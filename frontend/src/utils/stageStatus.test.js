import test from "node:test";
import assert from "node:assert/strict";
import { getStageStatusLabel } from "./stageStatus.js";

test("stage status labels use translated keys for known backend values", () => {
  assert.equal(
    getStageStatusLabel("UNAVAILABLE", (key) => key === "stages.UNAVAILABLE" ? "Unavailable" : key),
    "Unavailable",
  );
  assert.equal(
    getStageStatusLabel("disabled", (key) => key === "stages.DISABLED" ? "Disabled" : key),
    "Disabled",
  );
});

test("missing stage status keys are humanized and only warned about in development", () => {
  const warnings = [];
  const translate = (key) => key;

  assert.equal(
    getStageStatusLabel("NEW_BACKEND_STATE", translate, {
      development: true,
      warn: (message) => warnings.push(message),
    }),
    "New Backend State",
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /NEW_BACKEND_STATE/u);

  assert.equal(
    getStageStatusLabel("NEW_BACKEND_STATE", translate, {
      development: false,
      warn: (message) => warnings.push(message),
    }),
    "New Backend State",
  );
  assert.equal(warnings.length, 1);
});
