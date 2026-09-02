import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountSearchQueries,
  accountSearchTabs,
  clearAccountSearchFilters,
  clickAndResolveDestination,
  clickAssetLibraryMenu,
  clickVideoLibraryMenu,
  clickVisibleText,
  findAccountRow,
  findUploadDialog,
  openUploadDialog,
  openVideoUpload,
  clickUploadVideoButton,
  submitAccountSearch
} from '../src/navigation.js';
import { waitForBaiduLoginCompletion } from '../src/navigation.js';

test('account lookup starts and stays in all advertising accounts', () => {
  assert.deepEqual(accountSearchTabs(), ['全部广告账户']);
});

test('navigate account flow reports when the automation profile is on the Baidu login page', async () => {
  const { navigateToVideoLibrary } = await import('../src/navigation.js');
  const page = {
    goto: async () => {},
    title: async () => '百度营销-登录',
    url: () => 'https://cc.baidu.com/homepage',
    content: async () => '<html><title>百度营销-登录</title></html>',
    screenshot: async () => {},
    waitForLoadState: async () => {}
  };
  await assert.rejects(
    () => navigateToVideoLibrary(page, { accountId: '1', accountName: 'test', timeout: 20, openUpload: false }),
    /自动化 Chrome 尚未登录百度/
  );
});

test('waitForBaiduLoginCompletion continues after the user finishes login', async () => {
  const titles = ['百度营销-登录', '百度营销-登录', '百度营销'];
  const messages = [];
  const page = {
    title: async () => titles.shift() || '百度营销',
    url: () => 'https://cc.baidu.com/homepage',
    waitForTimeout: async () => {}
  };

  await waitForBaiduLoginCompletion(page, { timeout: 100, logger: (message) => messages.push(message) });
  assert.equal(messages.length, 1);
});

test('clickAndResolveDestination switches to a newly opened ecommerce tab', async () => {
  const popup = { waitForLoadState: async () => {} };
  let clicked = false;
  const page = {
    context: () => ({ waitForEvent: async () => popup }),
    waitForURL: async () => new Promise(() => {})
  };

  const destination = await clickAndResolveDestination(page, async () => { clicked = true; }, { timeout: 20 });
  assert.equal(clicked, true);
  assert.equal(destination, popup);
});

test('clickVisibleText skips hidden duplicate text and clicks the visible menu item', async () => {
  const clicked = [];
  const candidates = [
    { isVisible: async () => false, click: async () => clicked.push('hidden') },
    { isVisible: async () => true, click: async () => clicked.push('visible') }
  ];
  const page = {
    getByText: () => ({ count: async () => candidates.length, nth: (index) => candidates[index] }),
    waitForTimeout: async () => {}
  };

  await clickVisibleText(page, '视频库', { timeout: 20 });
  assert.deepEqual(clicked, ['visible']);
});

test('clickAssetLibraryMenu falls back to the asset management label used by some ecommerce accounts', async () => {
  const actions = [];
  const page = {
    getByText: (text) => ({
      count: async () => text === '资产管理' ? 1 : 0,
      nth: () => ({ isVisible: async () => true, click: async () => actions.push(text) })
    }),
    waitForTimeout: async () => {}
  };

  await clickAssetLibraryMenu(page, { timeout: 20, logger: () => {} });
  assert.deepEqual(actions, ['资产管理']);
});

test('clickVideoLibraryMenu prefers the visible video library link after assets menu opens', async () => {
  const actions = [];
  const link = {
    isVisible: async () => true,
    scrollIntoViewIfNeeded: async () => actions.push('scroll-link'),
    click: async () => actions.push('click-video-link')
  };
  const page = {
    locator: (selector) => {
      assert.equal(selector, 'a[href*="/assetsCenter/creative/video/user/"]');
      return { count: async () => 1, nth: () => link };
    },
    getByText: () => {
      throw new Error('video library text fallback should not run when the real link is visible');
    }
  };

  await clickVideoLibraryMenu(page, { timeout: 20 });
  assert.deepEqual(actions, ['scroll-link', 'click-video-link']);
});

test('accountSearchQueries falls back from the full name to a stable account suffix', () => {
  assert.deepEqual(accountSearchQueries('baidu-nt-恰青春普化21'), [
    'baidu-nt-恰青春普化21',
    '恰青春普化21',
    '普化21'
  ]);
});

