const assert = require('node:assert/strict');
const { chmod, mkdir, readFile, stat, writeFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const { rebuildSurgeFromLocalConfigs, syncSubscriptionToSurge } = require('../dist/surge.js');
const {
  captureConsole,
  generatedFiles,
  makeConfig,
  policyGroupLine,
  readProfile,
  readSharedConfig,
  sharedConfigPath,
  subscriptionUrl,
  vlessLink,
} = require('./helpers.js');

test('merges several subscriptions into one policy group', async () => {
  const { config } = await makeConfig('multi');
  config.subscriptionUrls = [
    subscriptionUrl([vlessLink(1, 'HK 01'), vlessLink(2, 'JP 01')]),
    subscriptionUrl([vlessLink(3, 'SG 01')]),
  ];

  const result = await syncSubscriptionToSurge(config);

  assert.equal(result.count, 3);
  assert.equal(await policyGroupLine(config), 'VLESS = url-test, HK 01, JP 01, SG 01, no-alert=0, hidden=0');
});

test('merges the legacy subscriptionUrl instead of letting subscriptionUrls shadow it', async () => {
  const { config } = await makeConfig('legacy');
  config.subscriptionUrl = subscriptionUrl([vlessLink(1, 'Legacy')]);
  config.subscriptionUrls = [subscriptionUrl([vlessLink(2, 'Added')])];

  await syncSubscriptionToSurge(config);

  assert.equal(await policyGroupLine(config), 'VLESS = url-test, Legacy, Added, no-alert=0, hidden=0');
});

test('does not fetch the same subscription twice when both fields hold it', async () => {
  const { config } = await makeConfig('dedupe-url');
  const shared = subscriptionUrl([vlessLink(1, 'Only')]);
  config.subscriptionUrl = shared;
  config.subscriptionUrls = [shared];

  const result = await syncSubscriptionToSurge(config);

  assert.equal(result.count, 1);
});

test('gives duplicate node names a numeric suffix', async () => {
  const { config } = await makeConfig('duplicate-names');
  config.subscriptionUrls = [
    subscriptionUrl([vlessLink(1, 'HK 01')]),
    subscriptionUrl([vlessLink(2, 'HK 01'), vlessLink(3, 'HK 01')]),
  ];

  await syncSubscriptionToSurge(config);

  assert.equal(await policyGroupLine(config), 'VLESS = url-test, HK 01, HK 01 2, HK 01 3, no-alert=0, hidden=0');
});

test('warns about an empty subscription but still syncs the others', async () => {
  const { config } = await makeConfig('partial-empty');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'Alive')]), subscriptionUrl(['ss://not-a-vless-node'])];

  const warnings = await captureConsole('warn', () => syncSubscriptionToSurge(config));

  assert.match(warnings, /Subscription 2 of 2 returned no VLESS nodes/);
  assert.equal(await policyGroupLine(config), 'VLESS = url-test, Alive, no-alert=0, hidden=0');
});

test('refuses to touch the profile when no source yields a VLESS node', async () => {
  const { config } = await makeConfig('all-empty');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'Alive')])];
  await syncSubscriptionToSurge(config);
  const before = await readProfile(config);

  config.subscriptionUrls = [subscriptionUrl(['ss://not-a-vless-node'])];
  await assert.rejects(syncSubscriptionToSurge(config), /refusing to update the Surge profile/);
  assert.equal(await readProfile(config), before);
});

test('names the failing subscription without leaking its token', async () => {
  const { config } = await makeConfig('failing-url');
  config.subscriptionUrls = [
    subscriptionUrl([vlessLink(1, 'Alive')]),
    'https://sub.example.invalid/link/TOKEN-SECRET?flag=surge',
  ];

  await assert.rejects(syncSubscriptionToSurge(config), (error) => {
    assert.match(error.message, /Subscription 2 of 2/);
    assert.match(error.message, /https:\/\/sub\.example\.invalid/);
    assert.doesNotMatch(error.message, /TOKEN-SECRET/);
    return true;
  });
});

test('leaves the profile and existing node configs untouched when sing-box rejects a config', async () => {
  const { root, config } = await makeConfig('rejected');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'Kept')])];
  await syncSubscriptionToSurge(config);

  const before = { profile: await readProfile(config), shared: await readFile(sharedConfigPath(config), 'utf8') };
  const failingBinary = path.join(root, 'failing-sing-box');
  await writeFile(failingBinary, '#!/bin/sh\necho "invalid config" >&2\nexit 1\n', 'utf8');
  await chmod(failingBinary, 0o700);

  await assert.rejects(
    syncSubscriptionToSurge({
      ...config,
      singBoxBinary: failingBinary,
      subscriptionUrls: [subscriptionUrl([vlessLink(9, 'Replacement')])],
    }),
    /sing-box rejected .*invalid config/,
  );

  assert.equal(await readProfile(config), before.profile);
  assert.equal(await readFile(sharedConfigPath(config), 'utf8'), before.shared);
});

