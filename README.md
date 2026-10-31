# surge-vless-bridge

[![npm version](https://img.shields.io/npm/v/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)
[![npm downloads](https://img.shields.io/npm/dm/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)

[English](./README.en.md) · [更新日志](./CHANGELOG.zh-CN.md)

**在 Surge Mac 里使用 VLESS 订阅。**

Surge Mac 不支持 VLESS（包括 REALITY、XTLS Vision）。这个工具把 VLESS 订阅转换成 Surge 节点，由本机的
[sing-box](https://github.com/SagerNet/sing-box) 负责连接，规则、策略组和面板照常使用。

配置完成后，你的 Surge 配置里会多出下面这样的节点和一个 `VLESS` 策略组，其余内容保持不变：

```ini
[Proxy]
# vless start
HK 01 = external, exec=/bin/sh, args=…/launcher.sh, args=…/sing-box, local-port=2081, addresses=203.0.113.10
JP 01 = external, exec=/bin/sh, args=…/launcher.sh, args=…/sing-box, local-port=2082, addresses=203.0.113.20
# vless end

[Proxy Group]
VLESS = url-test, HK 01, JP 01, no-alert=0, hidden=0
```

## 前置条件

- macOS 上的 Surge Mac，当前使用的 Surge 配置里有 `[Proxy]` 和 `[Proxy Group]` 两个区块
- Node.js 20 或更高版本
- [sing-box](https://github.com/SagerNet/sing-box)（`brew install sing-box`）

## 让 AI Agent 帮你完成配置

把下面这段话发给 Claude Code、Cursor、Codex 这类能操作本机终端的 agent，它会安装所需工具并完成配置：

```text
阅读 https://github.com/chen86860/surge-vless-bridge/blob/master/docs/agent-setup.md
然后帮我在这台 Mac 上配置好 surge-vless-bridge
```

## 手动配置

### 安装

```bash
npm i -g surge-vless-bridge
```

### 快速开始

**1. 生成本工具的配置：**

```bash
surge-vless-bridge init
```

按提示输入订阅地址、选择要写入的 Surge 配置即可，配置会保存在 `~/.config/surge-vless-bridge/config.json`。

**2. 补全配置**（只有跳过了提问才需要）：

```json
{
  "subscriptionUrls": ["https://your-provider.com/subscription"],
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/MyProfile.conf"
}
```

- **`subscriptionUrls`**：一个或多个 VLESS 订阅地址，节点会合并到同一个策略组。
- **`surgeConfigPath`**：Surge 配置文件（`.conf`）的完整路径，可在 Surge 菜单栏 → 切换配置 → 在访达中显示 找到。

**3. 预览，然后同步：**

```bash
surge-vless-bridge sync --dry-run   # 只预览，不写入任何文件
surge-vless-bridge sync
```

**4. 检查是否一切正常：**

```bash
surge-vless-bridge doctor
```

**5. 在 Surge 里使用这些节点：**

`sync` 不会改动你的规则。要让流量走这些节点，需要在 Surge 配置里引用 `VLESS`，比如加进你平时切换的策略组：

```ini
[Proxy Group]
Proxy = select, VLESS, DIRECT

[Rule]
DOMAIN-SUFFIX,example.com,VLESS
FINAL,Proxy
```

不要手动编辑 `VLESS = …` 这一行和 `# vless start` … `# vless end` 之间的内容，下次 `sync` 会覆盖它们。

### 升级

```bash
npm i -g surge-vless-bridge@latest
surge-vless-bridge sync
```

升级后执行一次 `sync`，让生成的文件跟上新版本。

## 本工具的配置文件

由 `init` 创建，默认路径为 `~/.config/surge-vless-bridge/config.json`，也可以用 `--config <path>` 指定。

```json
{
  "subscriptionUrls": ["https://example.com/subscription-a", "https://example.com/subscription-b"],
  "vlessNodes": [
    "vless://uuid@example.com:443?type=tcp&security=reality&pbk=public-key&sid=short-id&fp=chrome&sni=example.com&flow=xtls-rprx-vision#Example"
  ],
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/Config.conf",
  "policyGroupName": "VLESS",
  "portStart": 2081
}
```

### 必填

| 字段              | 说明                     |
| ----------------- | ------------------------ |
| `surgeConfigPath` | Surge 配置文件的完整路径 |

再加上**至少一种**节点来源：

| 字段               | 说明                                                      |
| ------------------ | --------------------------------------------------------- |
| `subscriptionUrls` | 一个或多个 VLESS 订阅地址，也可以写成带选项的对象，见下文 |
| `vlessNodes`       | 一个或多个原始 `vless://` 节点地址，适合没有订阅的情况    |

重名节点会自动追加序号（`HK 01 2`）；某个订阅没有可用节点时只告警，不影响其他订阅。

### 选填

| 字段                | 默认值                                 | 说明                                            |
| ------------------- | -------------------------------------- | ----------------------------------------------- |
| `policyGroupName`   | `"VLESS"`                              | 要写入的 Surge 策略组名称                       |
| `portStart`         | `2081`                                 | 起始本地端口，第 N 个节点用 `portStart + N - 1` |
| `singBoxBinary`     | 自动检测（`which sing-box`）           | `sing-box` 可执行文件路径                       |
| `outputDir`         | `~/.config/surge-vless-bridge/nodes`   | sing-box 配置和启动脚本的存放目录               |
| `backupDir`         | `~/.config/surge-vless-bridge/backups` | Surge 配置备份目录                              |
| `backupKeep`        | `20`                                   | 保留的备份数量                                  |
| `autoReload`        | `true`                                 | 改动后自动让 Surge 重载                         |
| `subscriptionProxy` | 无                                     | 直连拉取订阅失败时改走的代理，见下文            |
| `addressResolver`   | `"doh"`                                | 节点地址的解析方式，见下文                      |

### 按订阅加前缀、分策略组

`subscriptionUrls` 的每一项可以是地址，也可以是带选项的对象：

```json
{
  "subscriptionUrls": [
    "https://example.com/subscription-a",
    { "url": "https://example.com/subscription-b", "prefix": "机场B | " },
    { "url": "https://example.com/subscription-c", "prefix": "机场C | ", "group": "机场C" }
  ]
}
```

| 选项     | 说明                                                                     |
| -------- | ------------------------------------------------------------------------ |
| `url`    | 订阅地址，必填                                                           |
| `prefix` | 加在该订阅每个节点名前面（`机场B \| HK 01`），用来区分不同机场的同名节点 |
| `group`  | 把该订阅的节点写进单独的策略组，而不是 `policyGroupName`                 |

上面的例子会生成：

```ini
VLESS = url-test, HK 01, …, 机场B | HK 01, …, no-alert=0, hidden=0
机场C = url-test, 机场C | HK 01, …, no-alert=0, hidden=0
```

- 所有订阅都设置了 `group` 时，`VLESS` 会变成 `select, <各个 group>`，引用它的规则不用改。
- 从配置里删掉的 `group`，下次 `sync` 会一并删除对应的策略组。
- `group` 不要和你已有的策略组重名，否则会被覆盖。

### 订阅里的流量、到期信息

订阅里「剩余流量」「套餐到期」「距离重置」这类伪装成节点的提示会被自动跳过，`sync` 会列出跳过了哪些。

> 正常节点名里如果恰好带这些字样（例如「香港 01 流量倍率 0.5」）也会被跳过，留意 `sync` 的输出。

### 订阅拉取失败时走代理

有的订阅只能通过代理访问。配置 `subscriptionProxy` 后，直连失败时会通过该代理再试一次：

```json
{
  "subscriptionProxy": "http://127.0.0.1:6152"
}
```

`6152` 是 Surge 默认的 HTTP 代理端口。

### 节点地址解析

`sync` 会把节点服务器的 IP 写进 Surge 的 `addresses=`，`addressResolver` 决定怎么解析：

| 值       | 说明                                                      |
| -------- | --------------------------------------------------------- |
| `doh`    | 通过 DoH 解析（默认），开着 Surge 增强模式也能拿到真实 IP |
| `dns`    | 通过 `addressResolver.dnsServers` 指定的 DNS 服务器解析   |
| `system` | 使用系统 DNS，适合网络屏蔽了 DoH 的情况                   |
| `off`    | 不写入 `addresses=`                                       |

## 命令说明

| 命令                                | 说明                                            |
| ----------------------------------- | ----------------------------------------------- |
| `surge-vless-bridge init`           | 生成本工具的配置                                |
| `surge-vless-bridge sync`           | 拉取订阅并更新 Surge                            |
| `surge-vless-bridge rebuild`        | 不联网，用本地已有的节点重建 Surge 里的托管区块 |
| `surge-vless-bridge restore [path]` | 恢复最近一次（或指定的）Surge 配置备份          |
| `surge-vless-bridge clean`          | 移除本工具写入 Surge 的全部内容和生成的文件     |
| `surge-vless-bridge doctor`         | 检查配置和运行环境，有问题时退出码为 1          |

| 参数              | 作用                                             |
| ----------------- | ------------------------------------------------ |
| `--dry-run`       | `sync`：只预览，不写入任何文件                   |
| `--no-reload`     | `sync` / `rebuild` / `restore`：不自动重载 Surge |
| `--no-input`      | `init`：不提问，只生成模板                       |
| `--force`         | `init`：覆盖已有的配置                           |
| `--yes`           | `clean`：跳过确认                                |
| `--config <path>` | 使用指定的配置文件                               |

配置里的大部分字段也能用参数临时覆盖（如 `--subscription-url`、`--group-name`），完整列表见
`surge-vless-bridge help`。

### 自动重载

改动 Surge 配置后会自动重载：默认通过 Surge 自带的 `surge-cli`，无需额外设置；Surge 配置里开启了 `http-api` 时
优先用它。加 `--no-reload` 或设置 `"autoReload": false` 可以关闭。

### 卸载

```bash
surge-vless-bridge clean
npm uninstall -g surge-vless-bridge
```

本工具的配置和备份留在 `~/.config/surge-vless-bridge/`，不再需要时可手动删除。

## 排错

先运行 `surge-vless-bridge doctor`，每一项都会给出 `OK` / `WARN` / `FAIL` 和修复建议。

| 现象                                           | 排查方法                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Surge 提示 `External Proxy Process Terminated` | 查看 `~/.config/surge-vless-bridge/nodes/run/sing-box.log`；sing-box 太旧时 `brew upgrade sing-box` 后再 `sync` |
| `sync` 后 Surge 里看不到节点                   | 在 Surge 菜单里手动重载一次配置                                                                                 |
| 节点都在，但流量没有走它们                     | 确认规则或常用的策略组引用了 `VLESS`，见[快速开始第 5 步](#快速开始)                                            |
| 测速全部超时                                   | 确认订阅本身可用；`doctor` 提示端口被占用时，改 `portStart` 后重新 `sync`                                       |
| `Failed to fetch subscription …: 403`          | 浏览器能打开订阅的话，试试 [`subscriptionProxy`](#订阅拉取失败时走代理)                                         |
| `refusing to update the Surge profile`         | 所有订阅都没有可用节点（过期或为空），Surge 配置没有被改动                                                      |

改坏了也不用担心：`surge-vless-bridge restore` 会恢复最近一次备份。

## 安全性

- 任何一步失败，Surge 配置和已有文件都不会被改动。
- 每次修改 Surge 配置前都会备份，`restore` 可以恢复。
- 生成的文件只有你自己能读，其中的订阅地址和节点信息不会暴露给这台 Mac 上的其他用户。

所有节点共用一个 sing-box 进程，日志在 `~/.config/surge-vless-bridge/nodes/run/sing-box.log`。

---

## 本地开发

代码结构和约定见 [AGENTS.md](./AGENTS.md)。

```bash
git clone https://github.com/chen86860/surge-vless-bridge.git
cd surge-vless-bridge
npm install
npm run build
npm test
```

在仓库里运行时，如果仓库根目录有 `.surge-vless-bridge.json` 就优先使用它，否则用全局配置。用
`npm run init -- --config .surge-vless-bridge.json` 创建（已在 `.gitignore` 中）；`npm run sync`、
`npm run doctor` 等命令通过 `tsx` 直接运行源码。
