import test from "node:test";
import assert from "node:assert/strict";
import { joinApiUrl } from "./url.js";

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
  assert.equal(joinApiUrl("/api/v1", "/missions/42"), "/api/v1/missions/42");
});
