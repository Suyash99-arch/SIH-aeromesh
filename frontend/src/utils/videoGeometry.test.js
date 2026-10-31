import test from "node:test";
import assert from "node:assert/strict";
import { computeRenderedVideoRect, mapBboxToRenderedRect } from "./videoGeometry.js";

test("computeRenderedVideoRect - letterbox contain mode with wider video", () => {
  // Video 1280x676 (approx 1.89:1) rendered inside 16:9 container (1280x720)
  const rect = computeRenderedVideoRect({
    videoWidth: 1280,
    videoHeight: 676,
    elementWidth: 1280,
    elementHeight: 720,
    objectFit: "contain",
  });

  assert.equal(rect.left, 0);
  assert.equal(rect.width, 1280);
  assert.equal(rect.height, 676);
  assert.equal(rect.top, (720 - 676) / 2); // 22px letterbox top & bottom
});

test("computeRenderedVideoRect - pillarbox contain mode with portrait video", () => {
  // Video 1080x1920 (portrait) inside 1920x1080 (landscape)
  const rect = computeRenderedVideoRect({
    videoWidth: 1080,
    videoHeight: 1920,
    elementWidth: 1920,
    elementHeight: 1080,
    objectFit: "contain",
  });

  const expectedWidth = 1080 * (1080 / 1920); // 607.5px
  assert.equal(rect.top, 0);
  assert.equal(rect.height, 1080);
  assert.ok(Math.abs(rect.width - expectedWidth) < 0.1);
  assert.ok(rect.left > 0);
});

test("mapBboxToRenderedRect - scales pixel coordinates into letterboxed video", () => {
  const renderedRect = computeRenderedVideoRect({
    videoWidth: 1000,
    videoHeight: 500,
    elementWidth: 1000,
    elementHeight: 1000,
    objectFit: "contain",
  });

  // Video height is 500 inside 1000 height -> top offset is 250
  assert.equal(renderedRect.top, 250);
  assert.equal(renderedRect.left, 0);

  // A box at [100, 50, 200, 150] in video coordinates
  const mapped = mapBboxToRenderedRect([100, 50, 200, 150], renderedRect);
  assert.equal(mapped.x, 100);
  assert.equal(mapped.y, 250 + 50); // 300
  assert.equal(mapped.w, 100);
  assert.equal(mapped.h, 100);
});
