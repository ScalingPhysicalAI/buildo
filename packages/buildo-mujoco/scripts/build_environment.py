#!/usr/bin/env python3
"""Build a simulator environment from a declarative layout file.

    python3 scripts/build_environment.py office        # one environment
    python3 scripts/build_environment.py --all         # every environments/*/layout.json

Reads environments/<id>/layout.json and writes mjcf/environments/<id>/
(scene.xml + meshes/), the same format urdf_to_mjcf.py writes for the
kitchen: an MJCF fragment that the robot model <include>s alongside. Also
writes mjcf/props/ (prop meshes + catalog.json, see props.py). Run
apps/portal's `pnpm sync:mujoco` afterwards to copy it into the portal, then
register the environment in apps/portal/src/lib/mujoco/environments.ts.

Layout file:
    room:  x/y extents (m, MuJoCo world frame), wall height, colors. The
           robot spawns at the world origin unless the portal registry says
           otherwise, so keep ~1m around the spawn point clear.
    items: fixed furniture/decor. `asset` is a Poly Haven model id
           (https://polyhaven.com/models, all CC0) -- downloaded once into
           environments/.cache/ (gitignored). `pos` is the footprint center,
           `yaw` is degrees CCW from the model's own front (which faces -Y
           after import), `z` lifts it (e.g. onto a desk or shelf level).
           `collide: false` makes it visual-only (small decor resting on
           something that already has a collider).
    props: objects from props/catalog.json (see props.py) -- movable ones
           are real free bodies; `"movable": false` pins one in place. `z`
           is where the bottom should be; it's snapped onto whatever surface
           is under it. Both items and props take
           `"repeat": {"count": n, "step": [dx, dy]}` to place a row.
    decals: flat colored boxes with no collision (floor markings, rugs,
           baseboards beyond the automatic ones).

Collision follows urdf_to_mjcf.py's bitmask convention: walls/furniture are
contype=1/conaffinity=1 (the robot's body collides against bit 1), the floor
slab is bit 4 only (the robot's base mesh dips below z=0, see
_build_kitchen_collision_proxy()), movable props are 8/15 (see props.py),
and every furniture collider is an oriented box in group 3, which the
portal's three.js loader hides. Mesh geoms themselves are never collidable
-- MuJoCo would collide against each mesh's convex hull, which for furniture
is a solid block (see _build_kitchen_import()).
"""

from __future__ import annotations

import argparse
import json
import shutil

import mujoco

import props as props_lib
from assets import OUTPUT_DIR, ROOT, ImportedModel, fmt, yaw_quat

LAYOUTS_DIR = ROOT / "environments"

WALL_THICKNESS = 0.12
BASEBOARD_HEIGHT = 0.1
BASEBOARD_DEPTH = 0.015


def _box(name: str, center, half, rgba=None, quat=None, collide=False, group=None, floor=False) -> str:
    attrs = [f'name="{name}"', 'type="box"', f'pos="{fmt(center)}"', f'size="{fmt(half)}"']
    if quat is not None:
        attrs.append(f'quat="{fmt(quat)}"')
    if rgba is not None:
        attrs.append(f'rgba="{fmt(rgba)}"')
    if group is not None:
        attrs.append(f'group="{group}"')
    if floor:
        attrs.append('contype="4" conaffinity="4"')
    elif collide:
        attrs.append('contype="1" conaffinity="1"')
    else:
        attrs.append('contype="0" conaffinity="0"')
    return f"  <geom {' '.join(attrs)}/>"


def _room_geoms(env_id: str, room: dict) -> list[str]:
    (x0, x1), (y0, y1) = room["x"], room["y"]
    h = room["height"]
    t = WALL_THICKNESS
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2, (y1 - y0) / 2
    floor_rgba = room["floor_rgba"]
    wall_rgba = room["wall_rgba"]
    base_rgba = room.get("baseboard_rgba")
    lines = [
        _box(f"{env_id}_floor_visual", (cx, cy, -0.01), (hx + t, hy + t, 0.01), rgba=floor_rgba),
        _box(f"{env_id}_floor", (cx, cy, -0.05), (hx + t, hy + t, 0.05), group=3, floor=True),
    ]
    walls = {
        "south": ((cx, y0 - t / 2, h / 2), (hx + t, t / 2, h / 2)),
        "north": ((cx, y1 + t / 2, h / 2), (hx + t, t / 2, h / 2)),
        "west": ((x0 - t / 2, cy, h / 2), (t / 2, hy, h / 2)),
        "east": ((x1 + t / 2, cy, h / 2), (t / 2, hy, h / 2)),
    }
    for side, (center, half) in walls.items():
        lines.append(_box(f"{env_id}_wall_{side}", center, half, rgba=wall_rgba, collide=True))
    if base_rgba:
        b, d = BASEBOARD_HEIGHT / 2, BASEBOARD_DEPTH / 2
        boards = {
            "south": ((cx, y0 + d, b), (hx, d, b)),
            "north": ((cx, y1 - d, b), (hx, d, b)),
            "west": ((x0 + d, cy, b), (d, hy, b)),
            "east": ((x1 - d, cy, b), (d, hy, b)),
        }
        for side, (center, half) in boards.items():
            lines.append(_box(f"{env_id}_baseboard_{side}", center, half, rgba=base_rgba))
    return lines


def _write_scene(out_dir, env_id: str, asset_lines: list[str], geom_lines: list[str]):
    scene_xml = (
        f'<mujoco model="{env_id}">\n'
        f"<asset>\n" + "\n".join(asset_lines) + "\n</asset>\n"
        f"<worldbody>\n" + "\n".join(geom_lines) + "\n</worldbody>\n"
        "</mujoco>\n"
    )
    scene_path = out_dir / "scene.xml"
    scene_path.write_text(scene_xml)
    return scene_path


