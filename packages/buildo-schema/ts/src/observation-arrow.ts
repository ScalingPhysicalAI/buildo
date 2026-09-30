import * as arrow from "apache-arrow";
import { BuildoObservationSchema, type BuildoObservation, type CameraFrame } from "./types.js";

// apache-arrow's own type inference (tableFromJSON) can't handle this
// shape -- it throws on the binary camera-frame data and doesn't attempt
// fixed-size lists at all. Every field's Arrow type is declared explicitly
// here instead; this file (not tableFromJSON) is the actual source of truth
// for the Arrow schema, so keep it in step with ../../spec/SCHEMA.md
// directly, not through inference.

const vec3Type = () => new arrow.FixedSizeList(3, new arrow.Field("item", new arrow.Float64()));
const quatType = () => new arrow.FixedSizeList(4, new arrow.Field("item", new arrow.Float64()));
const float64List = () => new arrow.List(new arrow.Field("item", new arrow.Float64(), false));

const cameraFrameType = new arrow.Struct([
  new arrow.Field("name", new arrow.Utf8()),
  new arrow.Field("width", new arrow.Int32()),
  new arrow.Field("height", new arrow.Int32()),
  new arrow.Field("encoding", new arrow.Utf8()),
  new arrow.Field("data", new arrow.Binary()),
]);

const baseStateType = new arrow.Struct([
  new arrow.Field("x", new arrow.Float64()),
  new arrow.Field("y", new arrow.Float64()),
  new arrow.Field("yaw", new arrow.Float64()),
  new arrow.Field("vx", new arrow.Float64()),
  new arrow.Field("vy", new arrow.Float64()),
  new arrow.Field("yawRate", new arrow.Float64()),
]);

const liftStateType = new arrow.Struct([
  new arrow.Field("height", new arrow.Float64()),
  new arrow.Field("velocity", new arrow.Float64()),
]);

const armStateType = () =>
  new arrow.Struct([
    new arrow.Field("jointPositions", float64List()),
    new arrow.Field("eePosition", vec3Type()),
    new arrow.Field("eeOrientationQuat", quatType()),
  ]);

const handStateType = new arrow.Struct([
  new arrow.Field("fingerPositions", float64List()),
  new arrow.Field("gripClosed", new arrow.Bool()),
]);

// One Arrow RecordBatch column per top-level BuildoObservation field, all
// built from a single-element array -- an Observation is one message, not
// a batch of many, so every column has length 1.
function observationArrowSchema(): arrow.Schema {
  return new arrow.Schema([
    new arrow.Field("schemaVersion", new arrow.Utf8()),
    new arrow.Field("sequenceId", new arrow.Utf8()),
    new arrow.Field("timestamp", new arrow.Float64()),
    new arrow.Field("instruction", new arrow.Utf8()),
    new arrow.Field("cameraFrames", new arrow.List(new arrow.Field("item", cameraFrameType))),
    new arrow.Field("baseState", baseStateType),
    new arrow.Field("liftState", liftStateType),
    new arrow.Field("leftArmState", armStateType()),
    new arrow.Field("rightArmState", armStateType()),
    new arrow.Field("leftHandState", handStateType),
    new arrow.Field("rightHandState", handStateType),
    new arrow.Field("leftTactile", float64List(), true),
    new arrow.Field("rightTactile", float64List(), true),
  ]);
}

