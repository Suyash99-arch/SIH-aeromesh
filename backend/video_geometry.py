"""
Video rendered geometry and letterboxing calculation for AeroMesh.
Ensures bounding boxes align precisely with displayed video footage
under any aspect ratio, element size, or object-fit mode (contain, cover, fill).
"""

from typing import Dict, List, Optional, Tuple, Union


def compute_rendered_video_rect(
    video_width: float = 1920,
    video_height: float = 1080,
    element_width: float = 1920,
    element_height: float = 1080,
    object_fit: str = "contain",
) -> Dict[str, float]:
    vw = max(1.0, float(video_width or 1))
    vh = max(1.0, float(video_height or 1))
    ew = max(1.0, float(element_width or 1))
    eh = max(1.0, float(element_height or 1))

    video_aspect = vw / vh
    element_aspect = ew / eh

    render_width = ew
    render_height = eh
    offset_x = 0.0
    offset_y = 0.0

    if object_fit == "contain":
        if element_aspect > video_aspect:
            render_width = eh * video_aspect
            render_height = eh
            offset_x = (ew - render_width) / 2.0
            offset_y = 0.0
        else:
            render_width = ew
            render_height = ew / video_aspect
            offset_x = 0.0
            offset_y = (eh - render_height) / 2.0
    elif object_fit == "cover":
        if element_aspect > video_aspect:
            render_width = ew
            render_height = ew / video_aspect
            offset_x = 0.0
            offset_y = (eh - render_height) / 2.0
        else:
            render_width = eh * video_aspect
            render_height = eh
            offset_x = (ew - render_width) / 2.0
            offset_y = 0.0

    scale_x = render_width / vw
    scale_y = render_height / vh

    return {
        "left": offset_x,
        "top": offset_y,
        "width": render_width,
        "height": render_height,
        "scale_x": scale_x,
        "scale_y": scale_y,
        "video_width": vw,
        "video_height": vh,
        "element_width": ew,
        "element_height": eh,
    }


def map_bbox_to_rendered_rect(
    bbox: List[float],
    rendered_rect: Dict[str, float],
) -> Optional[Dict[str, float]]:
    if not bbox or len(bbox) < 4:
        return None

    b0, b1, b2, b3 = [float(v) for v in bbox[:4]]
    is_normalized = b0 <= 1.0 and b1 <= 1.0 and b2 <= 1.0 and b3 <= 1.0

    if is_normalized:
        x1 = rendered_rect["left"] + b0 * rendered_rect["width"]
        y1 = rendered_rect["top"] + b1 * rendered_rect["height"]
        x2 = rendered_rect["left"] + b2 * rendered_rect["width"]
        y2 = rendered_rect["top"] + b3 * rendered_rect["height"]
    else:
        x1 = rendered_rect["left"] + b0 * rendered_rect["scale_x"]
        y1 = rendered_rect["top"] + b1 * rendered_rect["scale_y"]
        x2 = rendered_rect["left"] + b2 * rendered_rect["scale_x"]
        y2 = rendered_rect["top"] + b3 * rendered_rect["scale_y"]

    return {
        "x": min(x1, x2),
        "y": min(y1, y2),
        "w": abs(x2 - x1),
        "h": abs(y2 - y1),
    }
