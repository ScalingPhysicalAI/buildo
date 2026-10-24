// Uploads an episode zip straight to Vercel Blob from the phone -- this
// never goes through our own backend's request body (which would hit
// Vercel's ~4.5MB serverless function limit for anything video-sized). The
// upload-url route only ever sees a token request and a completion
// callback, never the file itself.
//
// This is a hand-rolled version of @vercel/blob/client's own upload()
// protocol, not the package itself: its /client entry (and the shared
// internals it pulls in) unconditionally imports Node's `crypto` and the
// `undici` package at the top of the file. Metro has no polyfill for
// either, so it can't bundle for React Native no matter how it's called --
// confirmed directly from a real bundling failure, not a guess. The actual
// wire protocol underneath (a JSON token request, then an authenticated
// PUT) is simple enough to replicate with plain fetch.
import type { File } from "expo-file-system";

import { getToken } from "../api";
import { EPISODE_UPLOAD_URL } from "../skills-api";

const BLOB_API_URL = "https://vercel.com/api/blob";

function pathSafe(segment: string): string {
  return segment.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

// environments/<env>/skills/<slug>/episodes/<collectionId>.zip -- mirrors
// how this data actually gets queried later ("every episode of skill X in
// environment Y"), and lets both modalities (glasses now, gloves later)
// land under the same per-episode folder without a path redesign.
function episodeBlobPath(environment: string, skillSlug: string, collectionId: string): string {
  return `environments/${pathSafe(environment)}/skills/${pathSafe(skillSlug)}/episodes/${collectionId}.zip`;
}

// Client tokens are "vercel_blob_client_<storeId>_<secret>" -- same
// split-and-index parse @vercel/blob itself uses for its read-write tokens.
function storeIdFromClientToken(token: string): string {
  return token.split("_")[3] ?? "";
}

export async function uploadEpisodeZip(
  zipFile: File,
  collectionId: string,
  environment: string,
  skillSlug: string
): Promise<string> {
  const authToken = await getToken();
  const pathname = episodeBlobPath(environment, skillSlug, collectionId);

  // Phase 1: ask our own route (not Vercel) for a short-lived client token
  // scoped to this exact path -- same body shape @vercel/blob/client's
  // upload() sends, so the existing handleUpload()-based route needs no
  // change on the server side.
  const tokenRes = await fetch(EPISODE_UPLOAD_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname, clientPayload: JSON.stringify({ collectionId }), multipart: false },
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.json().catch(() => null);
    throw new Error(body?.error ?? `Couldn't start the upload (${tokenRes.status})`);
  }
  const { clientToken } = (await tokenRes.json()) as { clientToken: string };

  // Same "fetch the local file into a real Blob first" pattern already
  // proven in api.ts's uploadKycId() -- RN's New Architecture networking
  // rejects the old FormData.append({uri,...}) shortcut.
  const fileResponse = await fetch(zipFile.uri);
  const blob = await fileResponse.blob();

  // Phase 2: PUT straight to Vercel's blob API with that token -- this
  // request never touches our server at all. Vercel's own infrastructure
  // calls our route's completion webhook once this lands, independent of
  // how the PUT itself was made.
  const putRes = await fetch(`${BLOB_API_URL}/?pathname=${encodeURIComponent(pathname)}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${clientToken}`,
      "x-vercel-blob-store-id": storeIdFromClientToken(clientToken),
      "x-api-version": "13",
      "x-vercel-blob-access": "private",
      "x-content-type": "application/zip",
    },
    body: blob,
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed (${putRes.status})`);
  }
  const result = (await putRes.json()) as { url: string };
  return result.url;
}
