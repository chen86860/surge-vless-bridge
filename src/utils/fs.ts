import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

// The config holds subscription URLs, and the generated node files hold the UUIDs that act as each
// node's password, so nothing this tool writes should be readable by other users of the machine.
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export const pathExists = async (path: string) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export const readTextFile = async (path: string) => readFile(path, 'utf8');

export const readJsonFile = async <T>(path: string) => JSON.parse(await readTextFile(path)) as T;

// Written to a temporary file and renamed into place, so a crash or a full disk mid-write leaves the
// previous file intact instead of a truncated Surge profile. The rename targets the resolved path:
// replacing a symlinked profile (iCloud, dotfile managers) must update the file it points to, not swap
// the link for a regular file.
const writeAtomically = async (path: string, value: string | Uint8Array, { keepMode }: { keepMode: boolean }) => {
  const target = await realpath(path).catch(() => path);
  await mkdir(dirname(target), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });

  const existingMode = keepMode ? await stat(target).then((info) => info.mode & 0o777, () => undefined) : undefined;
  const temporaryPath = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, value, { flag: 'wx', mode: PRIVATE_FILE_MODE });
    if (existingMode !== undefined) {
      await chmod(temporaryPath, existingMode);
    }

    await rename(temporaryPath, target);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

export const writeTextFile = async (path: string, value: string) => writeAtomically(path, value, { keepMode: false });

export const writeBinaryFile = async (path: string, value: Uint8Array) =>
  writeAtomically(path, value, { keepMode: false });

// For files this tool edits but does not own, such as the Surge profile: written atomically like the
// rest, but their permissions are the user's choice and are left as they were.
export const replaceTextFile = async (path: string, value: string) => writeAtomically(path, value, { keepMode: true });

export const replaceBinaryFile = async (path: string, value: Uint8Array) =>
  writeAtomically(path, value, { keepMode: true });

export const isReadableByOthers = async (path: string) =>
  stat(path).then(
    (info) => (info.mode & 0o077) !== 0,
    () => false,
  );
