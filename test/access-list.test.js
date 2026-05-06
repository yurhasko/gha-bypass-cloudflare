"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ensureAccessList, ensureAccessRule } = require("../src/main");
const { ACCESS_LIST_NAME } = require("../src/lib/constants");

test("ensureAccessList reuses an existing IP list", async () => {
  const cloudflare = {
    listRulesLists: async () => [{ id: "list-1", name: ACCESS_LIST_NAME, kind: "ip" }]
  };

  assert.deepEqual(await ensureAccessList(cloudflare, "account"), {
    id: "list-1",
    created: false
  });
});

test("ensureAccessList rejects a same-name non-IP list", async () => {
  const cloudflare = {
    listRulesLists: async () => [{ id: "list-1", name: ACCESS_LIST_NAME, kind: "hostname" }]
  };

  await assert.rejects(() => ensureAccessList(cloudflare, "account"), /hostname/);
});

test("ensureAccessList creates a missing IP list", async () => {
  const cloudflare = {
    listRulesLists: async () => [],
    createIpList: async () => ({ id: "list-2", kind: "ip" })
  };

  assert.deepEqual(await ensureAccessList(cloudflare, "account"), {
    id: "list-2",
    created: true
  });
});

test("ensureAccessRule is available for setup-only rule creation", async () => {
  const calls = [];
  const originalStdoutWrite = process.stdout.write;

  process.stdout.write = () => true;

  const cloudflare = {
    getCustomFirewallEntrypoint: async () => null,
    createCustomFirewallRuleset: async (_zoneId, rules) => {
      calls.push(rules[0]);
      return { id: "ruleset-1" };
    }
  };

  try {
    await ensureAccessRule(cloudflare, "zone");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "skip");
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
});
