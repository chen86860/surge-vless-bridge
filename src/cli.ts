#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadCliConfig, writeExampleConfig } from './configuration';
import type { CliConfigInput } from './types/cli-config';
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
  init       Create a config template
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
  if (!process.stdin.isTTY) {
    throw new Error('Refusing to run without confirmation. Re-run with --yes.');
  }

  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
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
    const created = await writeExampleConfig({
      cwd,
      configPath,
      force: Boolean(parsed.options.force),
    });

    console.log(`Created config template: ${created.configPath}`);
    for (const warning of created.warnings) {
      console.warn(`Warning: ${warning}`);
    }
    console.log('Fill subscriptionUrls before running `sync`.');
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
