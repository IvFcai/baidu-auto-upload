export const DEFAULT_ACCOUNT_ID = '88193126';
export const DEFAULT_ACCOUNT_NAME = 'baidu-nt-恰青春普化21';
export const ACCOUNT_HOME_URL = 'https://cc.baidu.com/homepage';
const ACCOUNT_TAB = '全部广告账户';
const ACCOUNT_ROW_SELECTOR = '.widget-Homepage-UserList_container .one-table-body tbody tr, .one-table-body tbody tr';
export const UPLOAD_DIALOG_SELECTOR = '[role="dialog"], .one-dialog, [class*="modal"]';

function safeDebugTag(value) {
  return String(value || 'unknown').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
}

export async function clickVisibleText(page, text, { exact = true, timeout = 120000 } = {}) {
  const locator = page.getByText(text, { exact });
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click();
        return candidate;
      }
    }
    if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(250);
    else await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`页面中找不到可见的“${text}”`);
}

export async function waitForBaiduLoginCompletion(page, { timeout = 120000, logger = () => {} } = {}) {
  const startedAt = Date.now();
  let warned = false;
  while (Date.now() - startedAt < timeout) {
    const title = await page.title?.().catch?.(() => '') || '';
    const url = typeof page.url === 'function' ? page.url() : '';
    const stillOnLogin = /登录/.test(title) || /\/login(?:[/?#]|$)/i.test(url);
    if (!stillOnLogin) return;
    if (!warned) {
      logger('检测到百度登录页面，请在当前 Chrome 窗口完成登录，登录成功后将自动继续…', 'warning');
      warned = true;
    }
    if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(250);
    else await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('自动化 Chrome 尚未登录百度，请在程序打开的 Chrome 窗口中扫码登录后重试');
}

export async function clickAssetLibraryMenu(page, { timeout = 120000, logger = () => {} } = {}) {
  let lastError;
  for (const label of ['资产中心', '资产管理']) {
    try {
      await clickVisibleText(page, label, { timeout: Math.min(timeout, 15000) });
      logger(`${label}菜单已展开，正在点击视频库…`);
      return label;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('页面中找不到资产中心/资产管理菜单');
}

export async function clickVideoLibraryMenu(page, { timeout = 120000 } = {}) {
  // 电商推广的资产中心菜单是 SPA 自定义组件，点击包裹文字的 span
  // 在部分账户上只会展开菜单而不会触发链接。优先点击真实可见链接。
  const links = page.locator('a[href*="/assetsCenter/creative/video/user/"]');
  const startedAt = Date.now();
  while (Date.now() - startedAt < Math.min(timeout, 10000)) {
    const count = await links.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const link = links.nth(index);
      if (!await link.isVisible().catch(() => false)) continue;
      await link.scrollIntoViewIfNeeded?.().catch?.(() => {});
      await link.click({ force: true, timeout: Math.min(timeout, 10000) });
      return link;
    }
    if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(250);
    else break;
  }
  return clickVisibleText(page, '视频库', { timeout });
}

export async function clickAndResolveDestination(page, click, { timeout = 120000, logger = () => {} } = {}) {
  const listPages = () => typeof page.context().pages === 'function' ? page.context().pages() : [];
  const beforePages = new Set(listPages());
  logger(`准备点击“电商推广”（当前标签页：${typeof page.url === 'function' ? page.url() : '未知'}，已有页面：${beforePages.size}）`);
  const popupPromise = page.context().waitForEvent('page', { timeout }).catch(() => null);
  const samePagePromise = page.waitForURL(/shoppingads\.baidu\.com/, { timeout }).then(() => page).catch(() => null);
  await click();
  const candidate = await Promise.race([popupPromise, samePagePromise]);
  const destination = candidate || listPages().find((item) => !beforePages.has(item));
  if (!destination) throw new Error('点击“电商推广”后未打开推广页面');
  const destinationUrl = () => typeof destination.url === 'function' ? destination.url() : '';
  logger(`已捕获电商推广页面（${destination === page ? '当前标签页' : '新标签页'}）：${destinationUrl() || '空白页'}`);

  // 百度有时先创建 about:blank，再异步设置真实地址；不要把空白页误判为成功。
  if (destination !== page && typeof destination.waitForURL === 'function' && !/shoppingads\.baidu\.com/.test(destinationUrl())) {
    await destination.waitForURL(/shoppingads\.baidu\.com/, { timeout }).catch(() => {});
  }
  await destination.waitForLoadState('domcontentloaded').catch(() => {});
  if (typeof destination.url === 'function' && !/shoppingads\.baidu\.com/.test(destinationUrl())) {
    throw new Error(`电商推广页面未完成跳转（当前地址：${destinationUrl() || '空白页'}）`);
  }
  return destination;
}

export function accountSearchQueries(accountName) {
  const fullName = String(accountName || '').trim();
  if (!fullName) return [];
  const parts = fullName.split('-');
  const descriptiveName = parts.length >= 3 ? parts.slice(2).join('-') : fullName;
  const suffix = Array.from(descriptiveName).slice(-4).join('');
  return [...new Set([fullName, descriptiveName, suffix].filter(Boolean))];
}

export function accountSearchTabs() {
  return [ACCOUNT_TAB];
}

export async function submitAccountSearch(page, query, { timeout = 120000 } = {}) {
  const selectors = [
    'input[placeholder*="可搜索账户名称"]',
    'input[placeholder*="搜索账户"]',
    'input[placeholder*="账户名称"]'
  ];
  for (const selector of selectors) {
    const input = page.locator(selector).first();
    if (await input.count()) {
      await input.waitFor({ state: 'visible', timeout });
      await input.fill(query);
      const buttons = input
        .locator('xpath=ancestor::*[contains(@class,"one-search-box-container")][1]')
        .locator('button');
      let submitted = false;
      const buttonCount = await buttons.count();
      for (let index = 0; index < buttonCount; index += 1) {
        const button = buttons.nth(index);
        if (await button.isVisible().catch(() => false)) {
          await button.click();
          submitted = true;
          break;
        }
      }
      if (!submitted) await input.press('Enter');
      await page.waitForTimeout(1500);
      return true;
    }
  }
  return false;
}

export async function clearAccountSearchFilters(page) {
  const filterList = page.locator('.widget-common-components-SortTable_filterList').first();
  if (!await filterList.count()) return false;
  const clearButton = filterList.getByText('清空', { exact: true });
  if (!await clearButton.count() || !await clearButton.isVisible().catch(() => false)) return false;
  await clearButton.click();
  await page.waitForTimeout(800);
  return true;
}

export async function findAccountRow(page, { accountId, timeout = 120000 } = {}) {
  const expectedId = String(accountId || '').trim();
  if (!expectedId) return null;
  const rows = page.locator(ACCOUNT_ROW_SELECTOR);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const count = await rows.count();
    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      if (!await row.isVisible().catch(() => false)) continue;
      const text = await row.innerText().catch(() => '');
      if (text.includes(expectedId) && text.includes('电商推广')) return row;
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function clickRowEcommerce(page, row, { accountId, timeout, logger = () => {} }) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const freshRow = accountId
        ? await findAccountRow(page, { accountId, timeout: Math.min(timeout, 8000) })
        : row;
      if (!freshRow) throw new Error('目标账户行暂时不可用');
      const ecommerce = freshRow.getByText('电商推广', { exact: true });
      const count = await ecommerce.count();
      for (let index = 0; index < count; index += 1) {
        const candidate = ecommerce.nth(index);
        if (!await candidate.isVisible().catch(() => false)) continue;
        await candidate.scrollIntoViewIfNeeded?.().catch?.(() => {});
        logger(`已定位“电商推广”按钮，正在打开推广页面（第 ${attempt + 1} 次）…`);
        return await clickAndResolveDestination(page, () => candidate.click({ force: true, timeout: 5000 }), { timeout, logger });
      }
      throw new Error('目标账户行中找不到可点击的“电商推广”入口');
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!/detached|不可用|Timeout|timeout/i.test(message) || attempt === 4) throw error;
      await page.waitForTimeout(600);
    }
  }
  throw lastError || new Error('目标账户行中找不到可点击的“电商推广”入口');
}

async function findAndOpenAccount(page, { accountId, accountName, timeout, logger }) {
  const queries = accountSearchQueries(accountName);
  const rowTimeout = Math.min(timeout, 8000);
  let searchAvailable = false;

  for (const tabName of accountSearchTabs()) {
    try {
      await clickVisibleText(page, tabName, { timeout: Math.min(timeout, 15000) });
      logger(`正在“${tabName}”中搜索账户…`);
    } catch {
      continue;
    }

    for (const query of queries) {
      await clearAccountSearchFilters(page);
      searchAvailable = await submitAccountSearch(page, query, { timeout });
      if (!searchAvailable) break;
      const row = await findAccountRow(page, { accountId, timeout: rowTimeout });
      if (!row) continue;
      logger(`已找到目标账户 ${accountName}（ID: ${accountId}），正在点击电商推广…`);
      return clickRowEcommerce(page, row, { accountId, timeout, logger });
    }
  }

  if (!searchAvailable) throw new Error('找不到广告账户搜索框');
  throw new Error(`搜索结果中找不到目标账户 ID ${accountId}（名称：${accountName}）`);
}

async function hasVisibleExactText(page, text) {
  const locator = page.getByText(text, { exact: true });
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

async function waitForVideoLibraryContent(page, { timeout = 120000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await hasVisibleExactText(page, '完整视频')) return;
    await page.waitForTimeout(250);
  }
  throw new Error('已进入电商推广页面，但未加载“完整视频”视频库入口');
}

export async function openVideoUpload(page, {
  timeout = 120000,
  logger = console.log,
  assumeVideoLibrary = false,
  debugDir = process.cwd(),
  debugTag = 'unknown'
} = {}) {
  // URL 本身不足以证明 SPA 已渲染视频库。真实页面必须出现“完整视频”入口，
  // 否则仍按账户内的菜单重新进入，避免把电商推广首页误当成视频库。
  const libraryReady = await hasVisibleExactText(page, '完整视频');
  if (!assumeVideoLibrary || !libraryReady) {
    logger(`正在导航视频库，当前页面：${page.url()}`);
    await clickAssetLibraryMenu(page, { timeout, logger });
    await clickVisibleText(page, '视频库', { timeout });
    await page.waitForURL(/\/assetsCenter\/creative\/video\/user\//, { timeout });
  } else {
    logger(`已确认视频库内容：${page.url()}`);
  }
  await waitForVideoLibraryContent(page, { timeout });
  logger(`已进入视频库：${page.url()}`);
  logger('视频库页面已就绪，正在点击“上传视频”并激活加号…');
  await openUploadDialog(page, { timeout, logger, debugDir, debugTag });
  logger('已进入视频上传界面。');
  return page;
}

export async function clickUploadVideoButton(page, { timeout = 120000, forceFallback = false, logger = () => {} } = {}) {
  const selectors = [
    '.btn-upload[role="button"]',
    '.btn-upload',
    'div[role="button"]:has-text("上传视频")',
    'button:has-text("上传视频")'
  ];

  async function robustClick(button) {
    await button.scrollIntoViewIfNeeded?.().catch?.(() => {});
    try {
      await button.click({ force: true, timeout: Math.min(timeout, 5000) });
      if (!forceFallback) return;
      // Playwright actionability 成功不代表百度自定义组件真正处理了事件。
      // 上传流程要求时继续执行原生 click 与可信鼠标点击兜底。
      if (typeof button.evaluate === 'function') {
        await button.evaluate((element) => element.click()).catch(() => {});
      }
      if (typeof button.boundingBox === 'function' && page.mouse) {
        const box = await button.boundingBox().catch(() => null);
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
      }
      return;
    } catch (error) {
      // 自定义 VEUI 按钮偶尔会在 Playwright actionability 检查期间重绘，
      // 使用原生 click 和鼠标坐标作为兜底，确保真正触发页面事件。
      if (typeof button.evaluate === 'function') {
        await button.evaluate((element) => element.click()).catch(() => {});
      }
      if (typeof button.boundingBox === 'function' && page.mouse) {
        const box = await button.boundingBox().catch(() => null);
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
      }
      if (!error) throw error;
    }
  }

  if (typeof page.getByRole === 'function') {
    const roleButtons = page.getByRole('button', { name: '上传视频', exact: true });
    const roleCount = await roleButtons.count().catch(() => 0);
    for (let index = 0; index < roleCount; index += 1) {
      const button = roleButtons.nth(index);
      if (!await button.isVisible().catch(() => false)) continue;
      await robustClick(button);
      return button;
    }
  }

  for (const selector of selectors) {
    const buttons = page.locator(selector);
    const count = await buttons.count();
    logger(`上传按钮候选 ${selector}：${count} 个`);
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth ? buttons.nth(index) : buttons.first();
      if (!await button.isVisible().catch(() => false)) continue;
      const details = await button.evaluate?.((element) => ({
        tag: element.tagName,
        className: element.className,
        text: element.textContent?.trim().slice(0, 80),
        outerHTML: element.outerHTML?.slice(0, 500)
      })).catch?.(() => null);
      if (details) logger(`将点击上传按钮：${JSON.stringify(details)}`);
      await robustClick(button);
      return button;
    }
  }

  // 百度有时把按钮渲染成无语义的自定义容器，Playwright
  // 文本定位能看到文字，但事件实际绑定在其祖先节点上。直接在页面 DOM
  // 中找到可见“上传视频”文本，并返回最近可点击祖先的屏幕坐标。
  if (typeof page.evaluate === 'function') {
    const target = await page.evaluate(() => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) > 0
          && rect.width > 0
          && rect.height > 0;
      };
      const nodes = [...document.querySelectorAll('*')]
        .filter((element) => element.textContent?.trim() === '上传视频' && isVisible(element));
      for (const node of nodes) {
        const clickable = node.closest('button, a, [role="button"], .btn-upload') || node;
        if (!isVisible(clickable)) continue;
        const rect = clickable.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          tagName: clickable.tagName,
          className: clickable.className,
          text: clickable.textContent?.trim().slice(0, 80),
          outerHTML: clickable.outerHTML?.slice(0, 1000)
        };
      }
      return null;
    }).catch(() => false);
    if (target && target !== true) {
      if (page.mouse && Number.isFinite(target.x) && Number.isFinite(target.y)) {
        await page.mouse.click(target.x, target.y).catch(() => {});
        return target;
      }
      await page.evaluate(() => {
        const node = [...document.querySelectorAll('*')]
          .find((element) => element.textContent?.trim() === '上传视频');
        const clickable = node?.closest('button, a, [role="button"], .btn-upload') || node;
        clickable?.click();
        clickable?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }).catch(() => {});
      return target;
    }
    if (target === true) return true;
  }
  const fallback = page.getByText('上传视频', { exact: true });
  const count = await fallback.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = fallback.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      await robustClick(candidate);
      return candidate;
    }
  }
  // 部分百度版本按钮不是 button/div，而是可点击的自定义文本容器。
  // 使用文本定位作为最后兜底，并仍然要求元素可见。
  const textFallback = page.locator('text=上传视频');
  const textCount = await textFallback.count().catch(() => 0);
  for (let index = 0; index < textCount; index += 1) {
    const candidate = textFallback.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      await robustClick(candidate);
      return candidate;
    }
  }
  throw new Error('视频库页面中找不到“上传视频”按钮');
}

