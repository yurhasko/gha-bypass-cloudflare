"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("post run restores Bot Management from saved JSON state", async () => {
  const cloudflarePath = require.resolve("../src/lib/cloudflare");
  const githubPath = require.resolve("../src/lib/github");
  const postPath = require.resolve("../src/post");
  const calls = [];

  class FakeCloudflareClient {
    async replaceListItemsAndWait() {}

    async updateBotManagement(zoneId, settings) {
      calls.push({ zoneId, settings });
    }
  }

  const fakeGithub = {
    addMask: () => {},
    fail: (error) => {
      throw error;
    },
    getState: (name) => ({
      accountId: "account",
      zoneId: "zone",
      apiToken: "token",
      cloudflareRequestTimeoutMs: "30000",
      listOperationTimeoutMs: "120000",
      listOperationPollIntervalMs: "2000",
      listId: "list",
      restoreBotFightMode: "true",
      botManagementSettings: JSON.stringify({
        fight_mode: true,
        enable_js: false,
        ai_bots_protection: "block"
      })
    })[name] || "",
    group: async (_name, callback) => callback(),
    info: () => {},
    warning: () => {}
  };

  const previousCloudflare = require.cache[cloudflarePath];
  const previousGithub = require.cache[githubPath];
  const previousPost = require.cache[postPath];

  require.cache[cloudflarePath] = {
    id: cloudflarePath,
    filename: cloudflarePath,
    loaded: true,
    exports: { CloudflareClient: FakeCloudflareClient }
  };
  require.cache[githubPath] = {
    id: githubPath,
    filename: githubPath,
    loaded: true,
    exports: fakeGithub
  };
  delete require.cache[postPath];

  try {
    const { run } = require("../src/post");
    await run();

    assert.deepEqual(calls, [{
      zoneId: "zone",
      settings: {
        fight_mode: true,
        enable_js: false,
        ai_bots_protection: "block"
      }
    }]);
  } finally {
    restoreCache(cloudflarePath, previousCloudflare);
    restoreCache(githubPath, previousGithub);
    restoreCache(postPath, previousPost);
  }
});

function restoreCache(path, value) {
  if (value) {
    require.cache[path] = value;
  } else {
    delete require.cache[path];
  }
}
