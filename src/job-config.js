import { DEFAULT_ACCOUNT_ID, DEFAULT_ACCOUNT_NAME } from './navigation.js';
import path from 'node:path';

export function resolveProfilePath(profile, stableRoot) {
  return path.isAbsolute(profile) ? profile : path.resolve(stableRoot, profile);
}

export function normalizeAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new TypeError('至少需要配置一个目标账户');
  }
  const normalized = accounts.map((account) => {
    const folder = String(account?.folder || '').trim();
    return {
      accountName: String(account?.accountName || '').trim(),
      accountId: String(account?.accountId || '').trim(),
      loginGroup: String(account?.loginGroup || 'auto').trim() || 'auto',
      ...(folder ? { folder } : {})
    };
  });
  if (normalized.some((account) => !account.accountName || !account.accountId)) {
    throw new TypeError('每个账户都必须填写账户名称和账户 ID');
  }
  const ids = new Set(normalized.map((account) => account.accountId));
  if (ids.size !== normalized.length) throw new TypeError('账户 ID 不能重复');
  return normalized;
}

export function buildJobConfig(input = {}) {
  const folder = String(input.folder || '').trim();
  const accountId = String(input.accountId || DEFAULT_ACCOUNT_ID).trim();
  const accountName = String(input.accountName || DEFAULT_ACCOUNT_NAME).trim();
  const batchSize = Number(input.batchSize ?? 12);
  const waitMinutes = Number(input.waitMinutes ?? 15);
  const recursive = Boolean(input.recursive);
  const profile = String(input.profile || '.baidu-profile').trim();

  if (!folder && !Array.isArray(input.accounts)) throw new TypeError('请先选择视频文件夹');
  if (!Number.isInteger(batchSize) || batchSize <= 0) throw new TypeError('批次大小必须是正整数');
  if (!Number.isInteger(waitMinutes) || waitMinutes <= 0) throw new TypeError('等待时间必须是正整数');
  if (!accountId) throw new TypeError('账户 ID 不能为空');
  if (!accountName) throw new TypeError('账户名称不能为空');
  if (!profile) throw new TypeError('浏览器配置目录不能为空');

  const config = { folder, accountId, accountName, batchSize, waitMinutes, recursive, profile };
  if (Array.isArray(input.accounts)) {
    const accounts = normalizeAccounts(input.accounts);
    if (accounts.some((account) => !account.folder) && !folder) {
      throw new TypeError('每个账户都需要选择视频文件夹，或设置默认视频文件夹');
    }
    const explicitFolders = accounts
      .filter((account) => account.folder)
      .map((account) => path.resolve(account.folder).toLowerCase());
    if (new Set(explicitFolders).size !== explicitFolders.length) {
      throw new TypeError('不同账户显式设置的视频文件夹不能相同');
    }
    config.accounts = accounts.map((account) => ({ ...account, folder: account.folder || folder }));
  }
  return config;
}

export function buildAccountJobConfig(input = {}, account = {}) {
  const config = buildJobConfig({
    ...input,
    accountName: account.accountName,
    accountId: account.accountId,
    accounts: [account]
  });
  return { ...config, accounts: [config.accounts[0]] };
}
