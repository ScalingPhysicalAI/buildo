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
  was trimmed.
- `robots/buildo/` — `buildo_v0.xml`: a placeholder mobile base (planar
  x/y/yaw) + lift column + head, with OpenArm's bimanual arms attached at
  shoulder height via MuJoCo's `<model>`/`<attach>` composition (not a
  fork -- `robots/openarm/` stays untouched). `scene.xml` adds a floor and
  lights for standalone viewing/testing. Verified headless (`mujoco.MjModel
  .from_xml_path` + `mj_step`, 22 dof / 20 actuators, no attach-conflict
  warnings once cone/impratio were repeated per openarm_bimanual.xml's own
  note that `<option>` doesn't carry across `<attach>`).

Not wired into the portal's simulator yet (`apps/portal` still loads the
original humanoid from `mjcf/humanoid.xml`) -- that swap, and mapping this
model's action space onto `BuildoActionChunk` from `packages/buildo-schema`,
is the next step. Buildo's own dexterous hands aren't modeled yet either;
`buildo_v0.xml` uses OpenArm's built-in parallel-jaw grippers as an interim
end effector so the rest of the chain is testable now.
