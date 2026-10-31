/**
 * Video rendered geometry and letterboxing calculation.
 * Ensures bounding boxes align precisely with displayed video footage
 * under any aspect ratio, element size, or object-fit mode (contain, cover, fill).
 */

export function computeRenderedVideoRect({
  videoWidth = 1920,
  videoHeight = 1080,
  elementWidth = 1920,
  elementHeight = 1080,
  objectFit = "contain",
}) {
  const vw = Math.max(1, Number(videoWidth) || 1);
  const vh = Math.max(1, Number(videoHeight) || 1);
  const ew = Math.max(1, Number(elementWidth) || 1);
  const eh = Math.max(1, Number(elementHeight) || 1);

  const videoAspect = vw / vh;
  const elementAspect = ew / eh;

  let renderWidth = ew;
  let renderHeight = eh;
  let offsetX = 0;
  let offsetY = 0;

  if (objectFit === "contain") {
    if (elementAspect > videoAspect) {
      // Element is wider than video -> pillarboxed (black bars left/right)
      renderWidth = eh * videoAspect;
      renderHeight = eh;
      offsetX = (ew - renderWidth) / 2;
      offsetY = 0;
    } else {
      // Element is taller than video -> letterboxed (black bars top/bottom)
      renderWidth = ew;
      renderHeight = ew / videoAspect;
      offsetX = 0;
      offsetY = (eh - renderHeight) / 2;
    }
  } else if (objectFit === "cover") {
    if (elementAspect > videoAspect) {
      // Crop top/bottom
      renderWidth = ew;
      renderHeight = ew / videoAspect;
      offsetX = 0;
      offsetY = (eh - renderHeight) / 2;
    } else {
      // Crop left/right
      renderWidth = eh * videoAspect;
      renderHeight = eh;
      offsetX = (ew - renderWidth) / 2;
      offsetY = 0;
    }
  }

  const scaleX = renderWidth / vw;
  const scaleY = renderHeight / vh;

  return {
    left: offsetX,
    top: offsetY,
    width: renderWidth,
    height: renderHeight,
    scaleX,
    scaleY,
    videoWidth: vw,
    videoHeight: vh,
    elementWidth: ew,
    elementHeight: eh,
    objectFit,
  };
}

export function mapBboxToRenderedRect(bbox, renderedRect) {
  if (!bbox || !Array.isArray(bbox) || bbox.length < 4) return null;
  const [b0, b1, b2, b3] = bbox.slice(0, 4).map(Number);
  if (![b0, b1, b2, b3].every(Number.isFinite)) return null;

  const isNormalized = b0 <= 1.0 && b1 <= 1.0 && b2 <= 1.0 && b3 <= 1.0;

  let x1, y1, x2, y2;
  if (isNormalized) {
    x1 = renderedRect.left + b0 * renderedRect.width;
    y1 = renderedRect.top + b1 * renderedRect.height;
    x2 = renderedRect.left + b2 * renderedRect.width;
    y2 = renderedRect.top + b3 * renderedRect.height;
  } else {
    x1 = renderedRect.left + b0 * renderedRect.scaleX;
    y1 = renderedRect.top + b1 * renderedRect.scaleY;
    x2 = renderedRect.left + b2 * renderedRect.scaleX;
    y2 = renderedRect.top + b3 * renderedRect.scaleY;
  }

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}
