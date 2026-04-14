import { lookup } from 'node:dns/promises';
import { mkdir, readdir } from 'node:fs/promises';
import { isIP } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';

import { getVlessSubscriptionNodes } from './parse';
import type { CliConfig } from './types/cli-config';
import type { SingBoxVlessOutbound } from './types/sing-box-vless-outbound';
import { parseTemplate } from './utils/parse-template';
import { pathExists, readJsonFile, readTextFile, writeBinaryFile, writeTextFile } from './utils/fs';
import { parseVlessNode } from './utils/parse-vless-node';

const POLICY_REGEX_FILTER = /^((?!Remain|Expired|官网|如需|套餐|去除|剩余|距离|Reset|重置|流量).)+$/;

type GeneratedNode = {
  nodeName: string;
  port: number;
  configPath: string;
  server: string;
};

type SingBoxConfig = {
  outbounds?: Array<{
    tag?: string;
    server?: string;
  }>;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sanitizePolicyName = (tag: string, index: number) => {
  const candidate = POLICY_REGEX_FILTER.test(tag) ? tag : `node${index + 1}`;
  const sanitized = candidate
    .replace(/[,\n\r=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || `node${index + 1}`;
};

const resolveAddresses = async (server: string) => {
  if (isIP(server)) {
    return [server];
  }

  try {
    const records = await lookup(server, { all: true });
    return [...new Set(records.map((record) => record.address))];
  } catch (error) {
    console.error(`Failed to resolve ${server}:`, error);
    return [];
  }
};

const buildExternalProxyLine = async ({
  nodeName,
  port,
  configPath,
  server,
  singBoxBinary,
}: GeneratedNode & { singBoxBinary: string }) => {
  const addresses = await resolveAddresses(server);
  const addressArg = addresses.length > 0 ? `, addresses=${addresses.join(',')}` : '';
  return `${nodeName} = external, exec=${singBoxBinary}, args=run, args=-c, args=${configPath}, local-port=${port}${addressArg}`;
};

const ensureRequiredConfig = (config: CliConfig) => {
  if (!config.subscriptionUrl) {
    throw new Error(
      'Missing subscriptionUrl. Run `surge-vless-bridge init` and fill the config, or pass --subscription-url.',
    );
  }

  if (!config.surgeConfigPath) {
    throw new Error(
      'Missing surgeConfigPath. Run `surge-vless-bridge init` and fill the config, or pass --surge-config.',
    );
  }
};

const ensureWritableDirs = async (config: CliConfig) => {
  await mkdir(config.outputDir, { recursive: true });
  await mkdir(config.backupDir, { recursive: true });
  await mkdir(dirname(config.subscriptionOutputPath), { recursive: true });
};

export const backupSurgeProfile = async (config: CliConfig) => {
  await mkdir(config.backupDir, { recursive: true });

  const bytes = await readJsonCompatibleBinary(config.surgeConfigPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(config.backupDir, `${basename(config.surgeConfigPath, '.conf')}-${timestamp}.conf`);

  await writeBinaryFile(backupPath, bytes);
  return backupPath;
};

const updatePolicyGroup = ({
  surgeText,
  policyGroupName,
  nodeNames,
}: {
  surgeText: string;
  policyGroupName: string;
  nodeNames: string[];
}) => {
  const sectionPattern = /(\[Proxy Group\])([\s\S]*?)(?=\n\[|$)/;
  const groupPattern = new RegExp(`^${escapeRegExp(policyGroupName)}\\s*=.*$`, 'm');
  const groupLine = `${policyGroupName} = url-test, ${nodeNames.join(', ')}, no-alert=0, hidden=0`;

  return surgeText.replace(sectionPattern, (match, sectionTitle, sectionBody) => {
    if (groupPattern.test(sectionBody)) {
      return `${sectionTitle}${sectionBody.replace(groupPattern, groupLine)}`;
    }

    return `${match}\n${groupLine}`;
  });
};

const updateProxyBlock = ({ surgeText, proxyLines }: { surgeText: string; proxyLines: string[] }) => {
  const proxyStartMarker = '# vless start';
  const proxyEndMarker = '# vless end';

  const blockPattern = new RegExp(
    `(${escapeRegExp(proxyStartMarker)})([\\s\\S]*?)(${escapeRegExp(proxyEndMarker)})`,
    'm',
  );

  if (surgeText.includes(proxyStartMarker) && surgeText.includes(proxyEndMarker)) {
    return surgeText.replace(blockPattern, (_, start, __, end) => `${start}\n${proxyLines.join('\n')}\n${end}`);
  }

  const proxySectionPattern = /(\[Proxy\])([\s\S]*?)(?=\n\[|$)/;
  const proxyBlock = `\n${proxyStartMarker}\n${proxyLines.join('\n')}\n${proxyEndMarker}`;

  if (!proxySectionPattern.test(surgeText)) {
    throw new Error('Surge profile is missing the [Proxy] section.');
  }

  return surgeText.replace(proxySectionPattern, (match) => {
    const trimmed = match.replace(/\s*$/, '');
    return `${trimmed}${proxyBlock}\n`;
  });
};

const writeSurgeProfile = async ({
  config,
  proxyLines,
  nodeNames,
}: {
  config: CliConfig;
  proxyLines: string[];
  nodeNames: string[];
}) => {
  const source = await readTextFile(config.surgeConfigPath);
  const withProxyBlock = updateProxyBlock({
    surgeText: source,
    proxyLines,
  });
  const withPolicyGroup = updatePolicyGroup({
    surgeText: withProxyBlock,
    policyGroupName: config.policyGroupName,
    nodeNames,
  });

  await writeTextFile(config.surgeConfigPath, withPolicyGroup);
};

const generateConfigsFromOutbounds = async ({
  outbounds,
  config,
}: {
  outbounds: SingBoxVlessOutbound[];
  config: CliConfig;
}) => {
  await ensureWritableDirs(config);

  const generated = await Promise.all(
    outbounds.map(async (outbound, index) => {
      const port = config.portStart + index;
      const nodeName = sanitizePolicyName(outbound.tag, index);
      const configPath = join(config.outputDir, `sing-box[${port}].json`);
      const serverConfig = parseTemplate({
        node: {
          ...outbound,
          tag: nodeName,
        },
        port,
      });

      await writeTextFile(configPath, `${JSON.stringify(serverConfig, null, 2)}\n`);

      return {
        nodeName,
        port,
        configPath,
        server: outbound.server,
      } satisfies GeneratedNode;
    }),
  );

  const proxyLines = await Promise.all(
    generated.map((entry) =>
      buildExternalProxyLine({
        ...entry,
        singBoxBinary: config.singBoxBinary,
      }),
    ),
  );

  return {
    generated,
    proxyLines,
    nodeNames: generated.map((entry) => entry.nodeName),
  };
};

export const syncSubscriptionToSurge = async (config: CliConfig) => {
  ensureRequiredConfig(config);

  const vlessNodes = await getVlessSubscriptionNodes({
    subscriptionUrl: config.subscriptionUrl!,
    requestHeaders: config.requestHeaders,
    subscriptionOutputPath: config.subscriptionOutputPath,
  });
  const outbounds = vlessNodes.map((node, index) => parseVlessNode(node, index));
  const generated = await generateConfigsFromOutbounds({ outbounds, config });
  const backupPath = await backupSurgeProfile(config);

  await writeSurgeProfile({
    config,
    proxyLines: generated.proxyLines,
    nodeNames: generated.nodeNames,
  });

  return {
    backupPath,
    count: generated.nodeNames.length,
  };
};

export const rebuildSurgeFromLocalConfigs = async (config: CliConfig) => {
  if (!config.surgeConfigPath) {
    throw new Error(
      'Missing surgeConfigPath. Run `surge-vless-bridge init` and fill the config, or pass --surge-config.',
    );
  }

  const entries = (await readdir(config.outputDir))
    .filter((entry) => /^sing-box\[\d+\]\.json$/.test(entry))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (entries.length === 0) {
    throw new Error(`No sing-box configs found in ${config.outputDir}`);
  }

  const generated = await Promise.all(
    entries.map(async (entry, index) => {
      const match = entry.match(/sing-box\[(\d+)\]\.json$/);
      if (!match) {
        return null;
      }

      const port = Number(match[1]);
      const configPath = join(config.outputDir, entry);
      const json = await readJsonFile<SingBoxConfig>(configPath);
      const outbound = json.outbounds?.[0];
      const rawTag = outbound?.tag;
      const nodeName = rawTag
        ?.replace(/[,\n\r=]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!nodeName || !outbound?.server) {
        console.error(`Skipping unusable config: ${configPath}`);
        return null;
      }

      return {
        nodeName: nodeName || `node${index + 1}`,
        port,
        configPath,
        server: outbound.server,
      } satisfies GeneratedNode;
    }),
  );

  const validEntries = generated.filter((entry): entry is GeneratedNode => Boolean(entry));
  if (validEntries.length === 0) {
    throw new Error(`No usable sing-box configs found in ${config.outputDir}`);
  }

  const proxyLines = await Promise.all(
    validEntries.map((entry) =>
      buildExternalProxyLine({
        ...entry,
        singBoxBinary: config.singBoxBinary,
      }),
    ),
  );

  const backupPath = await backupSurgeProfile(config);
  await writeSurgeProfile({
    config,
    proxyLines,
    nodeNames: validEntries.map((entry) => entry.nodeName),
  });

  return {
    backupPath,
    count: validEntries.length,
  };
};

export const restoreSurgeProfileBackup = async ({ config, backupPath }: { config: CliConfig; backupPath?: string }) => {
  const resolvedBackupPath = backupPath ? resolve(backupPath) : undefined;
  const targetPath = resolvedBackupPath ?? (await findLatestBackup(config.backupDir));

  if (!targetPath) {
    throw new Error(`No backup files found in ${config.backupDir}`);
  }

  await writeBinaryFile(config.surgeConfigPath, await readJsonCompatibleBinary(targetPath));
  return targetPath;
};

const readJsonCompatibleBinary = async (path: string) => {
  const { readFile } = await import('node:fs/promises');
  return readFile(path);
};

const findLatestBackup = async (backupDir: string) => {
  try {
    const entries = await readdir(backupDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.conf'))
      .map((entry) => join(backupDir, entry.name))
      .sort((left, right) => right.localeCompare(left));
    return files[0];
  } catch {
    return undefined;
  }
};

export const runDoctor = async (config: CliConfig) => {
  const checks = [
    ['subscriptionUrl', Boolean(config.subscriptionUrl), config.subscriptionUrl || 'missing'],
    [
      'surgeConfigPath',
      Boolean(config.surgeConfigPath) && (await pathExists(config.surgeConfigPath)),
      config.surgeConfigPath || 'missing',
    ],
    [
      'singBoxBinary',
      Boolean(config.singBoxBinary) && (await pathExists(config.singBoxBinary)),
      config.singBoxBinary || 'missing',
    ],
    ['outputDir', true, config.outputDir],
    ['backupDir', true, config.backupDir],
  ] as const;

  for (const [label, ok, value] of checks) {
    console.log(`${ok ? 'OK' : 'FAIL'} ${label}: ${value}`);
  }

  if (config.surgeConfigPath) {
    if (await pathExists(config.surgeConfigPath)) {
      const text = await readTextFile(config.surgeConfigPath);

      console.log(`${text.includes('[Proxy Group]') ? 'OK' : 'FAIL'} proxy-group-section: [Proxy Group]`);
      console.log(`${text.includes('[Proxy]') ? 'OK' : 'FAIL'} proxy-section: [Proxy]`);
    }
  }
};
