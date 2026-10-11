import test from "node:test";
import assert from "node:assert/strict";
import { retryUnauthorizedOnce } from "./authRecovery.js";

test("401 waits for auth restoration and retries once with the restored token", async () => {
  let token = null;
  let attempts = 0;
  const result = await retryUnauthorizedOnce({ status: 401 }, {
    waitForAuthReady: async () => { token = "restored-token"; return true; },
    getCurrentToken: () => token,
    tokenUsed: null,
    refreshAuth: async () => false,
    retry: async () => { attempts += 1; return { status: 200, authorization: `Bearer ${token}` }; },
  });

  assert.equal(attempts, 1);
  assert.deepEqual(result, { status: 200, authorization: "Bearer restored-token" });
});

test("401 does not retry before auth is ready or when auth cannot be restored", async () => {
  let attempts = 0;
  const retry = async () => { attempts += 1; return { status: 200 }; };
  const notReady = await retryUnauthorizedOnce({ status: 401 }, {
    waitForAuthReady: async () => false,
    getCurrentToken: () => null,
    tokenUsed: null,
    refreshAuth: async () => true,
    retry,
  });
  const unavailable = await retryUnauthorizedOnce({ status: 401 }, {
    waitForAuthReady: async () => true,
    getCurrentToken: () => null,
    tokenUsed: null,
    refreshAuth: async () => false,
    retry,
  });

  assert.equal(notReady.status, 401);
  assert.equal(unavailable.status, 401);
  assert.equal(attempts, 0);
});

test("a non-401 response is returned without auth work", async () => {
  let called = false;
  const response = { status: 200 };
  const result = await retryUnauthorizedOnce(response, {
    waitForAuthReady: async () => { called = true; return true; },
    getCurrentToken: () => null,
    tokenUsed: null,
    refreshAuth: async () => false,
    retry: async () => response,
  });
  assert.equal(result, response);
  assert.equal(called, false);
});
