# Setting up surge-vless-bridge with an AI agent

This document is written for an AI agent (Claude Code, Cursor, Codex, …) helping a human set up VLESS
proxies in **Surge Mac**. It covers how to drive the `surge-vless-bridge` CLI end to end without
breaking their Surge profile.

> Editing the source code of this repo instead of using the tool? See
> [AGENTS.md](../AGENTS.md) and [Development](../README.md#development).

## What the tool does

Surge Mac has no native VLESS support. This CLI fetches a VLESS subscription, writes one local
`sing-box` config per node, and injects matching `external` proxies plus a policy group into the
user's Surge profile — inside a marked block (`# vless start` … `# vless end`) so the rest of the
profile is never touched.

Requires macOS, Node.js >= 20, `sing-box` on disk, and a Surge profile containing `[Proxy]` and
`[Proxy Group]` sections.

One node means one resident `sing-box` process at roughly 35 MB — 20 nodes cost about 700 MB. The
policy group is a `url-test`, so Surge latency-tests every member and none of the processes are
lazy. Tell the user this number **before** syncing a large subscription, and say what it will cost on
their machine: a 60-node subscription is about 2 GB. If they only need a few nodes, suggest a
filtered subscription or listing the links under `vlessNodes` instead. See
[Memory cost](../README.md#memory-cost-one-sing-box-process-per-node).

## Ask the user — never guess

| Value | Why you cannot infer it |
| --- | --- |
| `subscriptionUrls` | A private credential. It is not in the repo, the environment, or anywhere you may search. Ask for it, and never echo it back into chat, logs, commit messages, or a bug report. |
| `surgeConfigPath` | The CLI auto-detects the most recently modified `.conf` under `~/Library/Application Support/Surge/Profiles/`. If more than one profile exists, confirm the guess with the user before syncing — writing to the wrong profile edits a config they are actively using. |

Everything else has a working default. Do not invent values for `portStart`, `policyGroupName`,
`outputDir`, or `backupDir` unless the user asks.

## Happy path

Assume nothing is installed yet — check each prerequisite and install what is missing.

```bash
# 1. sing-box must exist on disk; install it if `which sing-box` finds nothing
which sing-box || brew install sing-box

# 2. Install the CLI (or use `npx surge-vless-bridge <command>` without installing)
npm i -g surge-vless-bridge

# 3. Create the config. `init` is interactive for humans, so pass the answers as flags instead —
#    it PRINTS the path it wrote; read it from the output rather than assuming it
#    (see "Where the config file lands" below).
#    `--no-input` also means it will not sync: for a human answering the questions `init` runs the
#    first sync itself, but under an agent the profile is only ever written by an explicit `sync`.
surge-vless-bridge init --no-input --subscription-url "$URL" --surge-config "$PROFILE"

# 4. Check the file: subscriptionUrls and surgeConfigPath must both be filled in
# 5. Preview — writes nothing
surge-vless-bridge sync --dry-run

# 6. Apply, then verify
surge-vless-bridge sync
surge-vless-bridge doctor
```

Confirm with the user before installing anything with `brew` or `npm -g`; both change their machine
outside this project. If Homebrew is absent, say so and let the user choose how to install `sing-box`
rather than installing Homebrew for them.

The one thing you cannot provide is the Surge profile itself: the user must already have Surge Mac
with a profile containing `[Proxy]` and `[Proxy Group]`. If those sections are missing, stop and tell
them — the tool will not create them.

Step 5 before step 6, always. `--dry-run` prints the node names and ports that a real sync would
produce; show that list to the user before touching their profile.

`doctor` exits non-zero when any check FAILs, so you can gate on its exit code.

## Where the config file lands

`init` and every later command resolve the config path in this order:

1. `--config <path>`, if given.
2. `<git root>/.surge-vless-bridge.json` — **if the current directory is inside a git repository**.
3. `~/.config/surge-vless-bridge/config.json`.

Rule 2 is the trap. If you run `init` from inside any git repo, the config — including the user's
subscription URL — is written into that repo and can be committed. Unless the user explicitly wants a
per-project config, run from outside a repo, or pin the path:

```bash
surge-vless-bridge init --config ~/.config/surge-vless-bridge/config.json
```

If a project-local config is intended, add `.surge-vless-bridge.json` to `.gitignore` first.

## Filling the config

Minimum viable file:

```json
{
  "subscriptionUrls": ["https://provider.example.com/subscription"],
  "surgeConfigPath": "/Users/you/Library/Application Support/Surge/Profiles/Config.conf"
}
```

`init` writes `"subscriptionUrls": [""]` — replace the empty string, don't append to it. Multiple URLs
are merged into one policy group. `vlessNodes` accepts raw `vless://` links for users without a
subscription. All other keys are optional; see [Config File](../README.md#config-file).

Any config key can be overridden per-run by a flag (`--subscription-url`, `--surge-config`,
`--group-name`, `--port-start`, …). Prefer editing the config file for anything permanent — flags
passed on a command line end up in shell history.

## `init` is interactive

Run by a human on a terminal, `init` asks for the subscription URL and offers a numbered list of Surge
profiles. You almost certainly cannot answer those questions:

- **If you can pass the values**, use `init --no-input --subscription-url … --surge-config …`.
- **If you cannot**, `init` detects the absent TTY and writes the plain template without asking, so a
  bare `init` is safe too — you then edit the JSON yourself.
- **Never try to feed keystrokes into the prompt.** If your shell tool does give the child a TTY,
  `--no-input` is what keeps the run deterministic.

`clean` is the other interactive command; see the confirmation note above.

## Commands

| Command | Network | Writes Surge profile | Notes |
| --- | --- | --- | --- |
| `init` | no | no | Interactive on a TTY — use `--no-input`. Fails if the config exists; `--force` overwrites |
| `sync` | yes | yes | The main command. `--dry-run` to preview |
| `rebuild` | no | yes | Re-emits the Surge block from existing local configs |
| `restore` | no | yes | Latest backup, or `restore <path>` |
| `clean` | no | yes | Deletes generated configs + the managed block |
| `doctor` | no | no | Exit code 1 when a check FAILs |

Safe to run unprompted: `doctor`, `sync --dry-run`, `help`, `version`.
**Confirm with the user first:** `sync`, `rebuild`, `restore`, `clean`, `init --force`.

`clean` prompts interactively. Under an agent there is usually no TTY, so it fails with
*"Refusing to run without confirmation. Re-run with --yes."* Get the user's explicit go-ahead, then
pass `--yes` — do not add `--yes` reflexively to silence the error.

## Reading `doctor`

Each line is `OK` / `WARN` / `FAIL` plus a label.

| Line | Meaning | Fix |
| --- | --- | --- |
| `FAIL nodeSources` | No subscription URL and no direct node | Fill `subscriptionUrls` |
| `FAIL surgeConfigPath` | Profile path empty or missing | Ask the user for the real path (Surge menu bar → Switch Profile → Show in Finder) |
| `FAIL singBoxBinary` | `sing-box` not found | `brew install sing-box`, or set `singBoxBinary` |
| `FAIL proxy-section` / `proxy-group-section` | Profile lacks `[Proxy]` / `[Proxy Group]` | The user must add the section; the tool will not create it |
| `WARN outputDir` / `backupDir` | Not created yet | Expected before the first `sync` |
| `WARN surge-http-api` | No auto-reload path | Suggest `http-api = <key>@127.0.0.1:6171` under `[General]` |
| `OK ports … in use` | Expected while Surge is running those nodes | Nothing to do |

## Common errors

| Message | What happened | What to do |
| --- | --- | --- |
| `Config file not found: <path>` | Wrong directory, or `init` never ran | Check the path — the git-root rule above is the usual cause |
| `Config file already exists: <path>` | `init` on an existing config | Edit it instead of re-running with `--force` |
| `No VLESS nodes from any configured source; refusing to update the Surge profile.` | Subscription empty, expired, or unreachable | Nothing was written. Have the user verify the URL in a browser |
| `Surge profile is missing the [Proxy] section.` | Profile is not a usable Surge config | Confirm `surgeConfigPath` points at the right file |
| `sing-box rejected <file>: …` | A node produced an invalid config | Nothing was applied; report the stderr to the user |
| `Surge profile not found: <path>` | Bad `surgeConfigPath` | Ask the user to re-copy the path |
| `Unknown flag: --x` | Typo | Flags are rejected, not ignored — check `help` |

## Safety rules

- **Never print, log, commit, or paste a subscription URL**, including into issue reports or PR
  descriptions. Redact it as `https://…/subscription` when quoting output.
- Every profile-writing command backs the profile up to `backupDir` first (20 kept by default). If
  something looks wrong after a sync, `surge-vless-bridge restore` is the undo.
- A failed `sync` is atomic: nodes are generated and validated in a staging directory, so neither the
  profile nor the previous node configs are modified when it errors. Do not "clean up" after a failure.
- Do not hand-edit the Surge profile between the markers; the next `sync` overwrites that block.
  Changes outside the markers are preserved.
- Surge does not reload on its own. After a successful `sync`, tell the user to reload the profile if
  `doctor` reported `WARN surge-http-api`.
