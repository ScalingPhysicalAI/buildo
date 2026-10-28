import { Unzip, UnzipInflate } from "fflate";

import { applySpawn, loadHumanoidModel } from "./loadHumanoidScene";
import type { SimEnvironment } from "./environments";

// User-uploaded environments, validated and compiled entirely in the browser
// (nothing is sent to the server). An upload is turned into the same kind of
// MJCF fragment the built-in rooms use (see lib/mujoco/environments.ts), held
// in memory, and loaded through loadHumanoidModel's in-memory file path.
//
// Accepted inputs:
//   .zip  -- one MJCF .xml (asset + worldbody, optional named default classes)
//            plus the mesh/texture files it references, or just mesh files
//   .xml  -- a self-contained MJCF (primitives / builtin textures only)
//   .obj / .stl -- a single room or object mesh, wrapped automatically
//
// Every upload is then normalized the same way, so it behaves like a built-in
// room: recentered on the world origin with its floor at z=0, given collision
// roles that follow urdf_to_mjcf.py's bitmask convention, fenced in by
// invisible walls, and given a robot spawn point at the center (or the
// nearest spot that isn't inside furniture).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mujoco = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MjModel = any;

const MB = 1024 * 1024;

export const UPLOAD_LIMITS = {
  maxUploadBytes: 50 * MB,
  maxExtractedBytes: 200 * MB,
  maxFileBytes: 50 * MB,
  maxFiles: 300,
  maxXmlBytes: 2 * MB,
  maxTriangles: 1_500_000,
  maxBodies: 300,
  maxGeoms: 3000,
  maxFreeBodies: 50,
  /** Largest allowed footprint side (m). The robot's planar base is limited to +/-50m anyway. */
  maxExtentM: 60,
  maxHeightM: 30,
} as const;

export const UPLOAD_ACCEPT = ".zip,.xml,.obj,.stl";

const ASSET_EXTENSIONS = new Set(["xml", "stl", "obj", "png"]);
const IGNORED_EXTENSIONS = new Set(["mtl", "md", "txt", "json", "jpg", "jpeg"]);
const ALLOWED_TOP_LEVEL = new Set(["asset", "worldbody", "default", "compiler"]);
const DROPPED_TOP_LEVEL = new Set(["visual", "statistic", "option", "size"]);
const FORBIDDEN_ELEMENTS = new Set(["include", "attach", "plugin", "composite", "flexcomp", "skin", "extension"]);
const FILE_ATTRS = ["file", "fileright", "fileleft", "fileup", "filedown", "filefront", "fileback"];
const NAME_REF_ATTRS = ["mesh", "material", "texture", "hfield", "class", "childclass", "target"];
const NAME_PREFIX = "u_";
const AUTO_GEOM_PREFIX = "u__g";

// Collision roles (see urdf_to_mjcf.py's own bitmask comments): the robot's
// geoms are contype=2/conaffinity=1.
const COLLIDE_STATIC = { contype: 1, conaffinity: 1 }; // walls/furniture the robot can't pass through
const COLLIDE_FLOOR = { contype: 4, conaffinity: 4 }; // floor -- the robot's base mesh dips below z=0, so not bit 1
const COLLIDE_PROP = { contype: 8, conaffinity: 15 }; // free bodies: hit furniture, the robot, the floor and each other
const COLLIDE_NONE = { contype: 0, conaffinity: 0 };
// A mesh is collided as its convex hull, so a large one (a whole room, a
// counter run) becomes a solid block the robot spawns inside of. Above this
// half-extent, auto-assigned meshes are visual only.
const LARGE_MESH_HALF_EXTENT_M = 1.0;
const FLOOR_TOP_TOLERANCE_M = 0.03;
const MIN_ROOM_HALF_EXTENT_M = 3;
const FENCE_HEIGHT_M = 2.5;
const ROBOT_HEIGHT_M = 1.9;

export type UpAxis = "auto" | "z" | "y";

export class UploadError extends Error {}

export interface UploadResult {
  environment: SimEnvironment;
  warnings: string[];
}

type FileMap = Map<string, Uint8Array>;

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

function formatMB(bytes: number): string {
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
}

/** Normalizes a path from an archive or an MJCF file attribute. Returns null for anything that
 * could escape the upload's own directory. */
