# surge-vless-bridge

[![npm version](https://img.shields.io/npm/v/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)
[![npm downloads](https://img.shields.io/npm/dm/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)

[中文文档](./README.md) · [Changelog](./CHANGELOG.md)

**Use VLESS subscriptions in Surge Mac.**

Surge Mac does not support VLESS (REALITY and XTLS Vision included). This tool turns VLESS
subscriptions into Surge nodes, with a local [sing-box](https://github.com/SagerNet/sing-box) handling
the connections, so your rules, policy groups and dashboard keep working as usual.

Once set up, your Surge profile gains nodes like these and a `VLESS` policy group, and is otherwise left
as it was:

```ini
[Proxy]
# vless start
HK 01 = external, exec=/bin/sh, args=…/launcher.sh, args=…/sing-box, local-port=2081, addresses=203.0.113.10
JP 01 = external, exec=/bin/sh, args=…/launcher.sh, args=…/sing-box, local-port=2082, addresses=203.0.113.20
# vless end

[Proxy Group]
VLESS = url-test, HK 01, JP 01, no-alert=0, hidden=0
```

## Prerequisites

- Surge Mac on macOS, with an active profile that has `[Proxy]` and `[Proxy Group]` sections
- Node.js 20 or later
- [sing-box](https://github.com/SagerNet/sing-box) (`brew install sing-box`)

## Setting this up with an AI agent

Paste this into Claude Code, Cursor, Codex or a similar agent that can use your terminal; it installs
what is needed and sets everything up:

```text
Read https://github.com/chen86860/surge-vless-bridge/blob/master/docs/agent-setup.md
and set up surge-vless-bridge on this Mac for me.
```

> Treat the subscription URL like a password: giving it to the agent on your machine is fine, but never
> post it in a public issue, chat or screenshot.

## Manual setup

### Install

```bash
npm i -g surge-vless-bridge
```

### Quick Start

**1. Create this tool's config:**

```bash
surge-vless-bridge init
```

Enter your subscription URL and pick the Surge profile to write to when asked. The config is saved to
`~/.config/surge-vless-bridge/config.json`.

**2. Fill in the config** (only if you skipped a question):

```json
{
  "subscriptionUrls": ["https://your-provider.com/subscription"],
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/MyProfile.conf"
}
```

- **`subscriptionUrls`**: one or more VLESS subscription URLs; their nodes share one policy group.
- **`surgeConfigPath`**: full path to your Surge profile (a `.conf` file). Find it via the Surge menu
  bar icon → Switch Profile → Show in Finder.

**3. Preview, then sync:**

```bash
surge-vless-bridge sync --dry-run   # preview only, writes nothing
surge-vless-bridge sync
```

**4. Check that everything is in order:**

```bash
surge-vless-bridge doctor
```

**5. Route traffic through the nodes:**

`sync` never touches your rules. For traffic to use the nodes, reference `VLESS` from your profile — for
example by adding it to the group you switch between:

```ini
[Proxy Group]
Proxy = select, VLESS, DIRECT

[Rule]
DOMAIN-SUFFIX,example.com,VLESS
FINAL,Proxy
```

Do not edit the `VLESS = …` line or anything between `# vless start` and `# vless end` by hand; the next
`sync` overwrites them.

### Upgrading

```bash
npm i -g surge-vless-bridge@latest
surge-vless-bridge sync
```

Run `sync` once after upgrading so the generated files match the new release.

## Config File

This tool's own config, created by `init`. Default path: `~/.config/surge-vless-bridge/config.json`;
pass `--config <path>` to use another file.

```json
{
  "subscriptionUrls": ["https://example.com/subscription-a", "https://example.com/subscription-b"],
  "vlessNodes": [
    "vless://uuid@example.com:443?type=tcp&security=reality&pbk=public-key&sid=short-id&fp=chrome&sni=example.com&flow=xtls-rprx-vision#Example"
  ],
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/Config.conf",
  "policyGroupName": "VLESS",
  "portStart": 2081
}
```

### Required

| Field             | Description                     |
| ----------------- | ------------------------------- |
| `surgeConfigPath` | Full path to your Surge profile |

Plus **at least one** node source:

| Field              | Description                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| `subscriptionUrls` | One or more VLESS subscription URLs, optionally as objects with options below |
| `vlessNodes`       | One or more raw `vless://` node URLs, for when you have no subscription       |

Duplicate node names get a numeric suffix (`HK 01 2`). A subscription with no usable nodes is reported as
a warning and does not affect the others.

### Optional

| Field               | Default                                | Description                                         |
| ------------------- | -------------------------------------- | --------------------------------------------------- |
| `policyGroupName`   | `"VLESS"`                              | Surge policy group name to populate                 |
| `portStart`         | `2081`                                 | First local port; node N uses `portStart + N - 1`   |
| `singBoxBinary`     | auto-detected via `which sing-box`     | Path to the `sing-box` binary                       |
| `outputDir`         | `~/.config/surge-vless-bridge/nodes`   | Where the sing-box config and launcher script live  |
| `backupDir`         | `~/.config/surge-vless-bridge/backups` | Where Surge profile backups are stored              |
| `backupKeep`        | `20`                                   | How many backups to keep                            |
| `autoReload`        | `true`                                 | Reload Surge after changing its profile             |
| `subscriptionProxy` | none                                   | Proxy to retry a failed subscription fetch through  |
| `addressResolver`   | `"doh"`                                | How node addresses are resolved, see below          |

### Per-subscription prefixes and policy groups

Each `subscriptionUrls` entry is either a URL or an object with options:

```json
{
  "subscriptionUrls": [
    "https://example.com/subscription-a",
    { "url": "https://example.com/subscription-b", "prefix": "B | " },
    { "url": "https://example.com/subscription-c", "prefix": "C | ", "group": "Provider C" }
  ]
}
```

| Option   | Description                                                                         |
| -------- | ----------------------------------------------------------------------------------- |
| `url`    | The subscription URL. Required                                                      |
| `prefix` | Prepended to every node name from it (`B \| HK 01`), to tell same-named nodes apart |
| `group`  | Puts its nodes in their own policy group instead of `policyGroupName`               |

The example above produces:

```ini
VLESS = url-test, HK 01, …, B | HK 01, …, no-alert=0, hidden=0
Provider C = url-test, C | HK 01, …, no-alert=0, hidden=0
```

- When every subscription has a `group`, `VLESS` becomes `select, <each group>`, so rules that use it
  keep working.
- A `group` removed from the config is removed from Surge on the next `sync`.
- Do not reuse the name of one of your own groups: it would be overwritten.

### Traffic and expiry entries

Notices disguised as nodes — traffic left, expiry date, reset countdown — are skipped automatically, and
`sync` lists what it skipped.

> A real node whose name happens to contain such words (`流量`, `剩余`, `Expired`, …) is skipped too;
> check the `sync` output.

### Fetching a subscription through a proxy

Some subscriptions are only reachable through a proxy. With `subscriptionProxy` set, a failed direct
fetch is retried once through it:

```json
{
  "subscriptionProxy": "http://127.0.0.1:6152"
}
```

`6152` is Surge's default HTTP proxy port.

### Resolving node addresses

`sync` writes each node server's IP into Surge's `addresses=`; `addressResolver` sets how it is
resolved:

| Value    | Description                                                         |
| -------- | ------------------------------------------------------------------- |
| `doh`    | Over DoH (default); gets real IPs even with Surge's enhanced mode on |
| `dns`    | Through the DNS servers in `addressResolver.dnsServers`             |
| `system` | With the system resolver, for networks that block DoH               |
| `off`    | Do not write `addresses=`                                           |

## Commands

| Command                             | Description                                                       |
| ----------------------------------- | ----------------------------------------------------------------- |
| `surge-vless-bridge init`           | Create this tool's config                                         |
| `surge-vless-bridge sync`           | Fetch subscriptions and update Surge                              |
| `surge-vless-bridge rebuild`        | Rebuild the managed block in Surge from local nodes, offline      |
| `surge-vless-bridge restore [path]` | Restore the latest (or the given) Surge profile backup            |
| `surge-vless-bridge clean`          | Remove everything this tool wrote to Surge and the generated files |
| `surge-vless-bridge doctor`         | Check the config and environment; exits 1 on failure              |

| Flag              | Effect                                              |
| ----------------- | --------------------------------------------------- |
| `--dry-run`       | `sync`: preview only, write nothing                 |
| `--no-reload`     | `sync` / `rebuild` / `restore`: do not reload Surge |
| `--no-input`      | `init`: ask nothing, write the template             |
| `--force`         | `init`: overwrite an existing config                |
| `--yes`           | `clean`: skip the confirmation                      |
| `--config <path>` | Use the given config file                           |

Most config fields can also be overridden for one run (`--subscription-url`, `--group-name`, …); see
`surge-vless-bridge help` for the full list.

### Automatic reload

Surge is reloaded after every change to its profile: by default through the `surge-cli` that ships with
Surge, with no setup needed, or through `http-api` when your profile enables it. Pass `--no-reload`, or
set `"autoReload": false`, to opt out.

### Uninstalling

```bash
surge-vless-bridge clean
npm uninstall -g surge-vless-bridge
```

This tool's config and backups stay in `~/.config/surge-vless-bridge/`; delete it by hand when you no
longer need them.

## Troubleshooting

Start with `surge-vless-bridge doctor`; every check reports `OK`, `WARN` or `FAIL` with a suggested fix.

| Symptom                                         | What to check                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Surge shows `External Proxy Process Terminated` | Read `~/.config/surge-vless-bridge/nodes/run/sing-box.log`; if sing-box is outdated, `brew upgrade sing-box` and `sync` |
| No nodes in Surge after `sync`                  | Reload the profile once from the Surge menu                                                                       |
| Nodes are there but traffic avoids them         | Make sure a rule or your everyday group references `VLESS` — see [Quick Start step 5](#quick-start)               |
| Every latency test times out                    | Check that the subscription itself works; if `doctor` reports a port in use, change `portStart` and `sync`       |
| `Failed to fetch subscription …: 403`           | If the URL opens in a browser, try [`subscriptionProxy`](#fetching-a-subscription-through-a-proxy)                |
| `refusing to update the Surge profile`          | No subscription yielded a usable node (expired or empty); the profile was not changed                             |

If something goes wrong, `surge-vless-bridge restore` brings back the latest backup.

## Safety

- If any step fails, neither the Surge profile nor existing files are changed.
- The Surge profile is backed up before every change, and `restore` brings it back.
- Generated files are readable by you only, so other users on the Mac cannot see your subscription URLs
  or node details.

All nodes share one sing-box process; its log is `~/.config/surge-vless-bridge/nodes/run/sing-box.log`.

---

## Development

See [AGENTS.md](./AGENTS.md) for the architecture and conventions.

```bash
git clone https://github.com/chen86860/surge-vless-bridge.git
cd surge-vless-bridge
npm install
npm run build
npm test
```

Inside the repo, a `.surge-vless-bridge.json` at the repo root takes precedence over the global config.
Create it with `npm run init -- --config .surge-vless-bridge.json` (it is git-ignored); `npm run sync`,
`npm run doctor` and the rest run the source through `tsx`.
