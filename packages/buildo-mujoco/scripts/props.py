"""Props: objects placed in environments, from props/catalog.json.

A prop type is defined once in the catalog and placed by any environment
(environments/<id>/layout.json "props", or environments/kitchen/props.json
for the kitchen, which urdf_to_mjcf.py builds). Each placement is either
movable (a free body with real mass that falls, slides, stacks, gets pushed
by the robot, and can be grabbed) or static (welded to the world, e.g.
racks and wall fixtures).

Prop geometry comes from one of three sources:
    "primitive": boxes/cylinders/spheres/ellipsoids defined inline, at real
                 dimensions. Each one is both visual and collider unless
                 `"collide": false` (visual only) or `"hidden": true`
                 (collider only). See _expand_primitives() for the
                 "radial"/"repeat" shorthands.
    "polyhaven": a Poly Haven model id (CC0), with a simple collider
                 ("collider": "box" | "cylinder" | "tray" | {"boxes": [...]}).
    "kitchen":   parts cut out of the purchased kitchen's per-material meshes
                 (kitchen/meshes/), selected by connected component. The
                 kitchen's static copy has those parts removed (see
                 trim_kitchen_meshes()).

Local frame: footprint centered on the origin, resting on z=0, front facing
-Y (same as build_environment.py's imported models). Wall fixtures put the
wall on their +Y side.

Collision bitmask (see urdf_to_mjcf.py): the robot is contype 2 /
conaffinity 1, walls and furniture 1/1, the floor 4/4. Movable props are
8/15 -- they hit the robot, walls, furniture, the floor, and each other.
While a prop is held, the portal clears its conaffinity bit 2 so the held
object doesn't fight the arm carrying it (MujocoViewer.tsx). Static props
are 1/1 like furniture. Mesh geoms never collide (MuJoCo would use their
convex hull); colliders are separate primitives in group 3, which the
portal's loader hides.

Mass/inertia: one <inertial> per body from the colliders' bounding box and
the catalog mass, so visual meshes don't add phantom density-based mass.
"""

from __future__ import annotations

import json
import pathlib
from dataclasses import dataclass, field

import mujoco
import numpy as np
import trimesh

from assets import OUTPUT_DIR, ROOT, ImportedModel, euler_quat, fmt, quat_rotate, yaw_quat

CATALOG_PATH = ROOT / "props" / "catalog.json"
KITCHEN_SOURCE_DIR = ROOT / "kitchen"
OUTPUT_PROPS_DIR = OUTPUT_DIR / "props"

MOVABLE_BITS = 'contype="8" conaffinity="15"'
STATIC_BITS = 'contype="1" conaffinity="1"'
NO_COLLIDE_BITS = 'contype="0" conaffinity="0"'
# Torsional friction keeps objects from spinning in place on a single
# contact point; rolling friction stays off so round things still roll.
PROP_CONDIM = 4
# MuJoCo mixes two geoms' friction by taking the max unless their priorities
# differ. Movable props outrank the floor/furniture/robot (priority 0) so
# their own friction applies -- otherwise the floor's default 1.0 would
# override, e.g., an office chair's 0.05 casters and it couldn't be pushed.
PROP_PRIORITY = 1
DEFAULT_FRICTION = 0.7
TRAY_WALL = 0.008  # m, wall/bottom thickness of hollow ("tray") colliders
# Door/drawer joint limits. MuJoCo's default (0.02 s) is soft enough that a
# slammed door overshoots "closed" and wedges into its own carcass; 0.005 s is
# the stiffest that stays stable at the scene's 2 ms timestep.
PART_LIMIT_SOLREF = "0.005 1"


@dataclass
class Visual:
    """A visual mesh part (mesh asset) or a visual-only primitive."""
    mesh: str | None = None  # asset name
    file: str | None = None  # path relative to mjcf/
    rgba: tuple = (0.7, 0.7, 0.7, 1)
    geom: dict | None = None  # primitive: {"type", "size", "pos", "quat"}