function normalizePath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (path.startsWith("/") || /^[a-z]+:/i.test(path) || parts.length === 0) return null;
  return parts.join("/");
}

function isJunkEntry(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  return path.startsWith("__MACOSX/") || base === ".DS_Store" || base.startsWith("._");
}

/** Streams the archive so the size limits hold even if an entry lies about its uncompressed size. */
function extractZip(bytes: Uint8Array): FileMap {
  const files: FileMap = new Map();
  let total = 0;
  let failure: UploadError | null = null;
  const fail = (message: string) => {
    failure ??= new UploadError(message);
  };

  const unzipper = new Unzip();
  unzipper.register(UnzipInflate);
  unzipper.onfile = (entry) => {
    if (failure || entry.name.endsWith("/") || isJunkEntry(entry.name)) return;
    const path = normalizePath(entry.name);
    if (!path) return fail(`"${entry.name}" has an unsafe path.`);
    const ext = extOf(path);
    if (IGNORED_EXTENSIONS.has(ext)) return;
    if (!ASSET_EXTENSIONS.has(ext)) {
      return fail(`"${path}" isn't a supported file type (allowed: ${[...ASSET_EXTENSIONS].map((e) => `.${e}`).join(", ")}).`);
    }
    if (files.size >= UPLOAD_LIMITS.maxFiles) return fail(`The archive has more than ${UPLOAD_LIMITS.maxFiles} files.`);

    const chunks: Uint8Array[] = [];
    let size = 0;
    entry.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) return fail(`Couldn't decompress "${path}": ${err.message}`);
      size += chunk.length;
      total += chunk.length;
      if (size > UPLOAD_LIMITS.maxFileBytes) {
        entry.terminate();
        return fail(`"${path}" is larger than ${formatMB(UPLOAD_LIMITS.maxFileBytes)} uncompressed.`);
      }
      if (total > UPLOAD_LIMITS.maxExtractedBytes) {
        entry.terminate();
        return fail(`The archive expands to more than ${formatMB(UPLOAD_LIMITS.maxExtractedBytes)}.`);
      }
      chunks.push(chunk);
      if (final) {
        const out = new Uint8Array(size);
        let offset = 0;
        for (const c of chunks) {
          out.set(c, offset);
          offset += c.length;
        }
        files.set(path, out);
      }
    };
    entry.start();
  };

  try {
    unzipper.push(bytes, true);
  } catch (err) {
    fail(`Not a valid .zip archive (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (failure) throw failure;
  if (files.size === 0) throw new UploadError("The archive doesn't contain any .xml, .stl, or .obj files.");
  return files;
}

function countTriangles(path: string, bytes: Uint8Array): number {
  const ext = extOf(path);
  if (ext === "stl") {
    if (bytes.length >= 84) {
      const declared = new DataView(bytes.buffer, bytes.byteOffset + 80, 4).getUint32(0, true);
      if (84 + declared * 50 === bytes.length) return declared;
    }
    const text = new TextDecoder().decode(bytes);
    if (!/^\s*solid/.test(text)) throw new UploadError(`"${path}" isn't a valid STL file.`);
    return (text.match(/facet\s+normal/g) ?? []).length;
  }
  if (ext === "obj") {
    let triangles = 0;
    for (const line of new TextDecoder().decode(bytes).split("\n")) {
      if (line.startsWith("f ")) triangles += Math.max(0, line.trim().split(/\s+/).length - 3);
    }
    return triangles;
  }
  return 0;
}

function parseAngleList(value: string): number[] {
  return value.trim().split(/\s+/).map(Number);
}

interface SanitizedScene {
  doc: XMLDocument;
  /** The <frame> wrapping the whole uploaded worldbody. */
  frame: Element;
  autoGeoms: string[];
  warnings: string[];
}

