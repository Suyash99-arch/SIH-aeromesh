import test from "node:test";
import assert from "node:assert/strict";
import { joinApiUrl } from "./url.js";
import { API_BASE, getUploadBase } from "./missions.js";

test("joinApiUrl leaves absolute API response URLs untouched", () => {
  const absolute = "https://media.example.test/video/clip.mp4?download=1";
  assert.equal(joinApiUrl("https://api.example.test/api/v1", absolute), absolute);
  assert.equal(joinApiUrl("https://api.example.test/api/v1", "blob:local-id"), "blob:local-id");
});

test("joinApiUrl joins relative endpoints once", () => {
  assert.equal(
    joinApiUrl("https://api.example.test/api/v1/", "/missions/42/upload-status"),
    "https://api.example.test/api/v1/missions/42/upload-status",
  );
  assert.equal(
    joinApiUrl("https://api.example.test/api/v1", "/api/v1/missions/42/video"),
    "https://api.example.test/api/v1/missions/42/video",
  );
  assert.equal(
    joinApiUrl("https://api.example.test/api/v1", "/api/missions/42/reconstruction/mesh"),
    "https://api.example.test/api/v1/missions/42/reconstruction/mesh",
  );
  assert.equal(joinApiUrl("/api/v1", "/missions/42"), "/api/v1/missions/42");
  assert.equal(
    joinApiUrl("/api/v1", "/api/missions/42/reconstruction/mesh"),
    "/api/v1/missions/42/reconstruction/mesh",
  );
  assert.equal(
    joinApiUrl("/api/v1", "/api/v1/missions/42/reconstruction/mesh"),
    "/api/v1/missions/42/reconstruction/mesh",
  );
});

test("uploads use the configured API origin when no separate upload URL is set", () => {
  assert.equal(getUploadBase(), API_BASE);
});
