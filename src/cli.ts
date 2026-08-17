#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { pathExists } from './utils/fs';

import { listSurgeProfiles, loadCliConfig, resolveConfigPath, writeExampleConfig } from './configuration';
import type { CliConfigInput } from './types/cli-config';
import { dim, isInteractive, normalizePastedPath, redactUrl, withPrompt, type Ask } from './utils/prompt';
import { canSelect, selectFromList } from './utils/select';
import {
  cleanManagedArtifacts,
  rebuildSurgeFromLocalConfigs,
  restoreSurgeProfileBackup,
  runDoctor,
  syncSubscriptionToSurge,
} from './surge';

const REPOSITORY_URL = 'https://github.com/chen86860/surge-vless-bridge';

type FlagType = 'string' | 'number' | 'boolean';

type ParsedArgs = {
  command: string;
  options: Record<string, string | number | boolean>;
  positionals: string[];
};

const FLAGS: Record<string, FlagType> = {
  config: 'string',
  'subscription-url': 'string',
  'surge-config': 'string',
  'sing-box-bin': 'string',
  'output-dir': 'string',
  'backup-dir': 'string',
  'group-name': 'string',
  'port-start': 'number',
  'backup-keep': 'number',
  'dry-run': 'boolean',
  'no-reload': 'boolean',
  'no-input': 'boolean',
  force: 'boolean',
  yes: 'boolean',
  help: 'boolean',
  version: 'boolean',
};

const COMMANDS = ['init', 'sync', 'rebuild', 'restore', 'doctor', 'clean', 'version', 'help'] as const;

// Read on demand: most commands never report the version, and only `help` needs it inline.
let cachedVersion: string | undefined;

const version = () => {
  if (cachedVersion === undefined) {
    try {
      const parsed = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { version?: string };
      cachedVersion = typeof parsed.version === 'string' ? parsed.version : 'unknown';
    } catch {
      cachedVersion = 'unknown';
    }
  }

  return cachedVersion;
};

const helpText = () => `Use VLESS subscriptions in Surge Mac, backed by local sing-box.

Usage:
  surge-vless-bridge <command> [flags]

Commands:
  init       Create a config, asking for the subscription and Surge profile
  sync       Fetch subscriptions, generate sing-box configs, update Surge
  rebuild    Rebuild the Surge block from local sing-box configs only
  restore    Restore the latest backup, or the one given as an argument
  clean      Remove generated configs and the managed block from Surge
  doctor     Check paths, ports and required Surge sections
  version    Print the version
  help       Print this help

Config flags:
  --config <path>            Config file to use
  --subscription-url <url>   Subscription URL
  --surge-config <path>      Surge profile path
  --sing-box-bin <path>      sing-box executable
  --output-dir <path>        Where node configs are written
  --backup-dir <path>        Where profile backups are stored
  --group-name <name>        Surge policy group name
  --port-start <number>      First local SOCKS port
  --backup-keep <number>     How many backups to keep

Command flags:
  --dry-run                  sync: preview the changes, write nothing
  --no-reload                sync/rebuild/restore: skip the Surge reload
  --no-input                 init: write the template without asking anything
  --force                    init: overwrite an existing config
  --yes                      clean: skip the confirmation prompt
  -v, --version              Print the version
  -h, --help                 Print this help

Examples:
  surge-vless-bridge init
  surge-vless-bridge sync
  surge-vless-bridge sync --dry-run
  surge-vless-bridge doctor

Version       ${version()}
Config file   ~/.config/surge-vless-bridge/config.json
Homepage      ${REPOSITORY_URL}
Issues        ${REPOSITORY_URL}/issues
`;

const ALIASES: Record<string, string> = {
  v: 'version',
  h: 'help',
};

