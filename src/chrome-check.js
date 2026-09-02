import fs from 'node:fs/promises';
import path from 'node:path';

export function chromeDownloadUrl() {
  return 'https://www.google.com/chrome/';
}

export function chromeCandidates({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return [];
  return [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
}

export async function findChromeExecutable({ platform = process.platform, env = process.env, access = fs.access } = {}) {
  for (const candidate of chromeCandidates({ platform, env })) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

export function chromeLaunchConfiguration({ executablePath } = {}) {
  return executablePath ? { executablePath } : { channel: 'chrome' };
}
