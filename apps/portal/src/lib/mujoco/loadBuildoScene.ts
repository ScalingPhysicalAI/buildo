// Loads packages/buildo-mujoco/robots/buildo/buildo_v0.xml (synced by
// scripts/sync-buildo-assets.sh into public/mujoco-buildo/robots/) into the
// WASM engine's virtual filesystem. Separate from loadHumanoidScene.ts's
// loadHumanoidModel on purpose -- that one is what the live simulator uses
// today; this is a new, not-yet-wired-in model, and the two must not share
// a loader in case a bug in one ever affected the other.
//
// Unlike the humanoid (one flat meshes/ folder), buildo_v0.xml's <model
// file="../openarm/openarm_bimanual.xml"> is a relative path resolved
// against buildo_v0.xml's own directory -- so this mirrors the *entire*
// robots/{buildo,openarm}/ directory tree into the virtual filesystem
// instead of flattening it, via a manifest file (the browser can't list a
// directory over plain HTTP) rather than parsing which files the XML
// references.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mujoco = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MjModel = any;

const MANIFEST_URL = "/mujoco-buildo/robots/manifest.txt";
const ASSET_BASE = "/mujoco-buildo/robots";
const WORKING_DIR = "/working-buildo";
const ROOT_XML = "buildo/buildo_v0.xml";

function parentDirs(relPath: string): string[] {
  const parts = relPath.split("/");
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i++) dirs.push(parts.slice(0, i).join("/"));
  return dirs;
}

export async function loadBuildoModel(mujoco: Mujoco): Promise<MjModel> {
  const manifestText = await (await fetch(MANIFEST_URL)).text();
  const files = manifestText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!mujoco.FS.analyzePath(WORKING_DIR).exists) {
    mujoco.FS.mkdir(WORKING_DIR);
    mujoco.FS.mount(mujoco.MEMFS, { root: "." }, WORKING_DIR);
  }

  const dirs = new Set<string>();
  for (const relPath of files) for (const d of parentDirs(relPath)) dirs.add(d);
  for (const d of Array.from(dirs).sort()) {
    const full = `${WORKING_DIR}/${d}`;
    if (!mujoco.FS.analyzePath(full).exists) mujoco.FS.mkdir(full);
  }

  await Promise.all(
    files.map(async (relPath) => {
      const buf = await (await fetch(`${ASSET_BASE}/${relPath}`)).arrayBuffer();
      mujoco.FS.writeFile(`${WORKING_DIR}/${relPath}`, new Uint8Array(buf));
    })
  );

  return mujoco.MjModel.mj_loadXML(`${WORKING_DIR}/${ROOT_XML}`);
}
