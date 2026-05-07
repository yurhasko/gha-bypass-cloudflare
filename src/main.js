"use strict";

const { setTimeout: sleep } = require("node:timers/promises");
const { CloudflareClient } = require("./lib/cloudflare");
const { readConfiguration } = require("./lib/config");
const {
  ACCESS_LIST_DESCRIPTION,
  ACCESS_LIST_NAME,
  ACCESS_RULE_NOTE,
  ACCESS_RULE_PROPAGATION_POLL_INTERVAL_MS,
  ACCESS_RULE_PROPAGATION_TIMEOUT_MS,
  BYPASS_RULE_DESCRIPTION,
  BYPASS_STRATEGIES
} = require("./lib/constants");
const github = require("./lib/github");
const { resolvePublicIp } = require("./lib/public-ip");

const READ_ONLY_BOT_MANAGEMENT_FIELDS = new Set(["using_latest_model"]);

async function run() {
  const config = readConfiguration();
  github.addMask(config.apiToken);
  github.setOutput("strategy", config.strategy);

  const cloudflare = new CloudflareClient({
    token: config.apiToken,
    timeoutMs: config.cloudflareRequestTimeoutMs
  });

  const publicIp = await github.group("Detect runner address", async () => {
    const address = await resolvePublicIp({
      providers: config.publicIpProviderUrls,
      maxAttempts: config.publicIpMaxAttempts,
      timeoutMs: config.publicIpRequestTimeoutMs
    });

    github.info(`Detected public IP: ${address}`);
    github.exportVariable("TEMPORARY_CLOUDFLARE_ACCESS_PUBLIC_IP", address);
    github.setOutput("publicIp", address);
    return address;
  });

  let list;

  if (config.strategy === BYPASS_STRATEGIES.RULE_LIST) {
    list = await github.group("Prepare Cloudflare resources", async () => prepareRuleListStrategy(cloudflare, config));
  } else if (config.strategy === BYPASS_STRATEGIES.ACCESS_RULE) {
    await github.group("Allow current runner", async () => prepareAccessRuleStrategy(cloudflare, config, publicIp));
  } else {
    throw new Error(`Unsupported bypass strategy: ${config.strategy}`);
  }

  if (config.disableBotFightMode) {
    await github.group("Temporarily adjust Bot Fight Mode", async () => {
      const currentSettings = await cloudflare.getBotManagement(config.zoneId);
      const writable = stripReadOnlyBotManagementFields(currentSettings);

      github.info(
        `Saving Bot Fight Mode state (fight_mode=${Boolean(writable.fight_mode)}, enable_js=${Boolean(writable.enable_js)}).`
      );
      github.saveState("restoreBotFightMode", "true");
      github.saveState("botManagementSettings", JSON.stringify(writable));

      await cloudflare.updateBotManagement(config.zoneId, {
        ...writable,
        fight_mode: false,
        enable_js: false
      });

      if (config.botFightModePropagationDelaySeconds > 0) {
        github.info(`Waiting ${config.botFightModePropagationDelaySeconds} seconds for settings propagation.`);
        await sleep(config.botFightModePropagationDelaySeconds * 1000);
      }
    });
  }

  if (config.strategy === BYPASS_STRATEGIES.RULE_LIST) {
    await github.group("Allow current runner", async () => {
      await cloudflare.replaceListItemsAndWait(
        config.accountId,
        list.id,
        [{ ip: publicIp, comment: "GitHub Actions runner" }],
        {
          timeoutMs: config.listOperationTimeoutMs,
          pollIntervalMs: config.listOperationPollIntervalMs
        }
      );
      github.info(`Cloudflare list now contains ${publicIp}.`);
    });
  }
}

async function prepareRuleListStrategy(cloudflare, config) {
  const result = await ensureAccessList(cloudflare, config.accountId);

  if (result.created) {
    try {
      await ensureAccessRule(cloudflare, config.zoneId);
    } catch (error) {
      github.warning(
        `WAF rule creation failed; rolling back the just-created list ${result.id} so the next run can retry setup.`
      );
      try {
        await cloudflare.deleteList(config.accountId, result.id);
        github.info(`Deleted Cloudflare list ${result.id}.`);
      } catch (deleteError) {
        github.warning(
          `Best-effort delete of list ${result.id} failed; remove it manually before retrying: ${deleteError.message}`
        );
      }
      throw error;
    }
  } else {
    github.info("Cloudflare list already exists; setup-only rule creation skipped.");
  }

  github.info(`${result.created ? "Created" : "Using"} Cloudflare list: ${result.id}`);
  github.exportVariable("TEMPORARY_CLOUDFLARE_ACCESS_LIST_ID", result.id);
  github.exportVariable("TEMPORARY_CLOUDFLARE_ACCESS_LIST_CREATED", String(result.created));
  github.setOutput("listId", result.id);
  github.setOutput("listCreated", String(result.created));
  saveCommonState(config);
  github.saveState("listOperationTimeoutMs", String(config.listOperationTimeoutMs));
  github.saveState("listOperationPollIntervalMs", String(config.listOperationPollIntervalMs));
  github.saveState("listId", result.id);

  return result;
}

