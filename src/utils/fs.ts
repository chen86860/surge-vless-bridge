import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';

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

export const writeTextFile = async (path: string, value: string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, 'utf8');
};

export const writeBinaryFile = async (path: string, value: Uint8Array) => {
  await writeFile(path, value);
};
