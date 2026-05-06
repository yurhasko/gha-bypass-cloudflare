"use strict";

const { setTimeout: sleep } = require("node:timers/promises");

const API_BASE_URL = "https://api.cloudflare.com/client/v4";
const CUSTOM_FIREWALL_PHASE = "http_request_firewall_custom";

class CloudflareClient {
  constructor({ token, timeoutMs }) {
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async listRulesLists(accountId) {
    const response = await this.request("GET", `/accounts/${accountId}/rules/lists`);
    return response.result || [];
  }

  async createIpList(accountId, { name, description }) {
    const response = await this.request("POST", `/accounts/${accountId}/rules/lists`, {
      kind: "ip",
      name,
      description
    });

    return requireResult(response, "Cloudflare did not return the created list.");
  }

  async deleteList(accountId, listId) {
    await this.request("DELETE", `/accounts/${accountId}/rules/lists/${listId}`);
  }

  async replaceListItems(accountId, listId, items) {
    const response = await this.request("PUT", `/accounts/${accountId}/rules/lists/${listId}/items`, items);
    return requireOperationId(response, "Cloudflare did not return a list operation ID.");
  }

  async replaceListItemsAndWait(accountId, listId, items, options) {
    const operation = await this.replaceListItems(accountId, listId, items);
    await this.waitForListOperation(accountId, operation.operation_id, options);
    return operation;
  }

  async getListOperation(accountId, operationId) {
    const response = await this.request("GET", `/accounts/${accountId}/rules/lists/bulk_operations/${operationId}`);
    return response.result || {};
  }

  async waitForListOperation(accountId, operationId, { timeoutMs, pollIntervalMs }) {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const operation = await this.getListOperation(accountId, operationId);

      if (operation.status === "completed") {
        return operation;
      }

      if (operation.status === "failed") {
        throw new Error(`Cloudflare list operation ${operationId} failed: ${operation.error || "unknown error"}`);
      }

      if (!["pending", "running"].includes(operation.status)) {
        throw new Error(`Cloudflare list operation ${operationId} returned unknown status '${operation.status}'.`);
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(`Timed out waiting for Cloudflare list operation ${operationId}.`);
      }

      await sleep(Math.min(pollIntervalMs, remainingMs));
    }
  }

  async getCustomFirewallEntrypoint(zoneId) {
    const response = await this.request(
      "GET",
      `/zones/${zoneId}/rulesets/phases/${CUSTOM_FIREWALL_PHASE}/entrypoint`,
      undefined,
      { allowNotFound: true }
    );

    return response ? response.result : null;
  }

  async createCustomFirewallRuleset(zoneId, rules) {
    const response = await this.request("POST", `/zones/${zoneId}/rulesets`, {
      kind: "zone",
      name: "default",
      phase: CUSTOM_FIREWALL_PHASE,
      rules
    });

    return requireResult(response, "Cloudflare did not return the created ruleset.");
  }

  async createRulesetRule(zoneId, rulesetId, rule) {
    const response = await this.request("POST", `/zones/${zoneId}/rulesets/${rulesetId}/rules`, rule);
    return requireResult(response, "Cloudflare did not return the created rule.");
  }

  async getBotManagement(zoneId) {
    const response = await this.request("GET", `/zones/${zoneId}/bot_management`);
    return response.result || {};
  }

  async updateBotManagement(zoneId, settings) {
    return this.request("PUT", `/zones/${zoneId}/bot_management`, settings);
  }

  async request(method, path, body, options = {}) {
    let response;
    let payload;

    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          "user-agent": "gha-bypass-cloudflare"
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new Error(`Cloudflare request failed before receiving a response: ${method} ${path}: ${error.message}`);
    }

    const text = await response.text();
    payload = parseResponseBody(text);

    if (options.allowNotFound && response.status === 404) {
      return null;
    }

    if (!response.ok || payload.success === false) {
      throw new Error(formatCloudflareError(method, path, response.status, payload, text));
    }

    return payload;
  }
}

function requireResult(response, message) {
  if (!response.result || !response.result.id) {
    throw new Error(message);
  }

  return response.result;
}

function requireOperationId(response, message) {
  if (!response.result || !response.result.operation_id) {
    throw new Error(message);
  }

  return response.result;
}

function parseResponseBody(text) {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return { success: false, errors: [{ message: truncate(text) }] };
  }
}

function formatCloudflareError(method, path, status, payload, rawBody) {
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const details = errors
    .map((error) => {
      const code = error.code === undefined ? "" : `${error.code}: `;
      return `${code}${error.message || JSON.stringify(error)}`;
    })
    .join("; ");

  return `Cloudflare ${method} ${path} failed with HTTP ${status}: ${details || truncate(rawBody) || "no response body"}`;
}

function truncate(value, maxLength = 1000) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

module.exports = {
  CloudflareClient,
  formatCloudflareError,
  parseResponseBody,
  requireOperationId
};
