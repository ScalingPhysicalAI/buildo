import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// Admin-only proxy for scripts/decrypt-episode.ts -- that script runs on a
// laptop, outside Vercel, so it has no way to read BLOB_READ_WRITE_TOKEN
// (Vercel marks it "sensitive": once set, its value can never be read back
// by anyone, CLI or dashboard -- that's a platform guarantee, not a bug).
// This route runs on Vercel itself, where the token still works fine at
// request time even though it can't be viewed, and just forwards the blob
// bytes to whoever holds ADMIN_SECRET. Never session-gated -- a CLI script
// has no browser session to present.
export async function GET(request: Request) {
  const secret = request.headers.get("x-admin-secret");
  if (!secret || !process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const collectionId = new URL(request.url).searchParams.get("collection");
  if (!collectionId) {
    return NextResponse.json({ error: "Missing ?collection=" }, { status: 400 });
  }

  const collection = await prisma.skillCollectionSession.findUnique({
    where: { id: collectionId },
    select: { videoUrl: true },
  });
  if (!collection?.videoUrl) {
    return NextResponse.json({ error: "Collection has no videoUrl yet" }, { status: 404 });
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json({ error: "Server is missing BLOB_READ_WRITE_TOKEN" }, { status: 500 });
  }

  const blobRes = await fetch(collection.videoUrl, { headers: { authorization: `Bearer ${blobToken}` } });
  if (!blobRes.ok || !blobRes.body) {
    return NextResponse.json({ error: `Blob fetch failed: ${blobRes.status}` }, { status: 502 });
  }

  return new NextResponse(blobRes.body, { status: 200, headers: { "content-type": "application/zip" } });
}
