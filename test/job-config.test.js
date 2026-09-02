import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DEFAULT_ACCOUNT_ID, DEFAULT_ACCOUNT_NAME } from '../src/navigation.js';
import { buildAccountJobConfig, buildJobConfig, normalizeAccounts, resolveProfilePath } from '../src/job-config.js';
import { buildFolderDialogOptions } from '../src/folder-dialog.js';

test('buildJobConfig applies the known account name and standard batch defaults', () => {
  assert.deepEqual(buildJobConfig({ folder: 'D:/videos' }), {
    folder: 'D:/videos',
    accountId: DEFAULT_ACCOUNT_ID,
    accountName: DEFAULT_ACCOUNT_NAME,
    batchSize: 12,
    waitMinutes: 15,
    recursive: false,
    profile: '.baidu-profile'
  });
});

test('buildJobConfig preserves user choices and rejects invalid values', () => {
  assert.deepEqual(buildJobConfig({
    folder: '\\\\192.168.1.206\\e\\clips', accountId: '123', accountName: '目标账户',
    batchSize: 6, waitMinutes: 30, recursive: true, profile: '.profile'
  }), {
    folder: '\\\\192.168.1.206\\e\\clips', accountId: '123', accountName: '目标账户',
    batchSize: 6, waitMinutes: 30, recursive: true, profile: '.profile'
  });
  assert.throws(() => buildJobConfig({ folder: '' }), /视频文件夹/);
  assert.throws(() => buildJobConfig({ folder: 'D:/videos', batchSize: 0 }), /批次/);
  assert.throws(() => buildJobConfig({ folder: 'D:/videos', waitMinutes: 0 }), /等待/);
});

test('resolveProfilePath turns the browser profile into a stable absolute path', () => {
  assert.equal(resolveProfilePath('.baidu-profile', 'D:/BaiduVideoRelay'), path.resolve('D:/BaiduVideoRelay/.baidu-profile'));
  assert.equal(resolveProfilePath('D:/custom-profile', 'D:/BaiduVideoRelay'), 'D:/custom-profile');
});

test('buildJobConfig normalizes multiple account rows while preserving the shared upload settings', () => {
  const config = buildJobConfig({
    folder: 'D:/videos',
    accounts: [
      { accountName: '账户一', accountId: '101' },
      { accountName: '  账户二 ', accountId: ' 202 ' }
    ]
  });
  assert.deepEqual(config.accounts, [
    { accountName: '账户一', accountId: '101', loginGroup: 'auto', folder: 'D:/videos' },
    { accountName: '账户二', accountId: '202', loginGroup: 'auto', folder: 'D:/videos' }
  ]);
});

test('buildJobConfig lets every account use its own video folder without a global folder', () => {
  const config = buildJobConfig({
    accounts: [
      { accountName: '账户一', accountId: '101', folder: 'D:/videos/account-one' },
      { accountName: '账户二', accountId: '202', folder: 'D:/videos/account-two', loginGroup: 'A' }
    ]
  });

  assert.equal(config.folder, '');
  assert.deepEqual(config.accounts, [
    { accountName: '账户一', accountId: '101', loginGroup: 'auto', folder: 'D:/videos/account-one' },
    { accountName: '账户二', accountId: '202', loginGroup: 'A', folder: 'D:/videos/account-two' }
  ]);
});

test('buildJobConfig rejects duplicate explicit video folders for different accounts', () => {
  assert.throws(() => buildJobConfig({
    accounts: [
      { accountName: '账户一', accountId: '101', folder: 'D:/videos/shared' },
      { accountName: '账户二', accountId: '202', folder: 'D:/videos/shared' }
    ]
  }), /视频文件夹不能相同/);
});

test('normalizeAccounts preserves explicit login groups for shared browser sessions', () => {
  assert.deepEqual(normalizeAccounts([
    { accountName: '账户一', accountId: '101', loginGroup: 'group-a' },
    { accountName: '账户二', accountId: '202', loginGroup: ' group-a ' }
  ]), [
    { accountName: '账户一', accountId: '101', loginGroup: 'group-a' },
    { accountName: '账户二', accountId: '202', loginGroup: 'group-a' }
  ]);
});

test('normalizeAccounts rejects incomplete account rows', () => {
  assert.throws(() => normalizeAccounts([{ accountName: '账户一', accountId: '' }]), /每个账户/);
  assert.throws(() => normalizeAccounts([
    { accountName: '账户一', accountId: '101' },
    { accountName: '账户一副本', accountId: '101' }
  ]), /不能重复/);
});

test('buildAccountJobConfig isolates one account while preserving shared upload settings', () => {
  const config = buildAccountJobConfig({
    folder: 'D:/videos', batchSize: 6, waitMinutes: 20, recursive: true, profile: '.profile'
  }, { accountName: '账户二', accountId: '202', loginGroup: '组 A' });

  assert.deepEqual(config, {
    folder: 'D:/videos',
    accountId: '202',
    accountName: '账户二',
    batchSize: 6,
    waitMinutes: 20,
    recursive: true,
    profile: '.profile',
    accounts: [{ accountName: '账户二', accountId: '202', loginGroup: '组 A', folder: 'D:/videos' }]
  });
});

test('folder dialog keeps the selected UNC account path as its default location', () => {
  assert.deepEqual(buildFolderDialogOptions({ defaultPath: ' \\\\192.168.1.206\\e\\account-two ' }), {
    properties: ['openDirectory'],
    title: '选择视频文件夹',
    defaultPath: '\\\\192.168.1.206\\e\\account-two'
  });
});
