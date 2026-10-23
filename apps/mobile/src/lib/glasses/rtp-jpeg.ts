// RTP header parsing (RFC 3550) and JPEG-over-RTP payload parsing +
// reconstruction (RFC 2435), for the glasses' video stream --
// PROTOCOL_GLASSES.md "Video (RTSP/RTP)": "RTP/JPEG, RFC 2435 (payload type
// 26, 90 kHz clock), quantization tables in-band (Q = 255)". Pure
// buffer-in, buffer-out functions -- no sockets here, see rtsp-client.ts.
//
// Why this exists at all: RFC 2435's wire format is NOT a JPEG file. It
// sends only the entropy-coded scan data plus a tiny type/width/height/
// quant-table header; a standards-compliant JPEG file needs SOI/DQT/SOF0/
// DHT/SOS markers in front of that data before any normal JPEG decoder
// (including React Native's <Image>) can read it. This file rebuilds that
// prefix from RFC 2435 Appendix A's reference algorithm, using the
// standard JPEG default Huffman tables (same constants ffmpeg/gstreamer/
// live555 all use for this exact RFC).
//
// Explicit import, not the bare global -- Hermes/React Native has no
// global Buffer (unlike Node, which is why this worked when sanity-tested
// via `npx tsx` but crashed in the app itself). `buffer` is the same pure-
// JS polyfill react-native-tcp-socket and react-native-udp already import
// this same way.
//
// Within this file: always slice a Buffer with `.slice()`, never
// `.subarray()`. Both exist, but only `.slice()` is actually safe here --
// the `buffer` package's own source shows why (its `Buffer.prototype.slice`
// calls `this.subarray(...)` and then explicitly
// `Object.setPrototypeOf(newBuf, Buffer.prototype)` straight afterward,
// specifically because the plain native `subarray()` does NOT carry the
// Buffer subclass/prototype through on Hermes -- it hands back a bare
// Uint8Array that's missing every Node-Buffer-specific method this file
// needs (readUInt16BE, etc.). `.slice()` is the one the package itself
// patches to still be a real Buffer afterward; `.subarray()` is not.
import { Buffer } from "buffer";

export interface RtpHeader {
  version: number;
  marker: boolean;
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  payloadOffset: number;
}

export function parseRtpHeader(buf: Buffer): RtpHeader | null {
  if (buf.length < 12) return null;
  const b0 = buf[0];
  const version = (b0 >> 6) & 0x03;
  const hasPadding = ((b0 >> 5) & 0x01) === 1;
  const hasExtension = ((b0 >> 4) & 0x01) === 1;
  const csrcCount = b0 & 0x0f;
  const b1 = buf[1];
  const marker = ((b1 >> 7) & 0x01) === 1;
  const payloadType = b1 & 0x7f;
  const sequenceNumber = buf.readUInt16BE(2);
  const timestamp = buf.readUInt32BE(4);
  const ssrc = buf.readUInt32BE(8);

  let offset = 12 + csrcCount * 4;
  if (hasExtension) {
    if (buf.length < offset + 4) return null;
    const extensionLengthWords = buf.readUInt16BE(offset + 2);
    offset += 4 + extensionLengthWords * 4;
  }
  if (hasPadding && buf.length > 0) {
    // Padding length is in the last byte of the packet -- doesn't affect
    // where the payload *starts*, only where it ends. Not needed here since
    // we only read forward from `payloadOffset`.
  }
  if (offset > buf.length) return null;

  return { version, marker, payloadType, sequenceNumber, timestamp, ssrc, payloadOffset: offset };
}

export interface JpegRtpPayload {
  fragmentOffset: number;
  type: number;
  q: number;
  width: number; // actual pixels (already *8)
  height: number; // actual pixels (already *8)
  // Present on the first fragment of a frame (fragmentOffset === 0)
  // regardless of q -- in-band (q >= 128) or RFC 2435 Appendix A's
  // standard-tables-scaled-by-q (q < 128, see makeQuantTables() below).
  // PROTOCOL_GLASSES.md says this stream is always q=255/in-band, but that
  // turned out to only hold with the `video` command never sent at all;
  // sending it with an explicit `quality` (which this firmware evidently
  // uses directly as the encoder's q) switches it into the q<128 standard-
  // tables mode instead -- confirmed by the HW team's own reference
  // (rtp_jpeg.py) handling exactly this case (`qt = self.qtables if q>=128
  // else make_qtables(q)`), which this file didn't have an equivalent of at
  // all until now.
  quantTables: { precision: number; tableData: Buffer }[] | null;
  scanData: Buffer;
}

