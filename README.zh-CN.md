# surge-vless-bridge

[![npm version](https://img.shields.io/npm/v/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)
[![npm downloads](https://img.shields.io/npm/dm/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)

[English README](./README.md)

基于 Node.js 的 CLI，把 VLESS 订阅转换为 Surge Mac 可用的 `external` 代理节点，底层由本地 `sing-box` 承接。

Surge Mac 不原生支持 VLESS。该工具自动拉取订阅、为每个节点生成 `sing-box` 配置、并保持 Surge 配置同步更新，让你继续使用 Surge 的规则、策略组和面板来使用 VLESS 节点。

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
  "subscriptionUrl": "https://your-provider.com/subscription",
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/MyProfile.conf"
}
```

- **`subscriptionUrl`**：填入你的 VLESS 订阅地址。

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

## 配置文件

由 `init` 创建，默认路径：`~/.config/surge-vless-bridge/config.json`。

```json
{
  "subscriptionUrl": "https://example.com/subscription",
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/Config.conf",
  "policyGroupName": "VLESS",
  "portStart": 2081
}
```

**必填**

| 字段              | 说明                     |
| ----------------- | ------------------------ |
| `subscriptionUrl` | VLESS 订阅地址           |
| `surgeConfigPath` | Surge 配置文件的绝对路径 |

**选填**

| 字段              | 默认值                                 | 说明                             |
| ----------------- | -------------------------------------- | -------------------------------- |
| `policyGroupName` | `"VLESS"`                              | 要写入的 Surge 策略组名称        |
| `portStart`       | `2081`                                 | 起始本地端口，每个节点依次递增   |
| `singBoxBinary`   | 自动检测（`which sing-box`）           | `sing-box` 可执行文件路径        |
| `outputDir`       | `~/.config/surge-vless-bridge/nodes`   | 每个节点的 sing-box 配置保存目录 |
| `backupDir`       | `~/.config/surge-vless-bridge/backups` | Surge 配置备份目录               |

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
