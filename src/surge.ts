import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Resolver, lookup } from 'node:dns/promises';
import { readFile, readdir, rename, rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { getVlessSubscriptionNodes } from './parse';
import type { AddressResolverConfig, CliConfig } from './types/cli-config';
import type { SingBoxVlessOutbound } from './types/sing-box-vless-outbound';
import { parseTemplate } from './utils/parse-template';
import {
  ensurePrivateDirectory,
  pathExists,
  readJsonFile,
  readTextFile,
  writeBinaryFile,
  writeTextFile,
} from './utils/fs';
import { parseVlessNode } from './utils/parse-vless-node';

const POLICY_REGEX_FILTER = /^((?!Remain|Expired|官网|如需|套餐|去除|剩余|距离|Reset|重置|流量).)+$/;
const MANAGED_CONFIG_PATTERN = /^sing-box\[\d+\]\.json$/;
const MANIFEST_FILE_NAME = 'manifest.json';
const DOH_RECORD_TYPES = {
  A: 1,
  AAAA: 28,
} as const;

type GeneratedNode = {
  nodeName: string;
  port: number;
  configPath: string;
  server: string;
};

type StagedGeneratedNode = GeneratedNode & {
  stagedConfigPath: string;
};

type ManagedConfigManifest = {
  version: 1;
  files: string[];
};

type SingBoxConfig = {
  outbounds?: Array<{
    tag?: string;
    server?: string;
  }>;
};

const execFileAsync = promisify(execFile);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isSurgeFakeIp = (address: string) => {
  if (isIP(address) !== 4) {
    return false;
  }

  const [first, second] = address.split('.').map((part) => Number(part));
  return first === 198 && (second === 18 || second === 19);
};

const uniqueRealAddresses = (addresses: string[], resolverConfig: AddressResolverConfig) => [
  ...new Set(
    addresses.filter((address) => isIP(address) && (!resolverConfig.filterSurgeFakeIp || !isSurgeFakeIp(address))),
  ),
];

const resolveWithSystem = async (server: string) => {
  const records = await lookup(server, { all: true });
  return records.map((record) => record.address);
};

const resolveWithDnsServers = async (server: string, dnsServers: string[]) => {
  const resolver = new Resolver();
  if (dnsServers.length > 0) {
    resolver.setServers(dnsServers);
  }

  const settled = await Promise.allSettled([resolver.resolve4(server), resolver.resolve6(server)]);
  return settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
};

const queryDohAddresses = async (server: string, recordType: keyof typeof DOH_RECORD_TYPES, dohEndpoint: string) => {
  const url = new URL(dohEndpoint);
  url.searchParams.set('name', server);
  url.searchParams.set('type', recordType);

  const response = await fetch(url, {
    headers: {
      accept: 'application/dns-json',
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    Answer?: Array<{
      type?: number;
      data?: string;
    }>;
  };

  if (!Array.isArray(payload.Answer)) {
    return [];
  }

  const answerType = DOH_RECORD_TYPES[recordType];
  return payload.Answer.filter((answer) => answer.type === answerType && typeof answer.data === 'string').map(
    (answer) => answer.data as string,
  );
};

const resolveWithDoh = async (server: string, dohEndpoint: string) => {
  const settled = await Promise.allSettled([
    queryDohAddresses(server, 'A', dohEndpoint),
    queryDohAddresses(server, 'AAAA', dohEndpoint),
  ]);
  return settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
};

const sanitizePolicyName = (tag: string, index: number) => {
  const candidate = POLICY_REGEX_FILTER.test(tag) ? tag : `node${index + 1}`;
  const sanitized = candidate
    .replace(/[,\n\r=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || `node${index + 1}`;
};

const resolveAddresses = async (server: string, resolverConfig: AddressResolverConfig) => {
  if (resolverConfig.strategy === 'off') {
    return [];
  }

  if (isIP(server)) {
    return uniqueRealAddresses([server], resolverConfig);
  }

  try {
    if (resolverConfig.strategy === 'doh') {
      const dohAddresses = uniqueRealAddresses(
        await resolveWithDoh(server, resolverConfig.dohEndpoint),
        resolverConfig,
      );
      if (dohAddresses.length > 0) {
        return dohAddresses;
      }

      return uniqueRealAddresses(await resolveWithDnsServers(server, resolverConfig.dnsServers), resolverConfig);
    }

    if (resolverConfig.strategy === 'dns') {
      return uniqueRealAddresses(await resolveWithDnsServers(server, resolverConfig.dnsServers), resolverConfig);
    }

    return uniqueRealAddresses(await resolveWithSystem(server), resolverConfig);
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
  addressResolver,
}: GeneratedNode & { singBoxBinary: string; addressResolver: AddressResolverConfig }) => {
  const addresses = await resolveAddresses(server, addressResolver);
  const addressArg = addresses.length > 0 ? `, addresses=${addresses[0]}` : '';
  return `${nodeName} = external, exec=${singBoxBinary}, args=run, args=-c, args=${configPath}, local-port=${port}${addressArg}`;
};

const ensureRuntimePaths = async (config: CliConfig) => {
  if (!config.surgeConfigPath || !(await pathExists(config.surgeConfigPath))) {
    throw new Error(`Surge profile not found: ${config.surgeConfigPath || 'missing'}`);
  }

  if (!config.singBoxBinary || !(await pathExists(config.singBoxBinary))) {
    throw new Error(`sing-box binary not found: ${config.singBoxBinary || 'missing'}`);
  }
};

const ensureRequiredConfig = async (config: CliConfig) => {
  if (!config.subscriptionUrl) {
    throw new Error(
      'Missing subscriptionUrl. Run `surge-vless-bridge init` and fill the config, or pass --subscription-url.',
    );
  }

  await ensureRuntimePaths(config);
};

const ensureSafeManagedDirectory = (path: string, label: string) => {
  const resolvedPath = resolve(path);
  if (resolvedPath === resolve('/') || resolvedPath === resolve(homedir())) {
    throw new Error(`${label} must be a dedicated subdirectory, not ${resolvedPath}`);
  }
};

const ensureWritableDirs = async (config: CliConfig) => {
  ensureSafeManagedDirectory(config.outputDir, 'outputDir');
  ensureSafeManagedDirectory(config.backupDir, 'backupDir');
  await ensurePrivateDirectory(config.outputDir);
  await ensurePrivateDirectory(config.backupDir);
};

const validateSingBoxConfig = async (singBoxBinary: string, configPath: string) => {
  try {
    await execFileAsync(singBoxBinary, ['check', '-c', configPath], {
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
    });
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : String(error);
    const detail = stderr ? `: ${stderr}` : '';
    throw new Error(`sing-box rejected ${basename(configPath)}${detail}`);
  }
};

const readManagedConfigEntries = async (outputDir: string) => {
  const manifestPath = join(outputDir, MANIFEST_FILE_NAME);
  if (await pathExists(manifestPath)) {
    const manifest = await readJsonFile<ManagedConfigManifest>(manifestPath);
    if (
      manifest.version !== 1 ||
      !Array.isArray(manifest.files) ||
      manifest.files.length === 0 ||
      manifest.files.some((entry) => !MANAGED_CONFIG_PATTERN.test(entry))
    ) {
      throw new Error(`Invalid managed config manifest: ${manifestPath}`);
    }

    return [...new Set(manifest.files)].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }

  return (await readdir(outputDir))
    .filter((entry) => MANAGED_CONFIG_PATTERN.test(entry))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
};

const promoteGeneratedConfigs = async (config: CliConfig, generated: StagedGeneratedNode[]) => {
  const files = generated.map((entry) => basename(entry.configPath));
  for (const entry of generated) {
    await rename(entry.stagedConfigPath, entry.configPath);
  }

  const manifest: ManagedConfigManifest = { version: 1, files };
  await writeTextFile(join(config.outputDir, MANIFEST_FILE_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
};

const removeStaleConfigs = async (outputDir: string, generated: GeneratedNode[]) => {
  const expected = new Set(generated.map((entry) => basename(entry.configPath)));
  const staleFiles = (await readdir(outputDir)).filter(
    (entry) => MANAGED_CONFIG_PATTERN.test(entry) && !expected.has(entry),
  );

  await Promise.all(staleFiles.map((entry) => rm(join(outputDir, entry), { force: true })));
};

export const backupSurgeProfile = async (config: CliConfig) => {
  ensureSafeManagedDirectory(config.backupDir, 'backupDir');
  await ensurePrivateDirectory(config.backupDir);

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
  stagingDir,
}: {
  outbounds: SingBoxVlessOutbound[];
  config: CliConfig;
  stagingDir: string;
}) => {
  const nodeNames = outbounds.map((outbound, index) => sanitizePolicyName(outbound.tag, index));
  const duplicateNodeName = nodeNames.find((nodeName, index) => nodeNames.indexOf(nodeName) !== index);
  if (duplicateNodeName) {
    throw new Error(`Duplicate proxy name after sanitization: ${duplicateNodeName}`);
  }

  const generated = await Promise.all(
    outbounds.map(async (outbound, index) => {
      const port = config.portStart + index;
      const nodeName = nodeNames[index]!;
      const configPath = join(config.outputDir, `sing-box[${port}].json`);
      const stagedConfigPath = join(stagingDir, `sing-box[${port}].json`);
      const serverConfig = parseTemplate({
        node: {
          ...outbound,
          tag: nodeName,
        },
        port,
      });

      await writeTextFile(stagedConfigPath, `${JSON.stringify(serverConfig, null, 2)}\n`);
      await validateSingBoxConfig(config.singBoxBinary, stagedConfigPath);

      return {
        nodeName,
        port,
        configPath,
        stagedConfigPath,
        server: outbound.server,
      } satisfies StagedGeneratedNode;
    }),
  );

  const proxyLines = await Promise.all(
    generated.map((entry) =>
      buildExternalProxyLine({
        ...entry,
        singBoxBinary: config.singBoxBinary,
        addressResolver: config.addressResolver,
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
  await ensureRequiredConfig(config);
  await ensureWritableDirs(config);

  const stagingDir = join(config.outputDir, `.staging-${randomUUID()}`);
  await ensurePrivateDirectory(stagingDir);

  try {
    const vlessNodes = await getVlessSubscriptionNodes({
      subscriptionUrl: config.subscriptionUrl!,
      requestHeaders: config.requestHeaders,
      subscriptionOutputPath: config.subscriptionOutputPath,
    });
    const outbounds = vlessNodes.map((node, index) => parseVlessNode(node, index));
    const generated = await generateConfigsFromOutbounds({ outbounds, config, stagingDir });
    const backupPath = await backupSurgeProfile(config);

    await promoteGeneratedConfigs(config, generated.generated);
    await writeSurgeProfile({
      config,
      proxyLines: generated.proxyLines,
      nodeNames: generated.nodeNames,
    });
    await removeStaleConfigs(config.outputDir, generated.generated);

    return {
      backupPath,
      count: generated.nodeNames.length,
    };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
};

export const rebuildSurgeFromLocalConfigs = async (config: CliConfig) => {
  await ensureRuntimePaths(config);

  const entries = await readManagedConfigEntries(config.outputDir);
  if (entries.length === 0) {
    throw new Error(`No sing-box configs found in ${config.outputDir}`);
  }

  const generated = await Promise.all(
    entries.map(async (entry) => {
      const match = entry.match(/sing-box\[(\d+)\]\.json$/);
      if (!match) {
        return null;
      }

      const port = Number(match[1]);
      const configPath = join(config.outputDir, entry);
      await validateSingBoxConfig(config.singBoxBinary, configPath);
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
        nodeName,
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
        addressResolver: config.addressResolver,
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

const readJsonCompatibleBinary = (path: string) => readFile(path);

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
  const outputDirExists = await pathExists(config.outputDir);
  const backupDirExists = await pathExists(config.backupDir);
  const checks = [
    ['subscriptionUrl', Boolean(config.subscriptionUrl), config.subscriptionUrl ? '[configured]' : 'missing'],
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
    ['outputDir', outputDirExists, config.outputDir],
    ['backupDir', backupDirExists, config.backupDir],
  ] as const;

  let failureCount = 0;
  for (const [label, ok, value] of checks) {
    console.log(`${ok ? 'OK' : 'FAIL'} ${label}: ${value}`);
    if (!ok) {
      failureCount += 1;
    }
  }

  if (config.surgeConfigPath) {
    if (await pathExists(config.surgeConfigPath)) {
      const text = await readTextFile(config.surgeConfigPath);

      const hasProxyGroup = text.includes('[Proxy Group]');
      const hasProxySection = text.includes('[Proxy]');
      console.log(`${hasProxyGroup ? 'OK' : 'FAIL'} proxy-group-section: [Proxy Group]`);
      console.log(`${hasProxySection ? 'OK' : 'FAIL'} proxy-section: [Proxy]`);
      failureCount += Number(!hasProxyGroup) + Number(!hasProxySection);
    }
  }

  if (outputDirExists && (await pathExists(config.singBoxBinary))) {
    try {
      const entries = await readManagedConfigEntries(config.outputDir);
      if (entries.length === 0) {
        console.log(`FAIL sing-box-configs: no managed configs found in ${config.outputDir}`);
        failureCount += 1;
      } else {
        await Promise.all(
          entries.map((entry) => validateSingBoxConfig(config.singBoxBinary, join(config.outputDir, entry))),
        );
        console.log(`OK sing-box-configs: ${entries.length} valid`);
      }
    } catch (error) {
      console.log(`FAIL sing-box-configs: ${error instanceof Error ? error.message : String(error)}`);
      failureCount += 1;
    }
  }

  if (failureCount > 0) {
    throw new Error(`Doctor found ${failureCount} problem${failureCount === 1 ? '' : 's'}.`);
  }
};