test('findAccountRow selects the result row by account ID and ignores filter text', async () => {
  const rows = [
    { text: '账户名称或备注：包含 baidu-nt-恰青春普化21', visible: true },
    { text: 'baidu-jt-卓腾普化21\nID: 80215095\n电商推广', visible: true },
    { text: 'baidu-nt-恰青春普化21\nID: 88193126\n电商推广', visible: true }
  ];
  const locators = rows.map((row) => ({
    isVisible: async () => row.visible,
    innerText: async () => row.text
  }));
  const page = {
    locator: () => ({ count: async () => locators.length, nth: (index) => locators[index] }),
    waitForTimeout: async () => {}
  };

  const result = await findAccountRow(page, { accountId: '88193126', timeout: 20 });
  assert.equal(result, locators[2]);
});

test('submitAccountSearch clicks the search icon to submit the account name', async () => {
  const actions = [];
  const searchButton = {
    isVisible: async () => true,
    click: async () => actions.push('click-search')
  };
  const buttons = { count: async () => 1, nth: () => searchButton };
  const input = {
    count: async () => 1,
    waitFor: async () => {},
    fill: async (value) => actions.push(['fill', value]),
    locator: () => ({ locator: () => buttons })
  };
  input.first = () => input;
  const empty = { count: async () => 0, first: () => ({}) };
  const page = {
    locator: (selector) => selector.startsWith('input[') ? input : empty,
    waitForTimeout: async () => {}
  };

  assert.equal(await submitAccountSearch(page, '普化21', { timeout: 20 }), true);
  assert.deepEqual(actions, [['fill', '普化21'], 'click-search']);
});

test('clearAccountSearchFilters removes the previous Baidu filter before retrying', async () => {
  const actions = [];
  const clearButton = {
    count: async () => 1,
    isVisible: async () => true,
    click: async () => actions.push('clear')
  };
  const filterList = {
    count: async () => 1,
    getByText: () => clearButton
  };
  filterList.first = () => filterList;
  const page = {
    locator: () => filterList,
    waitForTimeout: async () => actions.push('wait')
  };

  assert.equal(await clearAccountSearchFilters(page), true);
  assert.deepEqual(actions, ['clear', 'wait']);
});

test('openVideoUpload clicks assets, video library, and upload video in order', async () => {
  const actions = [];
  const dialogInput = { count: async () => 1, first() { return this; } };
  const dialog = { waitFor: async () => actions.push('upload-dialog'), locator: () => dialogInput };
  const uploadButton = {
    count: async () => 1,
    nth: () => ({
      isVisible: async () => true,
      click: async () => actions.push('上传视频')
    })
  };
  const page = {
    getByText: (text) => ({
      count: async () => 1,
      nth: () => ({
        isVisible: async () => true,
        click: async () => actions.push(text)
      })
    }),
    locator: (selector) => {
      if (selector.includes('role="dialog"')) return { filter: () => ({ first: () => dialog }) };
      if (selector.includes('.btn-upload')) return uploadButton;
      return { count: async () => 0 };
    },
    waitForTimeout: async () => {},
    waitForURL: async () => actions.push('video-url'),
    url: () => 'https://shoppingads.baidu.com/shop/assetsCenter/creative/video/user/123'
  };

  await openVideoUpload(page, { timeout: 20, logger: () => {} });
  assert.deepEqual(actions, ['资产中心', '视频库', 'video-url', '上传视频', 'upload-dialog']);
});

test('openVideoUpload re-enters the video library when a previously discovered page shows the ecommerce homepage', async () => {
  const actions = [];
  let inVideoLibrary = false;
  const input = { count: async () => 1, first() { return this; } };
  const dialog = { count: async () => 1, isVisible: async () => true, waitFor: async () => {}, locator: () => input };
  const uploadButton = {
    count: async () => 1,
    nth: () => ({ isVisible: async () => true, click: async () => actions.push('上传视频') })
  };
  const page = {
    url: () => 'https://shoppingads.baidu.com/shop/loading',
    locator: (selector) => selector.includes('.btn-upload')
      ? uploadButton
      : { filter: () => ({ first: () => dialog }) },
    getByText: (text) => text === '完整视频'
      ? { count: async () => inVideoLibrary ? 1 : 0, nth: () => ({ isVisible: async () => true }) }
      : {
        count: async () => 1,
        nth: () => ({
          isVisible: async () => true,
          click: async () => {
            actions.push(text);
            if (text === '视频库') inVideoLibrary = true;
          }
        })
      },
    waitForTimeout: async () => {},
    waitForURL: async () => actions.push('unexpected-navigation')
  };

  await openVideoUpload(page, { assumeVideoLibrary: true, timeout: 20, logger: () => {} });
  assert.deepEqual(actions, ['资产中心', '视频库', 'unexpected-navigation', '上传视频']);
});

