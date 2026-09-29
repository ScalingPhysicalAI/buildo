# @buildo/mujoco (assets package, no JS)

MuJoCo/robot model assets, shared by anything that needs to load or convert
them — today that's `apps/portal`'s browser simulator; later phases add
headless Python training/eval against this same package.

- `Humanoid_description_latest_version/` — source URDF (ROS-style) for the
  robot currently used by the simulator.
- `mjcf/` — that URDF converted to MJCF (`scripts/urdf_to_mjcf.py`), the
  format MuJoCo actually loads. `apps/portal/scripts/sync-mujoco-assets.sh`
  copies this into the portal's `public/mujoco/` at build/dev time.
- `kitchen/` — the pick-and-place scene environment (meshes + manifest),
  produced from a purchased OBJ asset by `scripts/convert_kitchen_obj.py`.
- `scripts/` — the two conversion scripts above. Both resolve their own
  paths relative to this directory, so this package can move without
  editing them.
- `robots/openarm/` — the bimanual arm model vendored from
  [`enactic/openarm_mujoco`](https://github.com/enactic/openarm_mujoco).
  Untouched upstream files, own README with provenance/license and what
  was trimmed. Not wired into the portal's simulator yet.

Next: add Buildo's own mobile base/lift/head/hands as separate MJCF files
under `robots/buildo/` that `<include>` `robots/openarm/openarm_bimanual.xml`
rather than editing it, and wire the resulting action space to
`BuildoActionChunk` from `packages/buildo-schema`.
