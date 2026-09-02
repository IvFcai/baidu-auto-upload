export const ACCOUNT_PREFERENCE_KEY = 'baidu-video-relay.account';

export function saveAccountPreference(storage, { accountName, accountId, loginGroup, folder } = {}) {
  const normalizedFolder = String(folder || '').trim();
  const preference = {
    accountName: String(accountName || '').trim(),
    accountId: String(accountId || '').trim(),
    loginGroup: String(loginGroup || 'auto').trim() || 'auto',
    ...(normalizedFolder ? { folder: normalizedFolder } : {})
  };
  if (!preference.accountName || !preference.accountId) {
    throw new TypeError('账户名称和账户 ID 不能为空');
  }
  storage.setItem(ACCOUNT_PREFERENCE_KEY, JSON.stringify(preference));
  return preference;
}

export function loadAccountPreference(storage) {
  try {
    const raw = storage?.getItem(ACCOUNT_PREFERENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const accountName = String(parsed?.accountName || '').trim();
    const accountId = String(parsed?.accountId || '').trim();
    if (!accountName || !accountId) return null;
    const loginGroup = String(parsed?.loginGroup || 'auto').trim() || 'auto';
    const folder = String(parsed?.folder || '').trim();
    return { accountName, accountId, loginGroup, ...(folder ? { folder } : {}) };
  } catch {
    return null;
  }
}