/** Rewrites an uploaded MJCF into a fragment that's safe to <include> next to the robot. */
function sanitizeMjcf(xmlText: string, xmlPath: string, files: FileMap, uploadDir: string): SanitizedScene {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new UploadError(`"${xmlPath}" isn't well-formed XML: ${doc.getElementsByTagName("parsererror")[0].textContent?.trim().slice(0, 200)}`);
  }
  const root = doc.documentElement;
  if (root.tagName !== "mujoco") throw new UploadError(`"${xmlPath}" isn't an MJCF file (root element must be <mujoco>, found <${root.tagName}>).`);

  // <compiler> settings that change how the file must be read. Anything else
  // in it would also apply to the robot, so the element itself is dropped.
  let angleIsDegree = true;
  let meshDir = "";
  let textureDir = "";
  for (const compiler of Array.from(root.getElementsByTagName("compiler"))) {
    if (compiler.getAttribute("angle")) angleIsDegree = compiler.getAttribute("angle") !== "radian";
    const assetDir = compiler.getAttribute("assetdir") ?? "";
    meshDir = compiler.getAttribute("meshdir") ?? assetDir ?? meshDir;
    textureDir = compiler.getAttribute("texturedir") ?? assetDir ?? textureDir;
    if (compiler.getAttribute("eulerseq") && compiler.getAttribute("eulerseq") !== "xyz") {
      throw new UploadError(`<compiler eulerseq="${compiler.getAttribute("eulerseq")}"> isn't supported; use quat or the default xyz.`);
    }
  }

  for (const child of Array.from(root.children)) {
    if (DROPPED_TOP_LEVEL.has(child.tagName)) {
      warnings.push(`Ignored <${child.tagName}>: global settings come from the simulator.`);
      child.remove();
    } else if (!ALLOWED_TOP_LEVEL.has(child.tagName)) {
      throw new UploadError(
        `<${child.tagName}> isn't allowed in an environment. Environments may only contain <asset>, <worldbody>, and named <default> classes.`
      );
    } else if (child.tagName === "compiler") {
      child.remove();
    }
  }

  const all = Array.from(root.getElementsByTagName("*"));
  for (const el of all) {
    if (FORBIDDEN_ELEMENTS.has(el.tagName)) throw new UploadError(`<${el.tagName}> isn't supported in uploaded environments.`);
  }

  // Top-level default attributes would apply to the robot's geoms too; only named classes are allowed.
  for (const def of Array.from(root.children).filter((c) => c.tagName === "default")) {
    for (const child of Array.from(def.children)) {
      if (child.tagName !== "default" || !child.getAttribute("class")) {
        throw new UploadError(
          `Top-level <default> settings (<${child.tagName}> here) would change the robot too. Move them into a named class: <default class="...">.`
        );
      }
    }
  }

  const lights = Array.from(root.getElementsByTagName("light"));
  if (lights.length) {
    warnings.push(`Removed ${lights.length} <light> element(s): scene lighting comes from the simulator.`);
    lights.forEach((l) => l.remove());
  }

  const bodies = root.getElementsByTagName("body").length;
  const geomsInWorld = Array.from(root.getElementsByTagName("worldbody")).flatMap((w) => Array.from(w.getElementsByTagName("geom")));
  const freeBodies =
    root.getElementsByTagName("freejoint").length +
    Array.from(root.getElementsByTagName("joint")).filter((j) => j.getAttribute("type") === "free").length;
  if (bodies > UPLOAD_LIMITS.maxBodies) throw new UploadError(`Too many bodies (${bodies}, max ${UPLOAD_LIMITS.maxBodies}).`);
  if (geomsInWorld.length > UPLOAD_LIMITS.maxGeoms) throw new UploadError(`Too many geoms (${geomsInWorld.length}, max ${UPLOAD_LIMITS.maxGeoms}).`);
  if (freeBodies > UPLOAD_LIMITS.maxFreeBodies) throw new UploadError(`Too many free-moving bodies (${freeBodies}, max ${UPLOAD_LIMITS.maxFreeBodies}).`);
  if (geomsInWorld.length === 0) throw new UploadError("The environment has no geoms in its <worldbody>.");

  for (const el of Array.from(root.getElementsByTagName("*"))) {
    // Names: prefixed so they can't collide with the robot's own (e.g. "base_link").
    const name = el.getAttribute("name");
    if (name) el.setAttribute("name", NAME_PREFIX + name);
    if (el.tagName === "default" && el.getAttribute("class")) el.setAttribute("class", NAME_PREFIX + el.getAttribute("class"));
    for (const attr of NAME_REF_ATTRS) {
      if (el.tagName === "default" && attr === "class") continue;
      const ref = el.getAttribute(attr);
      if (ref) el.setAttribute(attr, NAME_PREFIX + ref);
    }

    // The robot's compiler is angle="radian"; MJCF's own default is degrees.
    if (angleIsDegree) {
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const euler = el.getAttribute("euler");
      if (euler) el.setAttribute("euler", parseAngleList(euler).map(toRad).join(" "));
      const axisangle = el.getAttribute("axisangle");
      if (axisangle) {
        const v = parseAngleList(axisangle);
        if (v.length === 4) v[3] = toRad(v[3]);
        el.setAttribute("axisangle", v.join(" "));
      }
      const jointType = el.getAttribute("type") ?? "hinge";
      if (el.tagName === "joint" && (jointType === "hinge" || jointType === "ball")) {
        for (const attr of ["range", "ref", "springref"]) {
          const v = el.getAttribute(attr);
          if (v) el.setAttribute(attr, parseAngleList(v).map(toRad).join(" "));
        }
      }
    }

    // Asset files: must exist in the upload, and get rewritten under its own directory.
    for (const attr of FILE_ATTRS) {
      const ref = el.getAttribute(attr);
      if (!ref) continue;
      const baseDir = el.tagName === "mesh" ? meshDir : el.tagName === "texture" ? textureDir : "";
      const xmlDir = xmlPath.includes("/") ? xmlPath.slice(0, xmlPath.lastIndexOf("/")) : "";
      const resolved = normalizePath([xmlDir, baseDir, ref].filter(Boolean).join("/"));
      if (!resolved) throw new UploadError(`<${el.tagName} ${attr}="${ref}"> points outside the upload.`);
      if (!files.has(resolved)) throw new UploadError(`<${el.tagName} ${attr}="${ref}"> references "${resolved}", which isn't in the upload.`);
      el.setAttribute(attr, `${uploadDir}/${resolved}`);
    }
  }

  // Geoms with no explicit collision setting get a role assigned after the
  // first compile (see classifyGeoms); until then they don't collide.
  const autoGeoms: string[] = [];
  geomsInWorld.forEach((geom, i) => {
    if (geom.hasAttribute("contype") || geom.hasAttribute("conaffinity")) return;
    if (!geom.getAttribute("name")) geom.setAttribute("name", `${AUTO_GEOM_PREFIX}${i}`);
    autoGeoms.push(geom.getAttribute("name")!);
    geom.setAttribute("contype", "0");
    geom.setAttribute("conaffinity", "0");
  });

  // Wrap everything in one <frame> so the whole room can be rotated
  // (Y-up meshes) and recentered without touching each element.
  const worldbodies = Array.from(root.children).filter((c) => c.tagName === "worldbody");
  const merged = doc.createElement("worldbody");
  const frame = doc.createElement("frame");
  frame.setAttribute("name", "u__root");
  merged.appendChild(frame);
  for (const wb of worldbodies) {
    for (const child of Array.from(wb.childNodes)) frame.appendChild(child);
    wb.remove();
  }
  root.appendChild(merged);

  return { doc, frame, autoGeoms, warnings };
}

