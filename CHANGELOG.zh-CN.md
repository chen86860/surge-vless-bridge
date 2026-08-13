# 更新日志

[English Changelog](./CHANGELOG.md)

本文件记录项目的所有重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

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

[1.1.0]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.6...v1.1.0
[1.0.8]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.6...v1.0.8
[1.0.7]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.5...v1.0.6
