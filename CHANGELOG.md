# Changelog

[中文更新日志](./CHANGELOG.zh-CN.md)

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-13

### Changed

- **`addressResolver.strategy` now defaults to `doh` instead of `system`.** With Surge's enhanced mode
  enabled, the system resolver answers with fake IPs in `198.18.0.0/15`, which were pinned into
  `addresses=` and left the generated nodes unusable. DoH bypasses the system resolver, so `sync` no
  longer requires turning enhanced mode off ([#3](https://github.com/chen86860/surge-vless-bridge/issues/3)).
- Address resolution falls back across resolvers. Every strategy except `off` now tries the remaining
  resolvers when its own result is empty or contains only fake IPs (`doh` → `dns` → `system`, and the
  equivalent chain for each configured strategy). A single failing resolver no longer aborts resolution
  for that node.
- IPv4 is preferred when a proxy server resolves to several addresses. Surge accepts only one value in
  `addresses=`, and A/AAAA records arrived in an unstable order, so the written address could be an IPv6
  one that IPv4-only networks cannot reach. IPv6 is still written when no A record exists.

### Fixed

- A resolver error is now logged per resolver and skipped, instead of aborting the whole lookup and
  silently omitting `addresses=`. A node that cannot be resolved at all reports an explicit error.

## [1.0.8] - 2026-06-13

### Added

- `surge-vless-bridge --version` to print the installed version.

## [1.0.7] - 2026-06-13

### Fixed

- The publish workflow now targets the `master` branch explicitly.

## [1.0.6] - 2026-04-15

### Fixed

- Surge fake IP addresses (`198.18.0.0/15`) are filtered before being written into `addresses=`, and
  `addressResolver` gained the `filterSurgeFakeIp`, `dohEndpoint`, and `dnsServers` options
  ([#1](https://github.com/chen86860/surge-vless-bridge/pull/1)).
- `outputDir` defaults to `~/.config/surge-vless-bridge/nodes`.

## [1.0.1] - [1.0.5] - 2026-04-14 / 2026-04-15

Initial public releases: `init` / `sync` / `rebuild` / `restore` / `doctor` commands, VLESS
subscription parsing, per-node sing-box config generation, Surge profile backup, and npm publishing.

[1.1.0]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.6...v1.1.0
[1.0.8]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.6...v1.0.8
[1.0.7]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.5...v1.0.6
