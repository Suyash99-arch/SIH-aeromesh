import test from "node:test";
import assert from "node:assert/strict";
import { deleteMission, getMission, normalizeMissionId } from "./missions.js";

test("mission identifiers accept strings, id objects, and mission_id objects", () => {
  assert.equal(normalizeMissionId("mission-123"), "mission-123");
  assert.equal(normalizeMissionId({ id: "mission-123" }), "mission-123");
  assert.equal(normalizeMissionId({ mission_id: "mission-123" }), "mission-123");
});

test("invalid mission identifiers are rejected with a user-facing error", () => {
  for (const invalid of [null, undefined, 42, {}, { id: 42 }, "[object Object]"]) {
    assert.throws(
      () => normalizeMissionId(invalid),
      /Invalid mission ID\. Please select a mission and try again\./u,
    );
  }
});

test("mission requests normalize objects and reject invalid IDs before fetching", async () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const requests = [];
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.window = {
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url).endsWith("/missions/mission-123")) {
        return {
          status: 404,
          ok: false,
          json: async () => ({ detail: "not found" }),
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true }),
      };
    },
  };

  try {
    await getMission({ mission_id: "mission-123" });
    await assert.rejects(deleteMission({}), /Invalid mission ID/u);
    assert.throws(() => getMission("[object Object]"), /Invalid mission ID/u);
    assert.equal(requests.length, 1);
    assert.match(requests[0], /\/missions\/mission-123$/u);
    assert.doesNotMatch(requests.join("\n"), /\[object/iu);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});
