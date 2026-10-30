import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Resolver, lookup } from 'node:dns/promises';
import { chmod, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { isIP } from 'node:net';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { getVlessSubscriptionNodes } from './parse';
import type { AddressResolverConfig, CliConfig } from './types/cli-config';
import type { SingBoxVlessOutbound } from './types/sing-box-vless-outbound';
import {
  isReadableByOthers,
  pathExists,
  readJsonFile,
  readTextFile,
  replaceBinaryFile,
  replaceTextFile,
  writeBinaryFile,
  writeTextFile,
} from './utils/fs';
import {
  LAUNCHER_FILE_NAME,
  LAUNCHER_SCRIPT,
  SHARED_CONFIG_FILE_NAME,
  isSharedSingBoxRunning,
  stopSharedSingBox,
} from './utils/launcher';
import { parseTemplate } from './utils/parse-template';
import { parseVlessNode } from './utils/parse-vless-node';
import { findSurgeCli, parseHttpApiSettings, reloadSurgeProfile } from './utils/surge-reload';

const POLICY_REGEX_FILTER = /^((?!Remain|Expired|官网|如需|套餐|去除|剩余|距离|Reset|重置|流量).)+$/;
// Left behind by releases that ran one sing-box per node; removed by the first sync or clean.
const LEGACY_CONFIG_PATTERN = /^sing-box\[\d+\]\.json$/;
const LEGACY_MANIFEST_FILE_NAME = 'manifest.json';
const SING_BOX_CHECK_TIMEOUT_MS = 15_000;
const DOH_RECORD_TYPES = {
  A: 1,
  AAAA: 28,
} as const;

type GeneratedNode = {
  nodeName: string;
  port: number;
  server: string;
};

type SingBoxConfig = {
  inbounds?: Array<{
    tag?: string;
    listen_port?: number;
  }>;
  outbounds?: Array<{
    tag?: string;
    server?: string;
  }>;
  route?: {
    rules?: Array<{
      inbound?: string[];
      outbound?: string;
    }>;
  };
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

// Surge accepts a single value in `addresses=`, and A/AAAA records arrive in an unstable order.
// IPv4 comes first so the written address is deterministic and usable on IPv4-only networks.
const uniqueRealAddresses = (addresses: string[], resolverConfig: AddressResolverConfig) =>
  [
    ...new Set(
      addresses.filter((address) => isIP(address) && (!resolverConfig.filterSurgeFakeIp || !isSurgeFakeIp(address))),
    ),
  ].sort((left, right) => Number(isIP(right) === 4) - Number(isIP(left) === 4));

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

type ResolverAttempt = {
  label: string;
  run: () => Promise<string[]>;
};

const ensureUniquePolicyName = (nodeName: string, seenNames: Map<string, number>) => {
  const previousCount = seenNames.get(nodeName) ?? 0;
  seenNames.set(nodeName, previousCount + 1);

  if (previousCount === 0) {
    return nodeName;
  }

  return `${nodeName} ${previousCount + 1}`;
};

// `subscriptionUrl` and `subscriptionUrls` are merged rather than one shadowing the other: a user
// adding a second provider usually keeps the legacy single-URL field, and dropping it silently would
// remove every node of their original subscription. The legacy field stays first so existing node
// order, and therefore the assigned local ports, do not shift.
const getSubscriptionUrls = (config: CliConfig) => {
  const urls = [config.subscriptionUrl, ...(config.subscriptionUrls ?? [])];

  return [
    ...new Set(
      urls.filter((url): url is string => typeof url === 'string' && url.trim() !== '').map((url) => url.trim()),
    ),
  ];
};

const getConfiguredVlessNodes = (config: CliConfig) =>
  (config.vlessNodes ?? [])
    .filter((node): node is string => typeof node === 'string' && node.trim() !== '')
    .map((node) => node.trim());

const resolveAddresses = async (server: string, resolverConfig: AddressResolverConfig) => {
  if (resolverConfig.strategy === 'off') {
    return [];
  }

  if (isIP(server)) {
    return uniqueRealAddresses([server], resolverConfig);
  }

  const doh: ResolverAttempt = {
    label: 'doh',
    run: () => resolveWithDoh(server, resolverConfig.dohEndpoint),
  };
  const dns: ResolverAttempt = {
    label: 'dns',
    run: () => resolveWithDnsServers(server, resolverConfig.dnsServers),
  };
  const system: ResolverAttempt = {
    label: 'system',
    run: () => resolveWithSystem(server),
  };

  // Surge's enhanced mode answers system DNS with fake IPs (198.18.0.0/15), which would pin an
  // unusable address into the external proxy line. Every strategy therefore falls back to the
  // resolvers that bypass the system resolver before giving up.
  const chain: ResolverAttempt[] =
    resolverConfig.strategy === 'dns'
      ? [dns, doh, system]
      : resolverConfig.strategy === 'system'
        ? [system, doh, dns]
        : [doh, dns, system];

  let sawFakeIp = false;

  for (const attempt of chain) {
    let addresses: string[];
    try {
      addresses = await attempt.run();
    } catch (error) {
      console.error(`Failed to resolve ${server} via ${attempt.label}:`, error);
      continue;
    }

    const usable = uniqueRealAddresses(addresses, resolverConfig);
    if (usable.length > 0) {
      if (sawFakeIp) {
        console.warn(`Resolved ${server} via ${attempt.label} after discarding Surge fake IP results.`);
      }

      return usable;
    }

    if (resolverConfig.filterSurgeFakeIp && addresses.some(isSurgeFakeIp)) {
      sawFakeIp = true;
      console.warn(
        `Discarded Surge fake IP result for ${server} from ${attempt.label}; trying the next resolver.`,
      );
    }
  }

  console.error(`Failed to resolve a usable address for ${server}; the external proxy entry will omit addresses=.`);
  return [];
};

// Every node runs the same launcher, which shares one sing-box between them; see utils/launcher.ts.
const buildExternalProxyLine = async ({
  nodeName,
  port,
  server,
  config,
}: GeneratedNode & { config: CliConfig }) => {
  const addresses = await resolveAddresses(server, config.addressResolver);
  const addressArg = addresses.length > 0 ? `, addresses=${addresses[0]}` : '';
  const launcherPath = join(config.outputDir, LAUNCHER_FILE_NAME);
  return `${nodeName} = external, exec=/bin/sh, args=${launcherPath}, args=${config.singBoxBinary}, local-port=${port}${addressArg}`;
};

const buildProxyLines = (generated: GeneratedNode[], config: CliConfig) =>
  Promise.all(generated.map((entry) => buildExternalProxyLine({ ...entry, config })));

const ensureRequiredConfig = (config: CliConfig) => {
  if (getSubscriptionUrls(config).length === 0 && getConfiguredVlessNodes(config).length === 0) {
    throw new Error(
      'Missing subscriptionUrl/subscriptionUrls/vlessNodes. Run `surge-vless-bridge init` and fill the config, or pass --subscription-url.',
    );
  }

  if (!config.surgeConfigPath) {
    throw new Error(
      'Missing surgeConfigPath. Run `surge-vless-bridge init` and fill the config, or pass --surge-config.',
    );
  }
};

// Checked before anything is generated: a wrong sing-box path produces nodes Surge can never start,
// and the failure is far easier to understand here than as a Surge popup.
const ensureRuntimePaths = async (config: CliConfig) => {
  if (!config.surgeConfigPath || !(await pathExists(config.surgeConfigPath))) {
    throw new Error(`Surge profile not found: ${config.surgeConfigPath || 'missing'}`);
  }

  if (!config.singBoxBinary || !(await pathExists(config.singBoxBinary))) {
    throw new Error(`sing-box binary not found: ${config.singBoxBinary || 'missing'}`);
  }
};

const ensureWritableDirs = async (config: CliConfig) => {
  await mkdir(config.outputDir, { recursive: true, mode: 0o700 });
  await mkdir(config.backupDir, { recursive: true, mode: 0o700 });
};

// `sing-box check` validates structure only: it rejects malformed JSON, unknown outbound types and
// out-of-range values, but accepts an outbound with missing or nonsensical fields. It is a guard
// against this tool generating structurally broken configs, not a connectivity test.
const validateSingBoxConfig = async (singBoxBinary: string, configPath: string) => {
  try {
    await execFileAsync(singBoxBinary, ['check', '-c', configPath], {
      maxBuffer: 1024 * 1024,
      timeout: SING_BOX_CHECK_TIMEOUT_MS,
    });
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : String(error);
    throw new Error(`sing-box rejected ${basename(configPath)}${stderr ? `: ${stderr}` : ''}`);
  }
};

const sharedConfigPath = (outputDir: string) => join(outputDir, SHARED_CONFIG_FILE_NAME);

// The shared config is the record of what the last sync produced: each node's port comes from the
// inbound its route rule pins it to, so `rebuild` reproduces exactly the nodes and ports Surge expects.
const readSharedConfigNodes = async (outputDir: string) => {
  const configPath = sharedConfigPath(outputDir);
  const json = await readJsonFile<SingBoxConfig>(configPath);
  const inbounds = json.inbounds ?? [];
  const rules = json.route?.rules ?? [];

  return (json.outbounds ?? [])
    .map((outbound) => {
      const nodeName = outbound.tag
        ?.replace(/[,\n\r=]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const inboundTag = rules.find((rule) => rule.outbound === outbound.tag)?.inbound?.[0];
      const port = inbounds.find((inbound) => inbound.tag === inboundTag)?.listen_port;

      if (!nodeName || !outbound.server || typeof port !== 'number') {
        console.error(`Skipping unusable outbound ${outbound.tag ?? '(untagged)'} in ${configPath}`);
        return null;
      }

      return { nodeName, port, server: outbound.server } satisfies GeneratedNode;
    })
    .filter((entry): entry is GeneratedNode => Boolean(entry));
};

const readSharedConfigNodesIfPresent = async (outputDir: string) =>
  (await pathExists(sharedConfigPath(outputDir))) ? readSharedConfigNodes(outputDir).catch(() => []) : [];

const writeLauncher = async (path: string) => {
  await writeTextFile(path, LAUNCHER_SCRIPT);
  await chmod(path, 0o755);
};

const removeLegacyConfigs = async (outputDir: string) => {
  const legacy = (await readdir(outputDir).catch(() => [])).filter(
    (entry) => LEGACY_CONFIG_PATTERN.test(entry) || entry === LEGACY_MANIFEST_FILE_NAME,
  );

  await Promise.all(legacy.map((entry) => rm(join(outputDir, entry), { force: true })));
  return legacy.filter((entry) => entry !== LEGACY_MANIFEST_FILE_NAME).length;
};

// Every sync, rebuild and clean writes a backup, so without pruning the directory grows without
// bound: a daily sync leaves 365 profiles behind in a year.
const pruneBackups = async (backupDir: string, keep: number) => {
  if (!Number.isFinite(keep) || keep <= 0) {
    return 0;
  }

  const backups = await listBackups(backupDir);
  const stale = backups.slice(keep);
  await Promise.all(stale.map((path) => rm(path, { force: true })));
  return stale.length;
};

export const backupSurgeProfile = async (config: CliConfig) => {
  await mkdir(config.backupDir, { recursive: true, mode: 0o700 });

  const bytes = await readJsonCompatibleBinary(config.surgeConfigPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(config.backupDir, `${basename(config.surgeConfigPath, '.conf')}-${timestamp}.conf`);

  await writeBinaryFile(backupPath, bytes);
  await pruneBackups(config.backupDir, config.backupKeep);
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

const removeLegacyManagedProxyLines = ({ surgeText, outputDir }: { surgeText: string; outputDir: string }) => {
  const proxySectionPattern = /(\[Proxy\])([\s\S]*?)(?=\n\[|$)/;
  const normalizedOutputDir = outputDir.replace(/\\/g, '/');

  return surgeText.replace(proxySectionPattern, (_match: string, sectionTitle: string, sectionBody: string) => {
    let insideManagedBlock = false;
    const cleanedLines = sectionBody.split('\n').filter((line: string) => {
      if (line.includes('# vless start')) {
        insideManagedBlock = true;
        return true;
      }

      if (line.includes('# vless end')) {
        insideManagedBlock = false;
        return true;
      }

      if (insideManagedBlock) {
        return true;
      }

      const normalizedLine = line.replace(/\\/g, '/');
      const isLegacyManagedProxy =
        normalizedLine.includes('= external') &&
        normalizedLine.includes(normalizedOutputDir) &&
        /sing-box\[\d+\]\.json/.test(normalizedLine);

      return !isLegacyManagedProxy;
    });

    return `${sectionTitle}${cleanedLines.join('\n')}`;
  });
};

const updateProxyBlock = ({
  surgeText,
  proxyLines,
  outputDir,
}: {
  surgeText: string;
  proxyLines: string[];
  outputDir: string;
}) => {
  const proxyStartMarker = '# vless start';
  const proxyEndMarker = '# vless end';
  const cleanedSurgeText = removeLegacyManagedProxyLines({ surgeText, outputDir });

  const blockPattern = new RegExp(
    `(${escapeRegExp(proxyStartMarker)})([\\s\\S]*?)(${escapeRegExp(proxyEndMarker)})`,
    'm',
  );

  if (cleanedSurgeText.includes(proxyStartMarker) && cleanedSurgeText.includes(proxyEndMarker)) {
    return cleanedSurgeText.replace(blockPattern, (_, start, __, end) => `${start}\n${proxyLines.join('\n')}\n${end}`);
  }

  const proxySectionPattern = /(\[Proxy\])([\s\S]*?)(?=\n\[|$)/;
  const proxyBlock = `\n${proxyStartMarker}\n${proxyLines.join('\n')}\n${proxyEndMarker}`;

  if (!proxySectionPattern.test(cleanedSurgeText)) {
    throw new Error('Surge profile is missing the [Proxy] section.');
  }

  return cleanedSurgeText.replace(proxySectionPattern, (match) => {
    const trimmed = match.replace(/\s*$/, '');
    return `${trimmed}${proxyBlock}\n`;
  });
};

const buildSurgeProfile = async ({
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
    outputDir: config.outputDir,
  });

  return {
    source,
    updated: updatePolicyGroup({
      surgeText: withProxyBlock,
      policyGroupName: config.policyGroupName,
      nodeNames,
    }),
  };
};

const writeSurgeProfile = async (params: { config: CliConfig; proxyLines: string[]; nodeNames: string[] }) => {
  const { updated } = await buildSurgeProfile(params);
  await replaceTextFile(params.config.surgeConfigPath, updated);
  return updated;
};

const maybeReloadSurge = async (config: CliConfig, surgeText: string) => {
  if (!config.autoReload) {
    return;
  }

  const { reloaded, via } = await reloadSurgeProfile(surgeText);
  if (reloaded) {
    console.log(`Surge profile reloaded via ${via}.`);
  }
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
  const seenNodeNames = new Map<string, number>();
  const nodes = outbounds.map((outbound, index) => {
    const nodeName = ensureUniquePolicyName(sanitizePolicyName(outbound.tag, index), seenNodeNames);
    return { outbound: { ...outbound, tag: nodeName }, port: config.portStart + index };
  });

  const stagedConfigPath = join(stagingDir, SHARED_CONFIG_FILE_NAME);
  await writeTextFile(stagedConfigPath, `${JSON.stringify(parseTemplate(nodes), null, 2)}\n`);
  await writeLauncher(join(stagingDir, LAUNCHER_FILE_NAME));

  // Checked here, before Surge is touched: with every node in one process, a config sing-box rejects
  // would take all nodes down at once rather than one.
  await validateSingBoxConfig(config.singBoxBinary, stagedConfigPath);

  const generated = nodes.map(
    ({ outbound, port }) => ({ nodeName: outbound.tag, port, server: outbound.server }) satisfies GeneratedNode,
  );

  return {
    generated,
    proxyLines: await buildProxyLines(generated, config),
    nodeNames: generated.map((entry) => entry.nodeName),
  };
};

// Both files are renamed into place, so a launcher Surge starts mid-sync sees either the old config
// or the new one, never a partial write.
const promoteGeneratedConfigs = async (config: CliConfig, stagingDir: string) => {
  for (const name of [LAUNCHER_FILE_NAME, SHARED_CONFIG_FILE_NAME]) {
    await rename(join(stagingDir, name), join(config.outputDir, name));
  }
};

const reportDryRun = async ({
  config,
  generated,
}: {
  config: CliConfig;
  generated: { generated: GeneratedNode[]; proxyLines: string[]; nodeNames: string[] };
}) => {
  const { source, updated } = await buildSurgeProfile({
    config,
    proxyLines: generated.proxyLines,
    nodeNames: generated.nodeNames,
  });

  console.log(`Would write ${generated.nodeNames.length} nodes:`);
  for (const entry of generated.generated) {
    console.log(`  ${String(entry.port).padEnd(6)} ${entry.nodeName}`);
  }

  const existing = new Set((await readSharedConfigNodesIfPresent(config.outputDir)).map((entry) => entry.nodeName));
  const expected = new Set(generated.nodeNames);
  const added = [...expected].filter((entry) => !existing.has(entry)).length;
  const removed = [...existing].filter((entry) => !expected.has(entry)).length;

  console.log(`Nodes: +${added} / -${removed} in ${sharedConfigPath(config.outputDir)}`);
  console.log(
    updated === source
      ? `Surge profile unchanged: ${config.surgeConfigPath}`
      : `Surge profile would change: ${config.surgeConfigPath}`,
  );
  console.log(`Policy group: ${config.policyGroupName} = url-test, ${generated.nodeNames.join(', ')}`);
};

export const cleanManagedArtifacts = async (config: CliConfig) => {
  if (!config.surgeConfigPath || !(await pathExists(config.surgeConfigPath))) {
    throw new Error(`Surge profile not found: ${config.surgeConfigPath || 'missing'}`);
  }

  const backupPath = await backupSurgeProfile(config);
  const source = await readTextFile(config.surgeConfigPath);

  // Drops the managed block and the generated policy group, leaving the rest of the profile as is.
  const withoutBlock = source.replace(
    new RegExp(`\\n?${escapeRegExp(config.proxyStartMarker)}[\\s\\S]*?${escapeRegExp(config.proxyEndMarker)}\\n?`, 'm'),
    '\n',
  );
  const withoutGroup = withoutBlock.replace(
    new RegExp(`^${escapeRegExp(config.policyGroupName)}\\s*=\\s*url-test,.*$\\n?`, 'm'),
    '',
  );

  await replaceTextFile(config.surgeConfigPath, withoutGroup);

  const nodeCount = (await readSharedConfigNodesIfPresent(config.outputDir)).length;
  await stopSharedSingBox(config.outputDir);
  await Promise.all(
    [SHARED_CONFIG_FILE_NAME, LAUNCHER_FILE_NAME].map((name) => rm(join(config.outputDir, name), { force: true })),
  );
  const legacyCount = await removeLegacyConfigs(config.outputDir);

  await maybeReloadSurge(config, withoutGroup);

  return {
    backupPath,
    removedNodes: nodeCount + legacyCount,
  };
};

export const syncSubscriptionToSurge = async (config: CliConfig, { dryRun = false }: { dryRun?: boolean } = {}) => {
  ensureRequiredConfig(config);
  await ensureRuntimePaths(config);
  await ensureWritableDirs(config);

  const subscriptionUrls = getSubscriptionUrls(config);
  const describeSubscription = (index: number) => `Subscription ${index + 1} of ${subscriptionUrls.length}`;
  const vlessNodesBySubscription = await Promise.all(
    subscriptionUrls.map(async (subscriptionUrl, index) => {
      try {
        return await getVlessSubscriptionNodes({
          subscriptionUrl,
          requestHeaders: config.requestHeaders,
        });
      } catch (error) {
        throw new Error(`${describeSubscription(index)}: ${error instanceof Error ? error.message : error}`);
      }
    }),
  );
  vlessNodesBySubscription.forEach((nodes, index) => {
    if (nodes.length === 0) {
      console.warn(`${describeSubscription(index)} returned no VLESS nodes.`);
    }
  });

  const vlessNodes = [...vlessNodesBySubscription.flat(), ...getConfiguredVlessNodes(config)];

  // Checked across all sources rather than per subscription: with several providers configured, one
  // expired subscription should not be able to wipe the Surge profile.
  if (vlessNodes.length === 0) {
    throw new Error('No VLESS nodes from any configured source; refusing to update the Surge profile.');
  }

  if (config.subscriptionOutputPath && !dryRun) {
    await writeTextFile(config.subscriptionOutputPath, `${vlessNodes.join('\n')}\n`);
  }

  const outbounds = vlessNodes.map((node, index) => parseVlessNode(node, index));

  // Everything is generated and validated in a staging directory first, so a failure part-way through
  // leaves both the Surge profile and the previous node configs untouched.
  const stagingDir = join(config.outputDir, `.staging-${randomUUID()}`);
  await mkdir(stagingDir, { recursive: true });

  try {
    const generated = await generateConfigsFromOutbounds({ outbounds, config, stagingDir });

    // The staging directory already holds validated configs, so a dry run can report exactly what a
    // real sync would produce without having written anything outside it.
    if (dryRun) {
      await reportDryRun({ config, generated });
      return { dryRun: true as const, backupPath: undefined, count: generated.nodeNames.length };
    }

    const backupPath = await backupSurgeProfile(config);

    await promoteGeneratedConfigs(config, stagingDir);
    const surgeText = await writeSurgeProfile({
      config,
      proxyLines: generated.proxyLines,
      nodeNames: generated.nodeNames,
    });

    const legacyCount = await removeLegacyConfigs(config.outputDir);
    if (legacyCount > 0) {
      console.log(
        `Replaced ${legacyCount} per-node sing-box config${legacyCount === 1 ? '' : 's'} with the shared ${SHARED_CONFIG_FILE_NAME}.`,
      );
    }

    await maybeReloadSurge(config, surgeText);

    return {
      dryRun: false as const,
      backupPath,
      count: generated.nodeNames.length,
    };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
};

export const rebuildSurgeFromLocalConfigs = async (config: CliConfig) => {
  if (!config.surgeConfigPath) {
    throw new Error(
      'Missing surgeConfigPath. Run `surge-vless-bridge init` and fill the config, or pass --surge-config.',
    );
  }

  if (!(await pathExists(sharedConfigPath(config.outputDir)))) {
    const hasLegacy = (await readdir(config.outputDir).catch(() => [])).some((entry) => LEGACY_CONFIG_PATTERN.test(entry));
    throw new Error(
      hasLegacy
        ? `Found per-node configs from an older release in ${config.outputDir}; run \`sync\` once to switch to the shared ${SHARED_CONFIG_FILE_NAME}.`
        : `No ${SHARED_CONFIG_FILE_NAME} found in ${config.outputDir}; run \`sync\` first.`,
    );
  }

  const generated = await readSharedConfigNodes(config.outputDir);
  if (generated.length === 0) {
    throw new Error(`No usable nodes found in ${sharedConfigPath(config.outputDir)}`);
  }

  // Rewritten so the Surge block never points at a launcher missing from disk or left by an older release.
  await writeLauncher(join(config.outputDir, LAUNCHER_FILE_NAME));
  const proxyLines = await buildProxyLines(generated, config);

  const backupPath = await backupSurgeProfile(config);
  const surgeText = await writeSurgeProfile({
    config,
    proxyLines,
    nodeNames: generated.map((entry) => entry.nodeName),
  });

  await maybeReloadSurge(config, surgeText);

  return {
    backupPath,
    count: generated.length,
  };
};

export const restoreSurgeProfileBackup = async ({ config, backupPath }: { config: CliConfig; backupPath?: string }) => {
  const resolvedBackupPath = backupPath ? resolve(backupPath) : undefined;
  const targetPath = resolvedBackupPath ?? (await findLatestBackup(config.backupDir));

  if (!targetPath) {
    throw new Error(`No backup files found in ${config.backupDir}`);
  }

  await replaceBinaryFile(config.surgeConfigPath, await readJsonCompatibleBinary(targetPath));
  await maybeReloadSurge(config, await readTextFile(config.surgeConfigPath));
  return targetPath;
};

const readJsonCompatibleBinary = (path: string) => readFile(path);

// Newest first; the timestamp in the filename sorts lexicographically.
const listBackups = async (backupDir: string) => {
  try {
    const entries = await readdir(backupDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.conf'))
      .map((entry) => join(backupDir, entry.name))
      .sort((left, right) => right.localeCompare(left));
  } catch {
    return [];
  }
};

const findLatestBackup = async (backupDir: string) => (await listBackups(backupDir))[0];

type DoctorLevel = 'ok' | 'warn' | 'fail';

type DoctorCheck = {
  label: string;
  level: DoctorLevel;
  detail: string;
};

// Ports are probed by binding them: the shared sing-box listens on portStart+N for every node, and a
// port already taken by something else makes that node fail with no obvious cause.
const findPortConflicts = async (portStart: number, count: number) => {
  const conflicts: number[] = [];

  for (let offset = 0; offset < count; offset += 1) {
    const port = portStart + offset;
    const inUse = await new Promise<boolean>((resolvePromise) => {
      const server = createServer();
      server.once('error', (error: NodeJS.ErrnoException) => resolvePromise(error.code === 'EADDRINUSE'));
      server.once('listening', () => server.close(() => resolvePromise(false)));
      server.listen(port, '127.0.0.1');
    });

    if (inUse) {
      conflicts.push(port);
    }
  }

  return conflicts;
};

export const runDoctor = async (config: CliConfig, { configPath }: { configPath?: string } = {}) => {
  const subscriptionUrls = getSubscriptionUrls(config);
  const vlessNodes = getConfiguredVlessNodes(config);
  const checks: DoctorCheck[] = [];

  // Configs written by older releases, or by hand, are usually world-readable, and they hold the
  // subscription URL in plain text.
  if (configPath && (await pathExists(configPath))) {
    const exposed = await isReadableByOthers(configPath);
    checks.push({
      label: 'configFile',
      level: exposed ? 'warn' : 'ok',
      detail: exposed ? `${configPath} is readable by other users; run \`chmod 600\` on it` : configPath,
    });
  }


  checks.push({
    label: 'nodeSources',
    level: subscriptionUrls.length + vlessNodes.length > 0 ? 'ok' : 'fail',
    detail: `${subscriptionUrls.length} subscription URLs, ${vlessNodes.length} direct VLESS nodes`,
  });

  const surgeConfigExists = Boolean(config.surgeConfigPath) && (await pathExists(config.surgeConfigPath));
  checks.push({
    label: 'surgeConfigPath',
    level: surgeConfigExists ? 'ok' : 'fail',
    detail: config.surgeConfigPath || 'missing',
  });

  checks.push({
    label: 'singBoxBinary',
    level: Boolean(config.singBoxBinary) && (await pathExists(config.singBoxBinary)) ? 'ok' : 'fail',
    detail: config.singBoxBinary || 'missing',
  });

  // Both directories are created on the first sync, so their absence is expected before then.
  for (const [label, dir] of [
    ['outputDir', config.outputDir],
    ['backupDir', config.backupDir],
  ] as const) {
    const exists = await pathExists(dir);
    checks.push({
      label,
      level: exists ? 'ok' : 'warn',
      detail: exists ? dir : `${dir} (not created yet; run \`sync\`)`,
    });
  }

  if (surgeConfigExists) {
    const text = await readTextFile(config.surgeConfigPath);
    checks.push({
      label: 'proxy-group-section',
      level: text.includes('[Proxy Group]') ? 'ok' : 'fail',
      detail: '[Proxy Group]',
    });
    checks.push({
      label: 'proxy-section',
      level: text.includes('[Proxy]') ? 'ok' : 'fail',
      detail: '[Proxy]',
    });

    // Mirrors the order reloadSurgeProfile tries: the HTTP API first, then surge-cli.
    const httpApi = parseHttpApiSettings(text);
    const surgeCli = httpApi ? undefined : await findSurgeCli();
    checks.push({
      label: 'auto-reload',
      level: httpApi || surgeCli ? 'ok' : 'warn',
      detail: httpApi
        ? `http-api ${httpApi.origin}`
        : surgeCli
          ? `surge-cli ${surgeCli}`
          : 'unavailable; add `http-api = <key>@127.0.0.1:6171` to [General] to reload automatically',
    });
  }

  const nodes = await readSharedConfigNodesIfPresent(config.outputDir);
  if (nodes.length > 0) {
    const running = await isSharedSingBoxRunning(config.outputDir);
    const conflicts = await findPortConflicts(config.portStart, nodes.length);
    // The shared sing-box keeps every node's port bound, so they read as busy while it is running.
    checks.push({
      label: 'ports',
      level: conflicts.length > 0 && !running ? 'warn' : 'ok',
      detail: `${config.portStart}-${config.portStart + nodes.length - 1}${
        conflicts.length === 0
          ? ''
          : running
            ? `, ${conflicts.length} in use by the shared sing-box`
            : `, ${conflicts.length} in use by another program`
      }`,
    });
    checks.push({
      label: 'sing-box',
      level: 'ok',
      detail: running
        ? `one shared process serving ${nodes.length} nodes`
        : 'not running; Surge starts it when a node is first used',
    });
  }

  for (const check of checks) {
    console.log(`${check.level === 'ok' ? 'OK' : check.level === 'warn' ? 'WARN' : 'FAIL'} ${check.label}: ${check.detail}`);
  }

  const failures = checks.filter((check) => check.level === 'fail').length;
  const warnings = checks.filter((check) => check.level === 'warn').length;
  if (failures > 0) {
    console.error(`\n${failures} problem${failures === 1 ? '' : 's'} found.`);
  }

  return { checks, failures, warnings };
};
