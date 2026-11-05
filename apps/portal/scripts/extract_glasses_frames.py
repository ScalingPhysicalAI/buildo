#!/usr/bin/env python3
"""Saves EVERY decoded JPEG frame from a decrypted glasses capture, for
training data -- not a replacement for enc_tool.py's own `decrypt` command,
which only keeps a first/last frame as a quick visual sanity check (see its
decrypt_video()). This reuses that same file's already-verified hkdf() and
rtp_jpeg.py's JpegDepacketizer -- same crypto, same depacketizer, just a
different (fuller) output.

  python3 scripts/extract_glasses_frames.py <raw_capture_dir> --key enc_key.bin --out <dir>

Writes <out>/left/000000.jpg, <out>/left/000001.jpg, ... and the same for
right, one file per successfully decoded frame, in capture order.
"""

import argparse
import json
import os
import struct
import sys


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("capture", help="raw capture dir (has video-left.rtp/video-right.rtp/meta.json)")
    ap.add_argument("--key", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--enc-tool", default=None, help="path to enc_tool.py (default: ../../mobile/enc_tool.py relative to this script)")
    args = ap.parse_args()

    enc_tool_path = args.enc_tool or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "mobile", "enc_tool.py")
    enc_tool_dir = os.path.dirname(os.path.abspath(enc_tool_path))
    sys.path.insert(0, enc_tool_dir)  # enc_tool.py's own rtp_jpeg import needs this too
    import pylibsrtp
    from enc_tool import hkdf  # reuse, don't reimplement -- see header comment
    from rtp_jpeg import JpegDepacketizer

    with open(args.key, "rb") as f:
        key = f.read()
    with open(os.path.join(args.capture, "meta.json")) as f:
        meta = json.load(f)

    for name, v in meta["video"].items():
        path = os.path.join(args.capture, "video-%s.rtp" % name)
        if not os.path.exists(path):
            print("extract: no video-%s.rtp, skipping" % name)
            continue
        with open(path, "rb") as f:
            blob = f.read()

        out_dir = os.path.join(args.out, name)
        os.makedirs(out_dir, exist_ok=True)
        starts = {s[0]: s[1] for s in v["sessions"]}

        pos, index, good, bad, saved = 0, 0, 0, 0, 0
        session, depack = None, JpegDepacketizer()
        while pos < len(blob):
            n = struct.unpack_from(">I", blob, pos)[0]
            pkt = blob[pos + 4:pos + 4 + n]
            pos += 4 + n
            if index in starts:
                fields = dict(p.split("=", 1) for p in starts[index].split(";"))
                master = hkdf(key, bytes.fromhex(fields["session"]), b"glasses video v1", 30)
                session = pylibsrtp.Session(pylibsrtp.Policy(key=master, ssrc_type=pylibsrtp.Policy.SSRC_ANY_INBOUND))
            index += 1
            try:
                r = session.unprotect(pkt)
            except pylibsrtp.Error:
                bad += 1
                continue
            good += 1
            frame = depack.feed(r)
            if frame:
                with open(os.path.join(out_dir, "%06d.jpg" % saved), "wb") as f:
                    f.write(frame[1])
                saved += 1
        print("extract %s: %d packets decrypted, %d rejected, %d frames saved to %s" % (name, good, bad, saved, out_dir))


if __name__ == "__main__":
    main()
