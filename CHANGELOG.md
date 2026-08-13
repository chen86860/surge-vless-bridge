# Changelog

[中文更新日志](./CHANGELOG.zh-CN.md)

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-08-13

### Added

- `sync --dry-run` reports the nodes, ports and profile changes a sync would produce without writing
  anything.
- `clean` removes the generated node configs and the managed block and policy group from the Surge
  profile, leaving everything else intact. The profile is backed up first.
- The Surge profile is reloaded automatically after `sync`, `rebuild` and `restore`, through the Surge
  HTTP API (`http-api` in `[General]`) or `surge-cli` when available. Disable with `--no-reload` or
  `"autoReload": false`.
- `backupKeep` (default `20`) prunes old profile backups, which previously accumulated forever.
- `help` shows the repository URL and where to report issues.

### Changed

- Unknown flags, unknown commands, missing flag values and non-numeric numeric flags are now errors.
  A mistyped `--group-nmae` used to be ignored, so the command appeared to succeed while doing
  something else.
- `--flag=value` is accepted alongside `--flag value`.
- The help text documents only the user-facing config path; the development path is no longer listed.

### Fixed

- `doctor` exits non-zero when a check fails, so scripts and CI can rely on it.
- `doctor` verifies that `outputDir` and `backupDir` exist rather than always reporting OK, and reports
  a missing directory before the first sync as a warning rather than a failure.
- `doctor` reports the local port range in use and whether the Surge HTTP API is reachable.

## [1.3.1] - 2026-08-13

### Fixed

- Generated configs no longer set `tls.record_fragment`. The option only exists from sing-box 1.12 and
  was always written with its default value, so on older builds — including the 1.11.x releases still
  used on macOS 10.15 — sing-box rejected every generated config with `json: unknown field`, exited
  immediately, and Surge reported `External Proxy Process Terminated`
  ([#5](https://github.com/chen86860/surge-vless-bridge/issues/5)).

## [1.3.0] - 2026-08-13

### Added

- `sync` generates and validates every node in a staging directory before touching anything, so a
  failure part-way through leaves both the Surge profile and the previous node configs untouched
  (adapted from [#7](https://github.com/chen86860/surge-vless-bridge/pull/7), thanks to
  [@MapleGu](https://github.com/MapleGu)).
- Node configs produced by a sync are recorded in `manifest.json`, and `rebuild` reads it instead of
  globbing the output directory. Installs without a manifest keep working through a glob fallback.
- Generated configs are validated with `sing-box check`, capped at 8 parallel processes. This is a
  structural check: it rejects malformed JSON and unknown outbound types, but accepts an outbound with
  missing or nonsensical fields, so it is not a connectivity test.
- A `node --test` suite of 26 tests, run in CI on Node 20, 22 and 24.

### Fixed

- `rebuild` no longer resurrects nodes that have been removed from the subscription. Node configs left
  behind by a shrinking subscription are now deleted during `sync`.
- Subscriptions are no longer Base64-decoded blindly. A plain-text list is detected and passed through,
  the URL-safe alphabet is supported, and an unrecognised response — an HTML error page from an expired
  account, for instance — is reported instead of decoding into mojibake and yielding zero nodes.
- The subscription request times out after 15 seconds instead of hanging `sync` indefinitely.
- Reality nodes without a public key are rejected at parse time. sing-box starts without one but every
  handshake fails, which surfaces in Surge as a proxy that dies on each request.
- `sync` refuses to update the profile when no configured source yields a VLESS node, and fails early
  with a clear message when the Surge profile or the sing-box binary is missing.
- CRLF line endings and duplicate links within a single subscription are handled.

## [1.2.0] - 2026-08-13

### Added

- `subscriptionUrls` merges several VLESS subscriptions into a single Surge policy group
  ([#4](https://github.com/chen86860/surge-vless-bridge/pull/4), thanks to
  [@SKYhuangjing](https://github.com/SKYhuangjing)).
- `vlessNodes` accepts raw `vless://` links in the config, for nodes that are not part of any
  subscription.
- Duplicate policy names are deduplicated with a numeric suffix (`HK 01 2`), so nodes that share a name
  across providers no longer trigger Surge's `Policy already exists` error.
- Generated external proxy lines left outside the `# vless start` / `# vless end` block by older
  versions are cleaned up during `sync`.

### Changed

- `subscriptionUrl` and `subscriptionUrls` are merged and deduplicated instead of the latter shadowing
  the former, with `subscriptionUrl` fetched first so existing node order and local ports stay stable.
  Adding a second provider to an existing config no longer silently drops the original subscription.
- The `doctor` check `subscriptionUrl` is now `nodeSources` and reports how many subscription URLs and
  direct nodes are configured.

### Fixed

- A failing subscription reports which one failed (`Subscription 2 of 3`) and names the provider by
  origin, without leaking the token carried in the URL path or query.
- A subscription that returns no VLESS nodes logs a warning instead of contributing nothing silently.

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

[1.4.0]: https://github.com/chen86860/surge-vless-bridge/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/chen86860/surge-vless-bridge/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/chen86860/surge-vless-bridge/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/chen86860/surge-vless-bridge/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.6...v1.1.0
[1.0.8]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.6...v1.0.8
[1.0.7]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/chen86860/surge-vless-bridge/compare/v1.0.5...v1.0.6
