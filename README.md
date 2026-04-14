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

Then run:

```bash
surge-vless-bridge init
surge-vless-bridge sync
```

## Development

```bash
npm install
```

## Quick Start

**1. Create a config file:**

```bash
npm run init
```

This writes `.surge-vless-bridge.json` in the current directory.

**2. Edit `.surge-vless-bridge.json`:**

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

**3. Sync:**

```bash
npm run sync
```

`sync` fetches the subscription, generates sing-box configs, backs up your Surge profile, and updates it.

## Config File

`.surge-vless-bridge.json` — created by `init`, edit before the first `sync`.

```json
{
  "subscriptionUrl": "https://example.com/subscription",
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/Config.conf",
  "policyGroupName": "VLESS",
  "portStart": 2081
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
| `outputDir`       | `~/.config/surge-vless-bridge/config`  | Where per-node sing-box configs are written            |
| `backupDir`       | `~/.config/surge-vless-bridge/backups` | Where Surge profile backups are stored                 |

You can also override fields at runtime:

```bash
npm run sync -- --subscription-url https://example.com/sub --group-name VLESS
```

## Commands

| Command           | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `npm run init`    | Create a config template with detected defaults               |
| `npm run sync`    | Fetch subscription → generate sing-box configs → update Surge |
| `npm run rebuild` | Rebuild Surge block from existing local configs (no network)  |
| `npm run restore` | Restore the latest Surge profile backup                       |
| `npm run doctor`  | Validate config, paths, and required Surge markers            |
