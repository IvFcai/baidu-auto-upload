import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeDownloadUrl, findChromeExecutable } from '../src/chrome-check.js';

test('findChromeExecutable checks standard Windows Chrome locations', async () => {
  const checked = [];
  const found = await findChromeExecutable({
    platform: 'win32',
    env: {
      LOCALAPPDATA: 'C:/Users/Alice/AppData/Local',
      PROGRAMFILES: 'C:/Program Files',
      'PROGRAMFILES(X86)': 'C:/Program Files (x86)'
    },
    access: async (candidate) => {
      checked.push(candidate);
      if (candidate.replaceAll('\\', '/').endsWith('Google/Chrome/Application/chrome.exe')) return;
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    }
  });

  assert.ok(found.replaceAll('\\', '/').endsWith('Google/Chrome/Application/chrome.exe'));
  assert.ok(checked.length >= 1);
});

test('chromeDownloadUrl points to the official Chrome download page', () => {
  assert.equal(chromeDownloadUrl(), 'https://www.google.com/chrome/');
});