function meshOnlyMjcf(meshPaths: string[]): string {
  const assets = meshPaths.map((p, i) => `    <mesh name="mesh${i}" file="${p}"/>`).join("\n");
  const geoms = meshPaths.map((_, i) => `    <geom type="mesh" mesh="mesh${i}" rgba="0.72 0.72 0.7 1"/>`).join("\n");
  return `<mujoco>\n  <asset>\n${assets}\n  </asset>\n  <worldbody>\n${geoms}\n  </worldbody>\n</mujoco>\n`;
}

interface Box3 {
  min: [number, number, number];
  max: [number, number, number];
}

/** World-frame axis-aligned bounds of a geom, from its local AABB (model.geom_aabb). */
function geomWorldBox(model: MjModel, data: Mujoco, g: number): Box3 {
  const a = model.geom_aabb;
  const c = [a[g * 6], a[g * 6 + 1], a[g * 6 + 2]];
  const h = [a[g * 6 + 3], a[g * 6 + 4], a[g * 6 + 5]];
  const p = [data.geom_xpos[g * 3], data.geom_xpos[g * 3 + 1], data.geom_xpos[g * 3 + 2]];
  const R = data.geom_xmat.subarray(g * 9, g * 9 + 9);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner++) {
    const local = [c[0] + (corner & 1 ? h[0] : -h[0]), c[1] + (corner & 2 ? h[1] : -h[1]), c[2] + (corner & 4 ? h[2] : -h[2])];
    for (let i = 0; i < 3; i++) {
      const w = p[i] + R[i * 3] * local[0] + R[i * 3 + 1] * local[1] + R[i * 3 + 2] * local[2];
      min[i] = Math.min(min[i], w);
      max[i] = Math.max(max[i], w);
    }
  }
  return { min, max };
}

