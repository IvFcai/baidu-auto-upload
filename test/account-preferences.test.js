import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_PREFERENCE_KEY,
  loadAccountPreference,
  saveAccountPreference
} from '../src/account-preferences.js';

test('account preferences save and restore the selected name and ID', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };

  const saved = saveAccountPreference(storage, {
    accountName: '  目标账户  ',
    accountId: ' 12345 ',
    loginGroup: '组 A'
  });
  assert.deepEqual(saved, { accountName: '目标账户', accountId: '12345', loginGroup: '组 A' });
  assert.equal(values.has(ACCOUNT_PREFERENCE_KEY), true);
  assert.deepEqual(loadAccountPreference(storage), saved);
});

test('account preferences ignore malformed or incomplete saved data', () => {
  const storage = {
    getItem: () => JSON.stringify({ accountName: '', accountId: '123' })
  };
  assert.equal(loadAccountPreference(storage), null);
});

test('account preferences default a missing login group to automatic discovery', () => {
  const storage = { getItem: () => JSON.stringify({ accountName: '目标账户', accountId: '12345' }) };
  assert.deepEqual(loadAccountPreference(storage), { accountName: '目标账户', accountId: '12345', loginGroup: 'auto' });
});

test('account preferences preserve the account video folder', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };

  const saved = saveAccountPreference(storage, {
    accountName: '目标账户', accountId: '12345', folder: ' D:/videos/target '
  });
  assert.deepEqual(saved, {
    accountName: '目标账户', accountId: '12345', loginGroup: 'auto', folder: 'D:/videos/target'
  });
  assert.deepEqual(loadAccountPreference(storage), saved);
});
