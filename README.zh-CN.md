# surge-vless-bridge

[![npm version](https://img.shields.io/npm/v/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)
[![npm downloads](https://img.shields.io/npm/dm/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)

[English README](./README.md) · [更新日志](./CHANGELOG.zh-CN.md)

**让 Surge Mac 支持 VLESS，底层由 sing-box 承接。** 基于 Node.js 的 CLI，把 VLESS 订阅（含 REALITY、XTLS Vision 节点）转换为 Surge Mac 可用的 `external` 外部代理节点。

Surge Mac 不原生支持 VLESS 协议。该工具自动拉取订阅、为每个节点生成 `sing-box` 配置、并保持 Surge 配置同步更新，让你继续使用 Surge 的规则、策略组和面板来使用 VLESS 节点。

## 前置条件

- 已安装 [sing-box](https://github.com/SagerNet/sing-box)（`brew install sing-box`）
- Surge Mac 配置文件中包含 `[Proxy]` 和 `[Proxy Group]` 区块

## 安装

```bash
npm i -g surge-vless-bridge
```

## 快速开始

**1. 生成配置文件：**

```bash
surge-vless-bridge init
```

配置文件写入 `~/.config/surge-vless-bridge/config.json`，命令执行后会打印具体路径。

**2. 编辑配置文件：**

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

`sync` 会依次完成：拉取订阅 → 生成 sing-box 配置 → 备份 Surge 配置 → 更新 Surge 配置。

**4. 验证配置是否正常：**

```bash
surge-vless-bridge doctor
```

## 同步过程如何保护你的配置

- 节点先在临时目录里生成并校验，任一环节失败都不会动到 Surge 配置，也不会破坏上一次同步的节点配置。
- 每次写入 Surge 配置前都会备份到 `backupDir`，`restore` 可以恢复最近一次备份。
- 每次同步产生的节点配置会记录在 `manifest.json` 中，因此 `rebuild` 不会复活已从订阅里删除的节点。
- 所有来源都没有解析出 VLESS 节点时，`sync` 拒绝改写配置，避免某个机场过期导致策略组被清空。
- 生成的配置会经过 `sing-box check`，用的是**你本机安装的** sing-box：能查出不支持的选项和非法密钥，但
  **不能验证节点是否真的连得通**。

## 配置文件

由 `init` 创建，默认路径：`~/.config/surge-vless-bridge/config.json`。

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

**必填**

| 字段              | 说明                     |
| ----------------- | ------------------------ |
| `subscriptionUrls` | 一个或多个 VLESS 订阅地址 |
| `vlessNodes` | 一个或多个原始 `vless://` 节点地址 |
| `surgeConfigPath` | Surge 配置文件的绝对路径 |

`subscriptionUrl` 仍然兼容。当 `subscriptionUrl` 与 `subscriptionUrls` 同时存在时，两者会合并去重，且
`subscriptionUrl` 排在最前 —— 新增第二个机场不会导致原订阅丢失。`subscriptionUrl`、`subscriptionUrls`、
`vlessNodes` 至少需要配置其中一种节点来源。

所有来源的节点会合并进同一个策略组。重名节点自动追加序号（`HK 01 2`）；某个订阅没有解析出 VLESS 节点时
只告警，不会中断整次同步。

**选填**

| 字段              | 默认值                                 | 说明                               |
| ----------------- | -------------------------------------- | ---------------------------------- |
| `policyGroupName` | `"VLESS"`                              | 要写入的 Surge 策略组名称          |
| `portStart`       | `2081`                                 | 起始本地端口，每个节点依次递增     |
| `singBoxBinary`   | 自动检测（`which sing-box`）           | `sing-box` 可执行文件路径          |
| `outputDir`       | `~/.config/surge-vless-bridge/nodes`   | 每个节点的 sing-box 配置保存目录   |
| `backupDir`       | `~/.config/surge-vless-bridge/backups` | Surge 配置备份目录                 |
| `addressResolver` | 见下方                                 | 为 `addresses=` 解析代理服务器域名 |

`addressResolver.strategy` 可选：

| 策略     | 说明                                                          |
| -------- | ------------------------------------------------------------- |
| `doh`    | 使用 `addressResolver.dohEndpoint` 解析，这是默认值。          |
| `dns`    | 使用 `addressResolver.dnsServers` 解析，例如 `["1.1.1.1", "8.8.8.8"]`。 |
| `system` | 使用 Node.js 系统 DNS 解析。                                  |
| `off`    | 不在生成的 Surge external proxy 条目中写入 `addresses=`。      |

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
| `surge-vless-bridge init`    | 生成配置模板，自动检测默认值                    |
| `surge-vless-bridge sync`    | 拉取订阅 → 生成 sing-box 配置 → 更新 Surge      |
| `surge-vless-bridge rebuild` | 仅基于已有本地配置重建 Surge 区块（不访问网络） |
| `surge-vless-bridge restore` | 恢复最近一次 Surge 配置备份                     |
| `surge-vless-bridge doctor`  | 检查配置、路径及 Surge 必需区块是否正常         |

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

编译输出到 `dist/`：

```bash
npm run build
```
