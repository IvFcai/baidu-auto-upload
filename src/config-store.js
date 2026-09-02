import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function loadSavedAccountsSync(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadSavedAccounts(filePath, { readFile = fs.readFile } = {}) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return null;
  }
}

export async function saveSavedAccounts(filePath, accounts, {
  mkdir = fs.mkdir,
  writeFile = fs.writeFile
} = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(accounts), 'utf8');
  return accounts;
}
