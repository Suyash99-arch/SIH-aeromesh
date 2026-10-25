const releasedRenderers = new WeakSet();

export function isSoftwareWebGLRenderer(renderer) {
  const context = renderer?.getContext?.();
  if (!context) return false;

  const debugInfo = context.getExtension?.("WEBGL_debug_renderer_info");
  const rendererName = debugInfo
    ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : context.getParameter?.(context.RENDERER);
  return /swiftshader|llvmpipe|softpipe|software rasterizer/iu.test(String(rendererName || ""));
}

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
  if (!context?.isContextLost?.()) renderer.forceContextLoss?.();
  renderer.dispose?.();
}
