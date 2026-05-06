"use strict";

const { isIP } = require("node:net");

const DEFAULT_IP_PROVIDERS = [
  "https://api64.ipify.org?format=json",
  "https://api.ipify.org?format=json",
  "https://checkip.amazonaws.com",
  "https://icanhazip.com",
  "https://ident.me"
];

async function resolvePublicIp({ providers, maxAttempts, timeoutMs }) {
  const failures = [];

  for (let index = 0; index < maxAttempts; index += 1) {
    const provider = providers[index % providers.length];

    try {
      const response = await fetch(provider, {
        headers: {
          accept: "application/json, text/plain, */*",
          "user-agent": "gha-bypass-cloudflare"
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const ip = parseIpAddress(body);
      if (!ip) {
        throw new Error("response did not contain a valid IP address");
      }

      return ip;
    } catch (error) {
      failures.push(`${provider}: ${error.message}`);
    }
  }

  throw new Error(`Unable to detect runner public IP after ${maxAttempts} attempt(s).\n${failures.join("\n")}`);
}

function parseIpAddress(body) {
  const text = body.trim();

  if (isIP(text)) {
    return text;
  }

  try {
    const json = JSON.parse(text);
    const candidates = [
      json.ip,
      json.query,
      json.address,
      json.origin,
      json.result && json.result.ip
    ];

    for (const candidate of candidates) {
      const ip = String(candidate || "").split(",")[0].trim();
      if (isIP(ip)) {
        return ip;
      }
    }
  } catch (_error) {
    return "";
  }

  return "";
}

function parseProviderUrls(raw) {
  const providers = raw
    ? raw.split(/[\n,]+/).map((provider) => provider.trim()).filter(Boolean)
    : DEFAULT_IP_PROVIDERS;

  if (providers.length === 0) {
    throw new Error("At least one IP provider URL is required.");
  }

  for (const provider of providers) {
    const parsed = new URL(provider);
    if (parsed.protocol !== "https:") {
      throw new Error(`IP provider URLs must use HTTPS: ${provider}`);
    }
  }

  return providers;
}

module.exports = {
  DEFAULT_IP_PROVIDERS,
  parseIpAddress,
  parseProviderUrls,
  resolvePublicIp
};
