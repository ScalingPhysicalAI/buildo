import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Two-phase route Vercel Blob's client `upload()` calls itself: once to mint
// a short-lived, path-scoped token before the phone uploads anything (this
// server never sees the file bytes), and once more after the upload lands,
// to tell us it's done. Only the FIRST call actually comes from our own
// authenticated mobile client -- the second is a server-to-server webhook
// from Vercel's own infrastructure once the blob is stored, which carries
// no user session at all (handleUpload() itself verifies that request is
// genuinely from Vercel). Checking auth unconditionally before
// handleUpload() would 401 every real upload's completion callback.
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  const isTokenRequest = body.type === "blob.generate-client-token";

  let userId: string | null = null;
  if (isTokenRequest) {
    userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    // Not checking for BLOB_READ_WRITE_TOKEN specifically here -- Vercel's
    // newer OIDC + BLOB_STORE_ID auth needs no explicit token at all, and
    // handleUpload() below throws its own clear error either way if blob
    // credentials are genuinely missing.
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = clientPayload ? JSON.parse(clientPayload) : null;
        const collectionId = payload?.collectionId;
        if (typeof collectionId !== "string") {
          throw new Error("Missing collectionId");
        }

        const collection = await prisma.skillCollectionSession.findUnique({
          where: { id: collectionId },
          select: { userId: true },
        });
        if (!collection || collection.userId !== userId) {
          throw new Error("Not your recording");
        }
        // Ties the minted token to this exact collection's path -- a valid
        // collectionId alone shouldn't let the client point the upload at
        // an unrelated blob path.
        if (!pathname.endsWith(`/episodes/${collectionId}.zip`)) {
          throw new Error("Path doesn't match this recording");
        }

        return {
          allowedContentTypes: ["application/zip"],
          maximumSizeInBytes: 500 * 1024 * 1024, // 500MB -- generous headroom over the few-tens-of-MB a real episode runs
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ collectionId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const { collectionId } = JSON.parse(tokenPayload ?? "{}") as { collectionId?: string };
        if (!collectionId) return;
        await prisma.skillCollectionSession.update({
          where: { id: collectionId },
          data: { videoUrl: blob.url },
        });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload token request failed" },
      { status: 400 }
    );
  }
}
