# surge-vless-bridge

Node.js CLI that makes VLESS subscriptions usable in Surge Mac: it fetches subscriptions, writes one
shared sing-box config, and injects `external` proxies plus policy groups into the user's Surge
profile. User docs: `README.md` (Chinese, primary) and `README.en.md`. Setting the tool up *for* a
user is covered by `docs/agent-setup.md`; this file is for changing the code.

## Tooling

- Node.js >= 20, npm. No Bun APIs or Bun-only workflows; prefer `node:*` built-ins.
- TypeScript (`strict`) compiled by `tsc` to CommonJS in `dist/`. The published CLI runs from `dist/`.
- `npm run build` — clean build. `npm test` — builds, then runs `node --test test/*.test.js`.
  Tests import from `dist/`, so they always need a build first.
- `npm run sync|doctor|…` runs the source through `tsx`. Inside this repo the config is the
  git-ignored `.surge-vless-bridge.json` at the repo root, not the global one.

## How it works

- `sync` (`src/surge.ts`): fetch subscriptions (`src/parse.ts`) → parse `vless://` links
  (`src/utils/parse-vless-node.ts`) → write `sing-box.json`, `launcher.sh` and `groups.json` to a
  staging dir → `sing-box check` → back up the Surge profile → rename the files into `outputDir` →
  rewrite the managed block and policy groups → reload Surge. Any failure before the rename leaves
  everything untouched.
- All nodes share **one sing-box process**: `sing-box.json` has one SOCKS inbound per node
  (`socks-in-<port>`) and a route rule pinning it to its outbound (`src/utils/parse-template.ts`).
  Each Surge node runs `/bin/sh launcher.sh <sing-box>`; the launchers share sing-box through a lock,
  lease files and a pid file under `nodes/run/` (`src/utils/launcher.ts`). The first starts it, the
  last stops it, a changed config restarts it, and launchers exit once Surge is gone or `clean` ran.
  The script must stay POSIX `sh` (CI runs on Ubuntu, where `/bin/sh` is dash).
- `groups.json` records which nodes belong to a per-subscription `group`; `rebuild` and `clean` rely
  on it and on `sing-box.json`, never on the Surge profile, to know what they manage.
- The Surge profile is only edited between `# vless start` / `# vless end` and on policy group lines
  this tool wrote. Everything else in the profile must survive byte for byte.
- Reload (`src/utils/surge-reload.ts`): HTTP API from `[General] http-api`, then `surge-cli` from
  `PATH` or inside `Surge.app`.

## Conventions

- **Never print a subscription URL**: they carry tokens. Errors name the origin only
  (`describeSubscriptionUrl`), and proxy URLs drop their credentials. Tests assert this.
- Reject what cannot be right instead of guessing: unknown CLI flags, unknown fields in
  `subscriptionUrls` entries, names with `,` `=` or line breaks. Silent fallbacks look like success.
- Write files with `src/utils/fs.ts`: `writeTextFile` / `writeBinaryFile` for files this tool owns
  (atomic, mode 0600), `replaceTextFile` / `replaceBinaryFile` for the user's Surge profile (atomic,
  keeps its mode, follows symlinks). Never `fs.writeFile` directly.
- `sync` refuses to touch the profile when no source yields a usable node, so one expired
  subscription cannot empty the policy group.
- Comments explain why, not what; match the density of the surrounding code.

## Testing

- Tests use `node:test` and build throwaway configs with `test/helpers.js` (`makeConfig`). Fake
  subscriptions are `data:` URLs (`subscriptionUrl([...])`); sing-box is stubbed with `/usr/bin/true`,
  and auto-reload and DNS resolution are off, so tests never reach the real Surge or the network.
- `test/launcher.test.js` runs the real launcher against a stub sing-box and waits on fixed delays
  (the 5s heartbeat). Those tests are the slowest and the first to suspect if a run is flaky.
- Changes to the launcher, proxy lines or policy groups also need a check in the real Surge. Point
  `--config` at a scratch config whose `outputDir` and `backupDir` are outside `~/.config`, run `sync`,
  trigger nodes with `surge-cli test-group <group>` (bundled at
  `/Applications/Surge.app/Contents/Applications/surge-cli`), then `clean` and `restore` the first
  backup, and confirm with `cmp` that the profile matches it. Ask the user before touching their
  Surge profile.

## Docs and releases

- User-facing changes update `README.md` and `README.en.md` together, `docs/agent-setup.md` when the
  setup flow or `doctor` output changes, and both `CHANGELOG.md` and `CHANGELOG.zh-CN.md` under
  `Unreleased` / `未发布`.
- Commits follow Conventional Commits. A release is its own `chore(release): x.y.z` commit: bump
  `package.json` and `package-lock.json` with `npm version x.y.z --no-git-tag-version`, rename the
  changelog section, and add the compare link at the bottom of both changelogs.
- `.github/workflows/publish.yml` publishes on pushes to `master` and `v*` tags, and skips a version
  that is already on npm. Do not push, tag or publish without the user asking.
