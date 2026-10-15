// Object catalog for the simulator's add/remove-objects editor: every prop
// type packages/buildo-mujoco can place (props/catalog.json there, generated
// into public/mujoco/scene/props/catalog.json by build_environment.py --all),
// plus how added objects are spliced into an environment's MJCF.

import type { EnvironmentSource } from "./loadHumanoidScene";

const CATALOG_URL = "/mujoco/scene/props/catalog.json";
const SCENE_BASE_URL = "/mujoco/scene";

export type PropCategory = "kitchen" | "office" | "warehouse" | "fixtures";

export interface PropCatalogEntry {
  id: string;
  name: string;
  category: PropCategory;
  mass: number;
  /** Movable props get a free joint; static ones (fixtures, racks) don't. */
  movable: boolean;
  /** Bounding-box size and center in the prop's own frame (origin at the footprint center, on the floor). */
  size: [number, number, number];
  center: [number, number, number];
  /** <mesh> asset lines the body needs. */
  assets: string[];
  /** <body> template, at the origin, with "{name}" placeholders. */
  body: string;
}

let catalogPromise: Promise<PropCatalogEntry[]> | null = null;

export function loadPropCatalog(): Promise<PropCatalogEntry[]> {
  catalogPromise ??= fetch(CATALOG_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch ${CATALOG_URL}: ${res.status}`);
      return res.json() as Promise<Record<string, Omit<PropCatalogEntry, "id">>>;
    })
    .then((raw) => Object.entries(raw).map(([id, entry]) => ({ id, ...entry })));
  catalogPromise.catch(() => (catalogPromise = null));
  return catalogPromise;
}

/** An object added in the editor, in MuJoCo world coordinates. */
export interface AddedProp {
  name: string;
  propId: string;
  pos: [number, number, number];
  yawDeg: number;
}

function bodyXml(entry: PropCatalogEntry, added: AddedProp): string {
  const half = (added.yawDeg * Math.PI) / 360;
  const quat = [Math.cos(half), 0, 0, Math.sin(half)].map((v) => +v.toFixed(6)).join(" ");
  const pos = added.pos.map((v) => +v.toFixed(4)).join(" ");
  return entry.body
    .replace(/^<body name="\{name\}" pos="[^"]*" quat="[^"]*"/, `<body name="{name}" pos="${pos}" quat="${quat}"`)
    .replaceAll("{name}", added.name);
}

async function readText(env: EnvironmentSource): Promise<string> {
  const inMemory = env.files?.get(env.sceneFile);
  if (inMemory !== undefined) return typeof inMemory === "string" ? inMemory : new TextDecoder().decode(inMemory);
  const res = await fetch(`${SCENE_BASE_URL}/${env.sceneFile}`);
  if (!res.ok) throw new Error(`Failed to fetch ${env.sceneFile}: ${res.status}`);
  return res.text();
}

/** The environment with `added` appended to its worldbody. Appending (rather than inserting
 * anywhere else) keeps every existing body/joint/qpos index unchanged, so the viewer can carry
 * the running simulation state across the reload by copying arrays. */
export async function withAddedProps(
  env: EnvironmentSource,
  added: readonly AddedProp[],
  catalog: readonly PropCatalogEntry[]
): Promise<EnvironmentSource> {
  if (added.length === 0) return env;
  const byId = new Map(catalog.map((e) => [e.id, e]));
  let xml = await readText(env);
  const assetLines: string[] = [];
  const bodies: string[] = [];
  for (const item of added) {
    const entry = byId.get(item.propId);
    if (!entry) continue;
    for (const line of entry.assets) {
      const name = /name="([^"]+)"/.exec(line)?.[1];
      if (name && !xml.includes(`name="${name}"`) && !assetLines.some((l) => l.includes(`name="${name}"`))) assetLines.push(line);
    }
    bodies.push(bodyXml(entry, item));
  }
  const lastWorldbodyEnd = xml.lastIndexOf("</worldbody>");
  if (lastWorldbodyEnd < 0) throw new Error(`${env.sceneFile} has no <worldbody>`);
  xml = `${xml.slice(0, lastWorldbodyEnd)}${bodies.join("\n")}\n${xml.slice(lastWorldbodyEnd)}`;
  if (assetLines.length) {
    const assetEnd = xml.lastIndexOf("</asset>");
    if (assetEnd >= 0) {
      xml = `${xml.slice(0, assetEnd)}${assetLines.join("\n")}\n${xml.slice(assetEnd)}`;
    } else {
      xml = xml.replace(/<mujoco\b[^>]*>/, (open) => `${open}\n<asset>\n${assetLines.join("\n")}\n</asset>`);
    }
  }
  const files = new Map(env.files ?? []);
  files.set(env.sceneFile, xml);
  return { sceneFile: env.sceneFile, files };
}

/** Catalog id behind a scene body name (prop_<id>_<n> from the build scripts, added_<id>_<n> from the editor). */
export function propIdForBody(bodyName: string, catalog: readonly PropCatalogEntry[]): string | null {
  const match = /^(?:prop|added)_(.+)_\d+$/.exec(bodyName);
  if (!match) return null;
  return catalog.some((e) => e.id === match[1]) ? match[1] : null;
}
