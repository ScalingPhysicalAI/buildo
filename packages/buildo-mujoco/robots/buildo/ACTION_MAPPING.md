# `BuildoActionChunk` → `buildo_v0.xml` control surface

Normative mapping between one `actions[i]` entry of `BuildoActionChunk`
(`packages/buildo-schema/spec/SCHEMA.md`) and this model's actual MuJoCo
joints/actuators/sites. This is where the schema (task-space, robot-agnostic)
meets one specific robot model (joint-space, MuJoCo-specific) for the first
time -- exactly the seam Phase 3/4's policy server and browser controller
will sit on.

## Frame convention (not pinned down in SCHEMA.md until now)

`left_arm.ee_position` / `ee_orientation_quat` (and the right arm's) are
**relative to the `buildo_lift` body** -- the mount the arms are actually
attached to, which already reflects the base's current x/y/yaw *and* the
lift's current height. Not `buildo_base` (ground level) and not world/odom:
picking the lift frame means the arm's target doesn't need to change as the
lift raises/lowers, which is the more natural frame for a policy reasoning
about its own hands. `SCHEMA.md` should gain a one-line note to this effect
next time it's touched; recording it here now so this mapping isn't
ambiguous in the meantime.

**This has a real consequence for the controller, confirmed by building the
reference implementation, not just a theoretical note**: because the target
is mount-relative and the mount moves (base driving + lift raising, in the
same chunk as an arm motion), the arm's IK must be re-solved against the
mount's *current* pose at a high rate (every physics tick in
`apply_action_chunk.py`'s self-test, ~1kHz) -- solving it once per action
chunk and holding the resulting joint targets fixed for the whole
300-1000ms chunk drifts by however far the base/lift moved in that window
(confirmed: a single-shot solve here was off by 74mm on an 0.5s chunk with
a 5cm base move and 15cm lift move; re-solving continuously brought both
arms to ~2mm). Phase 4's browser controller needs the same re-solve rate,
not just the same math.

## Field-by-field mapping

| `BuildoActionChunk` field | Type / units | `buildo_v0.xml` target | How |
|---|---|---|---|
| `base.vx`, `base.vy` | m/s, base-frame | joints `base_x`, `base_y` via actuators `base_x_act`, `base_y_act` | **Velocity, not position** -- these are `<position>` actuators. The client integrates: `ctrl_x += vx * action_dt` (clamped to the previous chunk's leftover error), then writes the integrated target as `ctrl`. This integration state lives in the client's controller, not in the model or the schema. |
| `base.yaw_rate` | rad/s | joint `base_yaw` via `base_yaw_act` | Same integration pattern: `ctrl_yaw += yaw_rate * action_dt`. |
| `lift.height` | m, absolute | joint `lift_z` via `lift_z_act` | Direct passthrough -- already an absolute position target, range `[0, 0.4]`. Clamp to range before writing. |
| `left_arm.ee_position` (`[x,y,z]`), `ee_orientation_quat` (`[w,x,y,z]`) | m, mount-frame (`buildo_lift`) | site `arms_left_ee_control_point`; solved onto joints `arms_openarm_left_joint1..7` | Transform mount-frame target into world via `buildo_lift`'s *current* pose, then differential (damped-least-squares) IK using the site's Jacobian (`mj_jac`/`mj_jacSite`), seeded from the arm's current `qpos` each solve so it converges to the nearest solution rather than jumping configurations. Output written to actuators `arms_left_joint{1..7}_ctrl`. See `scripts/apply_action_chunk.py` for a tested reference solve. |
| `right_arm.*` | same | site `arms_right_ee_control_point`; joints `arms_openarm_right_joint1..7`; actuators `arms_right_joint{1..7}_ctrl` | Same method. Note the right arm's joint *ranges* are mirrored from the left's (e.g. `joint1`: left `[-3.4907, 1.3963]`, right `[-1.3963, 3.4907]`) -- irrelevant to the IK solve itself (it works in Cartesian error regardless of joint sign convention), but don't assume left/right ctrl values are symmetric if you ever bypass IK and drive joints directly. |
| `left_hand.grip_target` | `[0, 1]`, 0=open 1=closed | actuator `arms_left_finger1_ctrl` | `ctrl = grip_target * 0.7854`. `openarm_left_finger_joint2` is not separately actuated -- an `<equality>` mimic constraint in the vendored model drives it from `finger_joint1` (`joint2 = 1.0 * joint1`), so one control value is enough. |
| `right_hand.grip_target` | `[0, 1]` | actuator `arms_right_finger1_ctrl` | `ctrl = -grip_target * 0.7854` (sign flipped vs. the left hand -- the right gripper's joint range is `[-0.7854, 0]`, mirrored geometry). Same mimic-constraint note applies (`arms_right_ee_finger_joint_mimic`). |

`head` has no entry in `BuildoActionChunk` and none is added here --
`buildo_v0.xml`'s head is a fixed camera mount (see `buildo_v0.xml`'s own
comments), not an actuated joint, matching the doc's action-space table
exactly (base/lift/arms/hands only).

## What this does not do yet

This is the mapping, not the controller. `scripts/apply_action_chunk.py`
is a **headless reference implementation** that proves the mapping is
realizable (IK actually converges) -- it is not the browser client
controller. Phase 4 wires an equivalent of this into `apps/portal`'s
MuJoCo viewer (TypeScript, running against the WASM build), including the
SAFE HOLD behavior on a missed policy-server deadline. Porting this same
math to TS when that phase starts, rather than inventing a different
approach, is the point of writing it here first where it's easy to test
headlessly.
