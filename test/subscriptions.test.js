const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const { loadCliConfig } = require('../dist/configuration.js');
const { cleanManagedArtifacts, rebuildSurgeFromLocalConfigs, runDoctor, syncSubscriptionToSurge } = require('../dist/surge.js');
const {
  captureConsole,
  makeConfig,
  policyGroupLine,
  readProfile,
  readSharedConfig,
  subscriptionUrl,
  vlessLink,
} = require('./helpers.js');

const groupLine = async (config, name) =>
  (await readProfile(config)).split('\n').find((line) => line.startsWith(`${name} =`));

test('skips subscription info entries instead of keeping them as nodes', async () => {
  const { config } = await makeConfig('info-entries');
  config.subscriptionUrls = [
    subscriptionUrl([
      // Info entries are often not valid nodes at all; this one has no UUID.
      `vless://@0.0.0.0:0#${encodeURIComponent('剩余流量：100 GB')}`,
      vlessLink(1, '套餐到期：2027-01-01'),
      vlessLink(2, 'HK 01'),
      vlessLink(3, 'JP 01'),
    ]),
  ];

  const warnings = await captureConsole('warn', () => syncSubscriptionToSurge(config));

  assert.match(warnings, /Skipped 2 subscription info entries: 剩余流量：100 GB, 套餐到期：2027-01-01/);
  assert.equal(await policyGroupLine(config), 'VLESS = url-test, HK 01, JP 01, no-alert=0, hidden=0');
  // The skipped entries do not hold ports.
  assert.deepEqual(
    (await readSharedConfig(config)).inbounds.map((inbound) => inbound.listen_port),
    [2081, 2082],
  );
});

test('refuses to sync when a subscription holds nothing but info entries', async () => {
  const { config } = await makeConfig('info-only');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, '剩余流量：0 GB')])];

  await assert.rejects(
    captureConsole('warn', () => syncSubscriptionToSurge(config)),
    /refusing to update the Surge profile/,
  );
});

test('prefixes node names per subscription', async () => {
  const { config } = await makeConfig('prefix');
  config.subscriptionUrls = [
    { url: subscriptionUrl([vlessLink(1, 'HK 01')]), prefix: 'A | ' },
    { url: subscriptionUrl([vlessLink(2, 'HK 01')]), prefix: 'B | ' },
  ];

  await syncSubscriptionToSurge(config);

  assert.equal(await policyGroupLine(config), 'VLESS = url-test, A | HK 01, B | HK 01, no-alert=0, hidden=0');
});

test('puts a subscription with a group into its own policy group', async () => {
  const { config } = await makeConfig('groups');
  config.subscriptionUrls = [
    subscriptionUrl([vlessLink(1, 'Plain')]),
    { url: subscriptionUrl([vlessLink(2, 'HK 01'), vlessLink(3, 'JP 01')]), group: 'Provider B' },
  ];

  await syncSubscriptionToSurge(config);

  assert.equal(await groupLine(config, 'VLESS'), 'VLESS = url-test, Plain, no-alert=0, hidden=0');
  assert.equal(await groupLine(config, 'Provider B'), 'Provider B = url-test, HK 01, JP 01, no-alert=0, hidden=0');
});

test('keeps policyGroupName as a select over the custom groups when it has no nodes of its own', async () => {
  const { config } = await makeConfig('groups-only');
  config.subscriptionUrls = [
    { url: subscriptionUrl([vlessLink(1, 'A1')]), group: 'A' },
    { url: subscriptionUrl([vlessLink(2, 'B1')]), group: 'B' },
  ];

  await syncSubscriptionToSurge(config);

  assert.equal(await groupLine(config, 'VLESS'), 'VLESS = select, A, B');
  assert.equal(await groupLine(config, 'A'), 'A = url-test, A1, no-alert=0, hidden=0');
});

test('removes a group the config no longer has, and leaves a user group of another type alone', async () => {
  const { config } = await makeConfig('stale-group');
  const profile = await readProfile(config);
  await writeFile(config.surgeConfigPath, profile.replace('Proxy = select, DIRECT', 'Proxy = select, DIRECT\nMine = fallback, DIRECT'));
  config.subscriptionUrls = [{ url: subscriptionUrl([vlessLink(1, 'A1')]), group: 'Old' }];
  await syncSubscriptionToSurge(config);
  assert.ok(await groupLine(config, 'Old'));

  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A1')])];
  await syncSubscriptionToSurge(config);

  assert.equal(await groupLine(config, 'Old'), undefined);
  assert.equal(await groupLine(config, 'VLESS'), 'VLESS = url-test, A1, no-alert=0, hidden=0');
  assert.equal(await groupLine(config, 'Mine'), 'Mine = fallback, DIRECT');
});

