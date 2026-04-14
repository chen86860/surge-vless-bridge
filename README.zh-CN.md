# surge-vless-bridge

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

然后执行：

```bash
surge-vless-bridge init
surge-vless-bridge sync
```

## 本地开发

```bash
npm install
```

## 快速开始

**1. 生成配置文件：**

```bash
npm run init
```

会在当前目录生成 `.surge-vless-bridge.json`。

**2. 编辑 `.surge-vless-bridge.json`：**

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

**3. 同步：**

```bash
npm run sync
```

`sync` 会依次完成：拉取订阅 → 生成 sing-box 配置 → 备份 Surge 配置 → 更新 Surge 配置。

## 配置文件

`.surge-vless-bridge.json` — 由 `init` 创建，首次 `sync` 前需编辑。

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
| `outputDir`       | `~/.config/surge-vless-bridge/config`  | 每个节点的 sing-box 配置保存目录 |
| `backupDir`       | `~/.config/surge-vless-bridge/backups` | Surge 配置备份目录               |

也可以通过命令行参数临时覆盖：

```bash
npm run sync -- --subscription-url https://example.com/sub --group-name VLESS
```

## 命令说明

| 命令              | 说明                                            |
| ----------------- | ----------------------------------------------- |
| `npm run init`    | 生成配置模板，自动检测默认值                    |
| `npm run sync`    | 拉取订阅 → 生成 sing-box 配置 → 更新 Surge      |
| `npm run rebuild` | 仅基于已有本地配置重建 Surge 区块（不访问网络） |
| `npm run restore` | 恢复最近一次 Surge 配置备份                     |
| `npm run doctor`  | 检查配置、路径及 Surge 必需区块是否正常         |
