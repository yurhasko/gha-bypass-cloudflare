"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { stripReadOnlyBotManagementFields } = require("../src/main");

test("stripReadOnlyBotManagementFields removes read-only fields and preserves writable fields", () => {
  assert.deepEqual(stripReadOnlyBotManagementFields({
    fight_mode: true,
    enable_js: true,
    ai_bots_protection: "block",
    content_bots_protection: "disabled",
    using_latest_model: true
  }), {
    fight_mode: true,
    enable_js: true,
    ai_bots_protection: "block",
    content_bots_protection: "disabled"
  });
});
