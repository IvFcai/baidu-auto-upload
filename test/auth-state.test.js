import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterBaiduAuthState,
  loadEncryptedAuthState,
  localStorageInitScript,
  restoreBaiduAuthState,
  saveEncryptedAuthState
} from '../src/auth-state.js';

test('filterBaiduAuthState keeps only Baidu cookies and storage origins', () => {
  const result = filterBaiduAuthState({
    cookies: [
      { name: 'session', domain: '.baidu.com', value: 'a' },
      { name: 'other', domain: '.example.com', value: 'b' }
    ],
    origins: [
      { origin: 'https://cc.baidu.com', localStorage: [{ name: 'token', value: 'x' }] },
      { origin: 'https://example.com', localStorage: [{ name: 'other', value: 'y' }] }
    ]
  });
  assert.deepEqual(result, {
    cookies: [{ name: 'session', domain: '.baidu.com', value: 'a' }],
    origins: [{ origin: 'https://cc.baidu.com', localStorage: [{ name: 'token', value: 'x' }] }]
  });
});

test('localStorageInitScript restores values only for the matching origin', () => {
  const restore = localStorageInitScript([
    { origin: 'https://cc.baidu.com', localStorage: [{ name: 'token', value: 'x' }] }
  ]);
  const values = new Map();
  restore({
    origin: 'https://cc.baidu.com',
    setItem: (name, value) => values.set(name, value)
  });
  assert.equal(values.get('token'), 'x');
});

test('encrypted auth state round-trips without writing plaintext credentials', async () => {
  let written;
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(Buffer.from(value, 'utf8').toString('base64'), 'utf8'),
    decryptString: (value) => Buffer.from(value.toString('utf8'), 'base64').toString('utf8')
  };
  const state = {
    cookies: [{ name: 'session', domain: '.baidu.com', value: 'secret' }],
    origins: [{ origin: 'https://cc.baidu.com', localStorage: [{ name: 'token', value: 'secret-token' }] }]
  };

  const saved = await saveEncryptedAuthState('C:/state.bin', state, {
    safeStorage,
    mkdir: async () => {},
    writeFile: async (_filePath, contents) => { written = contents; }
  });
  assert.equal(saved, true);
  assert.equal(written.toString('utf8').includes('secret-token'), false);

  const loaded = await loadEncryptedAuthState('C:/state.bin', {
    safeStorage,
    readFile: async () => written
  });
  assert.deepEqual(loaded, state);
});

test('restoreBaiduAuthState injects cookies and local storage before navigation', async () => {
  const calls = [];
  const context = {
    addCookies: async (cookies) => calls.push(['cookies', cookies]),
    addInitScript: async (fn, arg) => calls.push(['script', fn, arg])
  };
  const state = {
    cookies: [{ name: 'session', domain: '.baidu.com', value: 'a' }],
    origins: [{ origin: 'https://cc.baidu.com', localStorage: [{ name: 'token', value: 'x' }] }]
  };

  await restoreBaiduAuthState(context, state);
  assert.deepEqual(calls[0], ['cookies', state.cookies]);
  assert.equal(calls[1][0], 'script');
  assert.deepEqual(calls[1][2], state.origins);
});
