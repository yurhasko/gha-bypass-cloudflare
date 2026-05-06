"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CloudflareClient, formatCloudflareError, parseResponseBody, requireOperationId } = require("../src/lib/cloudflare");

test("parseResponseBody accepts JSON responses", () => {
  assert.deepEqual(parseResponseBody('{"success":true,"result":{"id":"abc"}}'), {
    success: true,
    result: { id: "abc" }
  });
});

test("parseResponseBody converts non-JSON responses into Cloudflare-style errors", () => {
  assert.deepEqual(parseResponseBody("service unavailable"), {
    success: false,
    errors: [{ message: "service unavailable" }]
  });
});

test("formatCloudflareError includes method, path, status, code, and message", () => {
  assert.equal(
    formatCloudflareError("GET", "/zones/example", 403, {
      errors: [{ code: 9109, message: "permission denied" }]
    }),
    "Cloudflare GET /zones/example failed with HTTP 403: 9109: permission denied"
  );
});

test("requireOperationId returns asynchronous list operation IDs", () => {
  assert.deepEqual(requireOperationId({ result: { operation_id: "operation-1" } }, "missing"), {
    operation_id: "operation-1"
  });
});

test("requireOperationId rejects malformed list operation responses", () => {
  assert.throws(() => requireOperationId({ result: {} }, "missing operation"), /missing operation/);
});

test("waitForListOperation returns completed operations", async () => {
  const client = new CloudflareClient({ token: "token", timeoutMs: 1000 });
  client.getListOperation = async () => ({ id: "operation-1", status: "completed" });

  assert.deepEqual(await client.waitForListOperation("account", "operation-1", {
    timeoutMs: 1000,
    pollIntervalMs: 1
  }), {
    id: "operation-1",
    status: "completed"
  });
});

test("waitForListOperation rejects failed operations", async () => {
  const client = new CloudflareClient({ token: "token", timeoutMs: 1000 });
  client.getListOperation = async () => ({ id: "operation-1", status: "failed", error: "bad list item" });

  await assert.rejects(
    () => client.waitForListOperation("account", "operation-1", {
      timeoutMs: 1000,
      pollIntervalMs: 1
    }),
    /bad list item/
  );
});
