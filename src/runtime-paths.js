import fs from 'node:fs/promises';
import path from 'node:path';

export function buildRuntimePaths({ userDataPath, legacyRoot = process.cwd() } = {}) {
  const root = path.resolve(String(userDataPath || path.join(process.cwd(), '.baidu-video-uploader')));
  const profileRoot = path.join(root, 'profiles');
  return {
    root,
    profileRoot,
    primaryProfile: path.join(profileRoot, '.chrome-profile'),
    accountProfile: (accountId) => path.join(profileRoot, `.chrome-profile-account-${String(accountId || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown'}`),
    loginProfile: (key) => path.join(profileRoot, `.chrome-profile-login-${String(key || 'auto').replace(/[^a-zA-Z0-9_-]/g, '_') || 'auto'}`),
    debugRoot: path.join(root, 'debug'),
    legacyRoot: path.resolve(legacyRoot)
  };
}

export function shouldMigrateLegacyProfile({ legacyExists, targetExists }) {
  return Boolean(legacyExists && !targetExists);
}

export async function migrateLegacyProfile({ legacyPath, targetPath, access = fs.access, copy = fs.cp, mkdir = fs.mkdir } = {}) {
  let legacyExists = true;
  let targetExists = true;
  try { await access(legacyPath); } catch { legacyExists = false; }
  try { await access(targetPath); } catch { targetExists = false; }
  if (!shouldMigrateLegacyProfile({ legacyExists, targetExists })) return false;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copy(legacyPath, targetPath, { recursive: true, errorOnExist: true });
  return true;
}

export async function ensureRuntimePaths(paths, { mkdir = fs.mkdir } = {}) {
  await mkdir(paths.profileRoot, { recursive: true });
  await mkdir(paths.debugRoot, { recursive: true });
  return paths;
}