def build_environment(env_id: str):
    layout_path = LAYOUTS_DIR / env_id / "layout.json"
    layout = json.loads(layout_path.read_text())
    print(f"building {env_id} from {layout_path.relative_to(ROOT)}")
    items = props_lib.expand_repeats(layout.get("items", []))

    models: dict[str, ImportedModel] = {}
    for item in items:
        if item["asset"] not in models:
            models[item["asset"]] = ImportedModel(env_id, item["asset"])

    out_dir = OUTPUT_DIR / "environments" / env_id
    meshes_dir = out_dir / "meshes"
    if meshes_dir.exists():
        shutil.rmtree(meshes_dir)
    meshes_dir.mkdir(parents=True)

    asset_lines = []
    for model in models.values():
        for name, mesh, _ in model.parts:
            mesh.export(meshes_dir / f"{name}.stl")
            asset_lines.append(f'  <mesh name="{name}" file="environments/{env_id}/meshes/{name}.stl"/>')

    geom_lines = _room_geoms(env_id, layout["room"])
    for decal in layout.get("decals", []):
        geom_lines.append(
            _box(f"{env_id}_{decal['name']}", decal["center"], decal["half"], rgba=decal["rgba"],
                 quat=yaw_quat(decal.get("yaw", 0)))
        )

    for i, item in enumerate(items):
        model = models[item["asset"]]
        x, y = item["pos"]
        z = item.get("z", 0.0)
        quat = yaw_quat(item.get("yaw", 0.0))
        label = f"{env_id}_{i:02d}_{item['asset']}".lower()
        for j, (mesh_name, _, rgba) in enumerate(model.parts):
            geom_lines.append(
                f'  <geom name="{label}_v{j}" type="mesh" mesh="{mesh_name}" pos="{fmt((x, y, z))}" '
                f'quat="{fmt(quat)}" rgba="{fmt(rgba)}" contype="0" conaffinity="0"/>'
            )
        if item.get("collide", True):
            sx, sy, sz = model.size
            geom_lines.append(
                _box(f"{label}_collider", (x, y, z + sz / 2), (sx / 2, sy / 2, sz / 2), quat=quat, collide=True, group=3)
            )

    composite = OUTPUT_DIR / f"scene_{env_id}.xml"
    composite.write_text(
        f'<mujoco model="buildo_{env_id}">\n'
        '  <include file="humanoid.xml"/>\n'
        f'  <include file="environments/{env_id}/scene.xml"/>\n'
        "</mujoco>\n"
    )

    # Props: compile the room without them first, so each one can be snapped
    # onto the furniture actually under it.
    placements = props_lib.placements_from_layout(env_id, layout.get("props", []))
    _write_scene(out_dir, env_id, asset_lines, geom_lines)
    props_lib.settle_heights(placements, props_lib.static_boxes_from_model(mujoco.MjModel.from_xml_path(str(composite))))
    prop_assets, prop_bodies = props_lib.emit(placements)
    scene_path = _write_scene(out_dir, env_id, asset_lines + prop_assets, geom_lines + prop_bodies)

    prop_types = {p.prop.id: p.prop for p in placements}.values()
    credits = sorted(
        {(m.asset_id, m.info.get("name", m.asset_id), ", ".join(m.info.get("authors", {}).keys())) for m in models.values()}
        | set(props_lib.credits(prop_types))
    )
    (out_dir / "CREDITS.md").write_text(
        f"# {env_id} environment asset credits\n\n"
        "All models are from [Poly Haven](https://polyhaven.com) under CC0 (no attribution required, listed anyway). "
        "Props without a Poly Haven credit are built from primitives in props/catalog.json.\n\n"
        + "\n".join(f"- [{name}](https://polyhaven.com/a/{aid}) by {authors}" for aid, name, authors in credits)
        + "\n"
    )

    model = mujoco.MjModel.from_xml_path(str(composite))
    faces = sum(len(mesh.faces) for m in models.values() for _, mesh, _ in m.parts)
    size_mb = sum(p.stat().st_size for p in meshes_dir.glob("*.stl")) / 1e6
    movable = sum(p.movable for p in placements)
    print(f"  wrote {scene_path.relative_to(ROOT)}: {len(items)} items, {len(placements)} props ({movable} movable), "
          f"{sum(len(m.parts) for m in models.values())} meshes, {faces} faces, {size_mb:.1f} MB; "
          f"composite compiles ({model.ngeom} geoms, {model.nbody} bodies)")
    props_lib.settle_check(composite, placements)
    return scene_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("env_ids", nargs="*", help="environment ids (directories under environments/)")
    parser.add_argument("--all", action="store_true", help="build every environment with a layout.json, and the prop catalog")
    parser.add_argument("--surfaces", metavar="ASSET", help="print an asset's size and up-facing surface heights, then exit")
    args = parser.parse_args()

    if args.surfaces:
        model = ImportedModel("probe", args.surfaces)
        print(f"{args.surfaces}: size (x, y, z) = {fmt(model.size)}; surfaces at z = {model.up_surfaces()}")
        return

    env_ids = sorted(p.parent.name for p in LAYOUTS_DIR.glob("*/layout.json")) if args.all else args.env_ids
    if not env_ids:
        parser.error("pass environment ids or --all")
    for env_id in env_ids:
        build_environment(env_id)
    if args.all:
        path = props_lib.write_catalog_json()
        print(f"wrote {path.relative_to(ROOT)} ({len(props_lib.catalog_specs())} prop types)")


if __name__ == "__main__":
    main()
