# surge-vless-bridge

[![npm version](https://img.shields.io/npm/v/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)
[![npm downloads](https://img.shields.io/npm/dm/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)

[中文文档](./README.md) · [Changelog](./CHANGELOG.md)

**Use VLESS subscriptions in Surge Mac.**

Surge Mac does not support the VLESS protocol, REALITY and XTLS Vision nodes included. This command-line
tool turns your VLESS subscription into nodes Surge can use, while a local
[sing-box](https://github.com/SagerNet/sing-box) handles the actual connections. You keep using Surge's
rules, policy groups and dashboard as usual, and sync again whenever the subscription changes.

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

No need to install this tool first. Paste this into Claude Code, Cursor, Codex or a similar agent that
can use your terminal; it checks for and installs sing-box and this tool, then configures, syncs and
verifies everything:

```text
Read https://github.com/chen86860/surge-vless-bridge/blob/master/docs/agent-setup.md
and set up surge-vless-bridge on this Mac for me.
```

[docs/agent-setup.md](./docs/agent-setup.md) is the agent's runbook: which commands to run in what
order, how to read the checks, and what needs your go-ahead first. It asks you only two things — your
subscription URL and which Surge profile to write to — and uses defaults for everything else. Before
changing your Surge profile it shows you a preview, and it finishes with the node count, the backup
location and the check results.

> Treat the subscription URL like a password: giving it to the agent on your machine is fine, but never
> post it in a public issue, chat or screenshot. The runbook also tells the agent never to echo it back.

Prefer to do it yourself? Read on.

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

`init` asks for your subscription URL, lets you pick the Surge profile to write to with ↑/↓, then
creates `~/.config/surge-vless-bridge/config.json` and prints its path. To answer later instead, press
Enter at the URL or Esc at the profile and fill them in by hand; `--no-input` skips the questions and
writes just the template.

**2. Fill in the config** (only if you skipped a question):

```bash
# open the file printed by init, e.g.
open ~/.config/surge-vless-bridge/config.json
```

Fill in at minimum:

```json
{
  "subscriptionUrls": ["https://your-provider.com/subscription"],
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/MyProfile.conf"
}
```

- **`subscriptionUrls`**: Your VLESS subscription URLs. Use one or more URLs; nodes from all
  subscriptions are merged into the same Surge policy group.

- **`surgeConfigPath`**: Full path to your Surge profile (a `.conf` file). To find it:
  1. Click the Surge icon in the **macOS menu bar**
  2. Go to **Switch Profile**, then click **Show in Finder** on your active profile
  3. Press `⌘ + i` on the file in Finder and copy the full path including the filename

  > Or list all profiles quickly in Terminal:
  >
  > ```bash
  > ls ~/Library/Application\ Support/Surge/Profiles/
  > ```

**3. Preview, then sync:**

```bash
surge-vless-bridge sync --dry-run   # shows the nodes and changes, writes nothing
surge-vless-bridge sync
```

`sync` fetches the subscription, generates and validates the nodes, backs up your Surge profile, writes
the changes and reloads Surge.

**4. Check that everything is in order:**

```bash
surge-vless-bridge doctor
```

**5. Route traffic through the nodes:**

`sync` writes the nodes and the `VLESS` policy group but **never touches your rules**. For traffic to
use the nodes, reference `VLESS` from your profile — most often by adding it to the group you switch
between day to day:

```ini
[Proxy Group]
Proxy = select, VLESS, DIRECT

[Rule]
DOMAIN-SUFFIX,example.com,VLESS
FINAL,Proxy
```

`VLESS` can be referenced from anywhere in `[Proxy Group]`; order does not matter. Do not edit the
`VLESS = …` line or anything between `# vless start` and `# vless end` — the next `sync` overwrites
them. Changes anywhere else are kept.

### Upgrading

```bash
npm i -g surge-vless-bridge@latest
surge-vless-bridge sync
```

Run `sync` once after upgrading so the generated files match the new release. Coming from 1.5.x or
earlier this is required: those releases wrote one sing-box config per node, `sync` migrates them to
the shared `sing-box.json`, and `rebuild` refuses to run until it has.

## Config File

This tool's own config, created by `init`. Default path: `~/.config/surge-vless-bridge/config.json`.

Inside a git repository, `<repo root>/.surge-vless-bridge.json` is used only if it **already exists**;
otherwise the global config above is, so `sync` works from any project directory. `--config <path>`
points at any other file.

```json
{
  "subscriptionUrls": ["https://example.com/subscription-a", "https://example.com/subscription-b"],
  "vlessNodes": [
    "vless://uuid@example.com:443?type=tcp&security=reality&pbk=public-key&sid=short-id&fp=chrome&sni=example.com&flow=xtls-rprx-vision#Example"
  ],
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/Config.conf",
  "policyGroupName": "VLESS",
  "portStart": 2081,
  "addressResolver": {
    "strategy": "doh",
    "filterSurgeFakeIp": true,
    "dohEndpoint": "https://1.1.1.1/dns-query",
    "dnsServers": ["1.1.1.1", "8.8.8.8"]
  }
}
```

### Required

| Field             | Description                         |
| ----------------- | ----------------------------------- |
| `surgeConfigPath` | Absolute path to your Surge profile |

Plus **at least one** node source:

| Field              | Description                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| `subscriptionUrls` | One or more VLESS subscription URLs, optionally as objects with options below |
| `vlessNodes`       | One or more raw `vless://` node URLs, for when you have no subscription       |

`subscriptionUrl` (a single URL) is still supported. When both it and `subscriptionUrls` are set, they
are merged and deduplicated, with `subscriptionUrl` fetched first — so adding a second provider never
drops the original one.

By default nodes from every source share one policy group. Duplicate names get a numeric suffix
(`HK 01 2`), and a subscription that returns no VLESS nodes is reported as a warning rather than
failing the sync.

### Optional

| Field               | Default                                | Description                                          |
| ------------------- | -------------------------------------- | ---------------------------------------------------- |
| `policyGroupName`   | `"VLESS"`                              | Surge policy group name to populate                  |
| `portStart`         | `2081`                                 | First local port; node N uses `portStart + N - 1`    |
| `singBoxBinary`     | auto-detected via `which sing-box`     | Path to the `sing-box` binary                        |
| `outputDir`         | `~/.config/surge-vless-bridge/nodes`   | Where the sing-box config and launcher script live   |
| `backupDir`         | `~/.config/surge-vless-bridge/backups` | Where Surge profile backups are stored               |
| `backupKeep`        | `20`                                   | How many backups to keep; older ones are pruned      |
| `autoReload`        | `true`                                 | Ask Surge to reload the profile after it changes     |
| `subscriptionProxy` | none                                   | Proxy a failed subscription fetch is retried through |
| `addressResolver`   | see below                              | How to resolve proxy server domains for `addresses=` |

### Per-subscription prefixes and policy groups

Each `subscriptionUrls` entry is either a URL string or an object with options; the two forms mix:

```json
{
  "subscriptionUrls": [
    "https://example.com/subscription-a",
    { "url": "https://example.com/subscription-b", "prefix": "B | " },
    { "url": "https://example.com/subscription-c", "prefix": "C | ", "group": "Provider C" }
  ]
}
```

| Option   | Description                                                                                |
| -------- | ------------------------------------------------------------------------------------------ |
| `url`    | The subscription URL. Required                                                             |
| `prefix` | Prepended verbatim to every node name from it (`B \| HK 01`); tells same-named nodes apart |
| `group`  | Puts its nodes in their own url-test policy group instead of `policyGroupName`             |

The example above produces two groups:

```ini
VLESS = url-test, HK 01, …, B | HK 01, …, no-alert=0, hidden=0
Provider C = url-test, C | HK 01, …, no-alert=0, hidden=0
```

- Subscriptions without a `group`, and `vlessNodes`, go to `policyGroupName`.
- When every subscription has a `group`, `policyGroupName` is still written, as
  `VLESS = select, <each group>`, so rules that reference `VLESS` keep working — Surge refuses to load
  a profile whose rules name a missing policy.
- Removing a `group` from the config removes that policy group on the next `sync`; `clean` removes
  every group this tool wrote.
- Do not reuse the name of one of your own groups: it would be overwritten. Neither `prefix` nor
  `group` may contain commas, `=` or line breaks, and a mistyped field (say `grop`) is an error rather
  than being silently ignored.

### Traffic and expiry entries

Many providers list notices such as traffic left, expiry date or reset countdown as fake nodes. Entries
whose name contains `Remain`, `Expired`, `Reset`, `官网`, `如需`, `套餐`, `去除`, `剩余`, `距离`, `重置` or `流量`
are not turned into nodes and take no local port; `sync` lists the names it skipped.

> A real node whose name happens to contain one of these words is skipped too — check the list `sync`
> prints.

### Fetching a subscription through a proxy

Some subscription URLs are only reachable through a proxy, or reject Node.js's TLS fingerprint. With
`subscriptionProxy` set, a failed direct fetch is retried once with `curl` through that proxy:

```json
{
  "subscriptionProxy": "http://127.0.0.1:6152"
}
```

`6152` is Surge's default HTTP proxy port; check it under Surge's proxy settings. The proxy URL may
carry credentials (`http://user:pass@host:port`); output only ever shows `http://host:port`. A
successful direct fetch never touches the proxy, and when both attempts fail the error lists both
reasons. Requires `curl`, which macOS ships with.

### Resolving node addresses (`addressResolver`)

`sync` writes each node server's IP into Surge's `addresses=`. `addressResolver.strategy` can be:

| Strategy | Description                                                                  |
| -------- | ---------------------------------------------------------------------------- |
| `doh`    | Resolve with `addressResolver.dohEndpoint`. This is the default.             |
| `dns`    | Resolve with `addressResolver.dnsServers`, such as `["1.1.1.1", "8.8.8.8"]`. |
| `system` | Use Node.js system DNS resolution.                                           |
| `off`    | Do not write `addresses=` in generated Surge external proxy entries.         |

Every strategy except `off` falls back to the other resolvers when it returns nothing usable, so a
failing DoH endpoint or a fake-ip system resolver still produces a real address.

Surge accepts a single value in `addresses=`. When a server resolves to several addresses, IPv4 is
preferred; IPv6 is written only when no A record exists.

`addressResolver.filterSurgeFakeIp` defaults to `true`. It filters `198.18.0.0/15` addresses before
writing `addresses=`, avoiding Surge fake-ip results being pinned into external proxy entries.

**Why the default is `doh`**: with Surge's enhanced mode enabled, system DNS answers with fake IPs in
`198.18.0.0/15`. Resolving proxy server domains through the system resolver would pin those fake IPs
into `addresses=`, so nodes fail to connect. `doh` bypasses the system resolver entirely, which means
`sync` works without turning enhanced mode off. Set `"strategy": "system"` only if your network blocks
DoH endpoints.

## Commands

| Command                             | Description                                                          |
| ----------------------------------- | -------------------------------------------------------------------- |
| `surge-vless-bridge init`           | Create a config, asking for the subscription and Surge profile       |
| `surge-vless-bridge sync`           | Fetch subscription → generate shared sing-box config → update Surge  |
| `surge-vless-bridge rebuild`        | Rebuild the Surge block from existing local configs (no network)     |
| `surge-vless-bridge restore [path]` | Restore the latest Surge profile backup, or the given backup file    |
| `surge-vless-bridge clean`          | Stop sing-box, remove generated files and the managed block (asks)   |
| `surge-vless-bridge doctor`         | Validate config, paths, ports and Surge sections; exits 1 on failure |

Common flags:

| Flag              | Effect                                                  |
| ----------------- | ------------------------------------------------------- |
| `--dry-run`       | `sync`: preview nodes, ports and changes; write nothing |
| `--no-reload`     | `sync` / `rebuild` / `restore`: do not reload Surge     |
| `--no-input`      | `init`: ask nothing, just write the template            |
| `--force`         | `init`: overwrite an existing config                    |
| `--yes`           | `clean`: skip the confirmation prompt                   |
| `--config <path>` | Use the given config file                               |

Most config fields can also be overridden for one run:

```bash
surge-vless-bridge sync --subscription-url https://example.com/sub --group-name VLESS
```

See `surge-vless-bridge help` for the full list. Mistyped flags are rejected, not ignored.

### Automatic reload

Surge does not notice when its profile changes, so a sync only takes effect after a reload. The CLI
does this for you:

1. If `[General]` in your Surge profile enables the HTTP API (`http-api = your-key@127.0.0.1:6171`),
   it reloads through that;
2. otherwise it runs `surge-cli reload`, looked up on `PATH` and then inside the Surge app bundle
   (`/Applications/Surge.app/Contents/Applications/surge-cli`) — so **a default Surge install needs no
   setup**.

The `auto-reload` line of `doctor` reports which one is in use. Pass `--no-reload`, or set
`"autoReload": false`, to opt out.

### Uninstalling

```bash
surge-vless-bridge clean          # stops sing-box, removes generated files and the managed block and groups
npm uninstall -g surge-vless-bridge
```

`clean` backs the Surge profile up first and leaves the rest of it untouched. This tool's config and backups
stay in `~/.config/surge-vless-bridge/`; delete that directory by hand once you no longer need them.

## Troubleshooting

Start with `surge-vless-bridge doctor`: every line begins with `OK`, `WARN` or `FAIL` and suggests a
fix.

| Symptom                                         | What to check                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Surge shows `External Proxy Process Terminated` | Read `~/.config/surge-vless-bridge/nodes/run/sing-box.log` for sing-box's error. If sing-box is outdated, `brew upgrade sing-box`, then `sync` |
| No nodes in Surge after `sync`                  | Did `sync` print `Surge profile reloaded`? If not, reload the profile from the Surge menu                                                     |
| Nodes are there but traffic avoids them         | Make sure a rule or your everyday group references `VLESS` — see [Quick Start step 5](#quick-start)                                            |
| Every latency test times out                    | Check that the subscription itself works; if `doctor`'s `ports` line says another program holds a port, change `portStart` and `sync`         |
| `Failed to fetch subscription …: 403`           | The provider rejected the request. If the URL opens in a browser, try [`subscriptionProxy`](#fetching-a-subscription-through-a-proxy)         |
| `refusing to update the Surge profile`          | No source yielded a usable node (expired, empty, or only info entries); the profile was not changed                                            |

If something goes wrong, `surge-vless-bridge restore` brings back the latest backup.

## How it works: one sing-box for every node

Surge starts one process per `external` node, and a url-test group starts every node in the group as
soon as it tests them, then keeps them running. Running sing-box directly per node would mean one
sing-box process for every node.

Instead the CLI writes a **single** `sing-box.json`: each node gets its own local SOCKS inbound port and
a route rule pinning it to its outbound. Every Surge node runs a tiny `launcher.sh` script:

- the first launcher starts sing-box, later ones reuse it, and the last one to exit stops it;
- every 5 seconds each launcher restarts sing-box if it died or `sing-box.json` changed, so a new config
  takes effect even without a Surge reload;
- `sing-box check` runs before every start; its output goes to `nodes/run/sing-box.log`;
- launchers exit on their own once Surge is gone or `clean` has run.

Because all nodes share one process, `sync` validates the whole config with `sing-box check` before
touching Surge — one broken node cannot take the rest down.

## How sync protects your profile

- Configs are generated and validated in a staging directory first; if anything fails, neither the Surge
  profile nor the result of the previous sync is touched.
- The Surge profile is backed up to `backupDir` before every write, and `restore` brings the latest
  backup back.
- `rebuild` recreates exactly the nodes and ports recorded in `sing-box.json`, so it never resurrects
  nodes that have been removed from the subscription.
- `sync` refuses to update the profile when no configured source yields a VLESS node, so one expired
  subscription cannot empty your policy group.
- Generated configs are checked with `sing-box check`, which validates the config against _your_
  installed sing-box: it catches unknown or unsupported options and invalid keys, but it does not test
  whether a node actually connects.
- Every file is written to a temporary file and renamed into place, so an interrupted write never
  leaves a truncated Surge profile. A symlinked profile (in iCloud, say) is updated through the link.
- Files this tool creates — config, node files, backups — are mode `600` in `700` directories, so other
  users on the Mac cannot read subscription URLs or node UUIDs. The Surge profile keeps its own mode.
  `doctor` warns when an older config file is still readable by others.

---

## Development

For contributors working on the source code; see [AGENTS.md](./AGENTS.md) for the architecture and
conventions.

```bash
git clone https://github.com/chen86860/surge-vless-bridge.git
cd surge-vless-bridge
npm install
```

A `.surge-vless-bridge.json` at the repo root takes precedence over the global config. Create one with
`npm run init -- --config .surge-vless-bridge.json`; it is already in `.gitignore`.

Run commands directly via `tsx` without building:

```bash
npm run sync         # tsx src/cli.ts sync
npm run doctor       # tsx src/cli.ts doctor
```

Build compiled output to `dist/`, and run the tests:

```bash
npm run build
npm test
```