// Unknown flags and unusable values are rejected rather than ignored: silently dropping a mistyped
// `--group-nmae` looks like it worked and quietly writes the wrong policy group.
const parseArgs = (argv: string[]): ParsedArgs => {
  // A leading `-` means no command was given, as in `surge-vless-bridge --version`.
  const hasCommand = argv[0] !== undefined && !argv[0].startsWith('-');
  const command = hasCommand ? (argv[0] as string) : 'help';
  const rest = hasCommand ? argv.slice(1) : argv;
  const options: Record<string, string | number | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token) {
      continue;
    }

    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    const raw = token.startsWith('--') ? token.slice(2) : token.slice(1);
    const [name, inlineValue] = raw.includes('=')
      ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)]
      : [raw, undefined];
    const key = ALIASES[name] ?? name;
    const type = FLAGS[key];

    if (!type) {
      throw new Error(`Unknown flag: ${token}\nRun \`surge-vless-bridge help\` to see the available flags.`);
    }

    if (type === 'boolean') {
      if (inlineValue !== undefined) {
        throw new Error(`Flag --${key} does not take a value.`);
      }

      options[key] = true;
      continue;
    }

    let value = inlineValue;
    if (value === undefined) {
      const next = rest[index + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new Error(`Flag --${key} requires a value.`);
      }

      value = next;
      index += 1;
    }

    if (type === 'number') {
      const parsedValue = Number(value);
      if (!Number.isFinite(parsedValue)) {
        throw new Error(`Flag --${key} expects a number, received: ${value}`);
      }

      options[key] = parsedValue;
      continue;
    }

    options[key] = value;
  }

  return { command, options, positionals };
};

const stringOption = (options: ParsedArgs['options'], key: string) =>
  typeof options[key] === 'string' ? (options[key] as string) : undefined;

const numberOption = (options: ParsedArgs['options'], key: string) =>
  typeof options[key] === 'number' ? (options[key] as number) : undefined;

const toOverrides = (options: ParsedArgs['options']): CliConfigInput => {
  const subscriptionUrl = stringOption(options, 'subscription-url');

  return {
    subscriptionUrl,
    subscriptionUrls: subscriptionUrl ? [subscriptionUrl] : undefined,
    surgeConfigPath: stringOption(options, 'surge-config'),
    singBoxBinary: stringOption(options, 'sing-box-bin'),
    outputDir: stringOption(options, 'output-dir'),
    backupDir: stringOption(options, 'backup-dir'),
    policyGroupName: stringOption(options, 'group-name'),
    portStart: numberOption(options, 'port-start'),
    backupKeep: numberOption(options, 'backup-keep'),
    autoReload: options['no-reload'] === true ? false : undefined,
  };
};

const confirm = async (question: string) => {
  if (!isInteractive()) {
    throw new Error('Refusing to run without confirmation. Re-run with --yes.');
  }

  return withPrompt(async (ask) => (await ask(`${question} [y/N] `)).trim().toLowerCase() === 'y');
};

type InitAnswers = { subscriptionUrls?: string[]; vlessNodes?: string[]; surgeConfigPath?: string };

const ATTEMPT_LIMIT = 3;

// Both sources are accepted here because the config accepts both, and a user who only has a node
// link should not have to learn which key it belongs under.
const askNodeSource = async (ask: Ask): Promise<InitAnswers> => {
  console.log('Subscription URL — paste it, or press Enter to fill it in later.');

  for (let attempt = 0; attempt < ATTEMPT_LIMIT; attempt += 1) {
    const answer = (await ask('  › ')).trim();
    if (!answer) {
      return {};
    }

    if (/^https?:\/\//i.test(answer)) {
      return { subscriptionUrls: [answer] };
    }

    if (answer.startsWith('vless://')) {
      return { vlessNodes: [answer] };
    }

    console.log('  Expected an http(s) subscription URL or a vless:// link.');
  }

  console.log('  Skipped; fill subscriptionUrls in the config file instead.');
  return {};
};

const withHomeTilde = (path: string) => {
  const home = process.env.HOME;
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
};

