const assert = require('node:assert/strict');
const { chmod, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const { rebuildSurgeFromLocalConfigs, syncSubscriptionToSurge } = require('../dist/surge.js');
const {
  captureConsole,
  makeConfig,
  nodeConfigFiles,
  policyGroupLine,
  readProfile,
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

  const before = { profile: await readProfile(config), files: await nodeConfigFiles(config) };
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
  assert.deepEqual(await nodeConfigFiles(config), before.files);
});

test('fails before generating anything when the sing-box binary is missing', async () => {
  const { config } = await makeConfig('missing-binary');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'Node')])];

  await assert.rejects(
    syncSubscriptionToSurge({ ...config, singBoxBinary: '/nonexistent/sing-box' }),
    /sing-box binary not found/,
  );
});

test('removes stale node configs and rebuilds only what the manifest lists', async () => {
  const { config } = await makeConfig('stale');
  config.subscriptionUrls = [
    subscriptionUrl([vlessLink(1, 'A'), vlessLink(2, 'B'), vlessLink(3, 'C')]),
  ];
  await syncSubscriptionToSurge(config);
  assert.equal((await nodeConfigFiles(config)).length, 3);

  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A')])];
  await syncSubscriptionToSurge(config);

  assert.deepEqual(await nodeConfigFiles(config), ['sing-box[2081].json']);
  assert.deepEqual(JSON.parse(await readFile(path.join(config.outputDir, 'manifest.json'), 'utf8')), {
    version: 1,
    files: ['sing-box[2081].json'],
  });

  const rebuilt = await rebuildSurgeFromLocalConfigs(config);
  assert.equal(rebuilt.count, 1);
  assert.equal(await policyGroupLine(config), 'VLESS = url-test, A, no-alert=0, hidden=0');
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

test('resolves bracketed IPv6 server addresses and includes addresses= in proxy line', async () => {
  const { config } = await makeConfig('ipv6');
  config.subscriptionUrls = [
    subscriptionUrl([
      'vless://00000000-0000-4000-8000-000000000001@[2001:db8::1]:443?encryption=none#IPv6Node',
    ]),
  ];
  config.addressResolver.strategy = 'system';

  const result = await syncSubscriptionToSurge(config);
  assert.equal(result.count, 1);

  const profile = await readProfile(config);
  assert.match(
    profile,
    /^IPv6Node = external, .*addresses=2001:db8::1$/m,
  );
});
