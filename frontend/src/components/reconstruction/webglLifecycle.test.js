import test from "node:test";
import assert from "node:assert/strict";
import { attachWebGLContextHandlers, isSoftwareWebGLRenderer, releaseWebGLRenderer } from "./webglLifecycle.js";

test("software WebGL renderers are detected from the unmasked renderer name", () => {
  const debugInfo = { UNMASKED_RENDERER_WEBGL: 37446 };
  const makeRenderer = (name) => ({
    getContext: () => ({
      RENDERER: 7937,
      getExtension: (extension) => extension === "WEBGL_debug_renderer_info" ? debugInfo : null,
      getParameter: (parameter) => parameter === debugInfo.UNMASKED_RENDERER_WEBGL ? name : "WebGL renderer",
    }),
  });

  assert.equal(isSoftwareWebGLRenderer(makeRenderer("Google SwiftShader")), true);
  assert.equal(isSoftwareWebGLRenderer(makeRenderer("Mesa llvmpipe (LLVM 18.1.2)")), true);
  assert.equal(isSoftwareWebGLRenderer(makeRenderer("NVIDIA GeForce RTX")), false);
});

test("WebGL lifecycle prevents context loss and handles restore, then removes listeners", () => {
  const listeners = new Map();
  const canvas = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  };
  let prevented = false;
  let lost = 0;
  let restored = 0;
  const detach = attachWebGLContextHandlers(canvas, {
    onLost: () => { lost += 1; },
    onRestored: () => { restored += 1; },
  });

  listeners.get("webglcontextlost")({ preventDefault: () => { prevented = true; } });
  listeners.get("webglcontextrestored")({});
  assert.equal(prevented, true);
  assert.equal(lost, 1);
  assert.equal(restored, 1);
  detach();
  assert.equal(listeners.size, 0);
});

test("renderer cleanup skips an already-lost context and is idempotent", () => {
  let forceContextLossCalls = 0;
  let disposeCalls = 0;
  const renderer = {
    getContext: () => ({ isContextLost: () => true }),
    forceContextLoss: () => { forceContextLossCalls += 1; },
    dispose: () => { disposeCalls += 1; },
  };

  releaseWebGLRenderer(renderer);
  releaseWebGLRenderer(renderer);

  assert.equal(forceContextLossCalls, 0);
  assert.equal(disposeCalls, 1);
});

test("renderer cleanup loses a live context once before disposing", () => {
  const calls = [];
  const renderer = {
    getContext: () => ({ isContextLost: () => false }),
    forceContextLoss: () => calls.push("lose"),
    dispose: () => calls.push("dispose"),
  };

  releaseWebGLRenderer(renderer);
  releaseWebGLRenderer(renderer);

  assert.deepEqual(calls, ["lose", "dispose"]);
});
