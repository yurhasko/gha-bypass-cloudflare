"use strict";

const { parseProviderUrls } = require("./public-ip");
const { BYPASS_STRATEGIES } = require("./constants");

function readConfiguration() {
  const strategy = readChoiceInput("strategy", BYPASS_STRATEGIES.RULE_LIST, Object.values(BYPASS_STRATEGIES));

  return {
    strategy,
    accountId: readInput("accountId", { required: strategy === BYPASS_STRATEGIES.RULE_LIST }),
    zoneId: readInput("zoneId", { required: true }),
    apiToken: readInput("apiToken", { required: true }),
    disableBotFightMode: readBooleanInput("disableBotFightMode", false),
    botFightModePropagationDelaySeconds: readIntegerInput("botFightModePropagationDelaySeconds", 10, { min: 0 }),
    publicIpMaxAttempts: readIntegerInput("publicIpMaxAttempts", 6, { min: 1 }),
    publicIpRequestTimeoutMs: readIntegerInput("publicIpRequestTimeoutMs", 5000, { min: 250 }),
    cloudflareRequestTimeoutMs: readIntegerInput("cloudflareRequestTimeoutMs", 30000, { min: 1000 }),
    listOperationTimeoutMs: readIntegerInput("listOperationTimeoutMs", 120000, { min: 1000 }),
    listOperationPollIntervalMs: readIntegerInput("listOperationPollIntervalMs", 2000, { min: 250 }),
    publicIpProviderUrls: parseProviderUrls(readInput("publicIpProviderUrls"))
  };
}

function readInput(name, options = {}) {
  const value = (process.env[`INPUT_${name.toUpperCase()}`] || "").trim();

  if (options.required && !value) {
    throw new Error(`Missing required input: ${name}`);
  }

  return value;
}

function readBooleanInput(name, fallback) {
  const value = readInput(name).toLowerCase();

  if (!value) return fallback;
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;

  throw new Error(`Input ${name} must be a boolean value.`);
}

function readIntegerInput(name, fallback, { min }) {
  const raw = readInput(name);
  const value = raw ? Number(raw) : fallback;

  if (!Number.isInteger(value) || value < min) {
    throw new Error(`Input ${name} must be an integer greater than or equal to ${min}.`);
  }

  return value;
}

function readChoiceInput(name, fallback, choices) {
  const value = readInput(name) || fallback;

  if (!choices.includes(value)) {
    throw new Error(`Input ${name} must be one of: ${choices.join(", ")}.`);
  }

  return value;
}

module.exports = {
  readBooleanInput,
  readChoiceInput,
  readConfiguration,
  readInput,
  readIntegerInput
};