@dataclass
class Collider:
    type: str
    size: tuple
    pos: tuple = (0, 0, 0)
    quat: tuple = (1, 0, 0, 0)
    rgba: tuple | None = None  # set: the collider is also the visual
    friction: float | None = None


@dataclass
class Part:
    """A door or drawer: a child body on one hinge or slide joint, in the
    prop's frame at its closed position."""
    name: str
    pos: tuple
    joint: str  # "hinge" | "slide"
    axis: tuple
    range: tuple  # degrees (hinge) or meters (slide); closed at 0
    mass: float
    damping: float
    frictionloss: float
    friction: float
    visuals: list[Visual] = field(default_factory=list)
    colliders: list[Collider] = field(default_factory=list)


@dataclass
class PropType:
    id: str
    name: str
    category: str
    mass: float
    friction: float
    movable: bool
    visuals: list[Visual] = field(default_factory=list)
    colliders: list[Collider] = field(default_factory=list)
    meshes: list[tuple[str, trimesh.Trimesh]] = field(default_factory=list)  # (asset name, mesh) to write
    lo: np.ndarray = field(default_factory=lambda: np.zeros(3))
    hi: np.ndarray = field(default_factory=lambda: np.zeros(3))
    # Kitchen-sourced props: where the cut-out parts sat in the room
    # (footprint center, bottom z), used as the default placement.
    origin: tuple | None = None
    credits: tuple | None = None  # (asset id, name, authors) for Poly Haven models
    parts: list[Part] = field(default_factory=list)


# --- geometry helpers -------------------------------------------------------

