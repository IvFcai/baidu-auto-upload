import fs from 'node:fs/promises';
import path from 'node:path';

function isBaiduHost(hostname) {
  const normalized = String(hostname || '').replace(/^\.+/, '').toLowerCase();
  return normalized === 'baidu.com' || normalized.endsWith('.baidu.com');
}

function isBaiduOrigin(origin) {
  try {
    return isBaiduHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function filterBaiduAuthState(state = {}) {
  return {
    cookies: Array.isArray(state.cookies)
      ? state.cookies.filter((cookie) => isBaiduHost(cookie.domain))
      : [],
    origins: Array.isArray(state.origins)
      ? state.origins.filter((entry) => isBaiduOrigin(entry.origin))
      : []
  };
}

export function localStorageInitScript(origins = []) {
  return ({ origin, setItem }) => {
    const matching = origins.find((entry) => entry.origin === origin);
    for (const item of matching?.localStorage || []) setItem(item.name, item.value);
  };
}

function applySavedLocalStorage(origins) {
  const matching = origins.find((entry) => entry.origin === window.location.origin);
  for (const item of matching?.localStorage || []) window.localStorage.setItem(item.name, item.value);
}

export async function restoreBaiduAuthState(context, state) {
  const filtered = filterBaiduAuthState(state);
  if (filtered.cookies.length) await context.addCookies(filtered.cookies);
  if (filtered.origins.length) await context.addInitScript(applySavedLocalStorage, filtered.origins);
  return filtered;
}

export async function saveEncryptedAuthState(filePath, state, {
  safeStorage,
  mkdir = fs.mkdir,
  writeFile = fs.writeFile
} = {}) {
  if (!safeStorage?.isEncryptionAvailable()) return false;
  const filtered = filterBaiduAuthState(state);
  const encrypted = safeStorage.encryptString(JSON.stringify(filtered));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, encrypted);
  return true;
}

export async function loadEncryptedAuthState(filePath, {
  safeStorage,
  readFile = fs.readFile
} = {}) {
  if (!safeStorage?.isEncryptionAvailable()) return null;
  let encrypted;
  try {
    encrypted = await readFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  return filterBaiduAuthState(JSON.parse(safeStorage.decryptString(encrypted)));
}
