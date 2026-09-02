import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSavedAccounts, loadSavedAccountsSync, saveSavedAccounts } from '../src/config-store.js';

test('saved account config round-trips through the application backup file', async () => {
  let written;
  const accounts = [{ accountName: '目标账户', accountId: '123', folder: 'D:/videos' }];
  await saveSavedAccounts('C:/app/accounts.json', accounts, {
    mkdir: async () => {},
    writeFile: async (_path, value) => { written = value; }
  });
  assert.deepEqual(await loadSavedAccounts('C:/app/accounts.json', {
    readFile: async () => written
  }), accounts);
});

test('missing or malformed account backup is ignored', async () => {
  assert.equal(await loadSavedAccounts('C:/missing/accounts.json', {
    readFile: async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; }
  }), null);
  assert.equal(await loadSavedAccounts('C:/bad/accounts.json', {
    readFile: async () => 'not-json'
  }), null);
});

test('synchronous account backup loading is available before the first renderer paint', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'baidu-config-'));
  const filePath = path.join(directory, 'accounts.json');
  await fs.writeFile(filePath, JSON.stringify([{ accountId: '123' }]));
  assert.deepEqual(loadSavedAccountsSync(filePath), [{ accountId: '123' }]);
});
