"use strict";

const { CloudflareClient } = require("./lib/cloudflare");
const { BYPASS_STRATEGIES } = require("./lib/constants");
const github = require("./lib/github");

async function run() {
  const token = github.getState("apiToken");
  const strategy = github.getState("strategy") || BYPASS_STRATEGIES.RULE_LIST;
  const accountId = github.getState("accountId");
  const zoneId = github.getState("zoneId");
  const listId = github.getState("listId");
  const accessRuleId = github.getState("accessRuleId");
  const timeoutMs = Number(github.getState("cloudflareRequestTimeoutMs") || 30000);
  const listOperationTimeoutMs = Number(github.getState("listOperationTimeoutMs") || 120000);
  const listOperationPollIntervalMs = Number(github.getState("listOperationPollIntervalMs") || 2000);
  const restoreBotFightMode = github.getState("restoreBotFightMode") === "true";

  if (token) {
    github.addMask(token);
  }

  const cloudflare = new CloudflareClient({ token, timeoutMs });
  const cleanupErrors = [];

  await github.group("Remove temporary runner access", async () => {
    if (strategy === BYPASS_STRATEGIES.RULE_LIST) {
      await cleanupRuleList(
        cloudflare,
        { accountId, listId, token, listOperationTimeoutMs, listOperationPollIntervalMs },
        cleanupErrors
      );
      return;
    }

    if (strategy === BYPASS_STRATEGIES.ACCESS_RULE) {
      await cleanupAccessRule(cloudflare, { zoneId, accessRuleId, token }, cleanupErrors);
      return;
    }

    const error = new Error(`Unknown cleanup strategy: ${strategy}`);
    cleanupErrors.push(error);
    github.warning(error.message);
  });

  if (restoreBotFightMode) {
    await github.group("Restore Bot Fight Mode", async () => {
      if (!zoneId || !token) {
        const error = new Error("Missing Cloudflare zone or token state.");
        cleanupErrors.push(error);
        github.warning(error.message);
        return;
      }

      const savedJson = github.getState("botManagementSettings");
      if (!savedJson) {
        const error = new Error("Missing saved Bot Management settings; cannot restore.");
        cleanupErrors.push(error);
        github.warning(error.message);
        return;
      }

      let saved;
      try {
        saved = JSON.parse(savedJson);
      } catch (error) {
        cleanupErrors.push(error);
        github.warning(`Could not parse saved Bot Management state: ${error.message}`);
        return;
      }

      try {
        await cloudflare.updateBotManagement(zoneId, saved);
        github.info("Restored Bot Fight Mode settings.");
      } catch (error) {
        cleanupErrors.push(error);
        github.warning(`Failed to restore Bot Fight Mode: ${error.message}`);
      }
    });
  }

  if (cleanupErrors.length > 0) {
    throw new Error(`Cleanup completed with ${cleanupErrors.length} error(s).`);
  }
}

async function cleanupRuleList(cloudflare, options, cleanupErrors) {
  const { accountId, listId, token, listOperationTimeoutMs, listOperationPollIntervalMs } = options;

  if (!accountId || !listId || !token) {
    github.warning("Skipping list cleanup because required action state is missing.");
    return;
  }

  try {
    await cloudflare.replaceListItemsAndWait(accountId, listId, [], {
      timeoutMs: listOperationTimeoutMs,
      pollIntervalMs: listOperationPollIntervalMs
    });
    github.info(`Cleared Cloudflare list: ${listId}`);
  } catch (error) {
    cleanupErrors.push(error);
    github.warning(`Failed to clear Cloudflare list: ${error.message}`);
  }
}

async function cleanupAccessRule(cloudflare, { zoneId, accessRuleId, token }, cleanupErrors) {
  if (!zoneId || !accessRuleId || !token) {
    github.warning("Skipping IP Access Rule cleanup because required action state is missing.");
    return;
  }

  try {
    await cloudflare.deleteZoneAccessRule(zoneId, accessRuleId);
    github.info(`Deleted temporary IP Access Rule: ${accessRuleId}`);
  } catch (error) {
    cleanupErrors.push(error);
    github.warning(`Failed to delete temporary IP Access Rule: ${error.message}`);
  }
}

if (require.main === module) {
  run().catch((error) => {
    github.fail(error);
  });
}

module.exports = {
  cleanupAccessRule,
  cleanupRuleList,
  run
};
