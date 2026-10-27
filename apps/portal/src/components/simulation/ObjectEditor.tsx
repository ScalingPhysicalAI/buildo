"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import clsx from "clsx";

import { loadPropCatalog, type AddedProp, type PropCatalogEntry, type PropCategory } from "@/lib/mujoco/propCatalog";

export type Vec3 = [number, number, number];

export interface SceneObjectInfo {
  body: number;
  label: string;
  mass: number | null;
  movable: boolean;
  /** False for objects a scripted workflow depends on (the Serve coffee cup). */
  deletable: boolean;
  /** Has doors or drawers; `open` if any of them is. */
  openable: boolean;
  open: boolean;
}

export interface GhostSpec {
  entry: PropCatalogEntry;
  /** Bottom-center of the footprint, MuJoCo world frame. */
  pos: Vec3;
  yawDeg: number;
  valid: boolean;
}

export interface SurfaceHit {
  point: Vec3;
  /** World-frame normal of the face that was hit. */
  normal: Vec3;
  facesUp: boolean;
}

/** Scene access the viewer provides (MuJoCo world coordinates throughout). */
export interface ObjectEditorApi {
  pickObject(clientX: number, clientY: number): SceneObjectInfo | null;
  /** Point on the visible surface under the cursor, ignoring the robot and `excludeBody`. */
  surfaceAt(clientX: number, clientY: number, excludeBody?: number): SurfaceHit | null;
  /** False past the room's walls (always true for rooms without known walls). */
  insideRoom(point: Vec3): boolean;
  setGhost(ghost: GhostSpec | null): void;
  setSelected(body: number | null): void;
  /** Movable objects rest their bottom on `point`; fixtures slide along the floor, keeping their height. */
  moveObject(body: number, point: Vec3): void;
  rotateObject(body: number, deg: number): void;
  removeObject(body: number): void;
  /** Opens every door/drawer of the object, or closes them all if any is open. Returns the updated info. */
  toggleOpen(body: number): SceneObjectInfo | null;
  activeMovableCount(): number;
}

const opens = (entry: PropCatalogEntry) => /type="(?:hinge|slide)"/.test(entry.body);

/** Where a new object goes for a hit: on an upward face as is; against a wall or side face,
 * pushed out by its footprint so it stands in front of the face instead of inside it. */
function placementFor(entry: PropCatalogEntry, hit: SurfaceHit, yawDeg: number): Vec3 {
  if (hit.facesUp) return hit.point;
  const [px, py, pz] = hit.point;
  const z = entry.movable ? pz : 0;
  const len = Math.hypot(hit.normal[0], hit.normal[1]);
  if (len < 1e-6) return [px, py, z];
  const nx = hit.normal[0] / len;
  const ny = hit.normal[1] / len;
  const yaw = (yawDeg * Math.PI) / 180;
  const [sx, sy] = entry.size;
  const [cx, cy] = entry.center;
  // Footprint's half-extent along the normal, minus how far its center already sits off the origin that way.
  const along = (Math.abs(nx * Math.cos(yaw) + ny * Math.sin(yaw)) * sx + Math.abs(-nx * Math.sin(yaw) + ny * Math.cos(yaw)) * sy) / 2;
  const centerShift = nx * (Math.cos(yaw) * cx - Math.sin(yaw) * cy) + ny * (Math.sin(yaw) * cx + Math.cos(yaw) * cy);
  const d = along - centerShift + 0.01;
  return [px + nx * d, py + ny * d, z];
}

// Each movable object adds contacts to every physics step; past this the
// office/warehouse drop noticeably below realtime on a laptop.
export const MAX_MOVABLE_OBJECTS = 60;
// Each add recompiles the scene (~1s), and every added body stays in the model even if deleted later.
export const MAX_ADDED_OBJECTS = 40;
const ROTATE_STEP_DEG = 15;
const CLICK_SLOP_PX = 5;

const CATEGORIES: { id: PropCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "kitchen", label: "Kitchen" },
  { id: "office", label: "Office" },
  { id: "warehouse", label: "Warehouse" },
  { id: "fixtures", label: "Fixtures" },
];

type Tool = { kind: "none" } | { kind: "place"; entry: PropCatalogEntry } | { kind: "move"; body: number };

interface ObjectEditorProps {
  apiRef: RefObject<ObjectEditorApi | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  /** Changes whenever the scene is rebuilt (body ids survive a rebuild; the api object doesn't). */
  sceneKey: string;
  addedCount: number;
  onAdd(item: Omit<AddedProp, "name">): void;
  onClose(): void;
}