async function hasFileInput(container) {
  if (typeof container?.locator !== 'function') return false;
  const input = container.locator('input[type="file"]').first();
  const count = typeof input?.count === 'function' ? await input.count().catch(() => 0) : 0;
  return count > 0;
}

async function hasUploadPlus(container) {
  if (typeof container?.locator !== 'function') return false;
  const plus = container.locator(
    '.video-box.cursor, .video-box:has(svg.add), .cc-creative-video-upload-button [role="button"], [class*="upload"] [role="button"], [class*="add"] [role="button"], [aria-label*="上传"], [aria-label*="添加"], svg.add'
  ).first();
  const count = typeof plus?.count === 'function' ? await plus.count().catch(() => 0) : 0;
  if (count > 0) return true;
  if (typeof container.getByText !== 'function') return false;
  for (const symbol of ['+', '＋']) {
    const textNodes = container.getByText(symbol, { exact: true });
    if (await textNodes.count().catch(() => 0)) return true;
  }
  return false;
}

export async function findUploadDialog(page) {
  const standardDialog = page
    .locator(UPLOAD_DIALOG_SELECTOR)
    .filter({ hasText: /上传视频/ })
    .first();
  const standardCount = typeof standardDialog?.count === 'function'
    ? await standardDialog.count().catch(() => 0)
    : Number(Boolean(standardDialog));
  const standardVisible = typeof standardDialog?.isVisible === 'function'
    ? await standardDialog.isVisible().catch(() => false)
    : true;
  if (standardCount && standardVisible && (await hasFileInput(standardDialog) || await hasUploadPlus(standardDialog))) return standardDialog;

  const titles = page.getByText(/上传视频.*支持批量上传|支持批量上传/, { exact: false });
  const count = await titles.count();
  for (let index = 0; index < count; index += 1) {
    const title = titles.nth(index);
    if (!await title.isVisible().catch(() => false)) continue;
    let panel = title
      .locator('xpath=ancestor::*[@role="dialog" or contains(@class,"modal") or contains(@class,"Modal") or contains(@class,"dialog") or contains(@class,"Dialog")][1]')
      .first();
    const panelCount = typeof panel?.count === 'function'
      ? await panel.count().catch(() => 0)
      : Number(Boolean(panel));
    if (panelCount && (typeof panel?.locator !== 'function' || await hasFileInput(panel) || await hasUploadPlus(panel))) return panel;
    // 有些版本先渲染标题和加号，再异步挂载 file input；先返回可见面板，
    // 后续 selectBatchFiles 会继续等待并重新定位加号/文件控件。
    if (panelCount && await panel.isVisible().catch(() => false)) return panel;
    panel = title.locator('xpath=ancestor::*[.//input[@type="file"]][1]').first();
    const inputPanelCount = typeof panel?.count === 'function'
      ? await panel.count().catch(() => 0)
      : Number(Boolean(panel));
    if (inputPanelCount && await hasFileInput(panel)) return panel;
  }

  // 当前版本的上传组件使用自定义容器类，不一定带 dialog/modal/role 属性。
  // 以可见的“上传视频（支持批量上传）”标题为锚点，向上寻找包含加号的面板。
  const broadTitle = page.getByText(/上传视频\s*[（(]\s*支持批量上传\s*[）)]|上传视频.*支持批量上传/, { exact: false });
  const broadCount = await broadTitle.count().catch(() => 0);
  for (let index = 0; index < broadCount; index += 1) {
    const title = broadTitle.nth(index);
    if (!await title.isVisible().catch(() => false)) continue;
    const panel = title.locator(
      'xpath=ancestor::*[.//*[contains(@class,"video-box") or contains(@class,"upload") or contains(@class,"add")]][1]'
    ).first();
    if (await panel.count().catch(() => 0) && await panel.isVisible().catch(() => false)) return panel;
  }

  // 最后使用 body 作为兜底：标题和加号都在可见页面时，文件选择控件通常是挂在 body 下的。
  const bodyLocator = page.locator('body');
  const body = typeof bodyLocator.first === 'function' ? bodyLocator.first() : bodyLocator;
  const bodyTitle = typeof body.getByText === 'function'
    ? body.getByText(/上传视频.*支持批量上传/, { exact: false })
    : null;
  if (bodyTitle && await bodyTitle.count().catch(() => 0)) {
    const visibleTitle = await bodyTitle.first().isVisible().catch(() => false);
    if (visibleTitle) return body;
  }
  return null;
}