export function serializeObservation(obs: BuildoObservation): Uint8Array {
  const parsed = BuildoObservationSchema.parse(obs);
  const schema = observationArrowSchema();
  const columns: Record<string, arrow.Vector> = {};
  for (const field of schema.fields) {
    switch (field.name) {
      case "schemaVersion":
        columns[field.name] = arrow.vectorFromArray([parsed.schemaVersion], new arrow.Utf8());
        break;
      case "sequenceId":
        columns[field.name] = arrow.vectorFromArray([parsed.sequenceId], new arrow.Utf8());
        break;
      case "timestamp":
        columns[field.name] = arrow.vectorFromArray([parsed.timestamp], new arrow.Float64());
        break;
      case "instruction":
        columns[field.name] = arrow.vectorFromArray([parsed.instruction], new arrow.Utf8());
        break;
      case "cameraFrames":
        columns[field.name] = arrow.vectorFromArray([parsed.cameraFrames], field.type as arrow.List);
        break;
      case "baseState":
        columns[field.name] = arrow.vectorFromArray([parsed.baseState], baseStateType);
        break;
      case "liftState":
        columns[field.name] = arrow.vectorFromArray([parsed.liftState], liftStateType);
        break;
      case "leftArmState":
        columns[field.name] = arrow.vectorFromArray([parsed.leftArmState], armStateType());
        break;
      case "rightArmState":
        columns[field.name] = arrow.vectorFromArray([parsed.rightArmState], armStateType());
        break;
      case "leftHandState":
        columns[field.name] = arrow.vectorFromArray([parsed.leftHandState], handStateType);
        break;
      case "rightHandState":
        columns[field.name] = arrow.vectorFromArray([parsed.rightHandState], handStateType);
        break;
      case "leftTactile":
        columns[field.name] = arrow.vectorFromArray([parsed.leftTactile ?? null], field.type as arrow.List);
        break;
      case "rightTactile":
        columns[field.name] = arrow.vectorFromArray([parsed.rightTactile ?? null], field.type as arrow.List);
        break;
      default:
        throw new Error(`unhandled BuildoObservation field: ${field.name}`);
    }
  }
  const table = new arrow.Table(schema, columns);
  return arrow.tableToIPC(table, "stream");
}

// Arrow's own .toJSON() doesn't reconstruct Uint8Array for a Binary column
// nested inside a Struct/List -- it comes back as a plain index-keyed
// object ({0: 1, 1: 2, ...}) instead. Rebuilt by hand here rather than
// trusting toJSON for anything binary.
function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(Object.values(value as Record<string, number>));
}

function readCameraFrame(row: Record<string, unknown>): CameraFrame {
  return {
    name: row.name as string,
    width: row.width as number,
    height: row.height as number,
    encoding: row.encoding as CameraFrame["encoding"],
    data: toUint8Array(row.data) as CameraFrame["data"],
  };
}

export function deserializeObservation(bytes: Uint8Array): BuildoObservation {
  const table = arrow.tableFromIPC(bytes);
  const row = table.get(0);
  if (!row) throw new Error("empty BuildoObservation Arrow batch");
  const r = row.toJSON() as Record<string, any>;
  const obs: BuildoObservation = {
    schemaVersion: r.schemaVersion,
    sequenceId: r.sequenceId,
    timestamp: r.timestamp,
    instruction: r.instruction,
    cameraFrames: Array.from(r.cameraFrames ?? [], readCameraFrame),
    baseState: r.baseState,
    liftState: r.liftState,
    leftArmState: {
      jointPositions: Array.from(r.leftArmState.jointPositions ?? []),
      eePosition: Array.from(r.leftArmState.eePosition) as [number, number, number],
      eeOrientationQuat: Array.from(r.leftArmState.eeOrientationQuat) as [number, number, number, number],
    },
    rightArmState: {
      jointPositions: Array.from(r.rightArmState.jointPositions ?? []),
      eePosition: Array.from(r.rightArmState.eePosition) as [number, number, number],
      eeOrientationQuat: Array.from(r.rightArmState.eeOrientationQuat) as [number, number, number, number],
    },
    leftHandState: {
      fingerPositions: Array.from(r.leftHandState.fingerPositions ?? []),
      gripClosed: r.leftHandState.gripClosed,
    },
    rightHandState: {
      fingerPositions: Array.from(r.rightHandState.fingerPositions ?? []),
      gripClosed: r.rightHandState.gripClosed,
    },
    leftTactile: r.leftTactile ? Array.from(r.leftTactile) : undefined,
    rightTactile: r.rightTactile ? Array.from(r.rightTactile) : undefined,
  };
  return BuildoObservationSchema.parse(obs);
}
