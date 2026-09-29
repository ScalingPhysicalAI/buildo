# OpenArm (vendored)

Vendored, unmodified, from
[`enactic/openarm_mujoco`](https://github.com/enactic/openarm_mujoco)
at commit `c69cad6e51db68296cd5ebfd482caf54dc3cc9dd` (2026-09-29), the `v2`
bimanual arm model. Licensed Apache-2.0 (see `LICENSE` in this directory,
carried over unchanged from upstream).

Trimmed from upstream's `v2/` to just what `openarm_bimanual.xml` itself
references (`assets/visual/arm`, `assets/visual/gripper`,
`assets/collision`) — upstream's `assets/visual/body` and
`assets/visual/cell` are meshes for their own pedestal/work-cell fixtures,
which this file doesn't use and Buildo doesn't need (Buildo mounts these
arms on its own mobile base, built separately, not OpenArm's pedestal).

Verified with a headless load + single `mj_step` (`python -c "import
mujoco; ..."`, 18 dof / 16 actuators / 21 bodies) — see the commit that
added this directory.

**Do not edit files in this directory by hand.** If OpenArm needs a fix or
we need to update to a newer upstream version, re-run the same trimmed
copy from a fresh `enactic/openarm_mujoco` checkout and update the commit
hash above. Buildo's own base/lift/head/hands are separate MJCF files
elsewhere in `packages/buildo-mujoco/robots/` that `<include>` this file's
`openarm_bimanual.xml` — they don't fork or modify it.