// RFC 2435 Appendix A's default luma/chroma tables (zig-zag order) and the
// scaling formula used to derive the real quantization tables from a
// q value 1-99, when the sender isn't providing tables in-band (q < 128).
// Same constants and formula as the HW team's own reference (rtp_jpeg.py's
// _LUMA_Q/_CHROMA_Q/make_qtables) -- this is standard, not invented.
// prettier-ignore
const DEFAULT_LUMA_Q = [
  16, 11, 12, 14, 12, 10, 16, 14, 13, 14, 18, 17, 16, 19, 24, 40,
  26, 24, 22, 22, 24, 49, 35, 37, 29, 40, 58, 51, 61, 60, 57, 51,
  56, 55, 64, 72, 92, 78, 64, 68, 87, 69, 55, 56, 80, 109, 81, 87,
  95, 98, 103, 104, 103, 62, 77, 113, 121, 112, 100, 120, 92, 101, 103, 99,
];
// prettier-ignore
const DEFAULT_CHROMA_Q = [
  17, 18, 18, 24, 21, 24, 47, 26, 26, 47, 99, 66, 56, 66, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

function makeQuantTables(q: number): Buffer {
  const f = Math.max(1, Math.min(q, 99));
  const s = f < 50 ? Math.floor(5000 / f) : 200 - 2 * f;
  const scale = (v: number) => Math.max(1, Math.min(255, Math.floor((v * s + 50) / 100)));
  return Buffer.from([...DEFAULT_LUMA_Q, ...DEFAULT_CHROMA_Q].map(scale));
}

// Parses one RTP packet's JPEG payload (the bytes after the RTP header).
// Returns null for shapes this doesn't handle: restart-marker JPEG types
// (RFC 2435 type 64-127 -- rare for a simple embedded camera) and the
// width/height===0 "dimensions signaled elsewhere" edge case (>2040px,
// not plausible for this hardware).
export function parseJpegRtpPayload(buf: Buffer): JpegRtpPayload | null {
  if (buf.length < 8) return null;
  const fragmentOffset = (buf[1] << 16) | (buf[2] << 8) | buf[3];
  const type = buf[4];
  const q = buf[5];
  const width = buf[6] * 8;
  const height = buf[7] * 8;
  if (type >= 64 || width === 0 || height === 0) return null;

  let offset = 8;
  let quantTables: { precision: number; tableData: Buffer }[] | null = null;

  if (fragmentOffset === 0) {
    if (q >= 128) {
      if (buf.length < offset + 4) return null;
      // MBZ (1 byte, ignored), Precision (1 byte), Length (2 bytes BE)
      const precision = buf[offset + 1];
      const length = buf.readUInt16BE(offset + 2);
      offset += 4;
      if (length > 0) {
        if (buf.length < offset + length) return null;
        const tableData = buf.slice(offset, offset + length);
        offset += length;
        // Two tables (luma, chroma) back to back when precision is 8-bit
        // (the common case this hardware uses) -- split evenly down the
        // middle; a single combined table otherwise.
        if (precision === 0 && length === 128) {
          quantTables = [
            { precision, tableData: tableData.slice(0, 64) },
            { precision, tableData: tableData.slice(64, 128) },
          ];
        } else {
          quantTables = [{ precision, tableData }];
        }
      }
    } else {
      // No in-band tables on the wire at all in this mode -- derive the
      // standard ones from q instead of treating "none sent" as "frame
      // unusable", which is what every frame was hitting before this.
      const scaled = makeQuantTables(q);
      quantTables = [
        { precision: 0, tableData: scaled.slice(0, 64) },
        { precision: 0, tableData: scaled.slice(64, 128) },
      ];
    }
  }

  return { fragmentOffset, type, q, width, height, quantTables, scanData: buf.slice(offset) };
}

// -- JPEG header reconstruction (RFC 2435 Appendix A) ----------------------

const MARKER_SOI = 0xd8;
const MARKER_DQT = 0xdb;
const MARKER_SOF0 = 0xc0;
const MARKER_DHT = 0xc4;
const MARKER_SOS = 0xda;
const MARKER_EOI = 0xd9;

// Standard JPEG default Huffman tables (ITU T.81 Annex K) -- these are the
// same fixed constants RFC 2435 itself, ffmpeg, gstreamer and live555 all
// use to rebuild a JPEG-over-RTP stream, since RFC 2435 never sends Huffman
// tables on the wire at all (only quantization tables).
const LUM_DC_CODELENS = Buffer.from([0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
const LUM_DC_SYMBOLS = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const LUM_AC_CODELENS = Buffer.from([0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]);
// prettier-ignore
const LUM_AC_SYMBOLS = Buffer.from([
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]);
const CHM_DC_CODELENS = Buffer.from([0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
const CHM_DC_SYMBOLS = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const CHM_AC_CODELENS = Buffer.from([0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]);
// prettier-ignore
const CHM_AC_SYMBOLS = Buffer.from([
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]);

function buildQuantHeader(tableData: Buffer, tableNo: number): Buffer {
  // length field = 2 (itself) + 1 (table id byte) + table bytes
  const out = Buffer.alloc(2 + 2 + 1 + tableData.length);
  out[0] = 0xff;
  out[1] = MARKER_DQT;
  out.writeUInt16BE(2 + 1 + tableData.length, 2);
  out[4] = tableNo;
  tableData.copy(out, 5);
  return out;
}

function buildHuffmanHeader(codelens: Buffer, symbols: Buffer, tableNo: number, tableClass: number): Buffer {
  const out = Buffer.alloc(2 + 2 + 1 + codelens.length + symbols.length);
  out[0] = 0xff;
  out[1] = MARKER_DHT;
  out.writeUInt16BE(2 + 1 + codelens.length + symbols.length, 2);
  out[4] = (tableClass << 4) | tableNo;
  codelens.copy(out, 5);
  symbols.copy(out, 5 + codelens.length);
  return out;
}

// RFC 2435 §3.1: the RTP/JPEG `Type` field's low 6 bits select the chroma
// subsampling -- 0 means 4:2:2 (luma sampling 2x1), anything else (this
// hardware sends 1) means 4:2:0 (luma sampling 2x2). This was hardcoded to
// 4:2:0 before, which only matches if the camera happens to encode that
// way; a mismatch here doesn't just shift colors, it desyncs the Huffman
// decoder entirely, since h/v sampling determines the whole MCU layout --
// visually that's exactly the "broken/static" frames this was producing.
// Confirmed against the HW team's own reference (rtp_jpeg.py's
// `make_jpeg_header`): `luma_samp = 0x21 if (typ & 63) == 0 else 0x22`.
function buildSofHeader(width: number, height: number, type: number): Buffer {
  const lumaSampling = (type & 63) === 0 ? 0x21 : 0x22;
  const out = Buffer.from([
    0xff, MARKER_SOF0,
    0x00, 17, // length
    8, // precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    3, // number of components
    0, lumaSampling, 0, // comp 0 (Y): id=0, quant table 0
    1, 0x11, 1, // comp 1 (Cb): id=1, h/v sampling 1x1, quant table 1
    2, 0x11, 1, // comp 2 (Cr): id=2, h/v sampling 1x1, quant table 1
  ]);
  return out;
}

const SOS_HEADER = Buffer.from([
  0xff, MARKER_SOS,
  0x00, 12, // length
  3, // number of components
  0, 0x00, // comp 0: huffman table (DC 0, AC 0)
  1, 0x11, // comp 1: huffman table (DC 1, AC 1)
  2, 0x11, // comp 2: huffman table (DC 1, AC 1)
  0, 63, 0, // spectral selection / successive approximation (baseline, unused)
]);

// Builds a complete, standards-decodable JPEG file from one frame's
// reassembled scan data + the quant tables carried in its first RTP
// packet. `width`/`height` are already in pixels (parseJpegRtpPayload
// already multiplied by 8).
export function buildJpegFile(scanData: Buffer, width: number, height: number, quantTables: Buffer[], type: number): Buffer {
  const lumaTable = quantTables[0] ?? Buffer.alloc(64);
  const chromaTable = quantTables[1] ?? lumaTable;

  const parts = [
    Buffer.from([0xff, MARKER_SOI]),
    buildQuantHeader(lumaTable, 0),
    buildQuantHeader(chromaTable, 1),
    buildSofHeader(width, height, type),
    buildHuffmanHeader(LUM_DC_CODELENS, LUM_DC_SYMBOLS, 0, 0),
    buildHuffmanHeader(LUM_AC_CODELENS, LUM_AC_SYMBOLS, 0, 1),
    buildHuffmanHeader(CHM_DC_CODELENS, CHM_DC_SYMBOLS, 1, 0),
    buildHuffmanHeader(CHM_AC_CODELENS, CHM_AC_SYMBOLS, 1, 1),
    SOS_HEADER,
    scanData,
    Buffer.from([0xff, MARKER_EOI]),
  ];
  return Buffer.concat(parts);
}