test('rebuild restores custom groups, and clean removes them', async () => {
  const { config } = await makeConfig('groups-rebuild');
  config.subscriptionUrls = [
    subscriptionUrl([vlessLink(1, 'Plain')]),
    { url: subscriptionUrl([vlessLink(2, 'HK 01')]), group: 'B' },
  ];
  await syncSubscriptionToSurge(config);
  const synced = await readProfile(config);

  await rebuildSurgeFromLocalConfigs(config);
  assert.equal(await readProfile(config), synced);

  await cleanManagedArtifacts(config);
  assert.equal(await groupLine(config, 'VLESS'), undefined);
  assert.equal(await groupLine(config, 'B'), undefined);
  assert.match(await readProfile(config), /^Proxy = select, DIRECT$/m);
});

test('rejects a subscription entry with an unknown field', async () => {
  const { root } = await makeConfig('bad-entry');
  const configPath = path.join(root, 'config.json');
  await writeFile(configPath, JSON.stringify({ subscriptionUrls: [{ url: 'https://a.example/sub', grop: 'A' }] }));

  await assert.rejects(loadCliConfig({ cwd: root, configPath }), /subscriptionUrls\[0\] has unknown field: grop/);
});

test('rejects a group name that would break the Surge line', async () => {
  const { root } = await makeConfig('bad-group');
  const configPath = path.join(root, 'config.json');
  await writeFile(configPath, JSON.stringify({ subscriptionUrls: [{ url: 'https://a.example/sub', group: 'A, B' }] }));

  await assert.rejects(loadCliConfig({ cwd: root, configPath }), /group cannot contain commas/);
});

// A forward proxy that answers for any absolute URL, standing in for Surge's HTTP proxy. The
// subscription host does not resolve, so the direct request always fails and only the retry through
// the proxy can succeed.
const startProxy = async (body) => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}` };
};

test('retries a failed subscription fetch through subscriptionProxy', async (t) => {
  const proxy = await startProxy(Buffer.from(vlessLink(1, 'Via Proxy')).toString('base64'));
  t.after(() => proxy.server.close());
  const { config } = await makeConfig('proxy');
  config.subscriptionUrls = ['http://svb-subscription.invalid/link/TOKEN-SECRET'];
  config.subscriptionProxy = proxy.url.replace('http://', 'http://user:PROXY-SECRET@');

  const warnings = await captureConsole('warn', () => syncSubscriptionToSurge(config));

  assert.deepEqual(proxy.requests, ['http://svb-subscription.invalid/link/TOKEN-SECRET']);
  assert.equal(await policyGroupLine(config), 'VLESS = url-test, Via Proxy, no-alert=0, hidden=0');
  assert.match(warnings, /through http:\/\/127\.0\.0\.1:\d+ after the direct request failed/);
  assert.doesNotMatch(warnings, /TOKEN-SECRET|PROXY-SECRET/);
});

test('reports both failures when the proxy retry fails too', async () => {
  const { config } = await makeConfig('proxy-fail');
  config.subscriptionUrls = ['http://svb-subscription.invalid/link/TOKEN-SECRET'];
  // Nothing listens on port 9, so curl cannot connect.
  config.subscriptionProxy = 'http://127.0.0.1:9';

  await assert.rejects(syncSubscriptionToSurge(config), (error) => {
    assert.match(error.message, /retry through http:\/\/127\.0\.0\.1:9 failed/);
    assert.doesNotMatch(error.message, /TOKEN-SECRET/);
    return true;
  });
});

test('doctor warns when the config file is readable by other users', async () => {
  const { root, config } = await makeConfig('doctor-mode');
  const configPath = path.join(root, 'config.json');
  await writeFile(configPath, '{}\n', { mode: 0o644 });

  const output = await captureConsole('log', () => runDoctor(config, { configPath }));

  assert.match(output, /WARN configFile: .*readable by other users/);
  assert.equal((await readFile(configPath, 'utf8')).trim(), '{}');
});
