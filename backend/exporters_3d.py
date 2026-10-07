"""
3D Model Exporters & Public Share Tokens for AeroMesh / Hexa Spark.

Provides verified conversion and export of photogrammetric reconstructions to:
- PLY (Polygon File Format)
- OBJ (Wavefront 3D with normals/colors)
- GLB (glTF 2.0 Binary container)
- LAS (ASPRS LiDAR Point Cloud Standard 1.2)
- Cryptographically signed read-only shareable links with expiry.
"""

from __future__ import annotations

import io
import json
import logging
import os
import struct
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import open3d as o3d
except ImportError:
    o3d = None

from .security import create_access_token, decode_access_token

logger = logging.getLogger(__name__)


def export_mesh_to_obj(ply_path: Path, output_obj_path: Path) -> bool:
    """Convert a PLY triangle mesh to a Wavefront OBJ file using Open3D."""
    try:
        mesh = o3d.io.read_triangle_mesh(str(ply_path))
        if len(mesh.vertices) == 0:
            return False
        output_obj_path.parent.mkdir(parents=True, exist_ok=True)
        return bool(o3d.io.write_triangle_mesh(str(output_obj_path), mesh, write_ascii=True))
    except Exception as exc:
        logger.error("Failed converting PLY to OBJ: %s", exc)
        return False


def export_cloud_to_las(ply_path: Path, output_las_path: Path) -> bool:
    """
    Export a 3D point cloud from PLY into compliant ASPRS LAS 1.2 format.
    Format 1.2 Point Data Record Format 2 (XYZ + Intensity + Return + Classification + RGB).
    """
    try:
        pcd = o3d.io.read_point_cloud(str(ply_path))
        points = list(pcd.points)
        if not points:
            return False

        colors = list(pcd.colors) if pcd.has_colors() else []
        point_count = len(points)

        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        zs = [p[2] for p in points]

        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        min_z, max_z = min(zs), max(zs)

        # Scale factor: 0.001 (1 millimeter precision)
        scale_x = scale_y = scale_z = 0.001
        offset_x = min_x
        offset_y = min_y
        offset_z = min_z

        header_size = 227
        offset_to_points = 227
        record_length = 26  # Point Data Record Format 2 is 26 bytes

        output_las_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_las_path, "wb") as f:
            # 1. Signature (4 bytes) "LASF"
            f.write(b"LASF")
            # 2. File Source ID (2 bytes)
            f.write(struct.pack("<H", 0))
            # 3. Global Encoding (2 bytes)
            f.write(struct.pack("<H", 0))
            # 4. Project ID GUID data 1-4 (16 bytes)
            f.write(b"\x00" * 16)
            # 5. Version Major (1 byte) = 1, Minor (1 byte) = 2
            f.write(struct.pack("BB", 1, 2))
            # 6. System Identifier (32 bytes)
            sys_id = b"AEROMESH_HEXASPARK\x00".ljust(32, b"\x00")
            f.write(sys_id)
            # 7. Generating Software (32 bytes)
            gen_soft = b"AeroMesh Photogrammetry\x00".ljust(32, b"\x00")
            f.write(gen_soft)
            # 8. File Creation Day of Year (2 bytes) & Year (2 bytes)
            t = time.gmtime()
            f.write(struct.pack("<HH", t.tm_yday, t.tm_year))
            # 9. Header Size (2 bytes) = 227
            f.write(struct.pack("<H", header_size))
            # 10. Offset to point data (4 bytes) = 227
            f.write(struct.pack("<I", offset_to_points))
            # 11. Number of Variable Length Records (4 bytes) = 0
            f.write(struct.pack("<I", 0))
            # 12. Point Data Format ID (1 byte) = 2
            f.write(struct.pack("B", 2))
            # 13. Point Data Record Length (2 bytes) = 26
            f.write(struct.pack("<H", record_length))
            # 14. Number of point records (4 bytes)
            f.write(struct.pack("<I", point_count))
            # 15. Number of points by return (5 * 4 = 20 bytes)
            f.write(struct.pack("<IIIII", point_count, 0, 0, 0, 0))
            # 16. X, Y, Z scale factors (3 * 8 = 24 bytes doubles)
            f.write(struct.pack("<ddd", scale_x, scale_y, scale_z))
            # 17. X, Y, Z offsets (3 * 8 = 24 bytes doubles)
            f.write(struct.pack("<ddd", offset_x, offset_y, offset_z))
            # 18. Max/Min X, Y, Z (6 * 8 = 48 bytes doubles)
            f.write(struct.pack("<dddddd", max_x, min_x, max_y, min_y, max_z, min_z))

            # Point Data Records (Format 2: X, Y, Z as int32, Intensity uint16, flags uint8, class uint8, scan angle int8, user uint8, point source uint16, Red uint16, Green uint16, Blue uint16)
            for i, p in enumerate(points):
                ix = int(round((p[0] - offset_x) / scale_x))
                iy = int(round((p[1] - offset_y) / scale_y))
                iz = int(round((p[2] - offset_z) / scale_z))

                r = g = b = 255
                if i < len(colors):
                    r = int(min(255, max(0, colors[i][0] * 255)))
                    g = int(min(255, max(0, colors[i][1] * 255)))
                    b = int(min(255, max(0, colors[i][2] * 255)))

                # Intensity ~ 1000
                intensity = 1000
                flags = 1  # Return 1 of 1
                classification = 2  # Ground / default class
                scan_angle = 0
                user_data = 0
                point_source_id = 1

                f.write(struct.pack(
                    "<iiiHBBbBH HHH",
                    ix, iy, iz,
                    intensity,
                    flags,
                    classification,
                    scan_angle,
                    user_data,
                    point_source_id,
                    r * 256, g * 256, b * 256,  # LAS stores 16-bit colors
                ))
        return True
    except Exception as exc:
        logger.error("Failed exporting point cloud to LAS: %s", exc)
        return False