export function ObjectEditor({ apiRef, containerRef, sceneKey, addedCount, onAdd, onClose }: ObjectEditorProps) {
  const [catalog, setCatalog] = useState<PropCatalogEntry[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [category, setCategory] = useState<PropCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [tool, setTool] = useState<Tool>({ kind: "none" });
  const [yawDeg, setYawDeg] = useState(0);
  const [selected, setSelected] = useState<SceneObjectInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ghostRef = useRef<GhostSpec | null>(null);

  useEffect(() => {
    loadPropCatalog().then(setCatalog, (err: Error) => setCatalogError(err.message));
  }, []);

  // Re-apply the highlight after a rebuild, and clear editor visuals on close.
  useEffect(() => {
    apiRef.current?.setSelected(selected?.body ?? null);
  }, [apiRef, selected, sceneKey]);
  useEffect(() => {
    const api = apiRef;
    return () => {
      api.current?.setGhost(null);
      api.current?.setSelected(null);
    };
  }, [apiRef]);

  const limitReason = (entry: PropCatalogEntry): string | null => {
    if (addedCount >= MAX_ADDED_OBJECTS) return `This room already has ${MAX_ADDED_OBJECTS} added objects (the session limit).`;
    if (entry.movable && (apiRef.current?.activeMovableCount() ?? 0) >= MAX_MOVABLE_OBJECTS)
      return `This room has ${MAX_MOVABLE_OBJECTS} movable objects, the most it can simulate smoothly. Delete some first.`;
    return null;
  };

  const removeSelected = () => {
    if (!selected?.deletable) return;
    apiRef.current?.removeObject(selected.body);
    setSelected(null);
    setTool({ kind: "none" });
  };

  // The pointer/keyboard handlers below are attached once; they read the latest render's values from here.
  const latest = useRef({ tool, yawDeg, onAdd, limitReason, removeSelected });
  useEffect(() => {
    latest.current = { tool, yawDeg, onAdd, limitReason, removeSelected };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let downAt: { x: number; y: number } | null = null;
    let frame = 0;
    let last: { x: number; y: number } | null = null;

    const hover = () => {
      frame = 0;
      const api = apiRef.current;
      const t = latest.current.tool;
      if (!api || !last) return;
      if (t.kind === "place") {
        const hit = api.surfaceAt(last.x, last.y);
        if (!hit) {
          ghostRef.current = null;
          api.setGhost(null);
          return;
        }
        const yawDeg = latest.current.yawDeg;
        const pos = placementFor(t.entry, hit, yawDeg);
        const valid = latest.current.limitReason(t.entry) === null && api.insideRoom(pos);
        ghostRef.current = { entry: t.entry, pos, yawDeg, valid };
        api.setGhost(ghostRef.current);
      } else if (t.kind === "move") {
        const hit = api.surfaceAt(last.x, last.y, t.body);
        if (hit && api.insideRoom(hit.point)) api.moveObject(t.body, hit.point);
      }
    };
    const onMove = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(hover);
    };
    const onDown = (e: PointerEvent) => {
      downAt = e.target instanceof HTMLCanvasElement ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > CLICK_SLOP_PX) return;
      downAt = null;
      const api = apiRef.current;
      const t = latest.current.tool;
      if (!api) return;
      if (t.kind === "place") {
        last = { x: e.clientX, y: e.clientY };
        hover();
        const ghost = ghostRef.current;
        if (!ghost) return;
        const reason =
          latest.current.limitReason(t.entry) ??
          (api.insideRoom(ghost.pos) ? null : "That spot is outside the room. Click the floor or a surface inside it.");
        if (reason) {
          setNotice(reason);
          return;
        }
        setNotice(null);
        api.setGhost(null);
        ghostRef.current = null;
        latest.current.onAdd({ propId: t.entry.id, pos: ghost.pos, yawDeg: ghost.yawDeg });
      } else if (t.kind === "move") {
        setTool({ kind: "none" });
      } else {
        setSelected(api.pickObject(e.clientX, e.clientY));
      }
    };
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointerup", onUp);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointerup", onUp);
    };
  }, [apiRef, containerRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") {
        apiRef.current?.setGhost(null);
        ghostRef.current = null;
        if (latest.current.tool.kind === "none") setSelected(null);
        setTool({ kind: "none" });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        latest.current.removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apiRef]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (catalog ?? [])
      .filter((e) => category === "all" || e.category === category)
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog, category, query]);

  const choose = (entry: PropCatalogEntry) => {
    setNotice(limitReason(entry));
    setSelected(null);
    setTool((t) => (t.kind === "place" && t.entry.id === entry.id ? { kind: "none" } : { kind: "place", entry }));
    apiRef.current?.setGhost(null);
  };

  const rotate = (deg: number) => {
    if (tool.kind === "place") {
      setYawDeg((y) => (y + deg + 360) % 360);
    } else if (selected) {
      apiRef.current?.rotateObject(selected.body, deg);
    }
  };

  const chip = "rounded-sm border border-border-strong px-2 py-1 text-[11px] cursor-pointer transition-colors";
  const action = "rounded-sm border border-border-strong bg-panel px-3 py-1.5 text-xs text-off-white hover:bg-panel-raised cursor-pointer disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <>
      <div className="absolute top-14 left-4 z-10 flex max-h-[calc(100%-7rem)] w-72 flex-col rounded-sm border border-border-strong bg-panel/95 text-xs text-off-white backdrop-blur">
        <div className="flex items-center justify-between border-b border-border-strong px-3 py-2">
          <span className="text-technical text-sand">OBJECTS</span>
          <button onClick={onClose} aria-label="Close object editor" className="cursor-pointer text-off-white/60 hover:text-off-white">
            ×
          </button>
        </div>
        <div className="space-y-2 border-b border-border-strong px-3 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search objects"
            className="w-full rounded-sm border border-border-strong bg-black/30 px-2 py-1.5 text-xs text-off-white outline-none placeholder:text-off-white/40"
          />
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={clsx(chip, category === c.id ? "bg-off-white text-black" : "text-off-white/70 hover:bg-panel-raised")}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {catalogError && <p className="px-3 py-2 text-error">Couldn&apos;t load the catalog: {catalogError}</p>}
          {!catalog && !catalogError && <p className="px-3 py-2 text-off-white/50">Loading…</p>}
          {visible.map((entry) => {
            const active = tool.kind === "place" && tool.entry.id === entry.id;
            return (
              <button
                key={entry.id}
                onClick={() => choose(entry)}
                className={clsx(
                  "flex w-full items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-left last:border-0 cursor-pointer",
                  active ? "bg-sand/20 text-off-white" : "text-off-white/80 hover:bg-panel-raised"
                )}
              >
                <span className="truncate">{entry.name}</span>
                <span className="shrink-0 text-off-white/40">
                  {entry.movable ? `${entry.mass} kg` : opens(entry) ? "fixed · opens" : "fixed"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-border-strong px-3 py-2 text-off-white/60">
          {tool.kind === "place" ? (
            <div className="flex items-center justify-between gap-2">
              <span>Click in the scene to place · {yawDeg}°</span>
              <span className="flex gap-1">
                <button onClick={() => rotate(-ROTATE_STEP_DEG)} className={action} aria-label="Rotate left">
                  ⟲
                </button>
                <button onClick={() => rotate(ROTATE_STEP_DEG)} className={action} aria-label="Rotate right">
                  ⟳
                </button>
              </span>
            </div>
          ) : (
            <span>Pick an object to add, or click one in the scene to edit it. Physics is paused while editing.</span>
          )}
          {notice && <p className="mt-1.5 text-error">{notice}</p>}
        </div>
      </div>

      {selected && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-sm border border-border-strong bg-panel/95 px-3 py-2 text-xs text-off-white backdrop-blur">
          <span className="mr-1 max-w-56 truncate">
            {selected.label}
            {selected.mass !== null && <span className="text-off-white/50"> · {selected.movable ? `${+selected.mass.toFixed(2)} kg` : "fixed"}</span>}
          </span>
          <button
            onClick={() => setTool(tool.kind === "move" ? { kind: "none" } : { kind: "move", body: selected.body })}
            className={clsx(action, tool.kind === "move" && "bg-sand/30")}
          >
            {tool.kind === "move" ? "Click to drop" : "Move"}
          </button>
          <button onClick={() => rotate(-ROTATE_STEP_DEG)} className={action} aria-label="Rotate left">
            ⟲
          </button>
          <button onClick={() => rotate(ROTATE_STEP_DEG)} className={action} aria-label="Rotate right">
            ⟳
          </button>
          {selected.openable && (
            <button onClick={() => setSelected(apiRef.current?.toggleOpen(selected.body) ?? selected)} className={action}>
              {selected.open ? "Close" : "Open"}
            </button>
          )}
          <button
            onClick={removeSelected}
            disabled={!selected.deletable}
            title={selected.deletable ? undefined : "The Serve coffee workflow needs this object"}
            className={action}
          >
            Delete
          </button>
          <button onClick={() => setSelected(null)} aria-label="Deselect" className="cursor-pointer px-1 text-off-white/60 hover:text-off-white">
            ×
          </button>
        </div>
      )}
    </>
  );
}
