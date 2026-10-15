"""Shared mesh/asset helpers for build_environment.py, props.py, and
urdf_to_mjcf.py: Poly Haven downloads, glTF -> flat-colored STL parts, and
small MJCF formatting helpers.

Colors: the portal's loader renders one flat rgba per geom (no textures), so
each material is reduced to the average of its base-color texture sampled at
the mesh's own UVs (so unused atlas space doesn't skew it), times its
baseColorFactor, converted sRGB -> linear (three.js treats geom rgba as
linear).
"""

from __future__ import annotations

import json
import math
import pathlib
import shutil
import ssl
import urllib.request

import numpy as np
import trimesh

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "environments" / ".cache" / "polyhaven"
OUTPUT_DIR = ROOT / "mjcf"
POLYHAVEN_API = "https://api.polyhaven.com"
POLYHAVEN_RESOLUTION = "1k"
# Per-material face budget. Above this, the mesh is decimated -- MuJoCo
# compiles every mesh in the browser on load, and a single 100k-face plant
# costs more load time than the rest of a room combined.
MAX_FACES_PER_MATERIAL = 20000


# --- Poly Haven download ---------------------------------------------------

try:
    import certifi

    # python.org's macOS builds ship without a CA bundle until "Install
    # Certificates.command" is run; certifi sidesteps that.
    _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CONTEXT = None


def _open(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "buildo-environment-builder"})
    return urllib.request.urlopen(req, context=_SSL_CONTEXT)


def _fetch_json(url: str) -> dict:
    with _open(url) as res:
        return json.load(res)


def _download(url: str, dest: pathlib.Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with _open(url) as res, open(dest, "wb") as f:
        shutil.copyfileobj(res, f)


def fetch_polyhaven_model(asset_id: str) -> tuple[pathlib.Path, dict]:
    """Returns (path to the cached .gltf, Poly Haven info record)."""
    asset_dir = CACHE_DIR / asset_id
    gltf_path = asset_dir / f"{asset_id}_{POLYHAVEN_RESOLUTION}.gltf"
    info_path = asset_dir / "info.json"
    if not gltf_path.exists():
        files = _fetch_json(f"{POLYHAVEN_API}/files/{asset_id}")
        gltf = files["gltf"][POLYHAVEN_RESOLUTION]["gltf"]
        for rel, entry in gltf.get("include", {}).items():
            _download(entry["url"], asset_dir / rel)
        _download(gltf["url"], gltf_path)
        info_path.write_text(json.dumps(_fetch_json(f"{POLYHAVEN_API}/info/{asset_id}"), indent=2))
        print(f"  downloaded {asset_id}")
    return gltf_path, json.loads(info_path.read_text())


# --- Mesh conversion -------------------------------------------------------

def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _material_rgba(mesh: trimesh.Trimesh) -> np.ndarray:
    material = getattr(mesh.visual, "material", None)
    factor = np.array([1.0, 1.0, 1.0, 1.0])
    texture_rgb = None
    if material is not None:
        base_factor = getattr(material, "baseColorFactor", None)
        if base_factor is not None:
            factor = np.asarray(base_factor, dtype=float)
            if factor.max() > 1.0:
                factor = factor / 255.0
        image = getattr(material, "baseColorTexture", None)
        uv = getattr(mesh.visual, "uv", None)
        if image is not None:
            pixels = np.asarray(image.convert("RGB"), dtype=float) / 255.0
            h, w = pixels.shape[:2]
            if uv is not None and len(uv):
                u = np.mod(uv[:, 0], 1.0)
                v = np.mod(uv[:, 1], 1.0)
                px = np.clip((u * (w - 1)).astype(int), 0, w - 1)
                py = np.clip(((1.0 - v) * (h - 1)).astype(int), 0, h - 1)
                texture_rgb = pixels[py, px].mean(axis=0)
            else:
                texture_rgb = pixels.reshape(-1, 3).mean(axis=0)
    rgb = factor[:3] if texture_rgb is None else factor[:3] * texture_rgb
    alpha = float(factor[3]) if len(factor) > 3 else 1.0
    return np.concatenate([_srgb_to_linear(np.clip(rgb, 0, 1)), [alpha]])


# glTF is Y-up, MuJoCo is Z-up: (x, y, z) -> (x, -z, y). A model's glTF
# front (+Z) therefore ends up facing -Y.
_Y_UP_TO_Z_UP = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=float)


