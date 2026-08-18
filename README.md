# surge-vless-bridge

[![npm version](https://img.shields.io/npm/v/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)
[![npm downloads](https://img.shields.io/npm/dm/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)

[中文文档](./README.zh-CN.md) · [Changelog](./CHANGELOG.md)

**Surge Mac VLESS support, via sing-box.** A Node.js CLI that converts a VLESS subscription — including REALITY and XTLS Vision nodes — into Surge Mac `external` proxy entries backed by local `sing-box` configs.

Surge Mac does not natively support the VLESS protocol. This tool bridges the gap: it fetches your subscription, generates a `sing-box` config per node, and keeps your Surge profile updated — so VLESS nodes work seamlessly through Surge's rules, policy groups, and dashboard.

## Prerequisites

- macOS with Node.js >= 20
- [sing-box](https://github.com/SagerNet/sing-box) installed (`brew install sing-box`)
- Surge Mac with a profile containing `[Proxy]` and `[Proxy Group]` sections

## Setting this up with an AI agent

Nothing to install first. Paste this into Claude Code, Cursor, Codex or a similar agent and it handles
the whole setup — checking for and installing `sing-box` and the CLI, creating the config, syncing, and
verifying:

```text
Read https://github.com/chen86860/surge-vless-bridge/blob/master/docs/agent-setup.md
and set up surge-vless-bridge for me.
```

[docs/agent-setup.md](./docs/agent-setup.md) tells the agent the command order, the config path rules,
how to read `doctor`, and which commands must not run without your confirmation. It will ask you for
your subscription URL and confirm your Surge profile path; everything else has a sensible default, and
it previews with `sync --dry-run` before writing anything.

Prefer to do it yourself? Follow the manual setup below.

## Manual setup

### Install

```bash
npm i -g surge-vless-bridge
```

### Quick Start

**1. Set everything up:**

```bash
surge-vless-bridge init
```

`init` asks for your subscription URL, then lets you pick a Surge profile with ↑/↓, and writes
`~/.config/surge-vless-bridge/config.json` — printing the exact path. Once both answers are in it
runs the first sync itself, so this one command is usually the whole setup. Press Enter to skip the
URL or Esc to skip the profile and fill either in by hand later; anything skipped means there is
nothing to sync yet, and the steps below pick up from there.

`--no-sync` stops after writing the config. `--no-input` skips both questions and just writes the
template — it never syncs either, so creating a config file in CI or under an agent cannot rewrite
your Surge profile as a side effect.

`init` stops with an error if a config file is already there, before it asks anything. Pass `--force`
to overwrite it.

**2. Edit the config file** (only if you skipped a question):

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

- **`subscriptionUrls`**: Your VLESS subscription URLs. Use one or more URLs; nodes from all subscriptions are merged into the same Surge policy group.

- **`surgeConfigPath`**: Absolute path to your Surge profile. To find it:
  1. Click the Surge icon in the **macOS menu bar**
  2. Go to **Switch Profile**, then click **Show in Finder** on your active profile
  3. Press `⌘ + i` on the file in Finder and copy the full path including the filename

  > Or list all profiles quickly in Terminal:
  >
  > ```bash
  > ls ~/Library/Application\ Support/Surge/Profiles/
  > ```

**3. Run a sync** (only if `init` did not already):

```bash
surge-vless-bridge sync
```

`sync` fetches the subscription, generates sing-box configs, backs up your Surge profile, and updates
it. This is also the command to re-run whenever your subscription changes.

**4. Verify everything is correct:**

```bash
surge-vless-bridge doctor
```

## Config File

Created by `init`. Default path: `~/.config/surge-vless-bridge/config.json`.

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

**Required**

| Field             | Description                         |
| ----------------- | ----------------------------------- |
| `surgeConfigPath` | Absolute path to your Surge profile |

**Node source — at least one**

| Field              | Description                          |
| ------------------ | ------------------------------------ |
| `subscriptionUrls` | One or more VLESS subscription URLs  |
| `vlessNodes`       | One or more raw `vless://` node URLs |

`subscriptionUrl` is still supported for backward compatibility. When both `subscriptionUrl` and
`subscriptionUrls` are set, they are merged and deduplicated, with `subscriptionUrl` fetched first — so
adding a second provider never drops the original one. At least one of `subscriptionUrl`,
`subscriptionUrls`, or `vlessNodes` must be configured.

Nodes from every source share one policy group. Duplicate names get a numeric suffix (`HK 01 2`), and a
subscription that returns no VLESS nodes is reported as a warning rather than failing the sync.

**Optional**

| Field             | Default                                | Description                                            |
| ----------------- | -------------------------------------- | ------------------------------------------------------ |
| `policyGroupName` | `"VLESS"`                              | Surge policy group name to populate                    |
| `portStart`       | `2081`                                 | First local port; nodes take `portStart + N` in order  |
| `singBoxBinary`   | auto-detected via `which sing-box`     | Path to the `sing-box` binary                          |
| `outputDir`       | `~/.config/surge-vless-bridge/nodes`   | Where per-node sing-box configs are written            |
| `backupDir`       | `~/.config/surge-vless-bridge/backups` | Where Surge profile backups are stored                 |
| `backupKeep`      | `20`                                   | How many backups to keep; older ones are pruned        |
| `autoReload`      | `true`                                 | Ask Surge to reload the profile after it changes       |
| `addressResolver` | see below                              | How to resolve proxy server domains for `addresses=`   |

Ports are assigned in order, never reshuffled. Before generating anything, `sync` checks that the
range is free and stops with an error naming the ports if another program holds one, rather than
writing a node that could never start. The nodes from the previous sync are not a conflict: Surge
keeps them listening on the very ports the next sync reuses.

`addressResolver.strategy` can be:

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

`addressResolver.filterSurgeFakeIp` defaults to `true`. It filters `198.18.0.0/15` addresses before writing `addresses=`, avoiding Surge fake-ip results being pinned into external proxy entries.

### Why the default is `doh`

With Surge's enhanced mode enabled, system DNS answers with fake IPs in `198.18.0.0/15`. Resolving proxy
server domains through the system resolver would pin those fake IPs into `addresses=`, so nodes fail to
connect. `doh` bypasses the system resolver entirely, which means `sync` works without turning enhanced
mode off. Set `"strategy": "system"` only if your network blocks DoH endpoints.

You can also override fields at runtime:

```bash
surge-vless-bridge sync --subscription-url https://example.com/sub --group-name VLESS
```

Every config key has a matching flag, and `--config <path>` points at a different config file.
`surge-vless-bridge --help` lists them all.

## Commands

| Command                      | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `surge-vless-bridge init`    | Create a config, asking for the subscription and Surge profile |
| `surge-vless-bridge sync`    | Fetch subscription → generate sing-box configs → update Surge |
| `surge-vless-bridge rebuild` | Rebuild Surge block from existing local configs (no network)  |
| `surge-vless-bridge restore` | Restore the latest profile backup, or the one passed as an argument |
| `surge-vless-bridge clean`   | Remove generated configs and the managed Surge block          |
| `surge-vless-bridge doctor`  | Validate config, paths, ports and required Surge markers      |

### Previewing a sync

`sync --dry-run` reports the nodes, ports and profile changes a real sync would produce, and writes
nothing:

```bash
surge-vless-bridge sync --dry-run
```

### Automatic reload

Surge does not watch its profile, so a synced profile only takes effect after a reload. If the HTTP API
is enabled, the CLI triggers it automatically. Add this to `[General]` in your Surge profile:

```ini
http-api = your-key@127.0.0.1:6171
```

`surge-cli reload` is used as a fallback when it is available. Pass `--no-reload`, or set
`"autoReload": false`, to opt out. `doctor` reports which of these is in use.

### Removing everything

`clean` deletes the generated node configs and removes the managed block and policy group from the
Surge profile, leaving the rest of the profile untouched. The profile is backed up first.

```bash
surge-vless-bridge clean
```

It asks for confirmation before deleting anything. Pass `--yes` to skip the prompt — required when
running it from a script or an agent, which would otherwise hang waiting for an answer.

```bash
surge-vless-bridge clean --yes
```

---

## How sync protects your profile

- Nodes are generated and validated in a staging directory first; if anything fails, neither the Surge
  profile nor the previous node configs are touched.
- The Surge profile is backed up to `backupDir` before every write, and `restore` brings the latest
  backup back.
- Node configs produced by a sync are recorded in `manifest.json`, so `rebuild` never resurrects nodes
  that have been removed from the subscription.
- `sync` refuses to update the profile when no configured source yields a VLESS node, so one expired
  subscription cannot empty your policy group.
- Generated configs are checked with `sing-box check`, which validates the config against _your_
  installed sing-box: it catches unknown or unsupported options and invalid keys, but it does not test
  whether a node actually connects.

## Memory cost: one sing-box process per node

Surge's `external` proxy starts one process per proxy line, so every node in your subscription becomes
its own `sing-box` process. **Budget roughly 35 MB of RSS per node.** Measured on macOS with sing-box
1.13 and 20 nodes:

| Nodes | Processes | Total RSS |
| ----- | --------- | --------- |
| 1     | 1         | ~35 MB    |
| 20    | 20        | ~700 MB   |

Most of those 35 MB is the fixed cost of the Go runtime rather than anything per-connection, so the
figure barely moves whether a node is idle or busy.

The processes are not started on demand. `sync` writes the policy group as `url-test`, which makes
Surge latency-test every member periodically, so all of them are launched and stay resident even when
you only ever route traffic through one. A 60-node subscription therefore costs about 2 GB.

If that matters on your machine:

- Import only the nodes you actually use. Point `subscriptionUrls` at a filtered subscription, or list
  the handful of links you need under `vlessNodes` instead.
- Run `clean` when you are done with a set of nodes; it removes the generated configs and the policy
  group, which stops the processes.

A single sing-box process can serve many nodes at once — several SOCKS inbounds routed to their own
outbounds — which would collapse the whole set into ~35 MB. It is not what this tool generates today,
because `external` is what lets Surge own the process lifecycle. Tracking it as a possible opt-in mode.

## Development

For contributors working on the source code.

```bash
git clone https://github.com/chen86860/surge-vless-bridge.git
cd surge-vless-bridge
npm install
```

Config file defaults to `.surge-vless-bridge.json` in the current directory, not the global path.

Run commands directly via `tsx` without building:

```bash
npm run sync         # tsx src/cli.ts sync
npm run doctor       # tsx src/cli.ts doctor
```

Build compiled output to `dist/`:

```bash
npm run build
```
