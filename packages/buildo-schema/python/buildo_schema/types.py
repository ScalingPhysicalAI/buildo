"""Python bindings for BuildoObservation/BuildoActionChunk.

Normative source: ../spec/SCHEMA.md. Field *wire names* (the `alias=`
below) are camelCase to match the TS bindings exactly -- Arrow IPC and JSON
are both keyed by these names verbatim, so they must be byte-identical
across languages for the conformance test (../conformance) to mean
anything. Python attribute names stay snake_case (idiomatic) via
`populate_by_name`; only the wire representation is shared.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class _Wire(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class CameraFrame(_Wire):
    name: str
    width: int
    height: int
    encoding: Literal["rgb8", "jpeg"]
    data: bytes


class BaseState(_Wire):
    x: float
    y: float
    yaw: float
    vx: float
    vy: float
    yaw_rate: float = Field(alias="yawRate")


class LiftState(_Wire):
    height: float
    velocity: float


class ArmState(_Wire):
    joint_positions: list[float] = Field(alias="jointPositions")
    ee_position: tuple[float, float, float] = Field(alias="eePosition")
    ee_orientation_quat: tuple[float, float, float, float] = Field(alias="eeOrientationQuat")


class HandState(_Wire):
    finger_positions: list[float] = Field(alias="fingerPositions")
    grip_closed: bool = Field(alias="gripClosed")


class BuildoObservation(_Wire):
    schema_version: Literal["buildo-observation/1.0"] = Field(alias="schemaVersion")
    sequence_id: str = Field(alias="sequenceId")
    timestamp: float
    instruction: str
    camera_frames: list[CameraFrame] = Field(alias="cameraFrames")
    base_state: BaseState = Field(alias="baseState")
    lift_state: LiftState = Field(alias="liftState")
    left_arm_state: ArmState = Field(alias="leftArmState")
    right_arm_state: ArmState = Field(alias="rightArmState")
    left_hand_state: HandState = Field(alias="leftHandState")
    right_hand_state: HandState = Field(alias="rightHandState")
    left_tactile: Optional[list[float]] = Field(default=None, alias="leftTactile")
    right_tactile: Optional[list[float]] = Field(default=None, alias="rightTactile")


class BaseAction(_Wire):
    vx: float
    vy: float
    yaw_rate: float = Field(alias="yawRate")


class LiftAction(_Wire):
    height: float


class ArmAction(_Wire):
    ee_position: tuple[float, float, float] = Field(alias="eePosition")
    ee_orientation_quat: tuple[float, float, float, float] = Field(alias="eeOrientationQuat")


class HandAction(_Wire):
    grip_target: float = Field(alias="gripTarget", ge=0, le=1)


class ActionEntry(_Wire):
    base: BaseAction
    lift: LiftAction
    left_arm: ArmAction = Field(alias="leftArm")
    right_arm: ArmAction = Field(alias="rightArm")
    left_hand: HandAction = Field(alias="leftHand")
    right_hand: HandAction = Field(alias="rightHand")


class BuildoActionChunk(_Wire):
    schema_version: Literal["buildo-action-chunk/1.0"] = Field(alias="schemaVersion")
    sequence_id: str = Field(alias="sequenceId")
    model_version: str = Field(alias="modelVersion")
    action_start_time: float = Field(alias="actionStartTime")
    action_dt: float = Field(alias="actionDt", gt=0)
    actions: list[ActionEntry]