async function prepareAccessRuleStrategy(cloudflare, config, publicIp) {
  return createTemporaryZoneAccessRule(cloudflare, config.zoneId, publicIp, {
    onCreated: (accessRule) => {
      github.exportVariable("TEMPORARY_CLOUDFLARE_ACCESS_RULE_ID", accessRule.id);
      github.setOutput("accessRuleId", accessRule.id);
      saveCommonState(config);
      github.saveState("accessRuleId", accessRule.id);
    }
  });
}

function saveCommonState(config) {
  github.saveState("strategy", config.strategy);
  github.saveState("accountId", config.accountId);
  github.saveState("zoneId", config.zoneId);
  github.saveState("apiToken", config.apiToken);
  github.saveState("cloudflareRequestTimeoutMs", String(config.cloudflareRequestTimeoutMs));
}

async function ensureAccessList(cloudflare, accountId) {
  const lists = await cloudflare.listRulesLists(accountId);
  const existing = lists.find((list) => list.name === ACCESS_LIST_NAME);

  if (existing) {
    if (existing.kind !== "ip") {
      throw new Error(`Cloudflare list '${ACCESS_LIST_NAME}' already exists, but it is a '${existing.kind}' list.`);
    }

    return { id: existing.id, created: false };
  }

  const created = await cloudflare.createIpList(accountId, {
    name: ACCESS_LIST_NAME,
    description: ACCESS_LIST_DESCRIPTION
  });

  if (created.kind !== "ip") {
    throw new Error(`Cloudflare created '${ACCESS_LIST_NAME}', but returned unexpected list kind '${created.kind}'.`);
  }

  return { id: created.id, created: true };
}

async function ensureAccessRule(cloudflare, zoneId) {
  const expression = `ip.src in $${ACCESS_LIST_NAME}`;
  const rule = {
    description: BYPASS_RULE_DESCRIPTION,
    expression,
    action: "skip",
    action_parameters: {
      phases: ["http_request_firewall_managed", "http_ratelimit", "http_request_sbfm"],
      ruleset: "current"
    },
    position: { index: 1 }
  };

  const entrypoint = await cloudflare.getCustomFirewallEntrypoint(zoneId);

  if (!entrypoint) {
    const ruleset = await cloudflare.createCustomFirewallRuleset(zoneId, [rule]);
    github.info(`Created custom firewall ruleset: ${ruleset.id}`);
    return;
  }

  const duplicate = (entrypoint.rules || []).find(
    (candidate) => candidate.description === rule.description && candidate.expression === rule.expression
  );

  if (duplicate) {
    github.info(`WAF skip rule already exists: ${duplicate.id}`);
    return;
  }

  const createdRule = await cloudflare.createRulesetRule(zoneId, entrypoint.id, rule);
  github.info(`Created WAF skip rule: ${createdRule.id}`);
}

async function createTemporaryZoneAccessRule(cloudflare, zoneId, publicIp, options = {}) {
  const rule = await cloudflare.createZoneAccessRule(zoneId, {
    ip: publicIp,
    notes: ACCESS_RULE_NOTE
  });

  if (options.onCreated) {
    await options.onCreated(rule);
  }

  await cloudflare.waitForZoneAccessRule(zoneId, rule.id, {
    timeoutMs: ACCESS_RULE_PROPAGATION_TIMEOUT_MS,
    pollIntervalMs: ACCESS_RULE_PROPAGATION_POLL_INTERVAL_MS
  });

  github.info(`Created temporary IP Access Rule: ${rule.id}`);
  return rule;
}

function stripReadOnlyBotManagementFields(settings) {
  const writable = {};
  for (const [key, value] of Object.entries(settings || {})) {
    if (!READ_ONLY_BOT_MANAGEMENT_FIELDS.has(key)) {
      writable[key] = value;
    }
  }
  return writable;
}

if (require.main === module) {
  run().catch((error) => {
    github.fail(error);
  });
}

module.exports = {
  createTemporaryZoneAccessRule,
  ensureAccessList,
  ensureAccessRule,
  prepareAccessRuleStrategy,
  prepareRuleListStrategy,
  stripReadOnlyBotManagementFields
};
