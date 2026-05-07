"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createTemporaryZoneAccessRule, ensureAccessList, ensureAccessRule } = require("../src/main");
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

test("createTemporaryZoneAccessRule creates and verifies a temporary IP Access Rule", async () => {
  const calls = [];
  const originalStdoutWrite = process.stdout.write;

  process.stdout.write = () => true;

  const cloudflare = {
    createZoneAccessRule: async (zoneId, payload) => {
      calls.push({ method: "createZoneAccessRule", zoneId, payload });
      return { id: "rule-1" };
    },
    waitForZoneAccessRule: async (zoneId, ruleId, options) => {
      calls.push({ method: "waitForZoneAccessRule", zoneId, ruleId, options });
      return { id: ruleId };
    }
  };

  try {
    assert.deepEqual(await createTemporaryZoneAccessRule(cloudflare, "zone", "203.0.113.10"), {
      id: "rule-1"
    });

    assert.equal(calls[0].method, "createZoneAccessRule");
    assert.equal(calls[0].zoneId, "zone");
    assert.deepEqual(calls[0].payload, {
      ip: "203.0.113.10",
      notes: "GitHub Actions runner temporary access"
    });
    assert.equal(calls[1].method, "waitForZoneAccessRule");
    assert.equal(calls[1].ruleId, "rule-1");
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
});

test("createTemporaryZoneAccessRule exposes created rules before propagation verification", async () => {
  const calls = [];

  const cloudflare = {
    createZoneAccessRule: async () => ({ id: "rule-1" }),
    waitForZoneAccessRule: async () => {
      calls.push("wait");
      throw new Error("not visible");
    }
  };

  await assert.rejects(
    () => createTemporaryZoneAccessRule(cloudflare, "zone", "203.0.113.10", {
      onCreated: (rule) => calls.push(`created:${rule.id}`)
    }),
    /not visible/
  );

  assert.deepEqual(calls, ["created:rule-1", "wait"]);
});