def _geom_local_box(type_: str, size, pos, quat) -> tuple[np.ndarray, np.ndarray]:
    """Axis-aligned bounds (in the prop frame) of one primitive."""
    size = list(size)
    if type_ == "box" or type_ == "ellipsoid":
        half = np.array(size[:3])
    elif type_ == "sphere":
        half = np.array([size[0]] * 3)
    elif type_ in ("cylinder", "capsule"):
        r, h = size[0], size[1] + (size[0] if type_ == "capsule" else 0)
        half = np.array([r, r, h])
    else:
        raise ValueError(f"unsupported primitive type {type_}")
    corners = np.array([[sx, sy, sz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]) * half
    world = np.array([quat_rotate(quat, c) for c in corners]) + np.asarray(pos)
    return world.min(axis=0), world.max(axis=0)


def _primitive_size(type_: str, size) -> tuple:
    return tuple(size[:3] if type_ in ("box", "ellipsoid") else size[:2] if type_ in ("cylinder", "capsule") else size[:1])


def _colliders_from_bounds(spec, lo: np.ndarray, hi: np.ndarray) -> list[Collider]:
    """Simple collider(s) for a mesh-based prop, from its bounds."""
    center = (lo + hi) / 2
    half = (hi - lo) / 2
    if spec is None or spec == "box":
        return [Collider("box", tuple(half), tuple(center))]
    if isinstance(spec, str):
        spec = {"type": spec}
    kind = spec.get("type")
    if kind == "cylinder":
        r = max(half[0], half[1])
        h = spec.get("height", hi[2] - lo[2]) / 2
        return [Collider("cylinder", (r, h), (center[0], center[1], lo[2] + h))]
    if kind == "tray":
        t = TRAY_WALL / 2
        hx, hy, hz = half
        cx, cy = center[0], center[1]
        return [
            Collider("box", (hx, hy, t), (cx, cy, lo[2] + t)),
            Collider("box", (hx, t, hz), (cx, cy - hy + t, center[2])),
            Collider("box", (hx, t, hz), (cx, cy + hy - t, center[2])),
            Collider("box", (t, hy, hz), (cx - hx + t, cy, center[2])),
            Collider("box", (t, hy, hz), (cx + hx - t, cy, center[2])),
        ]
    if "boxes" in spec:
        return [Collider("box", tuple(b["size"]), tuple(b["pos"])) for b in spec["boxes"]]
    raise ValueError(f"unknown collider spec {spec}")


def _primitive_geoms(spec: list[dict]) -> tuple[list[Collider], list[Visual]]:
    colliders, visuals = [], []
    for g in _expand_primitives(spec):
        quat = euler_quat(g["euler"]) if "euler" in g else (1, 0, 0, 0)
        size = _primitive_size(g["type"], g["size"])
        rgba = tuple(g.get("rgba", (0.7, 0.7, 0.7, 1)))
        if g.get("collide", True):
            shown = None if g.get("hidden") else rgba
            colliders.append(Collider(g["type"], size, tuple(g["pos"]), quat, rgba=shown, friction=g.get("friction")))
        else:
            visuals.append(Visual(rgba=rgba, geom={"type": g["type"], "size": size, "pos": tuple(g["pos"]), "quat": quat}))
    return colliders, visuals


def _primitive_boxes(colliders: list[Collider], visuals: list[Visual]) -> list[tuple[np.ndarray, np.ndarray]]:
    boxes = [_geom_local_box(c.type, c.size, c.pos, c.quat) for c in colliders]
    boxes += [_geom_local_box(v.geom["type"], v.geom["size"], v.geom["pos"], v.geom["quat"]) for v in visuals if v.geom]
    return boxes


def _expand_primitives(geoms: list[dict]) -> list[dict]:
    """Primitive shorthands:
    "radial": {"count": n, "radius": r, "start": deg} -- n copies around the z axis, each turned to face outward;
    "repeat": {"count": n, "step": [dx, dy, dz]} -- n copies in a row."""
    out = []
    for g in geoms:
        if "radial" in g:
            rad = g["radial"]
            for k in range(rad["count"]):
                a = rad.get("start", 0) + 360 * k / rad["count"]
                e = {key: val for key, val in g.items() if key != "radial"}
                ex, ey, ez = g.get("euler", (0, 0, 0))
                e["euler"] = (ex, ey, ez + a)
                e["pos"] = (
                    g["pos"][0] + rad["radius"] * np.cos(np.radians(a)),
                    g["pos"][1] + rad["radius"] * np.sin(np.radians(a)),
                    g["pos"][2],
                )
                out.append(e)
        elif "repeat" in g:
            rep = g["repeat"]
            for k in range(rep["count"]):
                e = {key: val for key, val in g.items() if key != "repeat"}
                e["pos"] = tuple(np.asarray(g["pos"], dtype=float) + k * np.asarray(rep["step"], dtype=float))
                out.append(e)
        else:
            out.append(g)
    return out


def _component_labels(mesh: trimesh.Trimesh) -> np.ndarray:
    return trimesh.graph.connected_component_labels(mesh.face_adjacency, node_count=len(mesh.faces))


def _select_faces(mesh: trimesh.Trimesh, region) -> np.ndarray:
    """Mask of faces in connected components whose bounding-box center is inside `region`
    ([center, half]); everything if region is None."""
    if region is None:
        return np.ones(len(mesh.faces), dtype=bool)
    center, half = np.asarray(region[0]), np.asarray(region[1])
    labels = _component_labels(mesh)
    mask = np.zeros(len(mesh.faces), dtype=bool)
    for label in np.unique(labels):
        faces = labels == label
        verts = mesh.vertices[np.unique(mesh.faces[faces])]
        c = (verts.min(axis=0) + verts.max(axis=0)) / 2
        if np.all(np.abs(c - center) <= half):
            mask |= faces
    return mask


def _load_kitchen_mesh(file: str) -> trimesh.Trimesh:
    mesh = trimesh.load(KITCHEN_SOURCE_DIR / "meshes" / file, force="mesh")
    mesh.merge_vertices()
    return mesh


# --- catalog ----------------------------------------------------------------

_catalog_cache: dict[str, PropType] = {}


def catalog_specs() -> dict[str, dict]:
    return {k: v for k, v in json.loads(CATALOG_PATH.read_text()).items() if not k.startswith("_")}


def get_prop(prop_id: str) -> PropType:
    if prop_id not in _catalog_cache:
        specs = catalog_specs()
        if prop_id not in specs:
            raise KeyError(f"prop {prop_id!r} isn't in {CATALOG_PATH.relative_to(ROOT)}")
        _catalog_cache[prop_id] = _build_prop(prop_id, specs[prop_id])
    return _catalog_cache[prop_id]


def _build_prop(prop_id: str, spec: dict) -> PropType:
    prop = PropType(
        id=prop_id,
        name=spec["name"],
        category=spec.get("category", "misc"),
        mass=float(spec["mass"]),
        friction=float(spec.get("friction", DEFAULT_FRICTION)),
        movable=bool(spec.get("movable", True)),
    )
    if "primitive" in spec:
        prop.colliders, prop.visuals = _primitive_geoms(spec["primitive"])
        boxes = _primitive_boxes(prop.colliders, prop.visuals)
        for p in spec.get("parts", []):
            part = Part(
                name=p["name"],
                pos=tuple(p["pos"]),
                joint=p["joint"],
                axis=tuple(p["axis"]),
                range=tuple(p["range"]),
                mass=float(p["mass"]),
                damping=float(p.get("damping", 1.0)),
                frictionloss=float(p.get("frictionloss", 0.2)),
                friction=float(p.get("friction", prop.friction)),
            )
            part.colliders, part.visuals = _primitive_geoms(p["primitive"])
            prop.parts.append(part)
            boxes += [(lo + part.pos, hi + part.pos) for lo, hi in _primitive_boxes(part.colliders, part.visuals)]
        prop.lo = np.min([b[0] for b in boxes], axis=0)
        prop.hi = np.max([b[1] for b in boxes], axis=0)
    elif "polyhaven" in spec:
        model = ImportedModel(f"prop_{prop_id}", spec["polyhaven"])
        scale = float(spec.get("scale", 1.0))
        for name, mesh, rgba in model.parts:
            mesh = mesh.copy()
            mesh.apply_scale(scale)
            prop.meshes.append((name, mesh))
            prop.visuals.append(Visual(mesh=name, file=f"props/{prop_id}/{name}.stl", rgba=tuple(rgba)))
        size = model.size * scale
        prop.lo = np.array([-size[0] / 2, -size[1] / 2, 0])
        prop.hi = np.array([size[0] / 2, size[1] / 2, size[2]])
        prop.colliders = _colliders_from_bounds(spec.get("collider"), prop.lo, prop.hi)
        prop.credits = (spec["polyhaven"], model.info.get("name", spec["polyhaven"]), ", ".join(model.info.get("authors", {}).keys()))
    elif "kitchen" in spec:
        manifest = {e["file"]: e for e in json.loads((KITCHEN_SOURCE_DIR / "manifest.json").read_text())}
        cut: list[tuple[trimesh.Trimesh, tuple]] = []
        for part in spec["kitchen"]:
            mesh = _load_kitchen_mesh(part["file"])
            mask = _select_faces(mesh, part.get("region"))
            if not mask.any():
                raise ValueError(f"prop {prop_id}: region selects nothing in {part['file']}")
            sub = trimesh.Trimesh(mesh.vertices, mesh.faces[mask], process=False)
            sub.remove_unreferenced_vertices()
            cut.append((sub, tuple(manifest[part["file"]]["rgba"])))
        verts = np.vstack([m.vertices for m, _ in cut])
        lo, hi = verts.min(axis=0), verts.max(axis=0)
        offset = np.array([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])
        prop.origin = (-offset[0], -offset[1], lo[2])
        for i, (mesh, rgba) in enumerate(cut):
            mesh.apply_translation(offset)
            name = f"prop_{prop_id}_{i}"
            prop.meshes.append((name, mesh))
            prop.visuals.append(Visual(mesh=name, file=f"props/{prop_id}/{name}.stl", rgba=rgba))
        prop.lo, prop.hi = lo + offset, hi + offset
        prop.colliders = _colliders_from_bounds(spec.get("collider"), prop.lo, prop.hi)
    else:
        raise ValueError(f"prop {prop_id} needs a primitive, polyhaven, or kitchen source")
    return prop


def kitchen_cut_regions() -> dict[str, list]:
    """Kitchen mesh file -> list of regions cut out into props (None = whole file)."""
    regions: dict[str, list] = {}
    for spec in catalog_specs().values():
        for part in spec.get("kitchen", []):
            regions.setdefault(part["file"], []).append(part.get("region"))
    return regions


def trim_kitchen_meshes(meshes_dir: pathlib.Path) -> set[str]:
    """Removes the parts that became props from the kitchen's static meshes
    (already copied into `meshes_dir`). Returns the files that were removed
    entirely, which the static import must skip."""
    removed = set()
    for file, regions in kitchen_cut_regions().items():
        path = meshes_dir / file
        if any(r is None for r in regions):
            path.unlink(missing_ok=True)
            removed.add(file)
            continue
        mesh = _load_kitchen_mesh(file)
        mask = np.zeros(len(mesh.faces), dtype=bool)
        for region in regions:
            mask |= _select_faces(mesh, region)
        if mask.all():
            path.unlink(missing_ok=True)
            removed.add(file)
        else:
            keep = trimesh.Trimesh(mesh.vertices, mesh.faces[~mask], process=False)
            keep.remove_unreferenced_vertices()
            keep.export(path)
    return removed


# The kitchen's static meshes are visual only (it collides through box
# primitives), and at full detail (800k faces) compiling it peaks close to the
# browser's 2 GB wasm heap, so the editor's recompile (adding an object) and
# switching back to the kitchen ran out of memory.
KITCHEN_MAX_FACES_PER_MESH = 10000


def decimate_meshes(meshes_dir: pathlib.Path, max_faces: int) -> None:
    for path in meshes_dir.glob("*.stl"):
        mesh = trimesh.load(path, force="mesh")
        if len(mesh.faces) > max_faces:
            mesh.merge_vertices()
            mesh.simplify_quadric_decimation(face_count=max_faces).export(path)


# --- MJCF emission ----------------------------------------------------------

def write_prop_meshes(prop: PropType) -> None:
    if not prop.meshes:
        return
    out = OUTPUT_PROPS_DIR / prop.id
    out.mkdir(parents=True, exist_ok=True)
    for name, mesh in prop.meshes:
        mesh.export(out / f"{name}.stl")


def asset_xml(props: list[PropType]) -> list[str]:
    return [f'  <mesh name="{v.mesh}" file="{v.file}"/>' for p in props for v in p.visuals if v.mesh]


def _inertial(colliders: list[Collider], mass: float) -> str:
    boxes = [_geom_local_box(c.type, c.size, c.pos, c.quat) for c in colliders]
    lo = np.min([b[0] for b in boxes], axis=0)
    hi = np.max([b[1] for b in boxes], axis=0)
    dx, dy, dz = np.maximum(hi - lo, 0.01)
    m = mass
    inertia = (m * (dy * dy + dz * dz) / 12, m * (dx * dx + dz * dz) / 12, m * (dx * dx + dy * dy) / 12)
    diag = " ".join(f"{v:.4g}" for v in inertia)
    return f'<inertial pos="{fmt((lo + hi) / 2)}" mass="{m:g}" diaginertia="{diag}"/>'


def _geom_lines(name: str, visuals: list[Visual], colliders: list[Collider], friction: float, movable: bool, indent: str) -> list[str]:
    bits = MOVABLE_BITS if movable else STATIC_BITS
    has_mesh_visuals = any(v.mesh for v in visuals)
    lines = []
    for i, v in enumerate(visuals):
        if v.mesh:
            lines.append(f'{indent}<geom name="{name}_v{i}" type="mesh" mesh="{v.mesh}" rgba="{fmt(v.rgba)}" {NO_COLLIDE_BITS}/>')
        else:
            g = v.geom
            lines.append(
                f'{indent}<geom name="{name}_v{i}" type="{g["type"]}" size="{fmt(g["size"])}" pos="{fmt(g["pos"])}" '
                f'quat="{fmt(g["quat"])}" rgba="{fmt(v.rgba)}" {NO_COLLIDE_BITS}/>'
            )
    for i, c in enumerate(colliders):
        mu = c.friction if c.friction is not None else friction
        visible = c.rgba is not None and not has_mesh_visuals
        look = f'rgba="{fmt(c.rgba)}"' if visible else 'group="3" rgba="0.5 0.5 0.5 0.3"'
        extra = (
            f' condim="{PROP_CONDIM}" priority="{PROP_PRIORITY}" friction="{mu:g} 0.005 0.0001"'
            if movable
            else f' friction="{mu:g} 0.005 0.0001"'
        )
        lines.append(
            f'{indent}<geom name="{name}_c{i}" type="{c.type}" size="{fmt(c.size)}" pos="{fmt(c.pos)}" '
            f'quat="{fmt(c.quat)}" {look} {bits}{extra}/>'
        )
    return lines


def _part_xml(part: Part, name: str, indent: str) -> list[str]:
    """A door/drawer body. Its colliders behave like a movable prop's (they hit
    the robot and other props); the static carcass it's mounted in still
    collides with it -- MuJoCo only skips parent/child contacts between two
    moving bodies -- so parts are modeled with a few mm of clearance."""
    lo, hi = part.range
    if part.joint == "hinge":
        lo, hi = np.radians(lo), np.radians(hi)
    lines = [
        f'{indent}<body name="{name}" pos="{fmt(part.pos)}">',
        f'{indent}  <joint name="{name}_joint" type="{part.joint}" axis="{fmt(part.axis)}" range="{lo:.4g} {hi:.4g}" limited="true" '
        f'damping="{part.damping:g}" frictionloss="{part.frictionloss:g}" armature="0.02" solreflimit="{PART_LIMIT_SOLREF}"/>',
        f"{indent}  {_inertial(part.colliders, part.mass)}",
    ]
    lines += _geom_lines(name, part.visuals, part.colliders, part.friction, True, indent + "  ")
    lines.append(f"{indent}</body>")
    return lines


def body_xml(prop: PropType, name: str, pos, yaw_deg: float = 0.0, movable: bool | None = None, indent: str = "  ") -> str:
    movable = prop.movable if movable is None else movable
    if prop.parts and movable:
        raise ValueError(f"prop {prop.id}: props with doors/drawers must be static")
    lines = [f'{indent}<body name="{name}" pos="{fmt(pos)}" quat="{fmt(yaw_quat(yaw_deg))}">']
    if movable:
        lines.append(f'{indent}  <freejoint name="{name}_free"/>')
        lines.append(f"{indent}  {_inertial(prop.colliders, prop.mass)}")
    lines += _geom_lines(name, prop.visuals, prop.colliders, prop.friction, movable, indent + "  ")
    for part in prop.parts:
        lines += _part_xml(part, f"{name}_{part.name}", indent + "  ")
    lines.append(f"{indent}</body>")
    return "\n".join(lines)


# --- placement ----------------------------------------------------------------

@dataclass
class Placement:
    prop: PropType
    name: str
    x: float
    y: float
    z: float  # requested bottom height; snapped onto whatever is under it
    yaw: float
    movable: bool


def _world_box(prop: PropType, x: float, y: float, z: float, yaw: float) -> tuple[np.ndarray, np.ndarray]:
    q = yaw_quat(yaw)
    corners = np.array([[a, b, c] for a in (prop.lo[0], prop.hi[0]) for b in (prop.lo[1], prop.hi[1]) for c in (prop.lo[2], prop.hi[2])])
    world = np.array([quat_rotate(q, p) for p in corners]) + np.array([x, y, z])
    return world.min(axis=0), world.max(axis=0)


def static_boxes_from_model(model: mujoco.MjModel) -> list[tuple[np.ndarray, np.ndarray]]:
    """World AABBs of every collidable geom attached to the world body (walls, furniture colliders, floor)."""
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    boxes = []
    for g in range(model.ngeom):
        if model.body_rootid[model.geom_bodyid[g]] != 0:
            continue
        if not (model.geom_contype[g] or model.geom_conaffinity[g]) or model.geom_type[g] == mujoco.mjtGeom.mjGEOM_PLANE:
            continue
        c, h = model.geom_aabb[g, :3], model.geom_aabb[g, 3:]
        rot = data.geom_xmat[g].reshape(3, 3)
        corners = np.array([[sx, sy, sz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]) * h + c
        world = corners @ rot.T + data.geom_xpos[g]
        boxes.append((world.min(axis=0), world.max(axis=0)))
    return boxes


SNAP_UP = 0.04  # m: a support surface may be this far above the requested bottom (requested slightly low)
SNAP_DOWN = 0.3  # m: ...or this far below (requested slightly high); otherwise the request stands
MAX_STACK_LIFT = 0.15  # m: most a prop is lifted to clear props it overlaps


def settle_heights(placements: list[Placement], static_boxes) -> None:
    """Snaps each placement's bottom onto the highest support under its
    footprint, lowest placements first (so stacked props land on the ones
    beneath). Avoids starting interpenetrated, which would make the
    simulation fling things apart on the first step."""
    boxes = list(static_boxes)
    placed: list[tuple[np.ndarray, np.ndarray]] = []
    for p in sorted(placements, key=lambda p: p.z):
        lo, hi = _world_box(p.prop, p.x, p.y, 0.0, p.yaw)
        # Only the middle of the footprint counts, so an object near a table edge still finds the table.
        cx, cy = (lo[:2] + hi[:2]) / 2
        hx, hy = (hi[:2] - lo[:2]) / 2 * 0.6
        support = None
        for blo, bhi in boxes + placed:
            if bhi[0] < cx - hx or blo[0] > cx + hx or bhi[1] < cy - hy or blo[1] > cy + hy:
                continue
            top = bhi[2]
            if p.z - SNAP_DOWN <= top <= p.z + SNAP_UP and (support is None or top > support):
                support = top
        if support is not None:
            p.z = support + 0.0005
        # Props overlapping anywhere under the full footprint (e.g. toast leaning on
        # pancakes in the source art) push this one up onto them instead of inside them.
        height = hi[2] - lo[2]
        for _ in range(len(placed)):
            blocking = [
                bhi[2] for blo, bhi in placed
                if bhi[0] > lo[0] and blo[0] < hi[0] and bhi[1] > lo[1] and blo[1] < hi[1]
                and bhi[2] > p.z and blo[2] < p.z + height and bhi[2] - p.z <= MAX_STACK_LIFT
            ]
            if not blocking:
                break
            p.z = max(blocking) + 0.0005
        wlo, whi = _world_box(p.prop, p.x, p.y, p.z, p.yaw)
        placed.append((wlo, whi))


def expand_repeats(entries: list[dict]) -> list[dict]:
    """Layout entries may carry "repeat": {"count": n, "step": [dx, dy]} to place a row."""
    out = []
    for entry in entries:
        rep = entry.get("repeat")
        if not rep:
            out.append(entry)
            continue
        for k in range(rep["count"]):
            e = {key: val for key, val in entry.items() if key != "repeat"}
            e["pos"] = [entry["pos"][0] + rep["step"][0] * k, entry["pos"][1] + rep["step"][1] * k]
            out.append(e)
    return out


def placements_from_layout(env_id: str, entries: list[dict]) -> list[Placement]:
    placements = []
    counts: dict[str, int] = {}
    for entry in expand_repeats(entries):
        prop = get_prop(entry["prop"])
        if "pos" in entry:
            x, y = entry["pos"]
            z = entry.get("z", 0.0)
        elif prop.origin is not None:
            x, y, z = prop.origin
        else:
            raise ValueError(f"{env_id}: prop {prop.id} needs a pos")
        n = counts.get(prop.id, 0)
        counts[prop.id] = n + 1
        name = entry.get("name") or f"prop_{prop.id}_{n}"
        placements.append(Placement(prop, name, x, y, z, entry.get("yaw", 0.0), entry.get("movable", prop.movable)))
    return placements


def emit(placements: list[Placement]) -> tuple[list[str], list[str]]:
    """(asset lines, body lines) for these placements; writes the props' meshes."""
    used = {p.prop.id: p.prop for p in placements}
    for prop in used.values():
        write_prop_meshes(prop)
    bodies = [body_xml(p.prop, p.name, (p.x, p.y, p.z), p.yaw, p.movable) for p in placements]
    return asset_xml(list(used.values())), bodies


def settle_check(composite_path: pathlib.Path, placements: list[Placement], seconds: float = 2.0) -> None:
    """Steps the composed scene (robot idle at its spawn) and reports movable
    props that don't come to rest where they were placed. Raises if anything
    flies off -- that means overlapping colliders, not a placement nit."""
    model = mujoco.MjModel.from_xml_path(str(composite_path))
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    ids = {p.name: mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, p.name) for p in placements if p.movable}
    start = {n: data.xpos[b].copy() for n, b in ids.items()}
    for _ in range(int(seconds / model.opt.timestep)):
        mujoco.mj_step(model, data)
    if not np.all(np.isfinite(data.qpos)):
        raise RuntimeError("simulation went unstable while settling props")
    moved = {n: float(np.linalg.norm(data.xpos[b] - start[n])) for n, b in ids.items()}
    bad = {n: d for n, d in moved.items() if d > 0.3}
    drifted = {n: d for n, d in moved.items() if 0.02 < d <= 0.3}
    for n, d in sorted(drifted.items(), key=lambda kv: -kv[1]):
        print(f"  note: {n} settled {d * 100:.1f} cm from where it was placed")
    if bad:
        raise RuntimeError(f"props flew off while settling (overlapping colliders?): {bad}")
    print(f"  {len(ids)} movable props settle cleanly ({len(drifted)} shifted 2-30 cm)")


def write_catalog_json() -> pathlib.Path:
    """mjcf/props/catalog.json: every prop type with its asset lines and a
    body template, for the portal's add/remove-object feature."""
    entries = {}
    for prop_id in catalog_specs():
        prop = get_prop(prop_id)
        write_prop_meshes(prop)
        entries[prop_id] = {
            "name": prop.name,
            "category": prop.category,
            "mass": prop.mass,
            "movable": prop.movable,
            "size": [round(float(v), 4) for v in prop.hi - prop.lo],
            "center": [round(float(v), 4) for v in (prop.hi + prop.lo) / 2],
            "assets": asset_xml([prop]),
            "body": body_xml(prop, "{name}", (0, 0, 0), 0, indent=""),
        }
    path = OUTPUT_PROPS_DIR / "catalog.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, indent=1) + "\n")
    return path


def credits(props) -> list[tuple]:
    return sorted({p.credits for p in props if p.credits})
