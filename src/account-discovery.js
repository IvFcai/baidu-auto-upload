function isAccountMissing(error) {
  return /搜索结果中找不到目标账户|找不到广告账户|目标账户 ID/.test(String(error?.message || error));
}

export async function discoverAccountsInContext(context, accounts, {
  timeout,
  sessionKey,
  logger,
  navigateToVideoLibrary,
  debugDir,
  onFound
}) {
  const found = [];
  const missing = [];
  for (const account of accounts) {
    const accountListPage = await context.newPage();
    const label = `${account.accountName}（${account.accountId}）`;
    const accountLogger = (message, tone = 'info') => logger(`[${label}] ${message}`, tone);
    try {
      accountLogger(`正在登录组 ${sessionKey} 中查找账户…`);
      const videoLibraryPage = await navigateToVideoLibrary(accountListPage, {
        accountId: account.accountId,
        accountName: account.accountName,
        timeout,
        openUpload: false,
        debugTag: account.accountId,
        ...(debugDir ? { debugDir } : {}),
        logger: accountLogger
      });
      const discovered = { account, page: videoLibraryPage };
      found.push(discovered);
      accountLogger(`已归入登录组 ${sessionKey}`, 'success');
      onFound?.(discovered);
    } catch (error) {
      if (isAccountMissing(error)) {
        missing.push(account);
        accountLogger('当前登录组未找到该账户，稍后换登录组重试', 'warning');
      } else {
        throw error;
      }
    }
  }
  return { found, missing };
}
