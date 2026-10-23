// Uploads an episode zip straight to Vercel Blob from the phone -- this
// never goes through our own backend's request body (which would hit
// Vercel's ~4.5MB serverless function limit for anything video-sized). The
// upload-url route only ever sees a token request and a completion
// callback, never the file itself.
import { upload } from "@vercel/blob/client";
import type { File } from "expo-file-system";

import { getToken } from "../api";
import { EPISODE_UPLOAD_URL } from "../skills-api";

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

export async function uploadEpisodeZip(
  zipFile: File,
  collectionId: string,
  environment: string,
  skillSlug: string
): Promise<string> {
  const token = await getToken();
  const localUri = zipFile.uri;

  // Same "fetch the local file into a real Blob first" pattern already
  // proven in api.ts's uploadKycId() -- RN's New Architecture networking
  // rejects the old FormData.append({uri,...}) shortcut, but there's no
  // FormData involved here at all: @vercel/blob/client's upload() does a
  // raw PUT with this Blob as the body.
  const fileResponse = await fetch(localUri);
  const blob = await fileResponse.blob();

  const result = await upload(episodeBlobPath(environment, skillSlug, collectionId), blob, {
    access: "private",
    contentType: "application/zip",
    handleUploadUrl: EPISODE_UPLOAD_URL,
    clientPayload: JSON.stringify({ collectionId }),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  return result.url;
}
