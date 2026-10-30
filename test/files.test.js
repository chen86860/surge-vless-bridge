const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, stat, symlink, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveConfigPath } = require('../dist/configuration.js');
const { replaceTextFile, writeTextFile } = require('../dist/utils/fs.js');

const tempDir = (label) => mkdtemp(path.join(os.tmpdir(), `svb-${label}-`));
const modeOf = async (file) => (await stat(file)).mode & 0o777;

test('generated files are private to the user', async () => {
  const dir = await tempDir('private');
  const file = path.join(dir, 'nested', 'config.json');

  await writeTextFile(file, '{}\n');

  assert.equal(await modeOf(file), 0o600);
  assert.equal(await modeOf(path.dirname(file)), 0o700);
});

test('rewriting a generated file also tightens a looser mode', async () => {
  const dir = await tempDir('tighten');
  const file = path.join(dir, 'vless_nodes.txt');
  await writeFile(file, 'old\n');
  await chmod(file, 0o644);

  await writeTextFile(file, 'new\n');

  assert.equal(await modeOf(file), 0o600);
  assert.equal(await readFile(file, 'utf8'), 'new\n');
});

test('a replaced Surge profile keeps its mode and leaves no temporary file behind', async () => {
  const dir = await tempDir('replace');
  const file = path.join(dir, 'profile.conf');
  await writeFile(file, 'old\n');
  await chmod(file, 0o644);

  await replaceTextFile(file, 'new\n');

  assert.equal(await modeOf(file), 0o644);
  assert.equal(await readFile(file, 'utf8'), 'new\n');
  assert.deepEqual(await readdir(dir), ['profile.conf']);
});

test('a symlinked Surge profile is updated through the link', async () => {
  const dir = await tempDir('symlink');
  const real = path.join(dir, 'real.conf');
  const link = path.join(dir, 'link.conf');
  await writeFile(real, 'old\n');
  await symlink(real, link);

  await replaceTextFile(link, 'new\n');

  assert.ok((await lstat(link)).isSymbolicLink());
  assert.equal(await readFile(real, 'utf8'), 'new\n');
});

test('inside a git repo without its own config, the global config is used', async () => {
  const home = await tempDir('home');
  // git reports the resolved path, and macOS temp dirs live behind the /var -> /private/var link.
  const repo = await realpath(await tempDir('repo'));
  execFileSync('git', ['init', '-q', repo]);
  const subdir = path.join(repo, 'sub');
  await mkdir(subdir);
  const originalHome = process.env.HOME;
  process.env.HOME = home;

  try {
    assert.equal(resolveConfigPath(subdir), path.join(home, '.config', 'surge-vless-bridge', 'config.json'));

    await writeFile(path.join(repo, '.surge-vless-bridge.json'), '{}\n');
    assert.equal(resolveConfigPath(subdir), path.join(repo, '.surge-vless-bridge.json'));
  } finally {
    process.env.HOME = originalHome;
  }
});
