# surge-vless-bridge

[![npm version](https://img.shields.io/npm/v/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)
[![npm downloads](https://img.shields.io/npm/dm/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)

[中文文档](./README.zh-CN.md) · [Changelog](./CHANGELOG.md)

**Surge Mac VLESS support, via sing-box.** A Node.js CLI that converts a VLESS subscription — including REALITY and XTLS Vision nodes — into Surge Mac `external` proxy entries backed by local `sing-box` configs.

Surge Mac does not natively support the VLESS protocol. This tool bridges the gap: it fetches your subscription, generates a `sing-box` config per node, and keeps your Surge profile updated — so VLESS nodes work seamlessly through Surge's rules, policy groups, and dashboard.

## Prerequisites

- [sing-box](https://github.com/SagerNet/sing-box) installed (`brew install sing-box`)
- Surge Mac with a profile containing `[Proxy]` and `[Proxy Group]` sections

## Install

```bash
npm i -g surge-vless-bridge
```

## Quick Start

**1. Create a config file:**

```bash
surge-vless-bridge init
```

This writes the config template to `~/.config/surge-vless-bridge/config.json` and prints the exact path.

**2. Edit the config file:**

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

**3. Run a sync:**

```bash
surge-vless-bridge sync
```

`sync` fetches the subscription, generates sing-box configs, backs up your Surge profile, and updates it.

**4. Verify everything is correct:**

```bash
surge-vless-bridge doctor
```

## How sync protects your profile

- Nodes are generated and validated in a staging directory first; if anything fails, neither the Surge
  profile nor the previous node configs are touched.
- The Surge profile is backed up to `backupDir` before every write, and `restore` brings the latest
  backup back.
- Node configs produced by a sync are recorded in `manifest.json`, so `rebuild` never resurrects nodes
  that have been removed from the subscription.
- `sync` refuses to update the profile when no configured source yields a VLESS node, so one expired
  subscription cannot empty your policy group.
- Generated configs are checked with `sing-box check`, which validates the config against *your*
  installed sing-box: it catches unknown or unsupported options and invalid keys, but it does not test
  whether a node actually connects.

## Config File

Created by `init`. Default path: `~/.config/surge-vless-bridge/config.json`.

```json
{
  "subscriptionUrls": [
    "https://example.com/subscription-a",
    "https://example.com/subscription-b"
  ],
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
| `subscriptionUrls` | One or more VLESS subscription URLs |
| `vlessNodes` | One or more raw `vless://` node URLs |
| `surgeConfigPath` | Absolute path to your Surge profile |

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
| `portStart`       | `2081`                                 | Starting local port; each node uses the next available |
| `singBoxBinary`   | auto-detected via `which sing-box`     | Path to the `sing-box` binary                          |
| `outputDir`       | `~/.config/surge-vless-bridge/nodes`   | Where per-node sing-box configs are written            |
| `backupDir`       | `~/.config/surge-vless-bridge/backups` | Where Surge profile backups are stored                 |
| `backupKeep`      | `20`                                   | How many backups to keep; older ones are pruned        |
| `autoReload`      | `true`                                 | Ask Surge to reload the profile after it changes       |
| `addressResolver` | see below                              | How to resolve proxy server domains for `addresses=`   |

`addressResolver.strategy` can be:

| Strategy | Description                                                                          |
| -------- | ------------------------------------------------------------------------------------ |
| `doh`    | Resolve with `addressResolver.dohEndpoint`. This is the default.                     |
| `dns`    | Resolve with `addressResolver.dnsServers`, such as `["1.1.1.1", "8.8.8.8"]`.         |
| `system` | Use Node.js system DNS resolution.                                                   |
| `off`    | Do not write `addresses=` in generated Surge external proxy entries.                 |

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

## Commands

| Command                      | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `surge-vless-bridge init`    | Create a config template with detected defaults               |
| `surge-vless-bridge sync`    | Fetch subscription → generate sing-box configs → update Surge |
| `surge-vless-bridge rebuild` | Rebuild Surge block from existing local configs (no network)  |
| `surge-vless-bridge restore` | Restore the latest Surge profile backup                       |
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

```
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

---

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