class ImportedModel:
    """One Poly Haven model, split into one mesh per material, recentered so
    its footprint is centered on the origin and it rests on z=0. Part mesh
    names are "<prefix>_<asset_id>_<i>"."""

    def __init__(self, prefix: str, asset_id: str):
        self.asset_id = asset_id
        gltf_path, self.info = fetch_polyhaven_model(asset_id)
        scene = trimesh.load(gltf_path, force="scene")
        by_material: dict[str, list[trimesh.Trimesh]] = {}
        for geom_name, geom in scene.geometry.items():
            if not isinstance(geom, trimesh.Trimesh) or len(geom.faces) == 0:
                continue
            for node in scene.graph.geometry_nodes.get(geom_name, []):
                transform, _ = scene.graph[node]
                part = geom.copy()
                part.apply_transform(_Y_UP_TO_Z_UP @ transform)
                key = getattr(getattr(geom.visual, "material", None), "name", None) or geom_name
                by_material.setdefault(key, []).append(part)

        parts = [(key, meshes) for key, meshes in by_material.items()]
        all_verts = np.vstack([m.vertices for _, meshes in parts for m in meshes])
        lo, hi = all_verts.min(axis=0), all_verts.max(axis=0)
        offset = np.array([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])
        self.size = hi - lo  # (x width, y depth, z height) before yaw

        self.parts: list[tuple[str, trimesh.Trimesh, np.ndarray]] = []
        for i, (key, meshes) in enumerate(parts):
            rgba = _material_rgba(meshes[0])
            merged = trimesh.util.concatenate([trimesh.Trimesh(m.vertices, m.faces, process=False) for m in meshes])
            merged.apply_translation(offset)
            merged.merge_vertices()
            if len(merged.faces) > MAX_FACES_PER_MATERIAL:
                merged = merged.simplify_quadric_decimation(face_count=MAX_FACES_PER_MATERIAL)
            name = f"{prefix}_{asset_id}_{i}".lower()
            self.parts.append((name, merged, rgba))

    def up_surfaces(self, min_area: float = 0.05) -> list[float]:
        """Heights of large upward-facing surfaces (shelf levels, desk tops), lowest first."""
        heights: dict[float, float] = {}
        for _, mesh, _ in self.parts:
            up = mesh.face_normals[:, 2] > 0.95
            for z, area in zip(mesh.triangles_center[up, 2], mesh.area_faces[up]):
                key = round(float(z), 2)
                heights[key] = heights.get(key, 0.0) + float(area)
        return sorted(z for z, area in heights.items() if area >= min_area and z > 0.05)


# --- MJCF formatting -------------------------------------------------------

def fmt(values) -> str:
    return " ".join(f"{v:.4f}".rstrip("0").rstrip(".") if abs(v) > 1e-9 else "0" for v in values)


def yaw_quat(yaw_deg: float) -> tuple[float, float, float, float]:
    half = math.radians(yaw_deg) / 2
    return (math.cos(half), 0.0, 0.0, math.sin(half))


def euler_quat(euler_deg) -> tuple[float, float, float, float]:
    """Extrinsic-free intrinsic xyz Euler (MuJoCo's default eulerseq) in degrees -> wxyz quat."""
    q = np.array([1.0, 0.0, 0.0, 0.0])
    for axis, angle in zip(range(3), euler_deg):
        if not angle:
            continue
        half = math.radians(angle) / 2
        r = np.zeros(4)
        r[0] = math.cos(half)
        r[axis + 1] = math.sin(half)
        q = quat_mul(q, r)
    return tuple(q)


def quat_mul(a, b) -> np.ndarray:
    w1, x1, y1, z1 = a
    w2, x2, y2, z2 = b
    return np.array([
        w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
        w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
        w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
        w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    ])


def quat_rotate(q, v) -> np.ndarray:
    w, x, y, z = q
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    return r @ np.asarray(v, dtype=float)
