import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import type { CliConfig, CliConfigInput } from './types/cli-config';
import { pathExists, readJsonFile, writeTextFile } from './utils/fs';

export const CONFIG_FILE_NAME = '.surge-vless-bridge.json';

const DEFAULT_HEADERS = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'accept-language': 'en,zh-CN;q=0.9,zh;q=0.8',
  'upgrade-insecure-requests': '1',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
} as const;

const detectSingBoxBinary = () => {
  const result = spawnSync('which', ['sing-box'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.status === 0) {
    return result.stdout.trim();
  }

  return '/opt/homebrew/bin/sing-box';
};

const detectSurgeConfigPath = async () => {
  const home = process.env.HOME;
  if (!home) {
    return '';
  }

  const profilesDir = join(home, 'Library/Application Support/Surge/Profiles');

  try {
    const entries = await readdir(profilesDir, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.conf'))
      .map((entry) => entry.name)
      .sort((left, right) => {
        const leftScore = Number(left.includes('Smart'));
        const rightScore = Number(right.includes('Smart'));
        return rightScore - leftScore || left.localeCompare(right);
      });

    return candidates[0] ? join(profilesDir, candidates[0]) : '';
  } catch {
    return '';
  }
};

export const getDefaultConfig = async (_cwd: string): Promise<CliConfig> => {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  const stateDir = join(home, '.config', 'surge-vless-bridge');

  return {
    subscriptionUrl: '',
    surgeConfigPath: await detectSurgeConfigPath(),
    singBoxBinary: detectSingBoxBinary(),
    outputDir: join(stateDir, 'config'),
    backupDir: join(stateDir, 'backups'),
    policyGroupName: 'VLESS',
    proxyStartMarker: '# vless start',
    proxyEndMarker: '# vless end',
    portStart: 2081,
    subscriptionOutputPath: join(stateDir, 'vless_nodes.txt'),
    requestHeaders: { ...DEFAULT_HEADERS },
  };
};

const mergeConfig = (base: CliConfig, input?: CliConfigInput): CliConfig => {
  if (!input) {
    return base;
  }

  const definedEntries = Object.entries(input).filter(([, value]) => value !== undefined);
  const sanitizedInput = Object.fromEntries(definedEntries) as CliConfigInput;

  return {
    ...base,
    ...sanitizedInput,
    requestHeaders: {
      ...base.requestHeaders,
      ...(sanitizedInput.requestHeaders ?? {}),
    },
  };
};

export const loadCliConfig = async ({
  cwd,
  configPath,
  overrides,
}: {
  cwd: string;
  configPath?: string;
  overrides?: CliConfigInput;
}) => {
  const defaults = await getDefaultConfig(cwd);
  const resolvedConfigPath = configPath ? resolve(cwd, configPath) : resolve(cwd, CONFIG_FILE_NAME);

  if (!(await pathExists(resolvedConfigPath))) {
    return {
      config: mergeConfig(defaults, overrides),
      configPath: resolvedConfigPath,
      exists: false,
    };
  }

  const parsed = await readJsonFile<CliConfigInput>(resolvedConfigPath);
  return {
    config: mergeConfig(mergeConfig(defaults, parsed), overrides),
    configPath: resolvedConfigPath,
    exists: true,
  };
};

export const writeExampleConfig = async ({
  cwd,
  configPath,
  force,
}: {
  cwd: string;
  configPath?: string;
  force?: boolean;
}) => {
  const defaults = await getDefaultConfig(cwd);
  const resolvedConfigPath = configPath ? resolve(cwd, configPath) : resolve(cwd, CONFIG_FILE_NAME);

  if (!force && (await pathExists(resolvedConfigPath))) {
    throw new Error(`Config file already exists: ${resolvedConfigPath}`);
  }

  const example: CliConfigInput = {
    subscriptionUrl: '',
    surgeConfigPath: defaults.surgeConfigPath,
    policyGroupName: defaults.policyGroupName,
    portStart: defaults.portStart,
  };

  await writeTextFile(resolvedConfigPath, `${JSON.stringify(example, null, 2)}\n`);
  return resolvedConfigPath;
};
