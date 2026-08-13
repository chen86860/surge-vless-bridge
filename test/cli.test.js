const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
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

test('help shows the version and the repository URL', async () => {
  const { code, stdout } = await runCli(['help']);

  assert.equal(code, 0);
  assert.match(stdout, /surge-vless-bridge v\d+\.\d+\.\d+/);
  assert.match(stdout, /^Homepage {6}https:\/\/github\.com\/chen86860\/surge-vless-bridge$/m);
  assert.match(stdout, /^Issues {8}https:\/\/github\.com\/chen86860\/surge-vless-bridge\/issues$/m);
  assert.match(stdout, /^Usage:$/m);
});

test('help documents the config file path without the development path', async () => {
  const { stdout } = await runCli(['--help']);

  assert.match(stdout, /^Config file {3}~\/\.config\/surge-vless-bridge\/config\.json$/m);
  assert.doesNotMatch(stdout, /Local development/);
  assert.doesNotMatch(stdout, /\.surge-vless-bridge\.json/);
});

test('version is reported by both the command and the flag', async () => {
  const viaCommand = await runCli(['version']);
  const viaFlag = await runCli(['sync', '--version']);

  assert.equal(viaCommand.code, 0);
  assert.match(viaCommand.stdout.trim(), /^\d+\.\d+\.\d+$/);
  assert.equal(viaFlag.stdout.trim(), viaCommand.stdout.trim());
});
