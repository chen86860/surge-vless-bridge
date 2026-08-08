# surge-vless-bridge

[![npm version](https://img.shields.io/npm/v/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)
[![npm downloads](https://img.shields.io/npm/dm/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)

[中文文档](./README.zh-CN.md)

A Node.js CLI that converts a VLESS subscription into Surge Mac `external` proxy entries backed by local `sing-box` configs.

Surge Mac does not natively support VLESS. This tool bridges the gap: it fetches your subscription, generates a `sing-box` config per node, and keeps your Surge profile updated — so VLESS nodes work seamlessly through Surge's rules, policy groups, and dashboard.

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
  "subscriptionUrl": "https://your-provider.com/subscription",
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/MyProfile.conf"
}
```

- **`subscriptionUrl`**: Your VLESS subscription URL.

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

## Safe synchronization

- `sync` refuses to update Surge when the subscription contains no VLESS nodes.
- Every generated node is checked by `sing-box` before the Surge profile is changed.
- Managed node files are tracked explicitly, so removed subscription nodes cannot return during `rebuild`.
- Profiles, backups, node configs, and subscription data are written atomically with owner-only permissions.
- When multiple Surge profiles exist, set `surgeConfigPath` explicitly; the CLI will not guess which profile is active.
- `doctor` redacts the subscription URL and validates all managed sing-box configs.

## Config File

Created by `init`. Default path: `~/.config/surge-vless-bridge/config.json`.

```json
{
  "subscriptionUrl": "https://example.com/subscription",
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/Config.conf",
  "policyGroupName": "VLESS",
  "portStart": 2081,
  "addressResolver": {
    "strategy": "system",
    "filterSurgeFakeIp": true,
    "dohEndpoint": "https://1.1.1.1/dns-query",
    "dnsServers": ["1.1.1.1", "8.8.8.8"]
  }
}
```

**Required**

| Field             | Description                         |
| ----------------- | ----------------------------------- |
| `subscriptionUrl` | Your VLESS subscription URL         |
| `surgeConfigPath` | Absolute path to your Surge profile |

**Optional**

| Field             | Default                                | Description                                            |
| ----------------- | -------------------------------------- | ------------------------------------------------------ |
| `policyGroupName` | `"VLESS"`                              | Surge policy group name to populate                    |
| `portStart`       | `2081`                                 | Starting local port; each node uses the next available |
| `singBoxBinary`   | auto-detected via `which sing-box`     | Path to the `sing-box` binary                          |
| `outputDir`       | `~/.config/surge-vless-bridge/nodes`   | Where per-node sing-box configs are written            |
| `backupDir`       | `~/.config/surge-vless-bridge/backups` | Where Surge profile backups are stored                 |
| `addressResolver` | see below                              | How to resolve proxy server domains for `addresses=`   |

`addressResolver.strategy` can be:

| Strategy | Description                                                                                  |
| -------- | -------------------------------------------------------------------------------------------- |
| `system` | Use Node.js system DNS resolution. This is the default.                                       |
| `dns`    | Resolve with `addressResolver.dnsServers`, such as `["1.1.1.1", "8.8.8.8"]`.                 |
| `doh`    | Resolve with `addressResolver.dohEndpoint`, then fall back to `addressResolver.dnsServers`.   |
| `off`    | Do not write `addresses=` in generated Surge external proxy entries.                          |

`addressResolver.filterSurgeFakeIp` defaults to `true`. It filters `198.18.0.0/15` addresses before writing `addresses=`, avoiding Surge fake-ip results being pinned into external proxy entries. If Surge's fake-ip DNS affects your system resolver, set `"strategy": "doh"` or `"strategy": "dns"`.

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
| `surge-vless-bridge doctor`  | Validate config, paths, and required Surge markers            |

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