test('openUploadDialog fails when clicking upload video does not open the batch dialog', async () => {
  const page = {
    getByText: () => ({
      count: async () => 1,
      nth: () => ({ isVisible: async () => true, click: async () => {} })
    }),
    locator: () => ({ filter: () => ({ first: () => ({ waitFor: async () => { throw new Error('timeout'); } }) }) }),
    waitForTimeout: async () => {}
  };

  await assert.rejects(() => openUploadDialog(page, { timeout: 20 }), /上传弹窗未打开/);
});

test('openUploadDialog clicks upload only once while the batch panel is mounting', async () => {
  let ready = false;
  let clicks = 0;
  const input = { count: async () => 1, first() { return this; } };
  const dialog = {
    count: async () => ready ? 1 : 0,
    isVisible: async () => ready,
    locator: () => input,
    waitFor: async () => {}
  };
  const button = {
    count: async () => 1,
    nth: () => ({ isVisible: async () => true, click: async () => { clicks += 1; } })
  };
  const page = {
    locator: (selector) => selector.includes('.btn-upload')
      ? button
      : { filter: () => ({ first: () => dialog }) },
    getByText: () => ({ count: async () => 0 }),
    waitForTimeout: async () => { ready = true; }
  };

  await openUploadDialog(page, { timeout: 50 });
  assert.equal(clicks, 1);
});

test('clickUploadVideoButton clicks the outer role button instead of its intercepted text span', async () => {
  const actions = [];
  const button = {
    count: async () => 1,
    isVisible: async () => true,
    click: async () => actions.push('outer-button')
  };
  button.first = () => button;
  const page = {
    locator: (selector) => selector.includes('.btn-upload') ? button : { count: async () => 0 },
    getByText: () => ({
      count: async () => 1,
      nth: () => ({ click: async () => actions.push('inner-span') })
    }),
    waitForTimeout: async () => {}
  };

  await clickUploadVideoButton(page, { timeout: 20 });
  assert.deepEqual(actions, ['outer-button']);
});

test('clickUploadVideoButton finds a visible upload button when Baidu omits the btn-upload class', async () => {
  const actions = [];
  const button = {
    count: async () => 1,
    nth: () => ({
      isVisible: async () => true,
      click: async () => actions.push('generic-upload-button')
    })
  };
  const empty = { count: async () => 0 };
  const page = {
    locator: (selector) => selector.includes('button:has-text') ? button : empty,
    getByText: () => ({ count: async () => 0 })
  };

  await clickUploadVideoButton(page, { timeout: 20 });
  assert.deepEqual(actions, ['generic-upload-button']);
});

test('clickUploadVideoButton supports the accessible button name used by the upload toolbar', async () => {
  const actions = [];
  const roleButton = {
    count: async () => 1,
    nth: () => ({
      isVisible: async () => true,
      click: async () => actions.push('role-button')
    })
  };
  const page = {
    getByRole: () => roleButton,
    locator: () => ({ count: async () => 0 }),
    getByText: () => ({ count: async () => 0 })
  };

  await clickUploadVideoButton(page, { timeout: 20 });
  assert.deepEqual(actions, ['role-button']);
});

test('clickUploadVideoButton falls back to clicking the visible DOM ancestor found by page evaluation', async () => {
  const actions = [];
  const page = {
    locator: () => ({ count: async () => 0 }),
    getByText: () => ({ count: async () => 0 }),
    evaluate: async (callback) => {
      const result = callback.toString();
      assert.match(result, /上传视频/);
      actions.push('evaluated-dom-click');
      return true;
    }
  };

  await clickUploadVideoButton(page, { timeout: 20 });
  assert.deepEqual(actions, ['evaluated-dom-click']);
});

test('clickUploadVideoButton uses the evaluated button coordinates for a trusted mouse click', async () => {
  const actions = [];
  const page = {
    locator: () => ({ count: async () => 0 }),
    getByText: () => ({ count: async () => 0 }),
    evaluate: async () => ({ x: 42, y: 24, tagName: 'DIV' }),
    mouse: { click: async (x, y) => actions.push([x, y]) }
  };

  await clickUploadVideoButton(page, { timeout: 20 });
  assert.deepEqual(actions, [[42, 24]]);
});