interface CompiledInfo {
  model: MjModel;
  data: Mujoco;
  envGeoms: number[];
  robotRoot: number;
}

async function compile(mujoco: Mujoco, sceneFile: string, files: Map<string, Uint8Array | string>): Promise<CompiledInfo> {
  let model: MjModel;
  try {
    model = await loadHumanoidModel(mujoco, { sceneFile, files });
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err).replace(/^MuJoCo Error: /, "");
    throw new UploadError(`MuJoCo couldn't compile the environment: ${message.slice(0, 400)}`);
  }
  const data = new mujoco.MjData(model);
  mujoco.mj_forward(model, data);
  const robotRoot = model.body_rootid[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, "virtual_base_x")];
  const envGeoms: number[] = [];
  for (let g = 0; g < model.ngeom; g++) {
    if (model.body_rootid[model.geom_bodyid[g]] !== robotRoot) envGeoms.push(g);
  }
  return { model, data, envGeoms, robotRoot };
}

function release(info: CompiledInfo) {
  info.data.delete?.();
  info.model.delete?.();
}

function serialize(doc: XMLDocument): string {
  return new XMLSerializer().serializeToString(doc);
}

function sceneCamera(halfX: number, halfY: number, height: number): SimEnvironment["camera"] {
  const camY = Math.min(Math.max(height * 0.85, 2.2), 6);
  const cx = halfX * 0.8;
  const cz = halfY * 0.8;
  const lookAt: [number, number, number] = [0, 0.7, 0];
  return {
    orbitPosition: [cx, camY, cz],
    orbitTarget: [0, 0.6, 0],
    corners: [
      { pos: [cx, camY, cz], lookAt },
      { pos: [-cx, camY, cz], lookAt },
      { pos: [-cx, camY, -cz], lookAt },
      { pos: [cx, camY, -cz], lookAt },
    ],
  };
}

let uploadCounter = 0;

/**
 * Validates and normalizes an uploaded environment. `loadEngine` must return a fresh MuJoCo
 * WASM instance (validation compiles in its own instance so a bad upload can't disturb the
 * running simulation). Throws UploadError with a user-facing message on any problem.
 */
