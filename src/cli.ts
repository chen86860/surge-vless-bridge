#!/usr/bin/env node

import { resolve } from 'node:path';

import { HOME_CONFIG_FILE_PATH, loadCliConfig, writeExampleConfig } from './configuration';
import type { CliConfigInput } from './types/cli-config';
import { rebuildSurgeFromLocalConfigs, restoreSurgeProfileBackup, runDoctor, syncSubscriptionToSurge } from './surge';

type ParsedArgs = {
  command: string;
  options: Record<string, string | boolean>;
  positionals: string[];
};

const HELP_TEXT = `surge-vless-bridge

Commands:
  init       Create a local config template
  sync       Fetch subscription, generate sing-box configs, backup and update Surge
  rebuild    Rebuild Surge external proxies from local sing-box configs only
  restore    Restore the latest backup or a specified backup file
  doctor     Validate detected paths and Surge sections
  help       Show this help

Flags:
  --config <path>             Path to the JSON config file
  --subscription-url <url>    Override subscription URL
  --surge-config <path>       Override Surge profile path
  --sing-box-bin <path>       Override sing-box executable path
  --output-dir <path>         Override generated sing-box config directory
  --backup-dir <path>         Override Surge backup directory
  --group-name <name>         Override Surge policy group name
  --port-start <number>       Override the first local SOCKS port
  --force                     Overwrite config on init

Default config path:
  Global install              ~/.config/surge-vless-bridge/config.json
  Local development           ./.surge-vless-bridge.json

Examples:
  surge-vless-bridge init
  surge-vless-bridge sync --subscription-url https://example.com/sub
  surge-vless-bridge rebuild
  surge-vless-bridge doctor
`;

const parseArgs = (argv: string[]): ParsedArgs => {
  const [command = 'help', ...rest] = argv;
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token) {
      continue;
    }

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { command, options, positionals };
};

const toOverrides = (options: Record<string, string | boolean>): CliConfigInput => {
  const portStart = typeof options['port-start'] === 'string' ? Number(options['port-start']) : undefined;

  return {
    subscriptionUrl: typeof options['subscription-url'] === 'string' ? options['subscription-url'] : undefined,
    surgeConfigPath: typeof options['surge-config'] === 'string' ? options['surge-config'] : undefined,
    singBoxBinary: typeof options['sing-box-bin'] === 'string' ? options['sing-box-bin'] : undefined,
    outputDir: typeof options['output-dir'] === 'string' ? options['output-dir'] : undefined,
    backupDir: typeof options['backup-dir'] === 'string' ? options['backup-dir'] : undefined,
    policyGroupName: typeof options['group-name'] === 'string' ? options['group-name'] : undefined,
    portStart: Number.isFinite(portStart) ? portStart : undefined,
  };
};

const isUsingGlobalDefaultConfigPath = (configPath: string, hasExplicitConfigPath: boolean) => {
  if (hasExplicitConfigPath) {
    return false;
  }

  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    return false;
  }

  return configPath === resolve(home, HOME_CONFIG_FILE_PATH);
};

const main = async () => {
  const parsed = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
    console.log(HELP_TEXT);
    return;
  }

  if (parsed.command === 'init') {
    const hasExplicitConfigPath = typeof parsed.options.config === 'string';
    const { configPath, warnings } = await writeExampleConfig({
      cwd,
      configPath: hasExplicitConfigPath ? (parsed.options.config as string) : undefined,
      force: Boolean(parsed.options.force),
    });

    console.log(`Created config template: ${configPath}`);
    if (isUsingGlobalDefaultConfigPath(configPath, hasExplicitConfigPath)) {
      console.log(`Global install detected. Your config file is at: ${configPath}`);
    }
    for (const warning of warnings) {
      console.warn(`Warning: ${warning}`);
    }
    console.log('Fill subscriptionUrl before running `sync`.');
    return;
  }

  const loaded = await loadCliConfig({
    cwd,
    configPath: typeof parsed.options.config === 'string' ? parsed.options.config : undefined,
    overrides: toOverrides(parsed.options),
  });

  if (!loaded.exists) {
    console.log(`Config file not found: ${loaded.configPath}`);
    console.log('Run `surge-vless-bridge init` first, or pass all required flags directly.');
  }

  switch (parsed.command) {
    case 'sync': {
      const result = await syncSubscriptionToSurge(loaded.config);
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
    case 'doctor': {
      await runDoctor(loaded.config);
      break;
    }
    default:
      console.log(HELP_TEXT);
      process.exitCode = 1;
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
