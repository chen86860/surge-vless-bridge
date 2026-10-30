# surge-vless-bridge

[![npm version](https://img.shields.io/npm/v/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)
[![npm downloads](https://img.shields.io/npm/dm/surge-vless-bridge.svg)](https://www.npmjs.com/package/surge-vless-bridge)

[English](./README.en.md) · [更新日志](./CHANGELOG.zh-CN.md)

**在 Surge Mac 里使用 VLESS 订阅。**

Surge Mac 不支持 VLESS 协议，包括 REALITY 和 XTLS Vision 节点。这个命令行工具把你的 VLESS 订阅转换成 Surge
能用的节点，实际连接由本机的 [sing-box](https://github.com/SagerNet/sing-box) 完成。你照常使用 Surge 的规则、
策略组和面板，订阅更新后再同步一次即可。

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

不用提前安装本工具。把下面这段话发给 Claude Code、Cursor、Codex 这类能操作本机终端的 agent，它会检查并安装
sing-box 和本工具，然后完成配置、同步和验证：

```text
阅读 https://github.com/chen86860/surge-vless-bridge/blob/master/docs/agent-setup.md
然后帮我在这台 Mac 上配置好 surge-vless-bridge
```

[docs/agent-setup.md](./docs/agent-setup.md) 是写给 agent 的操作手册：按什么顺序执行命令、怎么读检查结果、
哪些操作必须先征得你同意。它只会问你两件事：订阅地址，以及要写入哪个 Surge 配置；其余都用默认值。真正改动
Surge 配置前，它会先把预览结果给你看，结束时汇报节点数量、备份位置和检查结果。

> 订阅地址相当于密码。发给本机的 agent 没问题，但不要贴到公开 Issue、群聊或截图里；手册也要求 agent 不在任何
> 输出中回显它。

想自己动手？继续往下看。

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

`init` 会先问订阅地址，再让你用 ↑/↓ 选择要写入的 Surge 配置，最后生成
`~/.config/surge-vless-bridge/config.json` 并打印路径。不想现在回答的话，订阅地址直接回车、Surge 配置按 Esc
跳过，之后再手动填写；加 `--no-input` 则不提问，只生成模板。

**2. 补全配置**（只有跳过了提问才需要）：

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

- **`surgeConfigPath`**：Surge 配置文件（`.conf`）的完整路径。查找方法：
  1. 点击 macOS **菜单栏**中的 Surge 图标
  2. 选择 **切换配置**，在当前使用的配置文件上点击 **在访达中显示**
  3. 在 Finder 中对该文件按 `⌘ + i`，复制"位置"下的完整路径，拼上文件名填入

  > 也可以在终端里列出所有 Surge 配置：
  >
  > ```bash
  > ls ~/Library/Application\ Support/Surge/Profiles/
  > ```

**3. 预览，然后同步：**

```bash
surge-vless-bridge sync --dry-run   # 只看会生成哪些节点和改动，不写入任何文件
surge-vless-bridge sync
```

`sync` 会拉取订阅、生成并校验节点、备份 Surge 配置、写入改动，最后让 Surge 重载。

**4. 检查是否一切正常：**

```bash
surge-vless-bridge doctor
```

**5. 在 Surge 里使用这些节点：**

`sync` 只写入节点和 `VLESS` 策略组，**不会改动你的规则**。要让流量走这些节点，需要在 Surge 配置里引用
`VLESS`，最常见的做法是把它加进你平时切换的那个策略组：

```ini
[Proxy Group]
Proxy = select, VLESS, DIRECT

[Rule]
DOMAIN-SUFFIX,example.com,VLESS
FINAL,Proxy
```

在 `[Proxy Group]` 里引用 `VLESS` 时不用管先后顺序。不要直接编辑 `VLESS = …` 这一行和 `# vless start` …
`# vless end` 之间的内容，下次 `sync` 会覆盖它们；在这两处之外的改动都会保留。

### 升级

```bash
npm i -g surge-vless-bridge@latest
surge-vless-bridge sync
```

升级后执行一次 `sync`，让生成的文件跟上新版本。从 1.5.x 及更早版本升级时这一步是必须的：旧版每个节点一个
sing-box 配置，`sync` 会把它们迁移成共用的 `sing-box.json`，迁移完成前 `rebuild` 会拒绝执行。

## 本工具的配置文件

由 `init` 创建，默认路径为 `~/.config/surge-vless-bridge/config.json`。

在 git 仓库里运行时，只有仓库根目录**已经存在** `.surge-vless-bridge.json` 才会使用它，否则仍然使用上面的全局
配置，所以在任何项目目录里都可以直接运行 `sync`。`--config <path>` 可以指定其他配置文件。

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

### 必填

| 字段              | 说明                     |
| ----------------- | ------------------------ |
| `surgeConfigPath` | Surge 配置文件的完整路径 |

再加上**至少一种**节点来源：

| 字段               | 说明                                                       |
| ------------------ | ---------------------------------------------------------- |
| `subscriptionUrls` | 一个或多个 VLESS 订阅地址，也可以写成带选项的对象，见下文 |
| `vlessNodes`       | 一个或多个原始 `vless://` 节点地址，适合没有订阅的情况     |

`subscriptionUrl`（单个地址）仍然兼容。它与 `subscriptionUrls` 同时存在时两者合并去重，且 `subscriptionUrl`
排在最前 —— 新增第二个机场不会导致原订阅丢失。

所有来源的节点默认合并进同一个策略组。重名节点自动追加序号（`HK 01 2`）；某个订阅没有解析出 VLESS 节点时
只告警，不会中断整次同步。

### 选填

| 字段                | 默认值                                 | 说明                                             |
| ------------------- | -------------------------------------- | ------------------------------------------------ |
| `policyGroupName`   | `"VLESS"`                              | 要写入的 Surge 策略组名称                        |
| `portStart`         | `2081`                                 | 起始本地端口，第 N 个节点用 `portStart + N - 1`  |
| `singBoxBinary`     | 自动检测（`which sing-box`）           | `sing-box` 可执行文件路径                        |
| `outputDir`         | `~/.config/surge-vless-bridge/nodes`   | sing-box 配置和启动脚本的存放目录                |
| `backupDir`         | `~/.config/surge-vless-bridge/backups` | Surge 配置备份目录                               |
| `backupKeep`        | `20`                                   | 保留的备份数量，超出的旧备份自动清理             |
| `autoReload`        | `true`                                 | 配置变更后自动让 Surge 重载                      |
| `subscriptionProxy` | 无                                     | 直连拉取订阅失败时改走的代理，见下文             |
| `addressResolver`   | 见下文                                 | 为 `addresses=` 解析代理服务器域名               |

### 按订阅加前缀、分策略组

`subscriptionUrls` 里的每一项既可以是地址字符串，也可以是带选项的对象，两种写法可以混用：

```json
{
  "subscriptionUrls": [
    "https://example.com/subscription-a",
    { "url": "https://example.com/subscription-b", "prefix": "机场B | " },
    { "url": "https://example.com/subscription-c", "prefix": "机场C | ", "group": "机场C" }
  ]
}
```

| 选项     | 说明                                                                                   |
| -------- | -------------------------------------------------------------------------------------- |
| `url`    | 订阅地址，必填                                                                         |
| `prefix` | 加在该订阅每个节点名前面，原样拼接（`机场B \| HK 01`），可以用来区分不同机场的同名节点 |
| `group`  | 把该订阅的节点写进单独的 url-test 策略组，而不是 `policyGroupName`                     |

上面的例子会生成两个策略组：

```ini
VLESS = url-test, HK 01, …, 机场B | HK 01, …, no-alert=0, hidden=0
机场C = url-test, 机场C | HK 01, …, no-alert=0, hidden=0
```

- 没写 `group` 的订阅和 `vlessNodes` 里的节点都进 `policyGroupName`。
- 如果所有订阅都写了 `group`，`policyGroupName` 仍会保留，变成 `VLESS = select, <各个 group>`，规则里原来
  引用 `VLESS` 的地方不用改；Surge 在规则引用的策略不存在时会拒绝加载配置。
- 从配置里删掉某个 `group` 后，下次 `sync` 会把对应的策略组一并删掉；`clean` 会删除本工具写过的所有策略组。
- `group` 不要和你已有的策略组重名，否则会被覆盖。`prefix`、`group` 都不能包含逗号、`=` 或换行，写错字段名
  （例如 `grop`）会直接报错，不会被悄悄忽略。

### 订阅里的流量、到期信息

很多机场会把「剩余流量」「套餐到期」「距离重置」之类的提示伪装成节点放进订阅。名称里含有 `Remain`、`Expired`、
`Reset`、`官网`、`如需`、`套餐`、`去除`、`剩余`、`距离`、`重置`、`流量` 的条目不会生成节点，也不占用本地端口，
`sync` 会列出被跳过的条目名。

> 正常节点名里如果恰好带这些词（例如「香港 01 流量倍率 0.5」）也会被跳过，留意 `sync` 输出的跳过列表。

### 订阅拉取失败时走代理

部分机场的订阅地址只能通过代理访问，或者会拒绝 Node.js 的 TLS 指纹。配置 `subscriptionProxy` 后，直连拉取失败
时会用 `curl` 通过该代理再试一次：

```json
{
  "subscriptionProxy": "http://127.0.0.1:6152"
}
```

`6152` 是 Surge 默认的 HTTP 代理端口，可在 Surge 的「设置 → 代理服务」里查看。代理地址可以带账号密码
（`http://user:pass@host:port`），输出中只会显示 `http://host:port`。直连成功时不会使用代理；两次都失败时，
报错会同时列出两次的原因。需要系统里有 `curl`，macOS 自带。

### 解析节点地址（`addressResolver`）

`sync` 会把每个节点服务器的 IP 写进 Surge 的 `addresses=`。`addressResolver.strategy` 可选：

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

`addressResolver.filterSurgeFakeIp` 默认为 `true`。它会在写入 `addresses=` 前过滤 `198.18.0.0/15` 地址，
避免把 Surge fake-ip 结果固定到 external proxy 条目里。

**为什么默认使用 `doh`**：开启 Surge 增强模式后，系统 DNS 会返回 `198.18.0.0/15` 段的 fake IP。此时用系统解析
代理服务器域名，会把 fake IP 固定写进 `addresses=`，导致节点连不通。`doh` 完全绕开系统解析，因此**不需要关闭
增强模式**也能正常 `sync`。只有当你的网络屏蔽了 DoH 端点时，才需要改成 `"strategy": "system"`。

## 命令说明

| 命令                                | 说明                                                       |
| ----------------------------------- | ---------------------------------------------------------- |
| `surge-vless-bridge init`           | 生成本工具的配置，交互询问订阅地址与 Surge 配置            |
| `surge-vless-bridge sync`           | 拉取订阅 → 生成共享 sing-box 配置 → 更新 Surge             |
| `surge-vless-bridge rebuild`        | 仅基于已有本地配置重建 Surge 区块（不访问网络）            |
| `surge-vless-bridge restore [path]` | 恢复最近一次 Surge 配置备份，或恢复指定的备份文件          |
| `surge-vless-bridge clean`          | 停止 sing-box，移除生成的文件与 Surge 托管区块（需确认）   |
| `surge-vless-bridge doctor`         | 检查配置、路径、端口及 Surge 必需区块，有问题时退出码为 1 |

常用参数：

| 参数                      | 作用                                               |
| ------------------------- | -------------------------------------------------- |
| `--dry-run`               | `sync`：只预览节点、端口和配置改动，不写入任何文件 |
| `--no-reload`             | `sync` / `rebuild` / `restore`：不自动重载 Surge   |
| `--no-input`              | `init`：不提问，直接写出配置模板                   |
| `--force`                 | `init`：覆盖已有的配置                             |
| `--yes`                   | `clean`：跳过确认提示                              |
| `--config <path>`         | 使用指定的配置文件                                 |

配置里的大部分字段也可以用命令行参数临时覆盖，例如：

```bash
surge-vless-bridge sync --subscription-url https://example.com/sub --group-name VLESS
```

完整列表见 `surge-vless-bridge help`。写错的参数会直接报错，不会被忽略。

### 自动重载

Surge 不会自动发现配置被改动，需要重载才会生效。本工具会自动处理：

1. 如果 Surge 配置的 `[General]` 里开启了 HTTP API（`http-api = your-key@127.0.0.1:6171`），优先通过它重载；
2. 否则使用 `surge-cli reload`：先找 `PATH`，再找 Surge 安装包内自带的
   `/Applications/Surge.app/Contents/Applications/surge-cli`，所以**默认安装的 Surge 不用额外配置**。

`doctor` 的 `auto-reload` 一行会显示当前使用的是哪种方式。加 `--no-reload` 或设置 `"autoReload": false` 可以
关闭自动重载。

### 卸载

```bash
surge-vless-bridge clean          # 停止 sing-box，移除生成的文件和 Surge 里的托管区块与策略组
npm uninstall -g surge-vless-bridge
```

`clean` 执行前会先备份 Surge 配置，其余内容保持不变。本工具的配置和备份仍留在 `~/.config/surge-vless-bridge/`，
确认不再需要后可以手动删除该目录。

## 排错

先运行 `surge-vless-bridge doctor`：每行以 `OK` / `WARN` / `FAIL` 开头，并给出修复建议。

| 现象                                           | 排查方法                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Surge 提示 `External Proxy Process Terminated` | 查看 `~/.config/surge-vless-bridge/nodes/run/sing-box.log`，里面是 sing-box 的报错。sing-box 版本太旧时先 `brew upgrade sing-box`，再 `sync` |
| `sync` 后 Surge 里看不到节点                   | `sync` 输出里是否有 `Surge profile reloaded`；没有的话在 Surge 菜单里手动重载配置                                         |
| 节点都在，但流量没有走它们                     | 确认规则或你常用的策略组引用了 `VLESS`，见[快速开始第 5 步](#快速开始)                                                     |
| 测速全部超时                                   | 先确认订阅本身可用；`doctor` 的 `ports` 一行如果提示端口被其他程序占用，改 `portStart` 后重新 `sync`                      |
| `Failed to fetch subscription …: 403`          | 订阅拒绝了这次请求。浏览器能打开的话，试试配置 [`subscriptionProxy`](#订阅拉取失败时走代理)                                |
| `refusing to update the Surge profile`         | 所有订阅都没有解析出可用节点（过期、为空或只有信息条目），Surge 配置没有被改动                                            |

改坏了也不用担心：`surge-vless-bridge restore` 会恢复最近一次备份。

## 工作原理：所有节点共用一个 sing-box

Surge 的每个 `external` 节点都会启动一个进程，而 url-test 策略组一测速就会把组里所有节点同时拉起来并一直
常驻。如果每个节点直接运行一个 sing-box，有多少个节点就会有多少个 sing-box 进程。

因此本工具只生成**一份** `sing-box.json`：每个节点在其中占一个本地 SOCKS 入站端口，并通过路由规则绑定到
自己的出站。Surge 里的每个节点运行的是一个很小的启动脚本 `launcher.sh`：

- 第一个启动的脚本拉起 sing-box，之后的直接复用，最后一个退出时关闭 sing-box；
- 每个脚本每 5 秒检查一次：sing-box 意外退出，或 `sing-box.json` 内容变了，就重新启动它，所以即使没有
  重载 Surge，新配置也会生效；
- 每次启动 sing-box 前都会先跑 `sing-box check`，输出写在 `nodes/run/sing-box.log`；
- Surge 退出或执行了 `clean` 之后，残留的启动脚本会自行退出。

由于所有节点在同一个进程里，`sync` 会在写入 Surge 之前先用 `sing-box check` 校验整份配置，避免一个坏节点
拖垮全部节点。

## 同步过程如何保护你的配置

- 配置先在临时目录里生成并校验，任一环节失败都不会动到 Surge 配置，也不会破坏上一次同步的结果。
- 每次写入 Surge 配置前都会备份到 `backupDir`，`restore` 可以恢复最近一次备份。
- `rebuild` 只按 `sing-box.json` 里记录的节点和端口重建，不会复活已从订阅里删除的节点。
- 所有来源都没有解析出 VLESS 节点时，`sync` 拒绝改写配置，避免某个机场过期导致策略组被清空。
- 生成的配置会经过 `sing-box check`，用的是**你本机安装的** sing-box：能查出不支持的选项和非法密钥，但
  **不能验证节点是否真的连得通**。
- 所有文件都先写入临时文件再改名替换，写到一半中断也不会留下残缺的 Surge 配置；符号链接形式的 Surge 配置
  （例如放在 iCloud 里）会更新链接指向的文件，链接本身不变。
- 本工具生成的文件（配置、节点、备份）权限都是 `600`，目录是 `700`，同一台 Mac 上的其他用户读不到订阅地址
  和节点 UUID。Surge 配置保留原来的权限。旧版本生成的配置如果对其他用户可读，`doctor` 会给出提示。

---

## 本地开发

面向参与贡献的开发者，代码结构和约定见 [AGENTS.md](./AGENTS.md)。

```bash
git clone https://github.com/chen86860/surge-vless-bridge.git
cd surge-vless-bridge
npm install
```

仓库根目录已有 `.surge-vless-bridge.json` 时会优先使用它，而非全局配置；没有的话用
`npm run init -- --config .surge-vless-bridge.json` 创建（该文件已在 `.gitignore` 中）。

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
