# surge-vless-bridge

[![npm version](https://img.shields.io/npm/v/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)
[![npm downloads](https://img.shields.io/npm/dm/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)

[English](./README.en.md) · [更新日志](./CHANGELOG.zh-CN.md)

**让 Surge Mac 支持 VLESS，底层由 sing-box 承接。** 基于 Node.js 的 CLI，把 VLESS 订阅（含 REALITY、XTLS Vision 节点）转换为 Surge Mac 可用的 `external` 外部代理节点。

Surge Mac 不原生支持 VLESS 协议。该工具自动拉取订阅、生成一份所有节点共用的 `sing-box` 配置、并保持 Surge 配置同步更新，让你继续使用 Surge 的规则、策略组和面板来使用 VLESS 节点。

## 前置条件

- 已安装 [sing-box](https://github.com/SagerNet/sing-box)（`brew install sing-box`）
- Surge Mac 配置文件中包含 `[Proxy]` 和 `[Proxy Group]` 区块

## 让 AI Agent 帮你完成配置

不需要先装任何东西。把下面这段话发给 Claude Code、Cursor、Codex 之类能操作本机终端的 agent，检测并安装
`sing-box` 和 CLI、生成配置、同步、验证，整套流程它都能完成：

```text
阅读 https://github.com/chen86860/surge-vless-bridge/blob/master/docs/agent-setup.md
然后帮我在这台 Mac 上配置好 surge-vless-bridge
```

[docs/agent-setup.md](./docs/agent-setup.md) 里写清了命令顺序、配置文件的位置、`doctor` 输出怎么读，
以及哪些命令必须先经过你确认。Agent 会向你索要订阅地址并确认 Surge 配置文件路径，其余项都有默认值；在真正
写入之前，它会先用 `sync --dry-run` 给你看一遍改动，结束时只汇报节点数量、备份位置和验证结果。

> 订阅地址相当于密码。直接在对话里发给本机 agent 即可，不要贴到公开 Issue、群聊或截图里；文档也要求 agent
> 不在任何输出中回显它。

想自己动手？往下看手动配置。

## 手动配置

### 安装

```bash
npm i -g surge-vless-bridge
```

### 快速开始

**1. 生成配置文件：**

```bash
surge-vless-bridge init
```

`init` 会先询问订阅地址，再用 ↑/↓ 选择 Surge 配置文件，然后写入
`~/.config/surge-vless-bridge/config.json` 并打印具体路径。订阅地址直接回车、配置文件按 Esc 即可跳过，
之后手动填写；加 `--no-input` 则跳过全部提问，只写模板。

**2. 编辑配置文件**（仅在跳过了提问时需要）：

```bash
# 用 init 打印的路径打开文件，例如：
open ~/.config/surge-vless-bridge/config.json
```

至少填写以下两个字段：

```json
{
  "subscriptionUrls": ["https://your-provider.com/subscription"],
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/MyProfile.conf"
}
```

- **`subscriptionUrls`**：填入一个或多个 VLESS 订阅地址，所有订阅里的节点会合并到同一个 Surge 策略组。

- **`surgeConfigPath`**：Surge 配置文件的绝对路径。获取方式：
  1. 点击 macOS **菜单栏**中的 Surge 图标
  2. 选择 **切换配置**，在当前使用的配置文件上点击 **在访达中显示**
  3. 在 Finder 中对该文件按 `⌘ + i`，复制"位置"下的完整路径，拼上文件名填入

  > 也可以通过终端快速查看所有配置文件：
  >
  > ```bash
  > ls ~/Library/Application\ Support/Surge/Profiles/
  > ```

**3. 执行同步：**

```bash
surge-vless-bridge sync
```

`sync` 会依次完成：拉取订阅 → 生成并校验 sing-box 配置 → 备份 Surge 配置 → 更新 Surge 配置 → 让 Surge 重载。

**4. 验证配置是否正常：**

```bash
surge-vless-bridge doctor
```

## 工作原理：所有节点共用一个 sing-box

Surge 的每个 `external` 节点都会启动一个进程，而 url-test 策略组一测速就会把组里所有节点同时拉起来并一直
常驻。如果每个节点直接运行一个 sing-box，20 个节点就是 20 个进程，实测约 880 MB 内存。

因此本工具只生成**一份** `sing-box.json`：每个节点在其中占一个本地 SOCKS 入站端口，并通过路由规则绑定到
自己的出站。Surge 里的每个节点启动的是一个很小的 `launcher.sh`（约 2.5 MB）：

- 第一个启动的 launcher 拉起 sing-box，之后的直接复用，最后一个退出时关闭 sing-box；
- launcher 每 5 秒检查一次：sing-box 意外退出、或 `sing-box.json` 内容变了，就重新启动它，所以即使没有
  重载 Surge，新配置也会生效；
- 每次启动 sing-box 前都会先跑 `sing-box check`，输出写在 `nodes/run/sing-box.log`；
- Surge 退出或执行了 `clean` 之后，残留的 launcher 会自行退出。

在 Surge 中实测，5 个节点从约 220 MB 降到约 58 MB；按单项实测值推算，20 个节点约从 880 MB 降到 90 MB。代价是所有节点在同一个进程里：
`sync` 会在写入 Surge 之前先用 `sing-box check` 校验整份配置，避免一个坏节点拖垮全部节点。

## 同步过程如何保护你的配置

- 配置先在临时目录里生成并校验，任一环节失败都不会动到 Surge 配置，也不会破坏上一次同步的结果。
- 每次写入 Surge 配置前都会备份到 `backupDir`，`restore` 可以恢复最近一次备份。
- `rebuild` 只按 `sing-box.json` 里记录的节点和端口重建，不会复活已从订阅里删除的节点。
- 所有来源都没有解析出 VLESS 节点时，`sync` 拒绝改写配置，避免某个机场过期导致策略组被清空。
- 生成的配置会经过 `sing-box check`，用的是**你本机安装的** sing-box：能查出不支持的选项和非法密钥，但
  **不能验证节点是否真的连得通**。

## 配置文件

由 `init` 创建，默认路径：`~/.config/surge-vless-bridge/config.json`。

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

**必填**

| 字段               | 说明                               |
| ------------------ | ---------------------------------- |
| `subscriptionUrls` | 一个或多个 VLESS 订阅地址          |
| `vlessNodes`       | 一个或多个原始 `vless://` 节点地址 |
| `surgeConfigPath`  | Surge 配置文件的绝对路径           |

`subscriptionUrl` 仍然兼容。当 `subscriptionUrl` 与 `subscriptionUrls` 同时存在时，两者会合并去重，且
`subscriptionUrl` 排在最前 —— 新增第二个机场不会导致原订阅丢失。`subscriptionUrl`、`subscriptionUrls`、
`vlessNodes` 至少需要配置其中一种节点来源。

所有来源的节点会合并进同一个策略组。重名节点自动追加序号（`HK 01 2`）；某个订阅没有解析出 VLESS 节点时
只告警，不会中断整次同步。

**选填**

| 字段              | 默认值                                 | 说明                                 |
| ----------------- | -------------------------------------- | ------------------------------------ |
| `policyGroupName` | `"VLESS"`                              | 要写入的 Surge 策略组名称            |
| `portStart`       | `2081`                                 | 起始本地端口，每个节点依次递增       |
| `singBoxBinary`   | 自动检测（`which sing-box`）           | `sing-box` 可执行文件路径            |
| `outputDir`       | `~/.config/surge-vless-bridge/nodes`   | 共享 sing-box 配置与 launcher 的目录 |
| `backupDir`       | `~/.config/surge-vless-bridge/backups` | Surge 配置备份目录                   |
| `backupKeep`      | `20`                                   | 保留的备份数量，超出的旧备份自动清理 |
| `autoReload`      | `true`                                 | 配置变更后自动让 Surge 重载          |
| `addressResolver` | 见下方                                 | 为 `addresses=` 解析代理服务器域名   |

`addressResolver.strategy` 可选：

| 策略     | 说明                                                                    |
| -------- | ----------------------------------------------------------------------- |
| `doh`    | 使用 `addressResolver.dohEndpoint` 解析，这是默认值。                   |
| `dns`    | 使用 `addressResolver.dnsServers` 解析，例如 `["1.1.1.1", "8.8.8.8"]`。 |
| `system` | 使用 Node.js 系统 DNS 解析。                                            |
| `off`    | 不在生成的 Surge external proxy 条目中写入 `addresses=`。               |

除 `off` 外，任何策略解析不到可用地址时都会自动回退到其余解析方式，因此 DoH 端点不可用或系统解析被
fake-ip 污染时，仍然可以拿到真实 IP。

Surge 的 `addresses=` 只接受单个地址。当一个域名解析出多个结果时优先写入 IPv4，只有在没有 A 记录时
才会写 IPv6。

`addressResolver.filterSurgeFakeIp` 默认为 `true`。它会在写入 `addresses=` 前过滤 `198.18.0.0/15` 地址，避免把 Surge fake-ip 结果固定到 external proxy 条目里。

### 为什么默认使用 `doh`

开启 Surge 增强模式后，系统 DNS 会返回 `198.18.0.0/15` 段的 fake IP。此时用系统解析代理服务器域名，会把
fake IP 固定写进 `addresses=`，导致节点连不通。`doh` 完全绕开系统解析，因此**不需要关闭增强模式**也能正常
`sync`。只有当你的网络屏蔽了 DoH 端点时，才需要改成 `"strategy": "system"`。

也可以通过命令行参数临时覆盖：

```bash
surge-vless-bridge sync --subscription-url https://example.com/sub --group-name VLESS
```

## 命令说明

| 命令                         | 说明                                            |
| ---------------------------- | ----------------------------------------------- |
| `surge-vless-bridge init`    | 生成配置文件，交互询问订阅地址与 Surge 配置路径 |
| `surge-vless-bridge sync`    | 拉取订阅 → 生成共享 sing-box 配置 → 更新 Surge  |
| `surge-vless-bridge rebuild` | 仅基于已有本地配置重建 Surge 区块（不访问网络） |
| `surge-vless-bridge restore` | 恢复最近一次 Surge 配置备份                     |
| `surge-vless-bridge clean`   | 停止 sing-box，移除生成的文件与 Surge 托管区块  |
| `surge-vless-bridge doctor`  | 检查配置、路径、端口及 Surge 必需区块是否正常   |

### 预览同步结果

`sync --dry-run` 会输出本次同步将生成的节点、端口和配置改动，但不写入任何文件：

```bash
surge-vless-bridge sync --dry-run
```

### 自动重载

Surge 不会监听配置文件变化，同步后需要重载才会生效。如果开启了 HTTP API，本工具会自动触发重载。在 Surge
配置的 `[General]` 中加入：

```ini
http-api = your-key@127.0.0.1:6171
```

未开启时会用 `surge-cli reload` 兜底：先找 `PATH`，再找 Surge 安装包内自带的
`/Applications/Surge.app/Contents/Applications/surge-cli`，所以默认安装的 Surge 不用额外配置也能自动重载。
加 `--no-reload` 或设置 `"autoReload": false` 可以关闭该行为，`doctor` 的 `auto-reload` 一行会显示当前使用的
是哪种方式。

### 彻底移除

`clean` 会停止共享的 sing-box、删除生成的配置与 launcher，并从 Surge 配置中移除托管区块和对应策略组，其余内容
保持不变。执行前会先备份。

```bash
surge-vless-bridge clean
```

---

## 本地开发

面向参与贡献的开发者。

```bash
git clone https://github.com/chen86860/surge-vless-bridge.git
cd surge-vless-bridge
npm install
```

配置文件默认写入当前目录的 `.surge-vless-bridge.json`，而非全局路径。

通过 `tsx` 直接运行源码，无需编译：

```bash
npm run sync         # tsx src/cli.ts sync
npm run doctor       # tsx src/cli.ts doctor
```

编译输出到 `dist/`，运行测试：

```bash
npm run build
npm test
```
