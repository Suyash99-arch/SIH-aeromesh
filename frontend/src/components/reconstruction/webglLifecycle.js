const releasedRenderers = new WeakSet();

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

export function releaseWebGLRenderer(renderer) {
  if (!renderer || releasedRenderers.has(renderer)) return;
  releasedRenderers.add(renderer);

  const context = renderer.getContext?.();
  if (!context?.isContextLost?.()) {
    try {
      renderer.forceContextLoss?.();
    } catch {
      /* ignore context loss error */
    }
  }
  try {
    renderer.dispose?.();
  } catch {
    /* ignore dispose error */
  }
}
