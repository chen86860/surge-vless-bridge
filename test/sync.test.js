const assert = require('node:assert/strict');
const { chmod, readFile, writeFile } = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
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
  TEST_PORT_START,
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

  assert.deepEqual(await nodeConfigFiles(config), [`sing-box[${TEST_PORT_START}].json`]);
  assert.deepEqual(JSON.parse(await readFile(path.join(config.outputDir, 'manifest.json'), 'utf8')), {
    version: 1,
    files: [`sing-box[${TEST_PORT_START}].json`],
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

// Binds a port on 127.0.0.1 and releases it when the test ends, standing in for an unrelated
// program sitting on a port the sync wants.
const occupyPort = async (t, port) => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
};

test('refuses to sync when another program holds a port it needs', async (t) => {
  const { config } = await makeConfig('port-taken');
  config.portStart = TEST_PORT_START + 10;
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A'), vlessLink(2, 'B')])];
  await occupyPort(t, config.portStart + 1);

  await assert.rejects(syncSubscriptionToSurge(config), (error) => {
    assert.match(error.message, new RegExp(`Ports already in use by another program: ${TEST_PORT_START + 11}`));
    assert.match(error.message, /--port-start/);
    return true;
  });

  // The failure lands before anything is generated, so no node config is left behind.
  assert.deepEqual(await nodeConfigFiles(config), []);
});

test('reports the port conflict on a dry run instead of previewing a sync that cannot work', async (t) => {
  const { config } = await makeConfig('port-taken-dry');
  config.portStart = TEST_PORT_START + 14;
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A')])];
  await occupyPort(t, config.portStart);

  await assert.rejects(syncSubscriptionToSurge(config, { dryRun: true }), /Ports already in use/);
});

// Stands in for a sing-box that Surge started: a real process holding the port, whose command line
// names both sing-box and a config inside outputDir. Binding the port from this test process would
// not do — the check asks the OS who the listener is.
const runFakeSingBoxOn = async (t, config, port) => {
  const script = path.join(path.dirname(config.outputDir), 'sing-box');
  // The port is the last argument; the ones before it only exist to make the command line look like
  // a sing-box started by Surge.
  await writeFile(script, 'require("node:net").createServer().listen(Number(process.argv.at(-1)), "127.0.0.1");\n', 'utf8');
  const child = spawn(process.execPath, [script, '-c', path.join(config.outputDir, `sing-box[${port}].json`), port], {
    stdio: 'ignore',
  });
  t.after(() => child.kill());

  // Wait for the port to actually be listening before the sync probes it.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const free = await new Promise((resolve) => {
      const probe = createServer();
      probe.once('error', () => resolve(false));
      probe.once('listening', () => probe.close(() => resolve(true)));
      probe.listen(port, '127.0.0.1');
    });
    if (!free) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`fake sing-box never bound port ${port}`);
};

// Surge keeps the previous sync's nodes listening on exactly the ports the next sync reuses, so a
// naive "is this port free" check would make every re-sync fail.
test('re-syncs while its own nodes still hold their ports', async (t) => {
  const { config } = await makeConfig('port-owned');
  config.portStart = TEST_PORT_START + 18;
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A'), vlessLink(2, 'B')])];
  await syncSubscriptionToSurge(config);

  await runFakeSingBoxOn(t, config, config.portStart);
  await runFakeSingBoxOn(t, config, config.portStart + 1);

  const result = await syncSubscriptionToSurge(config);
  assert.equal(result.count, 2);
});

// The port has been used by a node before, so a check that trusted the generated filenames would
// wave this through and write a node that can never start.
test('still fails when a stranger takes a port a previous sync had used', async (t) => {
  const { config } = await makeConfig('port-stolen');
  config.portStart = TEST_PORT_START + 22;
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A'), vlessLink(2, 'B')])];
  await syncSubscriptionToSurge(config);
  assert.deepEqual(await nodeConfigFiles(config), [
    `sing-box[${config.portStart}].json`,
    `sing-box[${config.portStart + 1}].json`,
  ]);

  await occupyPort(t, config.portStart + 1);

  await assert.rejects(
    syncSubscriptionToSurge(config),
    new RegExp(`Ports already in use by another program: ${TEST_PORT_START + 23}`),
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
  const [file] = await nodeConfigFiles(config);
  const json = JSON.parse(await readFile(path.join(config.outputDir, file), 'utf8'));
  assert.equal(json.outbounds[0].server, '2001:db8::1');

  assert.match(await readProfile(config), /^IPv6Node = external, .*addresses=2001:db8::1$/m);
});
