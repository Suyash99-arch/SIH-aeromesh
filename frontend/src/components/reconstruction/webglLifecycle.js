export function attachWebGLContextHandlers(canvas, { onLost, onRestored } = {}) {
  if (!canvas?.addEventListener || !canvas?.removeEventListener) return () => {};
  const handleLost = (event) => {
    event.preventDefault?.();
    onLost?.(event);
  };
  const handleRestored = (event) => onRestored?.(event);
  canvas.addEventListener("webglcontextlost", handleLost, false);
  canvas.addEventListener("webglcontextrestored", handleRestored, false);
  return () => {
    canvas.removeEventListener("webglcontextlost", handleLost, false);
    canvas.removeEventListener("webglcontextrestored", handleRestored, false);
  };
}
