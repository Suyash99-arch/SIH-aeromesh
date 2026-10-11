import test from "node:test";
import assert from "node:assert/strict";
import { attachWebGLContextHandlers } from "./webglLifecycle.js";

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
