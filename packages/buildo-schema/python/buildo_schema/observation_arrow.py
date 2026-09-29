"""PyArrow (de)serialization for BuildoObservation.

Field names and nesting here must match ../ts/src/observation-arrow.ts
exactly -- Arrow IPC is a raw binary format keyed by these names, so a
mismatch means the two languages silently can't read each other's
messages. The conformance test in ../conformance is what actually proves
they still match; this docstring is not enough on its own.
"""

from __future__ import annotations

import pyarrow as pa

from .types import ArmState, BaseState, BuildoObservation, CameraFrame, HandState, LiftState

_VEC3 = pa.list_(pa.field("item", pa.float64()), 3)
_QUAT = pa.list_(pa.field("item", pa.float64()), 4)
_FLOAT_LIST = pa.list_(pa.field("item", pa.float64(), nullable=False))

_CAMERA_FRAME_TYPE = pa.struct(
    [
        pa.field("name", pa.utf8()),
        pa.field("width", pa.int32()),
        pa.field("height", pa.int32()),
        pa.field("encoding", pa.utf8()),
        pa.field("data", pa.binary()),
    ]
)

_BASE_STATE_TYPE = pa.struct(
    [
        pa.field("x", pa.float64()),
        pa.field("y", pa.float64()),
        pa.field("yaw", pa.float64()),
        pa.field("vx", pa.float64()),
        pa.field("vy", pa.float64()),
        pa.field("yawRate", pa.float64()),
    ]
)

_LIFT_STATE_TYPE = pa.struct([pa.field("height", pa.float64()), pa.field("velocity", pa.float64())])

_ARM_STATE_TYPE = pa.struct(
    [
        pa.field("jointPositions", _FLOAT_LIST),
        pa.field("eePosition", _VEC3),
        pa.field("eeOrientationQuat", _QUAT),
    ]
)

_HAND_STATE_TYPE = pa.struct(
    [pa.field("fingerPositions", _FLOAT_LIST), pa.field("gripClosed", pa.bool_())]
)


def _observation_schema() -> pa.Schema:
    return pa.schema(
        [
            pa.field("schemaVersion", pa.utf8()),
            pa.field("sequenceId", pa.utf8()),
            pa.field("timestamp", pa.float64()),
            pa.field("instruction", pa.utf8()),
            pa.field("cameraFrames", pa.list_(pa.field("item", _CAMERA_FRAME_TYPE))),
            pa.field("baseState", _BASE_STATE_TYPE),
            pa.field("liftState", _LIFT_STATE_TYPE),
            pa.field("leftArmState", _ARM_STATE_TYPE),
            pa.field("rightArmState", _ARM_STATE_TYPE),
            pa.field("leftHandState", _HAND_STATE_TYPE),
            pa.field("rightHandState", _HAND_STATE_TYPE),
            pa.field("leftTactile", _FLOAT_LIST, nullable=True),
            pa.field("rightTactile", _FLOAT_LIST, nullable=True),
        ]
    )


def _camera_frame_dict(frame: CameraFrame) -> dict:
    return {"name": frame.name, "width": frame.width, "height": frame.height, "encoding": frame.encoding, "data": frame.data}


def serialize_observation(obs: BuildoObservation) -> bytes:
    schema = _observation_schema()
    columns = {
        "schemaVersion": pa.array([obs.schema_version], type=pa.utf8()),
        "sequenceId": pa.array([obs.sequence_id], type=pa.utf8()),
        "timestamp": pa.array([obs.timestamp], type=pa.float64()),
        "instruction": pa.array([obs.instruction], type=pa.utf8()),
        "cameraFrames": pa.array([[_camera_frame_dict(f) for f in obs.camera_frames]], type=schema.field("cameraFrames").type),
        "baseState": pa.array([obs.base_state.model_dump(by_alias=True)], type=_BASE_STATE_TYPE),
        "liftState": pa.array([obs.lift_state.model_dump(by_alias=True)], type=_LIFT_STATE_TYPE),
        "leftArmState": pa.array([obs.left_arm_state.model_dump(by_alias=True)], type=_ARM_STATE_TYPE),
        "rightArmState": pa.array([obs.right_arm_state.model_dump(by_alias=True)], type=_ARM_STATE_TYPE),
        "leftHandState": pa.array([obs.left_hand_state.model_dump(by_alias=True)], type=_HAND_STATE_TYPE),
        "rightHandState": pa.array([obs.right_hand_state.model_dump(by_alias=True)], type=_HAND_STATE_TYPE),
        "leftTactile": pa.array([obs.left_tactile], type=_FLOAT_LIST),
        "rightTactile": pa.array([obs.right_tactile], type=_FLOAT_LIST),
    }
    table = pa.Table.from_pydict(columns, schema=schema)
    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, schema) as writer:
        writer.write_table(table)
    return sink.getvalue().to_pybytes()


def deserialize_observation(data: bytes) -> BuildoObservation:
    with pa.ipc.open_stream(data) as reader:
        table = reader.read_all()
    row = table.to_pylist()[0]
    return BuildoObservation.model_validate(row)
