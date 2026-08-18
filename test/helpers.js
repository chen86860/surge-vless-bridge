const { mkdtemp, readFile, readdir, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { getDefaultConfig } = require('../dist/configuration.js');

// `true` accepts any arguments and exits 0, which stands in for a sing-box binary that validates
// every config. Tests that need a rejecting binary write their own script.
const STUB_SING_BOX = '/usr/bin/true';

// Well clear of the 2081 default: `sync` refuses to run when its ports are taken, and a developer
// using the tool has real sing-box instances sitting on that range.
//
// Each test file gets its own block. `node --test` runs the files in parallel processes, and the
// port check probes by binding, so a shared range would let one file's probe read as another file's
// conflict. Tests within a file run in sequence and can share the block.
const TEST_PORT_BLOCK = 30;
const TEST_PORT_START = 20000 + (process.pid % 300) * TEST_PORT_BLOCK;

const PROFILE_TEXT = [
  '[Proxy]',
  'DIRECT = direct',
  '',
  '[Proxy Group]',
  'Proxy = select, DIRECT',
  '',
  '[Rule]',
  'FINAL,Proxy',
  '',
].join('\n');

const subscriptionUrl = (links) =>
  `data:text/plain,${encodeURIComponent(Buffer.from(links.join('\n'), 'utf8').toString('base64'))}`;

const vlessLink = (id, name, host = 'example.com') =>
  `vless://00000000-0000-4000-8000-${String(id).padStart(12, '0')}@${host}:443?encryption=none#${encodeURIComponent(name)}`;

const makeConfig = async (label) => {
  const root = await mkdtemp(path.join(os.tmpdir(), `svb-${label}-`));
  const surgeConfigPath = path.join(root, 'profile.conf');
  await writeFile(surgeConfigPath, PROFILE_TEXT, 'utf8');

  const defaults = await getDefaultConfig(root);
  return {
    root,
    config: {
      ...defaults,
      subscriptionUrl: '',
      subscriptionUrls: [],
      vlessNodes: [],
      surgeConfigPath,
      singBoxBinary: STUB_SING_BOX,
      outputDir: path.join(root, 'nodes'),
      backupDir: path.join(root, 'backups'),
      subscriptionOutputPath: path.join(root, 'vless_nodes.txt'),
      // Resolution is disabled so tests never depend on DNS, and reloading is off so a test never
      // reaches a Surge instance running on the developer's machine.
      addressResolver: { ...defaults.addressResolver, strategy: 'off' },
      autoReload: false,
      portStart: TEST_PORT_START,
    },
  };
};

const readProfile = (config) => readFile(config.surgeConfigPath, 'utf8');

const policyGroupLine = async (config) =>
  (await readProfile(config)).split('\n').find((line) => line.startsWith(`${config.policyGroupName} =`));

const nodeConfigFiles = async (config) =>
  (await readdir(config.outputDir)).filter((entry) => /^sing-box\[\d+\]\.json$/.test(entry)).sort();

const captureConsole = async (method, run) => {
  const original = console[method];
  const lines = [];
  console[method] = (...args) => lines.push(args.join(' '));
  try {
    await run();
  } finally {
    console[method] = original;
  }

  return lines.join('\n');
};

module.exports = {
  PROFILE_TEXT,
  STUB_SING_BOX,
  TEST_PORT_START,
  captureConsole,
  makeConfig,
  nodeConfigFiles,
  policyGroupLine,
  readProfile,
  subscriptionUrl,
  vlessLink,
};
