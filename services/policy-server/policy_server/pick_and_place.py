"""Phase 3's "policy": a scripted pick-and-place state machine, deliberately
not ML -- see this repo's phased build plan. Speaks BuildoObservation in,
BuildoActionChunk out (packages/buildo-schema), nothing more.

Borrowed, not copied, from apps/portal's existing MujocoViewer.tsx pick-and-
place workflow (search that file for "PickPhase"): the same phase sequence
and the same order-of-magnitude timings, which were tuned there against real
gripper/arm settling dynamics (see that file's own comments on PICK_REACH_S
etc. for why those specific numbers, not rounder ones, were kept). What is
NOT reused is that version's actual joint angles (PICK_GRASP_QPOS and
friends) -- those are specific to the humanoid model apps/portal's simulator
loads today, which has a completely different joint layout from OpenArm /
buildo_v0. This version re-targets the same *behavior* in task space
(ee_position/orientation + grip target) relative to wherever this specific
robot's arm and base actually report themselves to be, via the observation,
rather than hardcoded absolute numbers for one specific robot.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from buildo_schema import (
    ActionEntry,
    ArmAction,
    BaseAction,
    BuildoActionChunk,
    BuildoObservation,
    HandAction,
    LiftAction,
)

MODEL_VERSION = "scripted-pick-and-place/0.1"

# Timings in seconds -- same values as MujocoViewer.tsx's PICK_REACH_S etc.
REACH_S = 1.5
LOWER_S = 1.5
CLOSE_S = 0.5
SETTLE_S = 1.2
LIFT_S = 1.2
RELEASE_S = 0.7
RETRACT_S = 1.2
PHASE_DURATIONS = {
    "reach": REACH_S,
    "lower": LOWER_S,
    "close": CLOSE_S,
    "settle": SETTLE_S,
    "lift": LIFT_S,
    "lowerPlace": LOWER_S,
    "settlePlace": SETTLE_S,
    "release": RELEASE_S,
    "retract": RETRACT_S,
}
_LOOP_NEXT = {  # explicit table, not "next in a list" -- some phases repeat
    "reach": "lower",
    "lower": "close",
    "close": "settle",
    "settle": "lift",
    "lift": "driveToPlace",
    "lowerPlace": "settlePlace",
    "settlePlace": "release",
    "release": "retract",
    "retract": "driveToPick",  # loops forever, demo-style -- see class docstring
}

DRIVE_KP = 0.8
DRIVE_MAX_SPEED = 0.3  # m/s
DRIVE_ARRIVE_TOL = 0.05  # m
LIFT_HEIGHT = 0.15  # m -- held constant; this policy doesn't use the lift

# Right-hand end-effector offsets from wherever it started, in the mount
# frame (see ../../packages/buildo-mujoco/robots/buildo/ACTION_MAPPING.md) --
# meaning these apply equally whether "start" is the pick location or the
# place location, since the offsets are relative to the arm's own mount, not
# world coordinates. Illustrative placeholder numbers: there's no real
# kitchen/cup scene wired up for buildo_v0 yet (that's still
# apps/portal's old humanoid's scene), so these just have to be small enough
# for OpenArm's own reach and don't correspond to a specific real object yet.
PREGRASP_OFFSET = (0.15, 0.0, -0.05)
GRASP_OFFSET = (0.20, 0.0, -0.12)
CARRY_OFFSET = (0.05, 0.0, 0.10)

Vec3 = tuple[float, float, float]


def _smoothstep(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def _lerp3(a: Vec3, b: Vec3, s: float) -> Vec3:
    return (a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s)


def _add3(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _arm_offset_for_phase(phase: str, t: float) -> Vec3:
    if phase == "reach":
        return _lerp3((0, 0, 0), PREGRASP_OFFSET, _smoothstep(t / REACH_S))
    if phase in ("lower", "lowerPlace"):
        return _lerp3(PREGRASP_OFFSET, GRASP_OFFSET, _smoothstep(t / LOWER_S))
    if phase in ("close", "settle", "settlePlace", "release"):
        return GRASP_OFFSET
    if phase == "lift":
        return _lerp3(GRASP_OFFSET, CARRY_OFFSET, _smoothstep(t / LIFT_S))
    if phase == "driveToPlace":
        return CARRY_OFFSET
    if phase == "retract":
        return _lerp3(GRASP_OFFSET, (0, 0, 0), _smoothstep(t / RETRACT_S))
    return (0, 0, 0)  # driveToPick


def _grip_for_phase(phase: str, t: float) -> float:
    if phase == "close":
        return min(1.0, t / CLOSE_S)
    if phase in ("settle", "lift", "driveToPlace", "lowerPlace", "settlePlace"):
        return 1.0
    if phase == "release":
        return max(0.0, 1.0 - t / RELEASE_S)
    return 0.0  # driveToPick, reach, lower, retract


def _drive_velocity(current_xy: tuple[float, float], target_xy: tuple[float, float]) -> tuple[float, float]:
    ex, ey = target_xy[0] - current_xy[0], target_xy[1] - current_xy[1]
    vx = max(-DRIVE_MAX_SPEED, min(DRIVE_MAX_SPEED, DRIVE_KP * ex))
    vy = max(-DRIVE_MAX_SPEED, min(DRIVE_MAX_SPEED, DRIVE_KP * ey))
    return vx, vy


def _advance_phase(phase: str, elapsed: float, dt: float, drive_done: bool) -> tuple[str, float]:
    if phase in ("driveToPick", "driveToPlace"):
        if drive_done:
            return ("reach" if phase == "driveToPick" else "lowerPlace"), 0.0
        return phase, elapsed + dt
    new_elapsed = elapsed + dt
    duration = PHASE_DURATIONS[phase]
    if new_elapsed >= duration:
        return _LOOP_NEXT[phase], 0.0
    return phase, new_elapsed


@dataclass
class PickAndPlacePolicy:
    """One stateful rollout: drive to a pick spot, reach/lower/close/lift,
    drive to a place spot, lower/release/retract, then loop back to
    driveToPick -- forever, so this behaves like an always-on process
    responding to a stream of requests (Phase 3's actual point) rather than
    a one-shot script. A real deployment would sit in an "idle" state until
    told to start a task; this stub always runs since there's no such
    trigger in BuildoActionChunk yet.

    Only the right arm/hand perform the task; the left stays wherever the
    observation reports it (holding position) the whole time.
    """

    phase: str = "driveToPick"
    phase_elapsed: float = 0.0
    spawn_xy: Optional[tuple[float, float]] = None
    pick_waypoint: Optional[tuple[float, float]] = None
    place_waypoint: Optional[tuple[float, float]] = None
    right_home_pos: Optional[Vec3] = None
    right_home_quat: Optional[tuple[float, float, float, float]] = None

    def act(self, obs: BuildoObservation, n_entries: int = 10, action_dt: float = 0.05) -> BuildoActionChunk:
        if self.spawn_xy is None:
            self.spawn_xy = (obs.base_state.x, obs.base_state.y)
            # 1m out, 1m over -- illustrative waypoints, not tied to any real
            # scene geometry (see PREGRASP_OFFSET's own comment).
            self.pick_waypoint = (self.spawn_xy[0] + 1.0, self.spawn_xy[1])
            self.place_waypoint = (self.spawn_xy[0] + 1.0, self.spawn_xy[1] + 1.0)
        if self.right_home_pos is None:
            self.right_home_pos = obs.right_arm_state.ee_position
            self.right_home_quat = obs.right_arm_state.ee_orientation_quat

        target_xy = self.pick_waypoint if self.phase == "driveToPick" else self.place_waypoint
        # Frozen for the whole chunk -- we only have this one, current
        # observation, not the future ones a real closed loop would react to
        # mid-chunk. Fine for a straight-line drive over a fraction of a
        # second; see this class's own docstring on what's a stand-in here.
        vx, vy = _drive_velocity((obs.base_state.x, obs.base_state.y), target_xy)
        drive_done = math.hypot(obs.base_state.x - target_xy[0], obs.base_state.y - target_xy[1]) < DRIVE_ARRIVE_TOL

        entries: list[ActionEntry] = []
        phase, elapsed = self.phase, self.phase_elapsed
        for _ in range(n_entries):
            is_drive = phase in ("driveToPick", "driveToPlace")
            offset = _arm_offset_for_phase(phase, elapsed)
            grip = _grip_for_phase(phase, elapsed)
            right_pos = _add3(self.right_home_pos, offset)

            entries.append(
                ActionEntry(
                    base=BaseAction(vx=vx if is_drive else 0.0, vy=vy if is_drive else 0.0, yaw_rate=0.0),
                    lift=LiftAction(height=LIFT_HEIGHT),
                    left_arm=ArmAction(
                        ee_position=obs.left_arm_state.ee_position,
                        ee_orientation_quat=obs.left_arm_state.ee_orientation_quat,
                    ),
                    right_arm=ArmAction(ee_position=right_pos, ee_orientation_quat=self.right_home_quat),
                    left_hand=HandAction(grip_target=0.0),
                    right_hand=HandAction(grip_target=grip),
                )
            )
            phase, elapsed = _advance_phase(phase, elapsed, action_dt, drive_done)

        self.phase, self.phase_elapsed = phase, elapsed

        return BuildoActionChunk(
            schema_version="buildo-action-chunk/1.0",
            sequence_id=obs.sequence_id,
            model_version=MODEL_VERSION,
            action_start_time=obs.timestamp,
            action_dt=action_dt,
            actions=entries,
        )
