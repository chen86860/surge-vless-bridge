# surge-vless-bridge

[![npm version](https://img.shields.io/npm/v/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)
[![npm downloads](https://img.shields.io/npm/dm/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)

[中文文档](./README.md) · [Changelog](./CHANGELOG.md)

**Surge Mac VLESS support, via sing-box.** A Node.js CLI that converts a VLESS subscription — including REALITY and XTLS Vision nodes — into Surge Mac `external` proxy entries backed by a single local `sing-box` process.

Surge Mac does not natively support the VLESS protocol. This tool bridges the gap: it fetches your subscription, generates one `sing-box` config shared by every node, and keeps your Surge profile updated — so VLESS nodes work seamlessly through Surge's rules, policy groups, and dashboard.

## Prerequisites

- [sing-box](https://github.com/SagerNet/sing-box) installed (`brew install sing-box`)
- Surge Mac with a profile containing `[Proxy]` and `[Proxy Group]` sections

## Setting this up with an AI agent

Nothing to install first. Paste this into Claude Code, Cursor, Codex or a similar agent and it handles
the whole setup — checking for and installing `sing-box` and the CLI, creating the config, syncing, and
verifying:

```text
Read https://github.com/chen86860/surge-vless-bridge/blob/master/docs/agent-setup.md
and set up surge-vless-bridge on this Mac for me.
```

[docs/agent-setup.md](./docs/agent-setup.md) tells the agent the command order, the config path rules,
how to read `doctor`, and which commands must not run without your confirmation. It will ask you for
your subscription URL and confirm your Surge profile path; everything else has a sensible default. It
previews with `sync --dry-run` before writing anything, and ends with a short report: node count, backup
path and verification results.

> Treat the subscription URL like a password: hand it to the agent on your machine, never to a public
> issue, chat or screenshot. The guide tells the agent never to echo it back.

Prefer to do it yourself? Follow the manual setup below.

## Manual setup

### Install

```bash
npm i -g surge-vless-bridge
```

### Quick Start

**1. Create a config file:**

```bash
surge-vless-bridge init
```

`init` asks for your subscription URL, then lets you pick a Surge profile with ↑/↓, and writes
`~/.config/surge-vless-bridge/config.json` — printing the exact path. Press Enter to skip the URL or
Esc to skip the profile and fill either in by hand later. Pass `--no-input` to skip both and just
write the template.

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

**3. Run a sync:**

```bash
surge-vless-bridge sync
```

`sync` fetches the subscription, generates and validates the sing-box config, backs up your Surge profile, updates it, and asks Surge to reload.

**4. Verify everything is correct:**

```bash
surge-vless-bridge doctor
```

## How it works: one sing-box for every node

Surge starts one process per `external` node, and a url-test group starts every node in the group as
soon as it tests them, then keeps them running. Running sing-box directly per node would mean 20
processes for 20 nodes — about 880 MB measured.

Instead the CLI writes a **single** `sing-box.json`: each node gets its own local SOCKS inbound port and
a route rule pinning it to its outbound. Every Surge node runs a tiny `launcher.sh` (~2.5 MB):

- the first launcher starts sing-box, later ones reuse it, and the last one to exit stops it;
- every 5 seconds each launcher restarts sing-box if it died or `sing-box.json` changed, so a new config
  takes effect even without a Surge reload;
- `sing-box check` runs before every start; its output goes to `nodes/run/sing-box.log`;
- launchers exit on their own once Surge is gone or `clean` has run.

Measured in Surge, 5 nodes drop from ~220 MB to ~58 MB; extrapolating from the measured parts, 20 nodes
drop from ~880 MB to ~90 MB. The trade-off is that all nodes share one process, so `sync` validates the
whole config with `sing-box check` before touching Surge — one broken node cannot take the rest down.

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

| Field              | Description                          |
| ------------------ | ------------------------------------ |
| `subscriptionUrls` | One or more VLESS subscription URLs  |
| `vlessNodes`       | One or more raw `vless://` node URLs |
| `surgeConfigPath`  | Absolute path to your Surge profile  |

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
| `outputDir`       | `~/.config/surge-vless-bridge/nodes`   | Where the shared sing-box config and launcher live     |
| `backupDir`       | `~/.config/surge-vless-bridge/backups` | Where Surge profile backups are stored                 |
| `backupKeep`      | `20`                                   | How many backups to keep; older ones are pruned        |
| `autoReload`      | `true`                                 | Ask Surge to reload the profile after it changes       |
| `addressResolver` | see below                              | How to resolve proxy server domains for `addresses=`   |

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

## Commands

| Command                      | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `surge-vless-bridge init`    | Create a config, asking for the subscription and Surge profile |
| `surge-vless-bridge sync`    | Fetch subscription → generate shared sing-box config → update Surge |
| `surge-vless-bridge rebuild` | Rebuild Surge block from existing local configs (no network)  |
| `surge-vless-bridge restore` | Restore the latest Surge profile backup                       |
| `surge-vless-bridge clean`   | Stop sing-box, remove generated files and the managed block   |
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

Otherwise it falls back to `surge-cli reload`, looked up on `PATH` and then inside the Surge app bundle
(`/Applications/Surge.app/Contents/Applications/surge-cli`), so a default Surge install reloads
automatically with no extra setup. Pass `--no-reload`, or set `"autoReload": false`, to opt out. The
`auto-reload` line of `doctor` reports which of these is in use.

### Removing everything

`clean` stops the shared sing-box, deletes the generated config and launcher, and removes the managed
block and policy group from the Surge profile, leaving the rest of the profile untouched. The profile is
backed up first.

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

Build compiled output to `dist/`, and run the tests:

```bash
npm run build
npm test
```