test('fails before generating anything when the sing-box binary is missing', async () => {
  const { config } = await makeConfig('missing-binary');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'Node')])];

  await assert.rejects(
    syncSubscriptionToSurge({ ...config, singBoxBinary: '/nonexistent/sing-box' }),
    /sing-box binary not found/,
  );
});

test('drops removed nodes from the shared config, and rebuild follows it', async () => {
  const { config } = await makeConfig('stale');
  config.subscriptionUrls = [
    subscriptionUrl([vlessLink(1, 'A'), vlessLink(2, 'B'), vlessLink(3, 'C')]),
  ];
  await syncSubscriptionToSurge(config);
  assert.equal((await readSharedConfig(config)).outbounds.length, 3);

  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A')])];
  await syncSubscriptionToSurge(config);

  assert.deepEqual(
    (await readSharedConfig(config)).outbounds.map((outbound) => outbound.tag),
    ['A'],
  );

  const rebuilt = await rebuildSurgeFromLocalConfigs(config);
  assert.equal(rebuilt.count, 1);
  assert.equal(await policyGroupLine(config), 'VLESS = url-test, A, no-alert=0, hidden=0');
});

test('writes one sing-box config with an inbound and a route rule per node', async () => {
  const { config } = await makeConfig('shared');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'HK 01')]), subscriptionUrl([vlessLink(2, 'JP 01')])];

  await syncSubscriptionToSurge(config);

  assert.deepEqual(await generatedFiles(config), ['groups.json', 'launcher.sh', 'sing-box.json']);
  const shared = await readSharedConfig(config);
  assert.deepEqual(
    shared.inbounds.map(({ tag, listen, listen_port }) => ({ tag, listen, listen_port })),
    [
      { tag: 'socks-in-2081', listen: '127.0.0.1', listen_port: 2081 },
      { tag: 'socks-in-2082', listen: '127.0.0.1', listen_port: 2082 },
    ],
  );
  assert.deepEqual(shared.route.rules, [
    { inbound: ['socks-in-2081'], outbound: 'HK 01' },
    { inbound: ['socks-in-2082'], outbound: 'JP 01' },
  ]);
});

test('points every Surge node at the shared launcher', async () => {
  const { config } = await makeConfig('launcher-lines');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A'), vlessLink(2, 'B')])];

  await syncSubscriptionToSurge(config);

  const launcher = path.join(config.outputDir, 'launcher.sh');
  const lines = (await readProfile(config)).split('\n').filter((line) => line.includes('= external'));
  assert.deepEqual(lines, [
    `A = external, exec=/bin/sh, args=${launcher}, args=${config.singBoxBinary}, local-port=2081`,
    `B = external, exec=/bin/sh, args=${launcher}, args=${config.singBoxBinary}, local-port=2082`,
  ]);
  assert.equal((await stat(launcher)).mode & 0o777, 0o755);
});

test('replaces per-node configs left by an older release', async () => {
  const { config } = await makeConfig('migrate');
  await mkdir(config.outputDir, { recursive: true });
  for (const name of ['sing-box[2081].json', 'sing-box[2082].json', 'manifest.json']) {
    await writeFile(path.join(config.outputDir, name), '{}', 'utf8');
  }

  await assert.rejects(rebuildSurgeFromLocalConfigs(config), /run `sync` once to switch/);

  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A')])];
  const output = await captureConsole('log', () => syncSubscriptionToSurge(config));

  assert.match(output, /Replaced 2 per-node sing-box configs/);
  assert.deepEqual(await generatedFiles(config), ['groups.json', 'launcher.sh', 'sing-box.json']);
});

test('leaves no staging directory behind', async () => {
  const { config } = await makeConfig('staging');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A')])];
  await syncSubscriptionToSurge(config);

  const { readdir } = require('node:fs/promises');
  assert.deepEqual(
    (await readdir(config.outputDir)).filter((entry) => entry.startsWith('.staging-')),
    [],
  );
});

test('writes an IPv6 node without the brackets URL parsing adds', async () => {
  const { config } = await makeConfig('ipv6');
  config.subscriptionUrls = [
    subscriptionUrl(['vless://00000000-0000-4000-8000-000000000001@[2001:db8::1]:443?encryption=none#IPv6Node']),
  ];
  // A literal address short-circuits before any resolver runs, so this never touches the network.
  config.addressResolver.strategy = 'doh';

  const result = await syncSubscriptionToSurge(config);
  assert.equal(result.count, 1);

  // sing-box reads `server` as an IP or a domain; `[2001:db8::1]` is neither, so it would be
  // treated as a hostname and never resolve.
  const json = await readSharedConfig(config);
  assert.equal(json.outbounds[0].server, '2001:db8::1');

  assert.match(await readProfile(config), /^IPv6Node = external, .*addresses=2001:db8::1$/m);
});
