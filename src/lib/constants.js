"use strict";

module.exports = {
  ACCESS_RULE_NOTE: "GitHub Actions runner temporary access",
  ACCESS_RULE_PROPAGATION_POLL_INTERVAL_MS: 1000,
  ACCESS_RULE_PROPAGATION_TIMEOUT_MS: 10000,
  ACCESS_LIST_DESCRIPTION: "Managed by the Temporary Cloudflare Access GitHub Action.",
  ACCESS_LIST_NAME: "github_actions_temporary_access",
  BYPASS_RULE_DESCRIPTION: "Temporary access for GitHub Actions runners",
  BYPASS_STRATEGIES: Object.freeze({
    RULE_LIST: "ruleList",
    ACCESS_RULE: "accessRule"
  })
};
