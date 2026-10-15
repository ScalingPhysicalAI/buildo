# @buildo/mujoco (assets package, no JS)

MuJoCo/robot model assets, shared by anything that needs to load or convert
them — today that's `apps/portal`'s browser simulator; later phases add
headless Python training/eval against this same package.

- `Humanoid_description_latest_version/` — source URDF (ROS-style) for the
  robot currently used by the simulator.
- `mjcf/` — generated output, the format MuJoCo actually loads.
  `apps/portal/scripts/sync-mujoco-assets.sh` copies it into the portal's
  `public/mujoco/scene/`.
  - `humanoid.xml` + `meshes/` — the robot alone, no room.
  - `environments/<id>/scene.xml` + `meshes/` — one MJCF fragment per room
    (kitchen, office, warehouse). Never loaded on its own.
  - `scene_<id>.xml` — robot + one room via `<include>`, for headless use:
    `mujoco.MjModel.from_xml_path("mjcf/scene_office.xml")`.
- `kitchen/` — the kitchen's source asset (purchased OBJ → per-material STLs +
  manifest via `scripts/convert_kitchen_obj.py`).
- `environments/<id>/layout.json` — declarative room layouts for every other
  environment (room size/colors + Poly Haven CC0 model placements).
- `scripts/` — `urdf_to_mjcf.py` (robot + kitchen), `build_environment.py`
  (layout-driven rooms), `convert_kitchen_obj.py`. All resolve paths relative
  to this directory.

## Regenerating

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/urdf_to_mjcf.py              # robot + kitchen
.venv/bin/python scripts/build_environment.py --all   # office, warehouse, ...
```

`mujoco` is pinned to 3.12.0 in `requirements.txt`: `urdf_to_mjcf.py`
post-processes `mj_saveLastXML` output as text, and other versions format it
differently (3.16 fails outright). 3.12.0 reproduces the committed `mjcf/`
byte-for-byte.

## Adding an environment

1. Write `environments/<id>/layout.json` (see `office/` and `warehouse/`, and
   the docstring at the top of `scripts/build_environment.py` for the
   schema). Models are referenced by [Poly Haven](https://polyhaven.com/models)
   id and downloaded into `environments/.cache/` (gitignored).
   `build_environment.py --surfaces <asset>` prints a model's size and the
   heights of its shelves/tabletops, for placing things on top of it.
2. `scripts/build_environment.py <id>` — writes `mjcf/environments/<id>/` and
   checks that robot + room compiles.
3. Copy into the portal (`apps/portal`: `pnpm sync:mujoco`, or copy `mjcf/`
   to `public/mujoco/scene/` directly if you don't want the engine files
   re-synced too).
4. Register it in `apps/portal/src/lib/mujoco/environments.ts` (name, camera
   framing, spawn point, lighting). It shows up in the simulator's
   environment picker.

Users can also load their own room from the picker ("Upload your own…"):
a `.zip` with one MJCF `.xml` plus its `.stl`/`.obj`/`.png` files, or a single
`.xml`/`.obj`/`.stl`. That never touches this package. It is validated,
recentered, fenced, and given a spawn point in the browser
(`apps/portal/src/lib/mujoco/uploadEnvironment.ts`, limits in `UPLOAD_LIMITS`)
and lives only in that browser tab.

Phase 2 adds `robots/openarm/` here (vendored from
[`enactic/openarm_mujoco`](https://github.com/enactic/openarm_mujoco)) as a
new, separate robot model — it does not touch the files above.
