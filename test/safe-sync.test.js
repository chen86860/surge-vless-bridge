const assert = require('node:assert/strict');
const { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { getDefaultConfig } = require('../dist/configuration.js');
const { rebuildSurgeFromLocalConfigs, runDoctor, syncSubscriptionToSurge } = require('../dist/surge.js');

const TRUE_BINARY = '/usr/bin/true';

const profileText = ['[Proxy]', 'DIRECT = direct', '', '[Proxy Group]', 'Proxy = select, DIRECT', '', '[Rule]', 'FINAL,Proxy', ''].join('\n');

const subscriptionUrl = (decodedText) => {
  const encoded = Buffer.from(decodedText, 'utf8').toString('base64');
  return `data:text/plain,${encodeURIComponent(encoded)}`;
};

const makeNode = (id, address) =>
  `vless://00000000-0000-4000-8000-${String(id).padStart(12, '0')}@${address}:443?encryption=none#node-${id}`;

const makeConfig = async (root, decodedSubscription) => {
  const surgeConfigPath = path.join(root, 'profile.conf');
  await writeFile(surgeConfigPath, profileText, 'utf8');

  return {
    subscriptionUrl: subscriptionUrl(decodedSubscription),
    surgeConfigPath,
    singBoxBinary: TRUE_BINARY,
    outputDir: path.join(root, 'nodes'),
    backupDir: path.join(root, 'backups'),
    policyGroupName: 'VLESS',
    proxyStartMarker: '# vless start',
    proxyEndMarker: '# vless end',
    portStart: 2081,
    subscriptionOutputPath: path.join(root, 'vless_nodes.txt'),
    requestHeaders: {},
    addressResolver: {
      strategy: 'system',
      filterSurgeFakeIp: true,
      dohEndpoint: 'https://1.1.1.1/dns-query',
      dnsServers: ['1.1.1.1'],
    },
  };
};

const mode = async (target) => (await stat(target)).mode & 0o777;

test('refuses an empty VLESS result without changing the Surge profile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'surge-vless-empty-'));
  const config = await makeConfig(root, 'ss://placeholder');

  await assert.rejects(
    syncSubscriptionToSurge(config),
    /contains no VLESS nodes; refusing to update the Surge profile/,
  );

  assert.equal(await readFile(config.surgeConfigPath, 'utf8'), profileText);
});

test('does not change the Surge profile when sing-box rejects a generated config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'surge-vless-invalid-'));
  const config = await makeConfig(root, makeNode(1, '203.0.113.1'));
  const failingBinary = path.join(root, 'failing-sing-box');
  await writeFile(failingBinary, '#!/bin/sh\necho invalid config >&2\nexit 1\n', 'utf8');
  await chmod(failingBinary, 0o700);
  config.singBoxBinary = failingBinary;

  await assert.rejects(syncSubscriptionToSurge(config), /sing-box rejected .*invalid config/);
  assert.equal(await readFile(config.surgeConfigPath, 'utf8'), profileText);
});

test('removes stale node configs and rebuilds only the current manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'surge-vless-stale-'));
  const config = await makeConfig(
    root,
    [makeNode(1, '203.0.113.1'), makeNode(2, '203.0.113.2'), makeNode(3, '203.0.113.3')].join('\n'),
  );

  await syncSubscriptionToSurge(config);
  config.subscriptionUrl = subscriptionUrl(makeNode(9, '203.0.113.9'));
  await syncSubscriptionToSurge(config);

  const managedFiles = (await readdir(config.outputDir)).filter((entry) => /^sing-box\[\d+\]\.json$/.test(entry));
  assert.deepEqual(managedFiles, ['sing-box[2081].json']);

  const manifest = JSON.parse(await readFile(path.join(config.outputDir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest, { version: 1, files: ['sing-box[2081].json'] });

  const rebuilt = await rebuildSurgeFromLocalConfigs(config);
  const profile = await readFile(config.surgeConfigPath, 'utf8');
  assert.equal(rebuilt.count, 1);
  assert.match(profile, /VLESS = url-test, node-9,/);
  assert.doesNotMatch(profile, /node-2|node-3/);
});

test('protects local secrets and redacts the subscription URL in doctor output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'surge-vless-permissions-'));
  const config = await makeConfig(root, makeNode(1, '203.0.113.1'));
  await syncSubscriptionToSurge(config);

  const backup = (await readdir(config.backupDir))[0];
  assert.ok(backup);
  assert.equal(await mode(config.outputDir), 0o700);
  assert.equal(await mode(config.backupDir), 0o700);
  assert.equal(await mode(config.surgeConfigPath), 0o600);
  assert.equal(await mode(config.subscriptionOutputPath), 0o600);
  assert.equal(await mode(path.join(config.outputDir, 'manifest.json')), 0o600);
  assert.equal(await mode(path.join(config.outputDir, 'sing-box[2081].json')), 0o600);
  assert.equal(await mode(path.join(config.backupDir, backup)), 0o600);

  config.subscriptionUrl = 'https://example.com/subscription?id=should-not-appear';
  const output = [];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(' '));
  try {
    await runDoctor(config);
  } finally {
    console.log = originalLog;
  }

  assert.match(output.join('\n'), /subscriptionUrl: \[configured\]/);
  assert.doesNotMatch(output.join('\n'), /should-not-appear/);
});

test('does not guess a Surge profile when multiple profiles exist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'surge-vless-home-'));
  const profilesDir = path.join(root, 'Library', 'Application Support', 'Surge', 'Profiles');
  await mkdir(profilesDir, { recursive: true });
  await writeFile(path.join(profilesDir, 'one.conf'), profileText, 'utf8');
  await writeFile(path.join(profilesDir, 'two.conf'), profileText, 'utf8');

  const originalHome = process.env.HOME;
  process.env.HOME = root;
  try {
    const config = await getDefaultConfig(root);
    assert.equal(config.surgeConfigPath, '');
  } finally {
    process.env.HOME = originalHome;
  }
});
