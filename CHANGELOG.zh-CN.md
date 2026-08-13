# 更新日志

[English Changelog](./CHANGELOG.md)

本文件记录项目的所有重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [1.3.1] - 2026-08-13

### 修复

- 生成的配置不再写入 `tls.record_fragment`。该选项从 sing-box 1.12 才引入，而且写入的一直是默认值；在更早的
  版本上（包括 macOS 10.15 仍在使用的 1.11.x），sing-box 会以 `json: unknown field` 拒绝每一个生成的配置并
  立即退出，在 Surge 里表现为 `External Proxy Process Terminated`
  （[#5](https://github.com/chen86860/surge-vless-bridge/issues/5)）。

## [1.3.0] - 2026-08-13

### 新增

- `sync` 先在临时目录里生成并校验全部节点，通过后再一次性落盘，因此中途失败不会动到 Surge 配置，也不会
  破坏上一次同步的节点配置（改编自 [#7](https://github.com/chen86860/surge-vless-bridge/pull/7)，感谢
  [@MapleGu](https://github.com/MapleGu)）。
- 每次同步产生的节点配置会记录到 `manifest.json`，`rebuild` 据此重建，不再直接扫描整个目录；没有
  manifest 的旧安装仍可回退到扫描方式。
- 生成的配置会用 `sing-box check` 校验，最多 8 个进程并发。注意这只是结构校验：它能拒绝非法 JSON 和未知
  outbound 类型，但缺字段或字段值离谱的配置照样能通过，**不等于连通性测试**。
- 新增 26 个 `node --test` 测试，CI 在 Node 20 / 22 / 24 上运行。

### 修复

- `rebuild` 不再复活已从订阅中删除的节点；订阅节点减少时，多余的节点配置会在 `sync` 时清理掉。
- 不再无条件对订阅内容做 Base64 解码。现在会先识别纯文本链接列表、支持 URL-safe 字母表，遇到无法识别的
  响应（例如账号过期返回的 HTML 错误页）直接报错，而不是解码成乱码后同步出 0 个节点。
- 订阅请求 15 秒超时，不再因为机场无响应而让 `sync` 无限挂起。
- 缺少 public key 的 reality 节点在解析阶段就报错。sing-box 缺这个字段照样能启动，但握手必然失败，在 Surge
  里表现为"一请求就断"的外部代理。
- 所有来源都没有解析出 VLESS 节点时，`sync` 拒绝改写 Surge 配置；Surge 配置文件或 sing-box 可执行文件缺失
  时提前报错并给出明确提示。
- 正确处理 CRLF 换行，以及单个订阅内部的重复链接。

## [1.2.0] - 2026-08-13

### 新增

- `subscriptionUrls`：把多个 VLESS 订阅合并进同一个 Surge 策略组
  （[#4](https://github.com/chen86860/surge-vless-bridge/pull/4)，感谢
  [@SKYhuangjing](https://github.com/SKYhuangjing)）。
- `vlessNodes`：支持在配置里直接写裸 `vless://` 链接，用于不属于任何订阅的节点。
- 重名节点自动追加序号（`HK 01 2`），不同机场存在同名节点时不再触发 Surge 的 `Policy already exists` 错误。
- `sync` 时清理旧版本遗留在 `# vless start` / `# vless end` 区块之外的 external 代理行。

### 变更

- `subscriptionUrl` 与 `subscriptionUrls` 改为合并去重，而不是后者覆盖前者；`subscriptionUrl` 排在最前，
  保证既有节点顺序和本地端口不变。在原有配置上新增第二个机场，不会再静默丢掉原订阅。
- `doctor` 的 `subscriptionUrl` 检查项改名为 `nodeSources`，会显示已配置的订阅数量和直填节点数量。

### 修复

- 订阅拉取失败时会指明是第几个订阅（`Subscription 2 of 3`），并且只用 origin 标识机场，不会泄露 URL
  路径或查询串里的 token。
- 某个订阅没有解析出 VLESS 节点时打印告警，不再静默地不产生任何节点。

## [1.1.0] - 2026-08-13

### 变更

- **`addressResolver.strategy` 默认值从 `system` 改为 `doh`。** 开启 Surge 增强模式后，系统解析会返回
  `198.18.0.0/15` 段的 fake IP，这些地址会被固定写进 `addresses=`，导致生成的节点连不通。DoH 完全绕开
  系统解析，因此 `sync` 不再需要先关闭增强模式
  （[#3](https://github.com/chen86860/surge-vless-bridge/issues/3)）。
- 地址解析支持自动回退。除 `off` 外，任何策略在自身结果为空、或过滤 fake IP 后为空时，都会依次尝试其余
  解析方式（`doh` → `dns` → `system`，其他策略同理）。单个解析方式失败不再中断该节点的整个解析流程。
- 一个域名解析出多个地址时优先使用 IPv4。Surge 的 `addresses=` 只接受单个地址，而 A/AAAA 记录的返回顺序
  不稳定，此前可能写入 IPv6 地址，在没有 IPv6 出口的网络下无法连接。没有 A 记录时仍然写入 IPv6。

### 修复

- 解析出错时按解析方式单独记录日志并跳过，不再中断整个查询并静默省略 `addresses=`。完全无法解析的节点会
  给出明确的错误提示。

## [1.0.8] - 2026-06-13

### 新增

- `surge-vless-bridge --version`，用于打印当前安装的版本号。

## [1.0.7] - 2026-06-13

### 修复

- 发布流程明确指定 `master` 分支。

## [1.0.6] - 2026-04-15

### 修复

- 写入 `addresses=` 前过滤 Surge fake IP（`198.18.0.0/15`），`addressResolver` 新增 `filterSurgeFakeIp`、
  `dohEndpoint`、`dnsServers` 选项（[#1](https://github.com/chen86860/surge-vless-bridge/pull/1)）。
- `outputDir` 默认值调整为 `~/.config/surge-vless-bridge/nodes`。

## [1.0.1] - [1.0.5] - 2026-04-14 / 2026-04-15

首批公开发布：`init` / `sync` / `rebuild` / `restore` / `doctor` 命令、VLESS 订阅解析、按节点生成
sing-box 配置、Surge 配置备份，以及 npm 发布流程。

[1.3.1]: https://github.com/chen86860/surge-vless-bridge/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/chen86860/surge-vless-bridge/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/chen86860/surge-vless-bridge/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.6...v1.1.0
[1.0.8]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.6...v1.0.8
[1.0.7]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.5...v1.0.6
