const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { chmod, mkdtemp, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LAUNCHER_SCRIPT } = require('../dist/utils/launcher.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Stands in for sing-box: `check` passes, `run` idles. It is a shell loop rather than `exec sleep` so
// the process keeps `run -c <config>` in its command line, which is how the launcher recognises it.
const STUB = '#!/bin/sh\n[ "$1" = check ] && exit 0\nwhile :; do sleep 1; done\n';

const setup = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'svb-launcher-'));
  const launcher = path.join(dir, 'launcher.sh');
  const stub = path.join(dir, 'fake-sing-box');
  const config = path.join(dir, 'sing-box.json');
  await writeFile(launcher, LAUNCHER_SCRIPT, 'utf8');
  await writeFile(stub, STUB, 'utf8');
  await chmod(stub, 0o755);
  await writeFile(config, '{"version":1}\n', 'utf8');

  const launchers = [];
  const start = () => {
    const child = spawn('/bin/sh', [launcher, stub], { stdio: 'ignore' });
    launchers.push(child);
    return child;
  };

  const singBoxPids = () => {
    try {
      return execFileSync('pgrep', ['-f', `${stub} run -c ${config}`], { encoding: 'utf8' }).trim().split('\n');
    } catch {
      return [];
    }
  };

  const stop = (child) =>
    new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill('SIGTERM');
    });

  const cleanup = async () => {
    await Promise.all(launchers.filter((child) => child.exitCode === null).map(stop));
    for (const pid of singBoxPids()) {
      process.kill(Number(pid), 'SIGKILL');
    }
  };

  return { dir, config, start, stop, singBoxPids, cleanup };
};

test('launchers share one sing-box and the last one to exit stops it', async (t) => {
  const env = await setup();
  t.after(env.cleanup);

  const first = env.start();
  const second = env.start();
  const third = env.start();
  await sleep(1500);
  assert.equal(env.singBoxPids().length, 1);

  await env.stop(first);
  await env.stop(second);
  await sleep(300);
  assert.equal(env.singBoxPids().length, 1);

  await env.stop(third);
  await sleep(300);
  assert.deepEqual(env.singBoxPids(), []);
});

test('a launcher restarts sing-box once the config changes', async (t) => {
  const env = await setup();
  t.after(env.cleanup);

  env.start();
  await sleep(1500);
  const [before] = env.singBoxPids();
  assert.ok(before);

  await writeFile(env.config, '{"version":2}\n', 'utf8');
  // The launcher compares the config on a 5s heartbeat.
  await sleep(6500);

  const after = env.singBoxPids();
  assert.equal(after.length, 1);
  assert.notEqual(after[0], before);
});

// `clean` removes the config and the run directory while Surge may still hold launchers. They used to
// spin forever waiting for a lock whose parent directory no longer existed.
test('launchers exit once clean removed the config and the run directory', async (t) => {
  const env = await setup();
  t.after(env.cleanup);

  const child = env.start();
  await sleep(1500);
  for (const pid of env.singBoxPids()) {
    process.kill(Number(pid), 'SIGTERM');
  }
  await rm(env.config);
  await rm(path.join(env.dir, 'run'), { recursive: true, force: true });

  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    sleep(7000).then(() => false),
  ]);
  assert.equal(exited, true);
});

test('a launcher stopped after clean still exits', async (t) => {
  const env = await setup();
  t.after(env.cleanup);

  const child = env.start();
  await sleep(1500);
  await rm(path.join(env.dir, 'run'), { recursive: true, force: true });

  const exited = await Promise.race([
    env.stop(child).then(() => true),
    sleep(3000).then(() => false),
  ]);
  assert.equal(exited, true);
});
