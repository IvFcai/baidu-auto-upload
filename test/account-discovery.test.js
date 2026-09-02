import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverAccountsInContext } from '../src/account-discovery.js';

test('account discovery forwards the ecommerce destination page to the upload queue', async () => {
  const account = { accountName: '示例账户', accountId: '123' };
  const accountListPage = { marker: 'account-list' };
  const videoLibraryPage = { marker: 'video-library' };
  const discovered = [];

  const result = await discoverAccountsInContext({
    newPage: async () => accountListPage
  }, [account], {
    timeout: 20,
    sessionKey: 'primary',
    logger: () => {},
    navigateToVideoLibrary: async (page, options) => {
      assert.equal(page, accountListPage);
      assert.deepEqual(options, {
        accountId: '123',
        accountName: '示例账户',
        timeout: 20,
        openUpload: false,
        debugTag: '123',
        logger: options.logger
      });
      return videoLibraryPage;
    },
    onFound: (item) => discovered.push(item)
  });

  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.found, [{ account, page: videoLibraryPage }]);
  assert.deepEqual(discovered, [{ account, page: videoLibraryPage }]);
});
