import assert from "node:assert/strict";
import test from "node:test";
import { formatTelemetryRequestUrl } from "./telemetry.js";

test("telemetry preserves blob URLs without duplicating their embedded origin", () => {
  const blobUrl = "blob:https://sih-aeromesh-blond.vercel.app/eff9dcc4-5b2b-4ee4-9f90-fb2740b4e3c6";
  assert.equal(formatTelemetryRequestUrl(blobUrl), blobUrl);
});

test("telemetry redacts credentials and sensitive query parameters", () => {
  assert.equal(
    formatTelemetryRequestUrl("https://api.example.test/upload?access_token=private", ["person@example.test"]),
    "https://api.example.test/upload?access_token=[redacted]",
  );
  assert.equal(formatTelemetryRequestUrl("https://person@example.test/path", ["person@example.test"]), "https://[redacted]/path");
});