def export_mesh_to_glb(ply_path: Path, output_glb_path: Path) -> bool:
    """
    Export mesh or point cloud to glTF 2.0 Binary (.glb).
    Encodes vertices, normals, and triangles into binary glTF chunks.
    """
    try:
        mesh = o3d.io.read_triangle_mesh(str(ply_path))
        if len(mesh.vertices) == 0:
            # Fallback to point cloud if mesh has no vertices
            pcd = o3d.io.read_point_cloud(str(ply_path))
            if len(pcd.points) == 0:
                return False
            # Generate mini tetrahedrons or points
            mesh = o3d.geometry.TriangleMesh()
            mesh.vertices = pcd.points
            if pcd.has_colors():
                mesh.vertex_colors = pcd.colors

        verts = list(mesh.vertices)
        triangles = list(mesh.triangles)

        # Build binary buffers: vertices float32 (len*3*4), indices uint32 (len*3*4)
        vert_bytes = io.BytesIO()
        min_x = min_y = min_z = float("inf")
        max_x = max_y = max_z = float("-inf")
        for v in verts:
            x, y, z = float(v[0]), float(v[1]), float(v[2])
            min_x, max_x = min(min_x, x), max(max_x, x)
            min_y, max_y = min(min_y, y), max(max_y, y)
            min_z, max_z = min(min_z, z), max(max_z, z)
            vert_bytes.write(struct.pack("<fff", x, y, z))

        idx_bytes = io.BytesIO()
        for t in triangles:
            idx_bytes.write(struct.pack("<III", int(t[0]), int(t[1]), int(t[2])))

        v_buf = vert_bytes.getvalue()
        i_buf = idx_bytes.getvalue()
        color_bytes = io.BytesIO()
        has_colors = mesh.has_vertex_colors() and len(mesh.vertex_colors) == len(verts)
        if has_colors:
            for color in mesh.vertex_colors:
                color_bytes.write(struct.pack("<fff", *(float(max(0.0, min(1.0, c))) for c in color)))
        c_buf = color_bytes.getvalue()

        # Align buffer to 4 bytes
        v_pad = (4 - (len(v_buf) % 4)) % 4
        v_buf += b"\x00" * v_pad
        i_pad = (4 - (len(i_buf) % 4)) % 4
        i_buf += b"\x00" * i_pad

        bin_buffer = v_buf + i_buf + c_buf

        gltf_dict: Dict[str, Any] = {
            "asset": {"version": "2.0", "generator": "AeroMesh Hexa Spark 3D Engine"},
            "scene": 0,
            "scenes": [{"nodes": [0]}],
            "nodes": [{"mesh": 0, "name": "ReconstructedSurfaceMesh"}],
            "meshes": [
                {
                    "primitives": [
                        {
                            "attributes": {"POSITION": 0, **({"COLOR_0": 2 if len(triangles) > 0 else 1} if has_colors else {})},
                            "indices": 1 if len(triangles) > 0 else None,
                            "mode": 4 if len(triangles) > 0 else 0,  # 4: TRIANGLES, 0: POINTS
                        }
                    ]
                }
            ],
            "buffers": [{"byteLength": len(bin_buffer)}],
            "bufferViews": [
                {
                    "buffer": 0,
                    "byteOffset": 0,
                    "byteLength": len(v_buf),
                    "target": 34962,  # ARRAY_BUFFER
                },
            ],
            "accessors": [
                {
                    "bufferView": 0,
                    "byteOffset": 0,
                    "componentType": 5126,  # FLOAT
                    "count": len(verts),
                    "type": "VEC3",
                    "max": [max_x, max_y, max_z],
                    "min": [min_x, min_y, min_z],
                },
            ],
        }

        if len(triangles) > 0:
            gltf_dict["bufferViews"].append({
                "buffer": 0,
                "byteOffset": len(v_buf),
                "byteLength": len(i_buf),
                "target": 34963,  # ELEMENT_ARRAY_BUFFER
            })
            gltf_dict["accessors"].append({
                "bufferView": 1,
                "byteOffset": 0,
                "componentType": 5125,  # UNSIGNED_INT
                "count": len(triangles) * 3,
                "type": "SCALAR",
                "max": [len(verts) - 1],
                "min": [0],
            })
        else:
            gltf_dict["meshes"][0]["primitives"][0].pop("indices", None)

        if has_colors:
            color_view_index = len(gltf_dict["bufferViews"])
            gltf_dict["bufferViews"].append({
                "buffer": 0, "byteOffset": len(v_buf) + len(i_buf),
                "byteLength": len(c_buf), "target": 34962,
            })
            gltf_dict["accessors"].append({
                "bufferView": color_view_index, "byteOffset": 0, "componentType": 5126,
                "count": len(verts), "type": "VEC3",
            })

        json_bytes = json.dumps(gltf_dict, separators=(",", ":")).encode("utf-8")
        # Pad json to 4 bytes with spaces
        json_pad = (4 - (len(json_bytes) % 4)) % 4
        json_bytes += b" " * json_pad

        # GLB Header: magic (4), version (4), totalLength (4)
        total_glb_len = 12 + (8 + len(json_bytes)) + (8 + len(bin_buffer))
        output_glb_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_glb_path, "wb") as f:
            f.write(struct.pack("<4sII", b"glTF", 2, total_glb_len))
            # JSON Chunk: length, chunkType (0x4E4F534A)
            f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
            f.write(json_bytes)
            # BIN Chunk: length, chunkType (0x004E4942)
            f.write(struct.pack("<II", len(bin_buffer), 0x004E4942))
            f.write(bin_buffer)
        return True
    except Exception as exc:
        logger.error("Failed exporting mesh to GLB: %s", exc)
        return False


def generate_share_token(mission_id: str, expires_in_days: int = 7) -> str:
    """Generate a tamper-proof signed read-only share token with expiration."""
    payload = {
        "sub": f"share:{mission_id}",
        "mission_id": mission_id,
        "scope": "read_only_share",
        "exp": int(time.time()) + (expires_in_days * 86400),
    }
    return create_access_token(payload)


def verify_share_token(token: str) -> Optional[str]:
    """Verify share token and return mission_id if valid and unexpired."""
    try:
        decoded = decode_access_token(token)
        if decoded.get("scope") != "read_only_share":
            return None
        return decoded.get("mission_id")
    except Exception:
        return None
