# Cloudflare bypass GitHub Action

GitHub Action that temporarily allows the current GitHub-hosted runner through Cloudflare: creates or reuses a Cloudflare account rule list, puts the runner public IP into that list for the duration of the job, and clears the list in the post step. On first setup it also creates the WAF custom rule that references the list.

## Use case

Use this before a workflow step that must call a Cloudflare-proxied host and is blocked by WAF, rate limiting, Super Bot Fight Mode, or Bot Fight Mode.

Typical examples:

- integration tests against a protected API
- deployment verification through a proxied hostname
- CI requests to admin endpoints that should stay protected from the public internet

## Requirements

The action requires a Cloudflare **API token**. Do not use the global API key.

Minimum permissions for regular runs:

```text
Account > Account Rule Lists > Read
Account > Account Rule Lists > Write
```

Additional permissions for the first setup run:

```text
Zone > Zone WAF > Read
Zone > Zone WAF > Write
```

Additional permissions when `disableBotFightMode` is enabled:

```text
Zone > Bot Management > Read
Zone > Bot Management > Write
```

Scope the token to:

```text
Account resources:
  the Cloudflare account containing the zone

Zone resources:
  the specific zone used by the workflow
```

`Zone Settings Read` and `Zone Settings Write` are not required.

## Usage

Store these as GitHub Actions secrets:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_ZONE_ID
CLOUDFLARE_API_TOKEN
```

Workflow:

```yaml
name: CI

on:
  push:
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v6

      - name: Allow runner through Cloudflare
        uses: yurhasko/gha-bypass-cloudflare@v1
        with:
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          zoneId: ${{ secrets.CLOUDFLARE_ZONE_ID }}
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}

      - name: Call protected endpoint
        run: curl --fail https://example.com/api/health
```

## Concurrency

The action manages a single shared list and replaces its contents on every run. Two jobs that run in parallel against the same Cloudflare account will overwrite each other's IPs, and either job's post step will leave the other without access.

Serialize runs with a workflow `concurrency` group when more than one job can hit the action at once:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    concurrency:
      group: cloudflare-bypass-${{ github.workflow }}
      cancel-in-progress: false
    steps:
      - uses: yurhasko/gha-bypass-cloudflare@v1
        with:
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          zoneId: ${{ secrets.CLOUDFLARE_ZONE_ID }}
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

Matrix jobs that need Cloudflare access must use the same `concurrency.group` value, or the protected work must run in one job after one bypass step. Do not put the bypass step in a separate setup job for downstream jobs; the action's post step runs when that setup job ends and clears the list before dependent jobs start.

## Bot Fight Mode

Cloudflare Bot Fight Mode and Super Bot Fight Mode may not respect WAF skip rules. If that applies to your zone, temporarily disable Bot Fight Mode during the job:

```yaml
- name: Allow runner through Cloudflare
  uses: yurhasko/gha-bypass-cloudflare@v1
  with:
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    zoneId: ${{ secrets.CLOUDFLARE_ZONE_ID }}
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    disableBotFightMode: true
```

The action reads the Bot Management configuration before changing anything, removes known read-only fields, overrides only `fight_mode` and `enable_js`, and restores the saved writable configuration in the post step. Other Bot Management settings on Pro/Business/Enterprise zones (`sbfm_*`, `optimize_wordpress`, etc.) are preserved.

For this mode, the token must have:

```text
Zone > Bot Management > Read
Zone > Bot Management > Write
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `accountId` | yes | | Cloudflare account ID. |
| `zoneId` | yes | | Cloudflare zone ID. |
| `apiToken` | yes | | Cloudflare API token. |
| `disableBotFightMode` | no | `false` | Temporarily disable Bot Fight Mode and restore it in the post step. |
| `botFightModePropagationDelaySeconds` | no | `10` | Delay after changing Bot Fight Mode settings. |
| `publicIpMaxAttempts` | no | `6` | Maximum public IP provider requests before failing. |
| `publicIpRequestTimeoutMs` | no | `5000` | Timeout per public IP provider request. |
| `cloudflareRequestTimeoutMs` | no | `30000` | Timeout per Cloudflare API request. |
| `listOperationTimeoutMs` | no | `120000` | Maximum wait time for Cloudflare rule list bulk operations. |
| `listOperationPollIntervalMs` | no | `2000` | Poll interval for Cloudflare rule list bulk operations. |
| `publicIpProviderUrls` | no | built in | Comma- or newline-separated HTTPS public IP provider URLs. |

Default public IP providers:

```text
https://api64.ipify.org?format=json
https://api.ipify.org?format=json
https://checkip.amazonaws.com
https://icanhazip.com
https://ident.me
```

## Outputs

| Output | Description |
| --- | --- |
| `publicIp` | Public IP detected for the runner. |
| `listId` | Cloudflare rule list ID used by the action. |
| `listCreated` | `true` if the action created the list in this run. |

## Cloudflare resources

The action manages one account-level IP list:

```text
github_actions_temporary_access
```

On the first setup run, it creates a WAF custom rule with this expression:

```text
ip.src in $github_actions_temporary_access
```

The skip rule targets these phases:

```text
http_request_firewall_managed
http_ratelimit
http_request_sbfm
```

WAF rule creation is setup-only. If the list already exists, the action does not touch WAF rules.

## Permission reduction after setup

After the first successful run, you can remove:

```text
Zone > Zone WAF > Read
Zone > Zone WAF > Write
```

Keep:

```text
Account > Account Rule Lists > Read
Account > Account Rule Lists > Write
```

Also keep Bot Management permissions if you use `disableBotFightMode`.

## Troubleshooting

### `GET /accounts/{accountId}/rules/lists` fails

The token is missing account rule list permissions.

Add:

```text
Account > Account Rule Lists > Read
Account > Account Rule Lists > Write
```

These permissions are account-level because Cloudflare rule lists are account resources.

### `GET /zones/{zoneId}/rulesets` or WAF rule creation fails

The token is missing zone WAF permissions.

Add:

```text
Zone > Zone WAF > Read
Zone > Zone WAF > Write
```

These are only needed for first-time setup.

### `GET /zones/{zoneId}/bot_management` fails

The token is missing Bot Management permissions.

Add:

```text
Zone > Bot Management > Read
Zone > Bot Management > Write
```

`Zone Settings Read/Write` is not sufficient for this endpoint.

### The WAF rule was deleted manually

If the Cloudflare list still exists, the action assumes setup is complete and skips WAF rule creation.

Fix it by either:

- recreating the WAF rule manually, or
- deleting the managed list and running the action again so setup runs from scratch.

### First setup failed midway

If the list was created in this run but WAF rule creation failed, the action best-effort deletes the just-created list before failing the step, so the next run can retry setup cleanly. If that delete itself fails, the action logs a warning identifying the list ID — remove it manually before retrying.

### The list is not empty after a cancelled workflow

The action uses a GitHub `post` hook with `post-if: always()`. GitHub normally runs it after failures.

If a runner is force-terminated or a job is hard-cancelled before post steps execute, clear the managed list manually.

## Credits

Inspired by [xiaotianxt/bypass-cloudflare-for-github-action](https://github.com/xiaotianxt/bypass-cloudflare-for-github-action).

This action is a Node.js implementation with a different runtime, input contract, permission model documentation, and cleanup flow.