// Profiles are often near-identical copies, so the filename alone rarely settles which one is live.
// The modification time usually does.
const formatMtime = (mtimeMs: number) => {
  const at = new Date(mtimeMs);
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

type Profile = { path: string; mtimeMs: number };

// Every candidate comes from the one Surge profiles directory, so the shared prefix is printed once
// and the names are padded: at full path width the timestamps stop lining up and long lines wrap. The
// full path of whatever gets picked is echoed back afterwards.
const describeProfiles = (profiles: Profile[]) => {
  const width = Math.max(...profiles.map((profile) => basename(profile.path).length));

  // The list is newest-first, so entry 1 is the profile the user most recently touched.
  return profiles.map((profile) => ({
    value: profile.path,
    label: basename(profile.path).padEnd(width),
    note: `modified ${formatMtime(profile.mtimeMs)}`,
  }));
};

const pickProfile = async (profiles: Profile[]): Promise<string | undefined> => {
  const title = `Surge profile ${dim(`in ${withHomeTilde(dirname((profiles[0] as Profile).path))}`)}`;
  const choices = describeProfiles(profiles);

  if (canSelect()) {
    return selectFromList({ title, choices });
  }

  // No raw mode — a dumb terminal, or stdin already spoken for. Numbers still work everywhere. There
  // is no cursor to show what a bare Enter would pick here, so the default is called out in text.
  console.log(`${title} — press Enter for the default, or pick a number:`);
  choices.forEach((choice, index) =>
    console.log(`  ${index + 1}) ${choice.label}  ${dim(`${choice.note}${index === 0 ? '  ← default' : ''}`)}`),
  );

  return withPrompt(async (ask) => {
    for (let attempt = 0; attempt < ATTEMPT_LIMIT; attempt += 1) {
      const answer = (await ask('  › ')).trim();
      if (!answer) {
        return (choices[0] as { value: string }).value;
      }

      const choice = Number(answer);
      if (Number.isInteger(choice) && choice >= 1 && choice <= choices.length) {
        return (choices[choice - 1] as { value: string }).value;
      }

      console.log(`  Enter a number between 1 and ${choices.length}.`);
    }

    return undefined;
  });
};

const askManualProfilePath = async () =>
  withPrompt(async (ask) => {
    const answer = (await ask('Surge profile path (paste or drag the file in, Enter to skip): ')).trim();
    if (!answer) {
      return undefined;
    }

    const manual = normalizePastedPath(answer);
    if (!(await pathExists(manual))) {
      console.warn(`Warning: ${manual} does not exist yet.`);
    }

    return manual;
  });

const askSurgeProfile = async (): Promise<string | undefined> => {
  const profiles = await listSurgeProfiles();

  if (profiles.length === 1) {
    const only = profiles[0] as Profile;
    const question = `Surge profile — use ${only.path} ${dim(`(modified ${formatMtime(only.mtimeMs)})`)}? [Y/n] `;
    const answer = await withPrompt(async (ask) => (await ask(question)).trim().toLowerCase());
    if (answer === '' || answer === 'y') {
      return only.path;
    }
  } else if (profiles.length > 1) {
    return pickProfile(profiles);
  } else {
    // Detection only ever looks in the one standard directory, so coming up empty means either Surge
    // is not installed or it keeps its profiles somewhere else. Both are recoverable by hand, but
    // only if the user knows where Surge hides the path.
    console.log('No Surge profile found under ~/Library/Application Support/Surge/Profiles.');
    console.log(dim('  Surge menu bar icon → Switch Profile → Show in Finder, then drag the file in below.'));
    console.log(dim('  You can also skip this and set surgeConfigPath in the config file later.'));
  }

  return askManualProfilePath();
};

// Each question owns its own stdin session: the arrow-key selector needs raw mode, and a readline
// interface left open around it would fight over the same keypresses.
const promptInitAnswers = async (preset: InitAnswers): Promise<InitAnswers> => {
  const nodeSource = preset.subscriptionUrls?.length ? {} : await withPrompt(askNodeSource);

  if (preset.surgeConfigPath) {
    return { ...preset, ...nodeSource };
  }

  console.log('');
  const surgeConfigPath = await askSurgeProfile();

  return { ...preset, ...nodeSource, surgeConfigPath };
};

const main = async () => {
  const parsed = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (parsed.command === 'version' || parsed.options.version) {
    console.log(version());
    return;
  }

  if (parsed.command === 'help' || parsed.options.help) {
    console.log(helpText());
    return;
  }

  if (!COMMANDS.includes(parsed.command as (typeof COMMANDS)[number])) {
    throw new Error(`Unknown command: ${parsed.command}\nRun \`surge-vless-bridge help\` to see the commands.`);
  }

  if (parsed.command === 'init') {
    const configPath = stringOption(parsed.options, 'config');
    const force = Boolean(parsed.options.force);
    const preset: InitAnswers = {
      subscriptionUrls: stringOption(parsed.options, 'subscription-url')
        ? [stringOption(parsed.options, 'subscription-url') as string]
        : undefined,
      surgeConfigPath: stringOption(parsed.options, 'surge-config'),
    };

    // Asking first and only then discovering the file is already there would waste the answers, so
    // the conflict is detected before a single question is printed.
    const resolvedConfigPath = resolveConfigPath(cwd, configPath);
    if (!force && (await pathExists(resolvedConfigPath))) {
      throw new Error(`Config file already exists: ${resolvedConfigPath}`);
    }

    const canPrompt = parsed.options['no-input'] !== true && isInteractive();
    const answers = canPrompt ? await promptInitAnswers(preset) : preset;
    const created = await writeExampleConfig({ cwd, configPath, force, values: answers });

    if (canPrompt) {
      console.log('');
    }

    console.log(`Created config: ${created.configPath}`);
    for (const warning of created.warnings) {
      console.warn(`Warning: ${warning}`);
    }

    const source = answers.subscriptionUrls?.[0] ?? answers.vlessNodes?.[0];
    if (source) {
      console.log(`  node source   ${redactUrl(source)}`);
    }
    if (answers.surgeConfigPath) {
      console.log(`  Surge profile ${answers.surgeConfigPath}`);
    }

    console.log(
      source
        ? 'Next: surge-vless-bridge sync'
        : 'Fill subscriptionUrls in that file, then run `surge-vless-bridge sync`.',
    );
    return;
  }

  const loaded = await loadCliConfig({
    cwd,
    configPath: stringOption(parsed.options, 'config'),
    overrides: toOverrides(parsed.options),
  });

  if (!loaded.exists) {
    console.log(`Config file not found: ${loaded.configPath}`);
    console.log('Run `surge-vless-bridge init` first, or pass all required flags directly.');
  }

  switch (parsed.command) {
    case 'sync': {
      const result = await syncSubscriptionToSurge(loaded.config, {
        dryRun: parsed.options['dry-run'] === true,
      });

      if (result.dryRun) {
        console.log(`Dry run: ${result.count} nodes would be written, nothing was changed.`);
        break;
      }

      console.log(`Synced ${result.count} nodes.`);
      console.log(`Backup saved to ${result.backupPath}`);
      break;
    }
    case 'rebuild': {
      const result = await rebuildSurgeFromLocalConfigs(loaded.config);
      console.log(`Rebuilt ${result.count} nodes from local configs.`);
      console.log(`Backup saved to ${result.backupPath}`);
      break;
    }
    case 'restore': {
      const restored = await restoreSurgeProfileBackup({
        config: loaded.config,
        backupPath: parsed.positionals[0],
      });
      console.log(`Restored Surge profile from ${restored}`);
      break;
    }
    case 'clean': {
      if (!parsed.options.yes && !(await confirm('Remove all generated node configs and the Surge managed block?'))) {
        console.log('Aborted.');
        break;
      }

      const result = await cleanManagedArtifacts(loaded.config);
      console.log(`Removed ${result.removedConfigs} node config${result.removedConfigs === 1 ? '' : 's'}.`);
      console.log(`Backup saved to ${result.backupPath}`);
      break;
    }
    case 'doctor': {
      const { failures } = await runDoctor(loaded.config);
      if (failures > 0) {
        process.exitCode = 1;
      }
      break;
    }
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
