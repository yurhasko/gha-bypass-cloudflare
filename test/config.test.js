"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { readConfiguration } = require("../src/lib/config");

const ACTION_INPUT_NAMES = [
  "accountId",
  "zoneId",
  "apiToken",
  "disableBotFightMode",
  "botFightModePropagationDelaySeconds",
  "publicIpMaxAttempts",
  "publicIpRequestTimeoutMs",
  "cloudflareRequestTimeoutMs",
  "listOperationTimeoutMs",
  "listOperationPollIntervalMs",
  "publicIpProviderUrls"
];

test("readConfiguration uses Cloudflare-style camelCase action inputs", () => {
  withActionInputs({
    accountId: "account-id",
    zoneId: "zone-id",
    apiToken: "token",
    disableBotFightMode: "true",
    botFightModePropagationDelaySeconds: "12",
    publicIpMaxAttempts: "4",
    publicIpRequestTimeoutMs: "1500",
    cloudflareRequestTimeoutMs: "10000",
    listOperationTimeoutMs: "30000",
    listOperationPollIntervalMs: "500",
    publicIpProviderUrls: "https://one.example/ip, https://two.example/ip"
  }, () => {
    assert.deepEqual(readConfiguration(), {
      accountId: "account-id",
      zoneId: "zone-id",
      apiToken: "token",
      disableBotFightMode: true,
      botFightModePropagationDelaySeconds: 12,
      publicIpMaxAttempts: 4,
      publicIpRequestTimeoutMs: 1500,
      cloudflareRequestTimeoutMs: 10000,
      listOperationTimeoutMs: 30000,
      listOperationPollIntervalMs: 500,
      publicIpProviderUrls: ["https://one.example/ip", "https://two.example/ip"]
    });
  });
});

function withActionInputs(values, callback) {
  const previous = new Map();

  for (const name of ACTION_INPUT_NAMES) {
    const key = inputEnvName(name);
    previous.set(key, process.env[key]);
    delete process.env[key];
  }

  for (const [name, value] of Object.entries(values)) {
    process.env[inputEnvName(name)] = value;
  }

  try {
    callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function inputEnvName(name) {
  return `INPUT_${name.toUpperCase()}`;
}
