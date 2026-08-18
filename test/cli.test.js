const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { mkdtemp, readFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const CLI = path.join(__dirname, '..', 'dist', 'cli.js');

const runCli = async (args) => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
};

// A config path inside a fresh temp dir: the default path resolves to the git root while these tests
// run from the repo, and `init` must never touch the developer's own config.
const tempConfigPath = async (label) =>
  path.join(await mkdtemp(path.join(os.tmpdir(), `svb-cli-${label}-`)), 'config.json');

test('rejects an unknown flag instead of ignoring it', async () => {
  const { code, stderr } = await runCli(['doctor', '--group-nmae', 'TYPO']);

  assert.equal(code, 1);
  assert.match(stderr, /Unknown flag: --group-nmae/);
});

test('rejects a non-numeric value for a numeric flag', async () => {
  const { code, stderr } = await runCli(['doctor', '--port-start', 'abc']);

  assert.equal(code, 1);
  assert.match(stderr, /--port-start expects a number, received: abc/);
});

test('rejects a value-taking flag with no value', async () => {
  const { code, stderr } = await runCli(['sync', '--group-name']);

  assert.equal(code, 1);
  assert.match(stderr, /--group-name requires a value/);
});

test('accepts --flag=value form', async () => {
  const { code, stderr } = await runCli(['doctor', '--config=/nonexistent/config.json', '--port-start=3000']);

  assert.notEqual(stderr, 'Unknown flag');
  assert.equal(code, 1); // doctor fails because nothing is configured, not because of parsing
});

test('rejects an unknown command', async () => {
  const { code, stderr } = await runCli(['sink']);

  assert.equal(code, 1);
  assert.match(stderr, /Unknown command: sink/);
});

test('help shows the metadata footer with version and links', async () => {
  const { code, stdout } = await runCli(['help']);

  assert.equal(code, 0);
  assert.match(stdout, /^Use VLESS subscriptions in Surge Mac/);
  assert.match(stdout, /^Usage:\n {2}surge-vless-bridge <command> \[flags\]$/m);
  assert.match(stdout, /^Version {7}\d+\.\d+\.\d+$/m);
  assert.match(stdout, /^Homepage {6}https:\/\/github\.com\/chen86860\/surge-vless-bridge$/m);
  assert.match(stdout, /^Issues {8}https:\/\/github\.com\/chen86860\/surge-vless-bridge\/issues$/m);
});

test('help documents the config file path without the development path', async () => {
  const { stdout } = await runCli(['--help']);

  assert.match(stdout, /^Config file {3}~\/\.config\/surge-vless-bridge\/config\.json$/m);
  assert.doesNotMatch(stdout, /Local development/);
  assert.doesNotMatch(stdout, /\.surge-vless-bridge\.json/);
});

// execFile gives the child a pipe rather than a TTY, which is exactly the shape an agent or a CI job
// sees. `init` must fall back to writing the template instead of blocking on a question nobody reads.
test('init writes the template without prompting when stdin is not a TTY', async () => {
  const configPath = await tempConfigPath('no-tty');
  const { code, stdout } = await runCli(['init', '--config', configPath]);

  assert.equal(code, 0);
  assert.match(stdout, /Fill subscriptionUrls in that file/);

  const written = JSON.parse(await readFile(configPath, 'utf8'));
  assert.deepEqual(written.subscriptionUrls, ['']);
});

test('init --no-input skips the prompts even on a TTY', async () => {
  const configPath = await tempConfigPath('no-input');
  const { code } = await runCli(['init', '--config', configPath, '--no-input']);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')).subscriptionUrls, ['']);
});

test('init records a subscription passed by flag and keeps its token out of the output', async () => {
  const configPath = await tempConfigPath('flag');
  const url = 'https://provider.example.com/sub?token=SECRET';
  const { code, stdout } = await runCli(['init', '--config', configPath, '--no-input', '--subscription-url', url]);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')).subscriptionUrls, [url]);
  assert.match(stdout, /node source {3}https:\/\/provider\.example\.com\//);
  assert.doesNotMatch(stdout, /SECRET/);
});

// Rewriting the Surge profile must never be a side effect of creating a config file in CI or under
// an agent, so the sync only follows the interactive questions.
test('init does not sync when it could not ask, even with a subscription to sync', async () => {
  const configPath = await tempConfigPath('no-auto-sync');
  const { code, stdout, stderr } = await runCli([
    'init',
    '--config',
    configPath,
    '--no-input',
    '--subscription-url',
    'https://provider.example.invalid/sub',
  ]);

  assert.equal(code, 0);
  assert.match(stdout, /Next: surge-vless-bridge sync/);
  // A sync would have tried to fetch the unreachable subscription and said so.
  assert.doesNotMatch(stdout + stderr, /Synced|Sync failed/);
});

// `init` syncs with the flags it was given, so a file that recorded the defaults instead would send
// the next sync to different ports and a different policy group.
test('init writes the config flags it was given instead of the defaults', async () => {
  const configPath = await tempConfigPath('flag-persist');
  const { code } = await runCli([
    'init',
    '--config',
    configPath,
    '--no-input',
    '--port-start',
    '26081',
    '--group-name',
    'NODES',
  ]);

  assert.equal(code, 0);
  const written = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(written.portStart, 26081);
  assert.equal(written.policyGroupName, 'NODES');
});

test('init syncs only after the questions were answered, and --no-sync opts out', () => {
  const { shouldSyncAfterInit } = require('../dist/cli.js');

  assert.equal(shouldSyncAfterInit({ answered: true, noSync: false }), true);
  assert.equal(shouldSyncAfterInit({ answered: true, noSync: true }), false);
  assert.equal(shouldSyncAfterInit({ answered: false, noSync: false }), false);
});

test('init refuses to overwrite an existing config', async () => {
  const configPath = await tempConfigPath('exists');
  await runCli(['init', '--config', configPath, '--no-input']);
  const { code, stderr } = await runCli(['init', '--config', configPath, '--no-input']);

  assert.equal(code, 1);
  assert.match(stderr, /Config file already exists/);
});

// Detection fails when Surge is absent or keeps its profiles elsewhere, and the fallback is to drag
// the file in from Finder — which arrives shell-escaped rather than as a usable path.
test('a profile path dragged in from Finder is unescaped before it is stored', () => {
  const { normalizePastedPath } = require('../dist/utils/prompt.js');
  const target = '/Users/me/Library/Application Support/Surge/Profiles/My Config.conf';

  assert.equal(normalizePastedPath('/Users/me/Library/Application\\ Support/Surge/Profiles/My\\ Config.conf'), target);
  assert.equal(normalizePastedPath(`'${target}'`), target);
  assert.equal(normalizePastedPath(`"${target}"`), target);
  assert.equal(normalizePastedPath(target), target);
});

test('a profile path starting with ~ is expanded against HOME', () => {
  const { normalizePastedPath } = require('../dist/utils/prompt.js');
  const home = process.env.HOME;

  assert.equal(normalizePastedPath('~/Library/Surge/A.conf'), path.join(home, 'Library/Surge/A.conf'));
});

test('version is reported by both the command and the flag', async () => {
  const viaCommand = await runCli(['version']);
  const viaFlag = await runCli(['sync', '--version']);

  assert.equal(viaCommand.code, 0);
  assert.match(viaCommand.stdout.trim(), /^\d+\.\d+\.\d+$/);
  assert.equal(viaFlag.stdout.trim(), viaCommand.stdout.trim());
});
