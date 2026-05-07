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

test("createZoneAccessRule sends Cloudflare IP Access Rule payloads", async () => {
  const client = new CloudflareClient({ token: "token", timeoutMs: 1000 });
  const calls = [];
  client.request = async (method, path, body) => {
    calls.push({ method, path, body });
    return { result: { id: "rule-1" } };
  };

  assert.deepEqual(await client.createZoneAccessRule("zone", {
    ip: "203.0.113.10",
    notes: "temporary access"
  }), {
    id: "rule-1"
  });

  assert.deepEqual(calls, [{
    method: "POST",
    path: "/zones/zone/firewall/access_rules/rules",
    body: {
      mode: "whitelist",
      configuration: {
        target: "ip",
        value: "203.0.113.10"
      },
      notes: "temporary access"
    }
  }]);
});

test("getZoneAccessRule fetches the access rule by ID", async () => {
  const client = new CloudflareClient({ token: "token", timeoutMs: 1000 });
  const calls = [];
  client.request = async (method, path, body, options) => {
    calls.push({ method, path, body, options });
    return { result: { id: "rule-1" } };
  };

  assert.deepEqual(await client.getZoneAccessRule("zone", "rule-1"), { id: "rule-1" });
  assert.deepEqual(calls, [{
    method: "GET",
    path: "/zones/zone/firewall/access_rules/rules/rule-1",
    body: undefined,
    options: { allowNotFound: true }
  }]);
});

test("getZoneAccessRule returns null while the rule is still propagating", async () => {
  const client = new CloudflareClient({ token: "token", timeoutMs: 1000 });
  client.request = async () => null;

  assert.equal(await client.getZoneAccessRule("zone", "rule-1"), null);
});

test("waitForZoneAccessRule polls by ID and returns the rule once visible", async () => {
  const client = new CloudflareClient({ token: "token", timeoutMs: 1000 });
  let calls = 0;
  client.getZoneAccessRule = async () => {
    calls += 1;
    return calls === 1 ? null : { id: "rule-1" };
  };

  assert.deepEqual(await client.waitForZoneAccessRule("zone", "rule-1", {
    timeoutMs: 1000,
    pollIntervalMs: 1
  }), {
    id: "rule-1"
  });
});

test("deleteZoneAccessRule treats missing cleanup targets as already clean", async () => {
  const client = new CloudflareClient({ token: "token", timeoutMs: 1000 });
  const calls = [];
  client.request = async (method, path, body, options) => {
    calls.push({ method, path, body, options });
  };

  await client.deleteZoneAccessRule("zone", "rule-1");

  assert.deepEqual(calls, [{
    method: "DELETE",
    path: "/zones/zone/firewall/access_rules/rules/rule-1",
    body: undefined,
    options: { allowNotFound: true }
  }]);
});
