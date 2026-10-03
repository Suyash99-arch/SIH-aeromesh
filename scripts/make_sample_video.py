"""
Synthetic 3D Scene Flight Video Generator
Test Tooling Only - Never shown as application content or result.

Renders a 3D textured world with procedural geometric boxes, features, and ground plane
projected through a pinhole camera flying forward with gentle orbital parallax.
"""

from __future__ import annotations

import argparse
import math
import os
import subprocess
from pathlib import Path
import cv2
import numpy as np


def generate_procedural_texture(size: int = 256, seed: int = 42, pattern_type: int = 0) -> np.ndarray:
    """Generate high-contrast textured pattern with rich corner and edge features."""
    rng = np.random.RandomState(seed)
    tex = np.zeros((size, size, 3), dtype=np.uint8)
    
    if pattern_type % 3 == 0:
        # High contrast grid/checkerboard with random colored tiles
        grid_size = max(16, size // 8)
        for y in range(0, size, grid_size):
            for x in range(0, size, grid_size):
                color = rng.randint(40, 240, size=3).tolist()
                tex[y:y+grid_size, x:x+grid_size] = color
                cv2.rectangle(tex, (x, y), (min(size-1, x+grid_size), min(size-1, y+grid_size)), (0, 0, 0), 2)
    elif pattern_type % 3 == 1:
        # Concentric circles and cross hatches
        base_col = rng.randint(60, 200, size=3).tolist()
        tex[:] = base_col
        for r in range(10, size // 2, 15):
            c_col = rng.randint(0, 255, size=3).tolist()
            cv2.circle(tex, (size // 2, size // 2), r, c_col, 3)
        for i in range(0, size, 20):
            cv2.line(tex, (i, 0), (size - i, size), (255, 255, 255), 2)
    else:
        # Random colored rectangles and lines (fast feature-rich texture)
        tex[:] = rng.randint(50, 180, size=3).tolist()
        for _ in range(12):
            pt1 = (int(rng.randint(0, size)), int(rng.randint(0, size)))
            pt2 = (int(rng.randint(0, size)), int(rng.randint(0, size)))
            col = rng.randint(0, 255, size=3).tolist()
            cv2.rectangle(tex, pt1, pt2, col, -1)
        for _ in range(8):
            pt1 = (int(rng.randint(0, size)), int(rng.randint(0, size)))
            pt2 = (int(rng.randint(0, size)), int(rng.randint(0, size)))
            col = rng.randint(200, 255, size=3).tolist()
            cv2.line(tex, pt1, pt2, col, 2)
                
    # Add high-frequency noise for SIFT/ORB feature richness
    noise = rng.randint(-15, 15, size=(size, size, 3))
    tex = np.clip(tex.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    return tex


def create_synthetic_scene(seed: int = 42, num_boxes: int = 12) -> tuple[list[dict], np.ndarray]:
    """Generate 3D scene elements: ground plane and multiple 3D cuboids."""
    rng = np.random.RandomState(seed)
    boxes = []
    
    ground_tex = generate_procedural_texture(256, seed=seed, pattern_type=0)
    
    for i in range(num_boxes):
        cx = float(rng.uniform(-6.0, 6.0))
        cz = float(rng.uniform(6.0, 30.0))
        w = float(rng.uniform(1.4, 3.0))
        d = float(rng.uniform(1.4, 3.0))
        h = float(rng.uniform(1.8, 4.0))
        cy = -h / 2.0  # sit on ground
        
        tex = generate_procedural_texture(128, seed=seed + i * 17, pattern_type=i)
        
        x0, x1 = cx - w/2, cx + w/2
        y0, y1 = cy - h/2, cy + h/2
        z0, z1 = cz - d/2, cz + d/2
        
        vertices = np.array([
            [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],  # Front
            [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],  # Back
        ], dtype=np.float32)
        
        faces = [
            ([0, 1, 2, 3], "front"),
            ([5, 4, 7, 6], "back"),
            ([4, 0, 3, 7], "left"),
            ([1, 5, 6, 2], "right"),
            ([4, 5, 1, 0], "top"),
            ([3, 2, 6, 7], "bottom"),
        ]
        
        boxes.append({
            "vertices": vertices,
            "faces": faces,
            "texture": tex,
            "center": np.array([cx, cy, cz]),
        })
        
    return boxes, ground_tex


def render_frame(
    boxes: list[dict],
    ground_tex: np.ndarray,
    cam_pos: np.ndarray,
    cam_rot_angles: tuple[float, float, float],
    width: int,
    height: int,
) -> np.ndarray:
    """Render 3D scene from camera viewpoint with fast projection."""
    # Sky / background gradient
    grad_v = np.linspace(220, 130, height, dtype=np.uint8)[:, None]
    img = np.repeat(grad_v, width, axis=1)
    img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    img[:, :, 0] = np.clip(img[:, :, 0].astype(np.int16) + 15, 0, 255).astype(np.uint8)
    
    fx = fy = 0.85 * max(width, height)
    cx, cy = width / 2.0, height / 2.0
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=np.float32)
    
    yaw, pitch, roll = cam_rot_angles
    R_yaw = np.array([
        [math.cos(yaw), 0, math.sin(yaw)],
        [0, 1, 0],
        [-math.sin(yaw), 0, math.cos(yaw)]
    ], dtype=np.float32)
    
    R_pitch = np.array([
        [1, 0, 0],
        [0, math.cos(pitch), -math.sin(pitch)],
        [0, math.sin(pitch), math.cos(pitch)]
    ], dtype=np.float32)
    
    R_roll = np.array([
        [math.cos(roll), -math.sin(roll), 0],
        [math.sin(roll), math.cos(roll), 0],
        [0, 0, 1]
    ], dtype=np.float32)
    
    R_cam = R_roll @ R_pitch @ R_yaw
    t_cam = -R_cam @ cam_pos
    
    all_polygons = []
    
    # Ground plane grid (8 coarse tiles)
    for gx in range(-12, 12, 6):
        for gz in range(0, 36, 6):
            g_verts = np.array([
                [gx, 0, gz],
                [gx + 6, 0, gz],
                [gx + 6, 0, gz + 6],
                [gx, 0, gz + 6],
            ], dtype=np.float32)
            center = g_verts.mean(axis=0)
            dist = float(np.linalg.norm(center - cam_pos))
            all_polygons.append({
                "verts": g_verts,
                "tex": ground_tex,
                "dist": dist,
                "is_ground": True,
            })
            
    for box in boxes:
        for v_indices, _ in box["faces"]:
            face_verts = box["vertices"][v_indices]
            center = face_verts.mean(axis=0)
            dist = float(np.linalg.norm(center - cam_pos))
            all_polygons.append({
                "verts": face_verts,
                "tex": box["texture"],
                "dist": dist,
                "is_ground": False,
            })
            
    all_polygons.sort(key=lambda p: p["dist"], reverse=True)
    
    for poly in all_polygons:
        verts = poly["verts"]
        v_cam = (R_cam @ verts.T + t_cam[:, None]).T
        
        if np.any(v_cam[:, 2] <= 0.2):
            continue
            
        uv = (K @ (v_cam.T / v_cam[:, 2])).T[:, :2]
        
        vec1 = v_cam[1] - v_cam[0]
        vec2 = v_cam[2] - v_cam[0]
        normal = np.cross(vec1, vec2)
        if normal[2] >= 0 and not poly.get("is_ground", False):
            continue
            
        dst_pts = uv.astype(np.float32)
        tex_h, tex_w = poly["tex"].shape[:2]
        tex_corners = np.array([[0, 0], [tex_w - 1, 0], [tex_w - 1, tex_h - 1], [0, tex_h - 1]], dtype=np.float32)
        
        try:
            M = cv2.getPerspectiveTransform(tex_corners, dst_pts)
            warped = cv2.warpPerspective(poly["tex"], M, (width, height))
            
            mask = np.zeros((height, width), dtype=np.uint8)
            cv2.fillConvexPoly(mask, dst_pts.astype(np.int32), 255)
            
            img[mask > 0] = warped[mask > 0]
            cv2.polylines(img, [dst_pts.astype(np.int32)], isClosed=True, color=(20, 20, 20), thickness=1)
        except cv2.error:
            continue
            
    return img


def make_sample_video(
    output_path: str | Path,
    seconds: float = 4.0,
    fps: float = 20.0,
    width: int = 1280,
    height: int = 720,
    seed: int = 42,
    rotate: int = 0,
    portrait: bool = False,
) -> Path:
    """Generate synthetic video file with realistic camera parallax using fast ffmpeg pipe."""
    out_p = Path(output_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    
    if portrait and width > height:
        width, height = height, width
        
    num_frames = int(seconds * fps)
    boxes, ground_tex = create_synthetic_scene(seed=seed)
    
    # Build ffmpeg command for pristine H.264 encode
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{width}x{height}",
        "-pix_fmt", "bgr24",
        "-r", str(fps),
        "-i", "-",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "ultrafast",
        "-crf", "18",
    ]
    if rotate != 0:
        ffmpeg_cmd.extend(["-metadata:s:v:0", f"rotate={rotate}"])
        
    ffmpeg_cmd.append(str(out_p))
    
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    for i in range(num_frames):
        t = i / max(1, num_frames - 1)
        cam_x = 3.0 * math.sin(t * math.pi * 1.5)
        cam_y = -3.5 + 0.5 * math.cos(t * math.pi * 2.0)
        cam_z = 1.0 + t * 20.0
        cam_pos = np.array([cam_x, cam_y, cam_z], dtype=np.float32)
        
        yaw = -0.25 * math.sin(t * math.pi * 1.5)
        pitch = 0.15
        roll = 0.05 * math.sin(t * math.pi * 2.0)
        
        frame = render_frame(boxes, ground_tex, cam_pos, (yaw, pitch, roll), width, height)
        proc.stdin.write(frame.tobytes())
        
    proc.stdin.close()
    proc.wait()
    return out_p


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic textured 3D flight video for testing.")
    parser.add_argument("--seconds", type=float, default=4.0, help="Video duration in seconds")
    parser.add_argument("--fps", type=float, default=20.0, help="Video frames per second")
    parser.add_argument("--width", type=int, default=1280, help="Frame width")
    parser.add_argument("--height", type=int, default=720, help="Frame height")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for procedural scene")
    parser.add_argument("--rotate", type=int, default=0, choices=[0, 90, 180, 270], help="Rotation metadata tag")
    parser.add_argument("--portrait", action="store_true", help="Generate portrait aspect ratio")
    parser.add_argument("--output", type=str, default=None, help="Output mp4 path (default: samples/...)")
    
    args = parser.parse_args()
    
    output_dir = Path("samples")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    if args.output:
        out_path = Path(args.output)
    else:
        dim_str = f"{args.height}x{args.width}" if args.portrait and args.width > args.height else f"{args.width}x{args.height}"
        out_path = output_dir / f"synthetic_seed{args.seed}_{dim_str}.mp4"
        
    print(f"Generating synthetic video: {out_path} ({args.seconds}s, {args.fps}fps, seed={args.seed}, rotate={args.rotate})...")
    created = make_sample_video(
        output_path=out_path,
        seconds=args.seconds,
        fps=args.fps,
        width=args.width,
        height=args.height,
        seed=args.seed,
        rotate=args.rotate,
        portrait=args.portrait,
    )
    print(f"Successfully generated: {created} (Size: {created.stat().st_size / (1024*1024):.2f} MB)")


if __name__ == "__main__":
    main()