test('clickUploadVideoButton can run native and mouse fallbacks after Playwright click success', async () => {
  const actions = [];
  const button = {
    count: async () => 1,
    nth: () => ({
      isVisible: async () => true,
      click: async () => actions.push('playwright-click'),
      evaluate: async () => actions.push('native-click'),
      boundingBox: async () => ({ x: 10, y: 20, width: 40, height: 20 })
    })
  };
  const page = {
    locator: (selector) => selector.includes('.btn-upload') ? button : { count: async () => 0 },
    getByText: () => ({ count: async () => 0 }),
    mouse: { click: async (x, y) => actions.push(['mouse-click', x, y]) }
  };

  await clickUploadVideoButton(page, { timeout: 20, forceFallback: true });
  assert.deepEqual(actions, ['native-click', 'playwright-click', 'native-click', ['mouse-click', 30, 30]]);
});

test('findUploadDialog recognizes Baidu batch upload content without a standard dialog role', async () => {
  const uploadPanelInput = { count: async () => 1, first() { return this; } };
  const uploadPanel = { waitFor: async () => {}, locator: () => uploadPanelInput, marker: 'batch-panel' };
  const title = {
    count: async () => 1,
    nth: () => ({
      isVisible: async () => true,
      locator: () => ({ first: () => uploadPanel })
    })
  };
  const page = {
    getByText: (pattern) => pattern instanceof RegExp ? title : { count: async () => 0 },
    locator: () => ({ filter: () => ({ first: () => ({ count: async () => 0 }) }) })
  };

  assert.equal(await findUploadDialog(page), uploadPanel);
});

test('findUploadDialog recognizes the upload dialog before the plus creates a file input', async () => {
  const plus = { count: async () => 1, first() { return this; } };
  const uploadDialog = {
    count: async () => 1,
    isVisible: async () => true,
    locator: (selector) => selector.includes('video-box') ? plus : { count: async () => 0, first() { return this; } },
    marker: 'empty-upload-dialog'
  };
  const page = {
    locator: () => ({
      filter: () => ({ first: () => uploadDialog })
    }),
    getByText: () => ({ count: async () => 0 })
  };

  const found = await findUploadDialog(page);
  assert.equal(found, uploadDialog);
});

test('findUploadDialog recognizes a batch panel whose plus is only visible text', async () => {
  const plus = { count: async () => 1, first() { return this; } };
  const uploadDialog = {
    count: async () => 1,
    isVisible: async () => true,
    locator: () => ({ count: async () => 0, first() { return this; } }),
    getByText: (text) => text === '+'
      ? { count: async () => 1, first: () => plus }
      : { count: async () => 0 }
  };
  const page = {
    locator: () => ({
      filter: () => ({ first: () => uploadDialog })
    }),
    getByText: () => ({ count: async () => 0 })
  };

  assert.equal(await findUploadDialog(page), uploadDialog);
});

test('findUploadDialog ignores hidden standard modal nodes and uses the visible batch panel', async () => {
  const hiddenModal = {
    count: async () => 1,
    isVisible: async () => false
  };
  const uploadPanelInput = { count: async () => 1, first() { return this; } };
  const uploadPanel = {
    waitFor: async () => {},
    locator: () => uploadPanelInput,
    marker: 'visible-batch-panel'
  };
  const title = {
    count: async () => 1,
    nth: () => ({
      isVisible: async () => true,
      locator: () => ({ first: () => uploadPanel })
    })
  };
  const page = {
    locator: () => ({ filter: () => ({ first: () => hiddenModal }) }),
    getByText: () => title
  };

  assert.equal(await findUploadDialog(page), uploadPanel);
});

test('findUploadDialog ignores visible non-upload containers and requires a file input', async () => {
  const visibleNonUpload = {
    count: async () => 1,
    isVisible: async () => true,
    locator: () => ({ count: async () => 0, first() { return this; } })
  };
  const uploadPanelInput = { count: async () => 1, first() { return this; } };
  const uploadPanel = { locator: () => uploadPanelInput, marker: 'real-upload-panel' };
  const title = {
    count: async () => 1,
    nth: () => ({
      isVisible: async () => true,
      locator: () => ({ first: () => uploadPanel })
    })
  };
  const page = {
    locator: () => ({ filter: () => ({ first: () => visibleNonUpload }) }),
    getByText: () => title
  };

  assert.equal(await findUploadDialog(page), uploadPanel);
});

test('findUploadDialog recognizes the visible upload modal when its file input is page-level', async () => {
  const uploadPanel = { waitFor: async () => {}, marker: 'modal-with-page-input' };
  const title = {
    count: async () => 1,
    nth: () => ({
      isVisible: async () => true,
      locator: () => ({ first: () => uploadPanel })
    })
  };
  const page = {
    locator: () => ({ filter: () => ({ first: () => ({ count: async () => 0 }) }) }),
    getByText: () => title
  };

  assert.equal(await findUploadDialog(page), uploadPanel);
});
