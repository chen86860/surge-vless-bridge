const assert = require('node:assert/strict');
const { readdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const { cleanManagedArtifacts, runDoctor, syncSubscriptionToSurge } = require('../dist/surge.js');
const { parseHttpApiSettings } = require('../dist/utils/surge-reload.js');
const { captureConsole, generatedFiles, makeConfig, readProfile, subscriptionUrl, vlessLink } = require('./helpers.js');

test('keeps only the configured number of backups', async () => {
  const { config } = await makeConfig('backup-keep');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A')])];
  config.backupKeep = 3;

  for (let run = 0; run < 5; run += 1) {
    await syncSubscriptionToSurge(config);
  }

  const backups = (await readdir(config.backupDir)).filter((entry) => entry.endsWith('.conf'));
  assert.equal(backups.length, 3);
});

test('dry run reports the plan without writing anything', async () => {
  const { config } = await makeConfig('dry-run');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A'), vlessLink(2, 'B')])];
  const before = await readProfile(config);

  const output = await captureConsole('log', async () => {
    const result = await syncSubscriptionToSurge(config, { dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.count, 2);
  });

  assert.match(output, /Would write 2 nodes/);
  assert.match(output, /2081\s+A/);
  assert.match(output, /Surge profile would change/);
  assert.equal(await readProfile(config), before);
  assert.deepEqual(await generatedFiles(config), []);
  assert.deepEqual(
    (await readdir(config.outputDir)).filter((entry) => entry.startsWith('.staging-')),
    [],
  );
});

test('clean removes the managed block, the policy group and the generated files', async () => {
  const { config } = await makeConfig('clean');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A'), vlessLink(2, 'B')])];
  await syncSubscriptionToSurge(config);
  assert.deepEqual(await generatedFiles(config), ['groups.json', 'launcher.sh', 'sing-box.json']);

  const result = await cleanManagedArtifacts(config);
  const profile = await readProfile(config);

  assert.equal(result.removedNodes, 2);
  assert.deepEqual(await generatedFiles(config), []);
  assert.doesNotMatch(profile, /# vless start/);
  assert.doesNotMatch(profile, /# vless end/);
  assert.doesNotMatch(profile, /^VLESS =/m);
  // Untouched parts of the profile survive.
  assert.match(profile, /\[Proxy\]/);
  assert.match(profile, /DIRECT = direct/);
  assert.match(profile, /^Proxy = select, DIRECT$/m);
  assert.match(profile, /FINAL,Proxy/);
});

test('clean backs the profile up before editing it', async () => {
  const { config } = await makeConfig('clean-backup');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A')])];
  await syncSubscriptionToSurge(config);
  const beforeClean = await readProfile(config);

  const { backupPath } = await cleanManagedArtifacts(config);

  assert.equal(await readFile(backupPath, 'utf8'), beforeClean);
});

test('doctor warns instead of failing before the first sync', async () => {
  const { config } = await makeConfig('doctor-fresh');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A')])];

  const output = await captureConsole('log', async () => {
    const { failures, warnings } = await runDoctor(config);
    assert.equal(failures, 0);
    assert.ok(warnings >= 2);
  });

  assert.match(output, /WARN outputDir: .*not created yet/);
  assert.match(output, /WARN backupDir: .*not created yet/);
});

test('doctor fails when a required path is missing', async () => {
  const { config } = await makeConfig('doctor-fail');
  const { failures } = await runDoctor({ ...config, singBoxBinary: '/nonexistent/sing-box' });

  assert.ok(failures >= 2); // no node sources configured, and no sing-box binary
});

test('doctor reports the ports in use once nodes exist', async () => {
  const { config } = await makeConfig('doctor-ports');
  config.subscriptionUrls = [subscriptionUrl([vlessLink(1, 'A')])];
  await syncSubscriptionToSurge(config);

  const output = await captureConsole('log', () => runDoctor(config));

  assert.match(output, /OK ports: 2081/);
  assert.match(output, /OK sing-box: not running/);
});

test('parses the Surge HTTP API settings', () => {
  const profile = ['[General]', 'skip-proxy = 127.0.0.1', 'http-api = secret@0.0.0.0:6171', '', '[Proxy]'].join('\n');

  assert.deepEqual(parseHttpApiSettings(profile), { key: 'secret', origin: 'http://127.0.0.1:6171' });
});

test('honours http-api-tls when building the API origin', () => {
  const profile = ['[General]', 'http-api = secret@127.0.0.1:6171', 'http-api-tls = true', '', '[Proxy]'].join('\n');

  assert.equal(parseHttpApiSettings(profile).origin, 'https://127.0.0.1:6171');
});

test('returns nothing when the HTTP API is not configured', () => {
  assert.equal(parseHttpApiSettings(['[General]', 'dns-server = 1.1.1.1', '', '[Proxy]'].join('\n')), undefined);
  assert.equal(parseHttpApiSettings('[Proxy]\nDIRECT = direct'), undefined);
});

test('doctor falls back to surge-cli when the HTTP API is not enabled', async () => {
  const { config } = await makeConfig('doctor-api');
  const output = await captureConsole('log', () => runDoctor(config));

  // Which of the two appears depends on whether Surge is installed on the machine running the tests.
  assert.match(output, /(OK auto-reload: surge-cli \/|WARN auto-reload: unavailable)/);
});

test('doctor confirms the HTTP API when the profile enables it', async () => {
  const { config } = await makeConfig('doctor-api-on');
  const profile = await readProfile(config);
  await writeFile(config.surgeConfigPath, `[General]\nhttp-api = secret@127.0.0.1:6171\n\n${profile}`, 'utf8');

  const output = await captureConsole('log', () => runDoctor(config));

  assert.match(output, /OK auto-reload: http-api http:\/\/127\.0\.0\.1:6171/);
});