export async function openUploadDialog(page, {
  timeout = 120000,
  logger = () => {},
  debugDir = process.cwd(),
  debugTag = 'unknown'
} = {}) {
  const waitTimeout = Math.max(1000, timeout);
  let clickError;
  const startedAt = Date.now();
  // 从账户推广页切到视频库后，按钮节点可能先出现、事件监听稍后才挂载。
  // 给页面一个短暂稳定窗口，避免首击落在未初始化的 React 节点上。
  await page.waitForTimeout?.(800).catch?.(() => {});
  for (let attempt = 0; attempt < 3 && Date.now() - startedAt < waitTimeout; attempt += 1) {
    try {
      await clickUploadVideoButton(page, {
        timeout: Math.min(waitTimeout, 5000),
        forceFallback: true,
        logger
      });
      logger(`上传按钮已点击（第 ${attempt + 1} 次），正在等待批量上传面板…`);
      const attemptStartedAt = Date.now();
      while (Date.now() - attemptStartedAt < Math.min(6000, waitTimeout)) {
        const dialog = await findUploadDialog(page);
        if (dialog) {
          await dialog.waitFor({ state: 'visible', timeout: Math.min(waitTimeout, 10000) });
          logger('批量上传面板已打开。');
          return dialog;
        }
        await page.waitForTimeout(250);
      }
    } catch (error) {
      clickError = error;
    }
    await page.waitForTimeout(500);
  }

  // 上传按钮可能点击成功但弹窗组件异步挂载失败；保存最新现场供真实 DOM 校准。
  const debugPrefix = `${debugDir}/.baidu-debug-upload-${safeDebugTag(debugTag)}`;
  if (typeof page.screenshot === 'function') {
    await page.screenshot({ path: `${debugPrefix}.png`, fullPage: true }).catch(() => {});
  }
  const html = typeof page.content === 'function' ? await page.content().catch(() => '') : '';
  if (html) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(`${debugPrefix}.html`, html, 'utf8').catch(() => {});
  }
  logger(`上传弹窗未打开，已保存 ${debugPrefix}.png/html`);
  throw new Error('点击“上传视频”后上传弹窗未打开', { cause: clickError });
}