export async function prepareUploadedEnvironment(
  file: File,
  upAxis: UpAxis,
  loadEngine: () => Promise<Mujoco>,
  onProgress: (step: string) => void = () => {}
): Promise<UploadResult> {
  if (file.size > UPLOAD_LIMITS.maxUploadBytes) {
    throw new UploadError(`The file is ${formatMB(file.size)}; the limit is ${formatMB(UPLOAD_LIMITS.maxUploadBytes)}.`);
  }
  const ext = extOf(file.name);
  if (!["zip", "xml", "obj", "stl"].includes(ext)) throw new UploadError(`Unsupported file type ".${ext}". Upload a .zip, .xml, .obj, or .stl file.`);

  onProgress("Reading file");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files: FileMap = ext === "zip" ? extractZip(bytes) : new Map([[normalizePath(file.name) ?? `upload.${ext}`, bytes]]);

  let triangles = 0;
  for (const [path, data] of files) {
    triangles += countTriangles(path, data);
    if (triangles > UPLOAD_LIMITS.maxTriangles) {
      throw new UploadError(`The meshes have more than ${UPLOAD_LIMITS.maxTriangles.toLocaleString()} triangles in total. Decimate them first.`);
    }
  }

  const xmlPaths = [...files.keys()].filter((p) => extOf(p) === "xml");
  const meshPaths = [...files.keys()].filter((p) => ["stl", "obj"].includes(extOf(p)));
  let xmlPath: string;
  let xmlText: string;
  if (xmlPaths.length > 1) {
    const preferred = xmlPaths.find((p) => /(^|\/)(scene|environment)\.xml$/i.test(p));
    if (!preferred) throw new UploadError(`Found ${xmlPaths.length} .xml files. Name the main one scene.xml.`);
    xmlPath = preferred;
  } else {
    xmlPath = xmlPaths[0] ?? "";
  }
  if (xmlPath) {
    const xmlBytes = files.get(xmlPath)!;
    if (xmlBytes.length > UPLOAD_LIMITS.maxXmlBytes) throw new UploadError(`"${xmlPath}" is larger than ${formatMB(UPLOAD_LIMITS.maxXmlBytes)}.`);
    xmlText = new TextDecoder().decode(xmlBytes);
  } else if (meshPaths.length > 0) {
    xmlPath = "generated.xml";
    xmlText = meshOnlyMjcf(meshPaths);
  } else {
    throw new UploadError("No .xml or mesh file found.");
  }

  const resolvedUpAxis = upAxis !== "auto" ? upAxis : !xmlPaths.length && meshPaths.some((p) => extOf(p) === "obj") ? "y" : "z";
  const frameQuat = resolvedUpAxis === "y" ? "0.7071068 0.7071068 0 0" : "1 0 0 0";

  const id = `upload-${++uploadCounter}`;
  const uploadDir = `uploads/${id}`;
  const sceneFile = `${uploadDir}/scene.xml`;
  const memFiles = new Map<string, Uint8Array | string>();
  for (const [path, data] of files) if (path !== xmlPath) memFiles.set(`${uploadDir}/${path}`, data);

  onProgress("Checking MJCF");
  const { doc, frame, autoGeoms, warnings } = sanitizeMjcf(xmlText, xmlPath, files, uploadDir);
  frame.setAttribute("quat", frameQuat);

  onProgress("Starting physics engine");
  const mujoco = await loadEngine();

  // Pass 1: compile as uploaded (rotated, not yet moved) to measure it.
  onProgress("Compiling");
  memFiles.set(sceneFile, serialize(doc));
  const first = await compile(mujoco, sceneFile, memFiles);
  if (first.envGeoms.length > UPLOAD_LIMITS.maxGeoms) {
    release(first);
    throw new UploadError(`Too many geoms after compiling (${first.envGeoms.length}, max ${UPLOAD_LIMITS.maxGeoms}).`);
  }
  const PLANE = mujoco.mjtGeom.mjGEOM_PLANE.value;
  const MESH = mujoco.mjtGeom.mjGEOM_MESH.value;
  const FREE = mujoco.mjtJoint.mjJNT_FREE.value;
  const boxes = new Map<number, Box3>();
  const bounds: Box3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let lowestPlane = Infinity;
  for (const g of first.envGeoms) {
    if (first.model.geom_type[g] === PLANE) {
      lowestPlane = Math.min(lowestPlane, first.data.geom_xpos[g * 3 + 2]);
      continue;
    }
    const box = geomWorldBox(first.model, first.data, g);
    boxes.set(g, box);
    for (let i = 0; i < 3; i++) {
      bounds.min[i] = Math.min(bounds.min[i], box.min[i]);
      bounds.max[i] = Math.max(bounds.max[i], box.max[i]);
    }
  }
  if (!Number.isFinite(bounds.min[0])) throw new UploadError("The environment has no solid geometry (only planes).");
  const span = bounds.max.map((v, i) => v - bounds.min[i]);
  if (span[0] > UPLOAD_LIMITS.maxExtentM || span[1] > UPLOAD_LIMITS.maxExtentM || span[2] > UPLOAD_LIMITS.maxHeightM) {
    throw new UploadError(
      `The environment is ${span.map((s) => s.toFixed(1)).join(" x ")} m, larger than the ${UPLOAD_LIMITS.maxExtentM} m limit. ` +
        "Check that it's modeled in meters (not cm/mm) and that the up axis is right."
    );
  }
  // Floor height: a plane if there is one, else the top of the widest thin
  // slab near the bottom (a floor box/mesh), else the lowest point.
  const floorSlabs = [...boxes.values()].filter(
    (b) => Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) > 2 && b.max[2] - b.min[2] < 0.3 && b.min[2] < bounds.min[2] + 0.3
  );
  const floorZ = Number.isFinite(lowestPlane)
    ? lowestPlane
    : floorSlabs.length
      ? Math.max(...floorSlabs.map((b) => b.max[2]))
      : bounds.min[2];
  const center = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2];

  // Collision roles for geoms that didn't specify one.
  const geomId = (name: string) => mujoco.mj_name2id(first.model, mujoco.mjtObj.mjOBJ_GEOM.value, name);
  let visualOnlyMeshes = 0;
  for (const name of autoGeoms) {
    const g = geomId(name);
    if (g < 0) continue;
    const rootBody = first.model.body_rootid[first.model.geom_bodyid[g]];
    const isProp = rootBody !== 0 && first.model.body_jntnum[rootBody] > 0 && first.model.jnt_type[first.model.body_jntadr[rootBody]] === FREE;
    const box = boxes.get(g);
    let role = COLLIDE_STATIC;
    if (isProp) role = COLLIDE_PROP;
    else if (first.model.geom_type[g] === PLANE || (box && box.max[2] <= floorZ + FLOOR_TOP_TOLERANCE_M)) role = COLLIDE_FLOOR;
    else if (first.model.geom_type[g] === MESH && box && Math.max(...box.max.map((v, i) => v - box.min[i])) / 2 > LARGE_MESH_HALF_EXTENT_M) {
      role = COLLIDE_NONE;
      visualOnlyMeshes++;
    }
    const el = Array.from(doc.getElementsByTagName("geom")).find((e) => e.getAttribute("name") === name)!;
    el.setAttribute("contype", String(role.contype));
    el.setAttribute("conaffinity", String(role.conaffinity));
  }
  if (visualOnlyMeshes > 0) {
    warnings.push(
      `${visualOnlyMeshes} large mesh(es) are visual only, so the robot can drive through them. ` +
        "Add box/cylinder geoms (or set contype/conaffinity) for walls and furniture that should block it."
    );
  }
  const hasFloor = Number.isFinite(lowestPlane) || floorSlabs.length > 0;
  release(first);

  // Pass 2: recentered, floor at z=0, fenced in.
  frame.setAttribute("pos", `${-center[0]} ${-center[1]} ${-floorZ}`);
  const halfX = Math.max(span[0] / 2, MIN_ROOM_HALF_EXTENT_M) + 0.3;
  const halfY = Math.max(span[1] / 2, MIN_ROOM_HALF_EXTENT_M) + 0.3;
  const t = 0.1;
  const worldbody = doc.getElementsByTagName("worldbody")[0];
  const addGeom = (attrs: Record<string, string | number>) => {
    const geom = doc.createElement("geom");
    for (const [k, v] of Object.entries(attrs)) geom.setAttribute(k, String(v));
    worldbody.appendChild(geom);
  };
  addGeom({ name: "u__floor", type: "box", group: 3, pos: `0 0 -0.05`, size: `${halfX + t} ${halfY + t} 0.05`, ...COLLIDE_FLOOR });
  if (!hasFloor) addGeom({ name: "u__floor_visual", type: "box", pos: `0 0 -0.006`, size: `${halfX} ${halfY} 0.005`, rgba: "0.55 0.55 0.53 1", ...COLLIDE_NONE });
  const h = FENCE_HEIGHT_M / 2;
  for (const [name, pos, size] of [
    ["u__fence_n", `0 ${halfY + t} ${h}`, `${halfX + 2 * t} ${t} ${h}`],
    ["u__fence_s", `0 ${-halfY - t} ${h}`, `${halfX + 2 * t} ${t} ${h}`],
    ["u__fence_e", `${halfX + t} 0 ${h}`, `${t} ${halfY} ${h}`],
    ["u__fence_w", `${-halfX - t} 0 ${h}`, `${t} ${halfY} ${h}`],
  ]) {
    addGeom({ name, type: "box", group: 3, pos, size, ...COLLIDE_STATIC });
  }

  onProgress("Placing robot");
  memFiles.set(sceneFile, serialize(doc));
  const second = await compile(mujoco, sceneFile, memFiles);
  const obstacles: Box3[] = [];
  for (const g of second.envGeoms) {
    const blocksRobot = (second.model.geom_contype[g] & 1) !== 0 || (second.model.geom_conaffinity[g] & 2) !== 0;
    if (!blocksRobot || second.model.geom_type[g] === PLANE) continue;
    const box = geomWorldBox(second.model, second.data, g);
    if (box.max[2] > 0.03 && box.min[2] < ROBOT_HEIGHT_M) obstacles.push(box);
  }
  // Robot footprint: its farthest collidable part from the base, at the rest pose.
  const baseBody = mujoco.mj_name2id(second.model, mujoco.mjtObj.mjOBJ_BODY.value, "base_link");
  const bx = second.data.xpos[baseBody * 3];
  const by = second.data.xpos[baseBody * 3 + 1];
  let footprint = 0.3;
  for (let g = 0; g < second.model.ngeom; g++) {
    if (second.model.body_rootid[second.model.geom_bodyid[g]] !== second.robotRoot || second.model.geom_contype[g] === 0) continue;
    const box = geomWorldBox(second.model, second.data, g);
    for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) footprint = Math.max(footprint, Math.hypot(x - bx, y - by));
  }
  footprint = Math.min(footprint, 0.8);
  const isFree = (x: number, y: number) =>
    obstacles.every((b) => {
      const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
      const dy = Math.max(b.min[1] - y, 0, y - b.max[1]);
      return Math.hypot(dx, dy) > footprint;
    });
  // Base sits at (bx, by) when the virtual base joints are zero -- spawn is an offset from there.
  let spawn: { x: number; y: number } | null = null;
  const maxRadius = Math.max(halfX, halfY);
  for (let r = 0; r <= maxRadius && !spawn; r += 0.2) {
    const steps = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 0.2);
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * 2 * Math.PI;
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      if (Math.abs(x) > halfX - footprint || Math.abs(y) > halfY - footprint) continue;
      if (isFree(x, y)) {
        spawn = { x: x - bx, y: y - by };
        break;
      }
    }
  }
  if (!spawn) throw new UploadError("There's no open floor space big enough for the robot.");
  if (Math.hypot(spawn.x + bx, spawn.y + by) > 0.05) warnings.push("The room's center is occupied, so the robot starts at the nearest open spot.");

  // Short settle run: catches props that start interpenetrating or anything else that blows up.
  onProgress("Testing physics");
  applySpawn(mujoco, second.model, spawn);
  mujoco.mj_resetData(second.model, second.data);
  mujoco.mj_forward(second.model, second.data);
  // Read data.contact once: each access copies the contact buffer into wasm memory.
  const contacts = second.data.contact;
  for (let i = 0; i < second.data.ncon; i++) {
    const c = contacts.get(i);
    const robot1 = second.model.body_rootid[second.model.geom_bodyid[c.geom1]] === second.robotRoot;
    const robot2 = second.model.body_rootid[second.model.geom_bodyid[c.geom2]] === second.robotRoot;
    if (robot1 !== robot2 && c.dist < -0.01) {
      warnings.push("Part of the robot overlaps the environment at its start position; it may get pushed when the simulation starts.");
      break;
    }
  }
  for (let i = 0; i < 300; i++) mujoco.mj_step(second.model, second.data);
  const unstable = Array.from(second.data.qpos as Float64Array).some((v) => !Number.isFinite(v)) ||
    Array.from(second.data.qvel as Float64Array).some((v) => !Number.isFinite(v) || Math.abs(v) > 1e3);
  release(second);
  if (unstable) throw new UploadError("The simulation became unstable within the first second (objects overlapping or flying apart). Check for bodies placed inside each other.");

  const name = file.name.replace(/\.[^.]+$/, "");
  return {
    environment: {
      id,
      name: `Uploaded — ${name}`,
      description: `Uploaded from ${file.name}`,
      sceneFile,
      files: memFiles,
      background: "#d9dadc",
      spawn,
      camera: sceneCamera(halfX, halfY, Math.max(span[2], 2.5)),
      lighting: { focus: [0, 0.6, 0], shadowHalfExtent: [halfX + 1, halfY + 1] },
      workflows: [],
    },
    warnings,
  };
}
