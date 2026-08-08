import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

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

export const ensurePrivateDirectory = async (path: string) => {
  const alreadyExists = await pathExists(path);
  await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  if (!alreadyExists) {
    await chmod(path, PRIVATE_DIRECTORY_MODE);
  }
};

const writeAtomically = async (path: string, value: string | Uint8Array) => {
  const destinationPath = await realpath(path).catch(() => path);
  await mkdir(dirname(destinationPath), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });

  const temporaryPath = join(
    dirname(destinationPath),
    `.${basename(destinationPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    if (typeof value === 'string') {
      await writeFile(temporaryPath, value, {
        encoding: 'utf8',
        flag: 'wx',
        mode: PRIVATE_FILE_MODE,
      });
    } else {
      await writeFile(temporaryPath, value, {
        flag: 'wx',
        mode: PRIVATE_FILE_MODE,
      });
    }

    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

export const writeTextFile = async (path: string, value: string) => writeAtomically(path, value);

export const writeBinaryFile = async (path: string, value: Uint8Array) => writeAtomically(path, value);