export async function navigateToVideoLibrary(page, {
  accountId = DEFAULT_ACCOUNT_ID,
  accountName,
  timeout = 120000,
  logger = console.log,
  openUpload = true,
  debugDir = process.cwd(),
  debugTag = accountId
} = {}) {
  const effectiveAccountName = accountName || (accountId === DEFAULT_ACCOUNT_ID ? DEFAULT_ACCOUNT_NAME : undefined);
  logger('正在打开百度营销账户首页…');
  await page.goto(ACCOUNT_HOME_URL, { waitUntil: 'domcontentloaded' });
  await waitForBaiduLoginCompletion(page, { timeout, logger });
  try {
    page = await findAndOpenAccount(page, {
      accountId,
      accountName: effectiveAccountName,
      timeout,
      logger
    });
  } catch (error) {
    const debugPrefix = `${debugDir}/.baidu-debug-account-${safeDebugTag(debugTag)}`;
    await page.screenshot({ path: `${debugPrefix}.png`, fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => '');
    if (html) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(`${debugPrefix}.html`, html, 'utf8').catch(() => {});
    }
    throw new Error(`${error.message}；已保存当前页面调试文件 ${debugPrefix}.png/html`);
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  logger('正在进入资产中心视频库…');
  try {
    if (openUpload) await openVideoUpload(page, { timeout, logger, debugDir, debugTag });
    else {
      await clickAssetLibraryMenu(page, { timeout, logger });
      await clickVideoLibraryMenu(page, { timeout });
      await page.waitForURL(/\/assetsCenter\/creative\/video\/user\//, { timeout });
      await waitForVideoLibraryContent(page, { timeout });
    }
  } catch (error) {
    const debugPrefix = `${debugDir}/.baidu-debug-assets-${safeDebugTag(debugTag)}`;
    await page.screenshot({ path: `${debugPrefix}.png`, fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => '');
    if (html) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(`${debugPrefix}.html`, html, 'utf8').catch(() => {});
    }
    throw new Error(`进入资产中心视频库失败：${error.message}；已保存 ${debugPrefix}.png/html`);
  }
  return page;
}
