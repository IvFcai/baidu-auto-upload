import fs from 'node:fs/promises';
import path from 'node:path';
import { findUploadDialog } from './navigation.js';

function pageFileInput(page, selector) {
  if (typeof page?.locator !== 'function') return null;
  const locator = page.locator(selector);
  return typeof locator?.first === 'function' ? locator.first() : locator;
}

async function findUploadPlus(dialog) {
  if (typeof dialog?.locator !== 'function') return false;
  const candidates = dialog.locator(
    '.video-box.cursor, .video-box:has(svg.add), .cc-creative-video-upload-button [role="button"], [class*="upload"] [role="button"], [class*="add"] [role="button"], [aria-label*="添加"], [aria-label*="选择文件"], svg.add, svg[class*="add"], svg[class*="plus"]'
  );
  const isAppendLabel = (label) => /^\s*[+＋]\s*$/.test(label) || /添加文件|选择文件/.test(label);
  if (typeof candidates.count !== 'function') {
    const candidate = typeof candidates.first === 'function' ? candidates.first() : candidates;
    return candidate && typeof candidate.click === 'function' ? candidate : null;
  }
  const count = typeof candidates.count === 'function' ? await candidates.count().catch(() => 0) : 0;
  for (let index = 0; index < count; index += 1) {
    const candidate = typeof candidates.nth === 'function' ? candidates.nth(index) : candidates.first();
    if (typeof candidate.click !== 'function' || !await candidate.isVisible().catch(() => false)) continue;
    const text = typeof candidate.innerText === 'function' ? await candidate.innerText().catch(() => '') : '';
    const ariaLabel = typeof candidate.getAttribute === 'function'
      ? await candidate.getAttribute('aria-label').catch(() => '') || ''
      : '';
    if (isAppendLabel(`${text} ${ariaLabel}`)) return candidate;
  }

  // 百度部分版本只给加号一个无 class 的 role=button，使用可见文本/aria-label兜底。
  const buttons = dialog.locator('[role="button"]');
  const buttonCount = typeof buttons.count === 'function' ? await buttons.count().catch(() => 0) : 0;
  for (let index = 0; index < buttonCount; index += 1) {
    const candidate = typeof buttons.nth === 'function' ? buttons.nth(index) : buttons.first();
    if (typeof candidate?.isVisible !== 'function' || !await candidate.isVisible().catch(() => false)) continue;
    const label = `${await candidate.innerText().catch(() => '')} ${await candidate.getAttribute?.('aria-label').catch?.(() => '') || ''}`;
    if (isAppendLabel(label)) return candidate;
  }
  // 截图所示百度版本可能只渲染一个没有 class/aria 的大号加号文本节点。
  // 优先在弹窗内按精确文本查找，避免误点页面其他“+”图标。
  if (typeof dialog.getByText === 'function') {
    for (const symbol of ['+', '＋']) {
      const textNodes = dialog.getByText(symbol, { exact: true });
      const textCount = await textNodes.count().catch(() => 0);
      for (let index = 0; index < textCount; index += 1) {
        const candidate = textNodes.nth(index);
        if (await candidate.isVisible().catch(() => false)) return candidate;
      }
    }
  }

  // 没有文字或 aria 标签时，才以百度上传卡片/加号 SVG 作为回退；不使用
  // 普通 upload 控件，避免点到已有视频条目并让页面替换已选文件。
  const structuralCandidates = dialog.locator(
    '.video-box.cursor, .video-box:has(svg.add), .video-box:has(svg[class*="add"]), .video-box:has(svg[class*="plus"]), [class*="add-video"], [class*="video-add"], svg.add, svg[class*="add"], svg[class*="plus"]'
  );
  const structuralCount = typeof structuralCandidates.count === 'function'
    ? await structuralCandidates.count().catch(() => 0)
    : 0;
  for (let index = 0; index < structuralCount; index += 1) {
    const candidate = typeof structuralCandidates.nth === 'function'
      ? structuralCandidates.nth(index)
      : structuralCandidates.first();
    if (typeof candidate.click === 'function' && await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function clickUploadPlus(page, dialog, { alreadyScrolled = false } = {}) {
  const plus = await findUploadPlus(dialog);
  if (!plus) return false;
  if (!alreadyScrolled) await plus.scrollIntoViewIfNeeded?.({ timeout: 2000 }).catch?.(() => {});
  try {
    await plus.click({ force: true });
    return true;
  } catch {
    // 百度有时把可点击事件挂在加号外层卡片，内部 SVG/文本节点本身不可触发 filechooser。
    const ancestorLocator = plus.locator?.(
      'xpath=ancestor::*[@role="button" or contains(@class,"video-box") or contains(@class,"upload") or contains(@class,"add")][1]'
    );
    const ancestor = typeof ancestorLocator?.first === 'function' ? ancestorLocator.first() : ancestorLocator;
    if (!ancestor || typeof ancestor.click !== 'function') return false;
    if (typeof ancestor.isVisible === 'function' && !await ancestor.isVisible().catch(() => false)) return false;
    await ancestor.scrollIntoViewIfNeeded?.({ timeout: 2000 }).catch?.(() => {});
    await ancestor.click({ force: true });
    return true;
  }
}

function uploadInputTargets(plus) {
  const targets = [plus];
  const ancestorLocator = plus?.locator?.(
    'xpath=ancestor::*[@role="button" or contains(@class,"video-box") or contains(@class,"upload") or contains(@class,"add")][1]'
  );
  const ancestor = typeof ancestorLocator?.first === 'function' ? ancestorLocator.first() : ancestorLocator;
  if (ancestor && ancestor !== plus) targets.push(ancestor);
  return targets;
}

async function findNewlyMountedInput(targets, baselineCounts) {
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const inputLocator = target?.locator?.('input[type="file"]');
    const input = typeof inputLocator?.first === 'function' ? inputLocator.first() : inputLocator;
    const count = await input?.count?.().catch(() => 0) || 0;
    if (count > (baselineCounts[index] || 0) && typeof input?.setInputFiles === 'function') return input;
  }
  return null;
}

async function chooseFilesViaPlus(page, dialog, filePaths, { requirePlus = false } = {}) {
  if (typeof dialog?.locator !== 'function' || typeof page?.waitForEvent !== 'function') return false;
  const plus = await findUploadPlus(dialog);
  if (!plus) return false;
  await plus.scrollIntoViewIfNeeded?.({ timeout: 2000 }).catch?.(() => {});
  const inputTargets = uploadInputTargets(plus);
  const baselineCounts = await Promise.all(inputTargets.map(async (target) => {
    const inputLocator = target?.locator?.('input[type="file"]');
    const input = typeof inputLocator?.first === 'function' ? inputLocator.first() : inputLocator;
    return await input?.count?.().catch(() => 0) || 0;
  }));
  const pageInput = pageFileInput(page, 'input[type="file"]');
  const baselinePageInputCount = await pageInput?.count?.().catch(() => 0) || 0;

  // 百度部分版本把追加加号和隐藏 input 放在同一卡片内。
  // 直接设置该 input 可继续追加下一批，同时避免再次唤起系统文件窗口。
  if (!requirePlus) {
    const associatedLocator = plus.locator?.('input[type="file"]');
    const associatedInput = typeof associatedLocator?.first === 'function'
      ? associatedLocator.first()
      : associatedLocator;
    if (associatedInput && typeof associatedInput.setInputFiles === 'function'
      && await associatedInput.count().catch(() => 0)) {
      await associatedInput.setInputFiles(filePaths);
      return true;
    }
  }

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 2000 }).catch(() => null);
  const clicked = await clickUploadPlus(page, dialog, { alreadyScrolled: true });
  const chooser = clicked ? await chooserPromise : null;
  if (clicked && !chooser) {
    // 某些版本点击后异步挂载 input，而不是派发 Playwright filechooser。
    // 仅接受点击前不存在、点击后新出现的关联 input，避免覆盖上一批文件。
    const startedAt = Date.now();
    while (Date.now() - startedAt < 1500) {
      const mountedInput = await findNewlyMountedInput(inputTargets, baselineCounts);
      if (mountedInput) {
        await mountedInput.setInputFiles(filePaths);
        return true;
      }
      const pageInputCount = await pageInput?.count?.().catch(() => 0) || 0;
      if (pageInputCount > baselinePageInputCount && typeof pageInput?.setInputFiles === 'function') {
        await pageInput.setInputFiles(filePaths);
        return true;
      }
      await page.waitForTimeout(100).catch(() => {});
    }
    throw new Error('点击上传面板加号后未收到文件选择事件');
  }
  if (!chooser) return false;
  await chooser.setFiles(filePaths);
  return true;
}

function isFailedUploadRow(text, attributes = {}) {
  const combined = `${text || ''} ${attributes.className || ''} ${attributes.title || ''} ${attributes.ariaLabel || ''}`;
  return /(重复上传|上传失败|校验失败|解析失败|失败|错误|error|fail)/i.test(combined)
    || /(upload-error|upload-fail|is-error|has-error|danger)/i.test(String(attributes.className || ''));
}

async function findFailedUploadRows(dialog) {
  if (typeof dialog?.locator !== 'function') return [];
  const rows = dialog.locator(
    '.video-box, [class*="upload-item"], [class*="video-item"], [class*="file-item"], [class*="upload-file"]'
  );
  const count = await rows.count().catch(() => 0);
  const failed = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const visible = typeof row.isVisible === 'function' ? await row.isVisible().catch(() => false) : true;
    if (!visible) continue;
    const attributes = {
      className: await row.getAttribute?.('class').catch?.(() => '') || '',
      title: await row.getAttribute?.('title').catch?.(() => '') || '',
      ariaLabel: await row.getAttribute?.('aria-label').catch?.(() => '') || ''
    };
    const text = await row.innerText?.().catch?.(() => '') || '';
    if (isFailedUploadRow(text, attributes)) failed.push(row);
  }
  return failed;
}

async function findFailedUploadRemoveButton(row, { logger = () => {} } = {}) {
  if (typeof row?.locator !== 'function') return null;
  logger('正在滚动到失败视频条目，查找删除“×”…');
  await row.scrollIntoViewIfNeeded?.({ timeout: 2000 }).catch?.(() => {});
  const findInScope = async (scope) => {
    const deleteControls = scope.locator(
      ':scope > [role="button"].cc-creative-sdk-veui-button:not(.refresh-button), :scope > [role="button"]:not(.refresh-button), .video-box-panel > [role="button"].cc-creative-sdk-veui-button:not(.refresh-button), .video-box-panel .cc-creative-sdk-veui-button:not(.refresh-button), [class*="video-box-panel"] [role="button"]:not(.refresh-button)'
    );
    const deleteCount = await deleteControls.count().catch(() => 0);
    for (let index = 0; index < deleteCount; index += 1) {
      const control = deleteControls.nth(index);
      if (typeof control.isVisible !== 'function' || await control.isVisible().catch(() => false)) return control;
    }

    const controls = scope.locator(
      'button, [role="button"], svg, a, span, i, div, [class*="close"], [class*="delete"], [class*="remove"]'
    );
    const count = await controls.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      const visible = typeof control.isVisible === 'function' ? await control.isVisible().catch(() => false) : true;
      if (!visible) continue;
      const text = await control.innerText?.().catch?.(() => '') || '';
      const ariaLabel = await control.getAttribute?.('aria-label').catch?.(() => '') || '';
      const title = await control.getAttribute?.('title').catch?.(() => '') || '';
      const className = await control.getAttribute?.('class').catch?.(() => '') || '';
      const label = `${text} ${ariaLabel} ${title}`.trim();
      const closeGlyph = [text, ariaLabel, title].some((value) => /^\s*[×x✕✖]\s*$/.test(value));
      if (closeGlyph
        || /删除|移除|remove|delete/i.test(label)
        || /(?:delete|remove|close)(?:-icon|\b)/i.test(className)) {
        return control;
      }
    }
    return null;
  };

  let scope = row;
  for (let depth = 0; depth < 3 && scope; depth += 1) {
    const control = await findInScope(scope);
    if (control) return control;
    const parentLocator = scope.locator('xpath=ancestor::*[1]');
    scope = typeof parentLocator?.first === 'function' ? parentLocator.first() : null;
  }
  return null;
}

export async function removeFailedUploadItems(dialog, { timeoutMs = 120000, logger = () => {} } = {}) {
  const startedAt = Date.now();
  let removed = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const failedRows = await findFailedUploadRows(dialog);
    if (!failedRows.length) return removed;
    let removedOne = false;
    for (const row of failedRows) {
      const removeButton = await findFailedUploadRemoveButton(row, { logger });
      if (!removeButton) {
        const rowText = await row.innerText?.().catch?.(() => '') || '';
        logger(`失败视频条目未找到删除控件：${rowText.slice(0, 120)}`, 'error');
        throw new Error('发现失败视频条目，但找不到该条目内的删除“×”按钮');
      }
      await removeButton.click({ force: true });
      removed += 1;
      removedOne = true;
      logger(`已删除失败视频条目（第 ${removed} 个）`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!removedOne) break;
  }
  throw new Error('失败视频条目未能全部删除，请检查上传弹窗');
}

export const DEFAULT_BATCH_SIZE = 12;
export const DEFAULT_URL = 'https://shoppingads.baidu.com/shop/assetsCenter/creative/video/user/88193126';
export const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.mpeg', '.mpg', '.ts'
]);

export function isVideoFile(fileName) {
  return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function chunk(items, batchSize = DEFAULT_BATCH_SIZE) {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new TypeError('batchSize must be a positive integer');
  }
  const batches = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

export function buildBatches(files, batchSize = DEFAULT_BATCH_SIZE) {
  const videos = files
    .filter((file) => isVideoFile(file.name))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));
  return chunk(videos, batchSize);
}

export async function listVideoFiles(folder, { recursive = false } = {}) {
  const root = path.resolve(folder);
  const results = [];

  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isFile() && isVideoFile(entry.name)) {
        results.push({ name: entry.name, path: entryPath });
      } else if (recursive && entry.isDirectory()) {
        await visit(entryPath);
      }
    }
  }

  await visit(root);
  return results.sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' }));
}

function defaultLogger(message) {
  process.stdout.write(`${message}\n`);
}

export async function waitForBatchSettled(page, {
  timeoutMs = 15 * 60 * 1000,
  pollMs = 500,
  stableMs = 2000,
  minWaitMs = 5000,
  logger = defaultLogger,
  allowFailedItems = false
} = {}) {
  const startedAt = Date.now();
  let quietSince = null;
  const uploadingPattern = /(上传中|正在上传|处理中|校验中|解析中|uploading|processing|validating)/i;
  const failurePattern = /(上传失败|校验失败|解析失败|upload failed|upload error)/i;

  while (Date.now() - startedAt < timeoutMs) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (!allowFailedItems && failurePattern.test(bodyText)) {
      throw new Error('页面报告本批次上传失败，请检查页面并重试。');
    }
    if (uploadingPattern.test(bodyText)) {
      quietSince = null;
    } else {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= stableMs && Date.now() - startedAt >= minWaitMs) return;
    }
    await page.waitForTimeout(pollMs);
  }
  logger('等待批次完成超时，继续前请检查页面状态。');
  throw new Error(`批次上传等待超过 ${Math.round(timeoutMs / 60000)} 分钟`);
}

export async function selectBatchFiles(page, dialog, filePaths, {
  timeoutMs = 120000,
  logger = () => {},
  requirePlus = false
} = {}) {
  let lastError;
  const startedAt = Date.now();
  let waitingLogged = false;
  while (Date.now() - startedAt < timeoutMs) {
    // 百度加入文件后会重绘上传面板；旧 locator 可能仍存在但已不再包含底部加号。
    // 每次尝试优先重新发现当前可见面板，确保后续批次滚动到新的加号。
    const currentDialog = await findUploadDialog(page).catch(() => null) || dialog;

    try {
      if (await chooseFilesViaPlus(page, currentDialog, filePaths, { requirePlus })) return;
    } catch (error) {
      lastError = error;
      if (requirePlus) throw error;
    }
    if (requirePlus) {
      if (!waitingLogged) {
        logger('正在等待上传面板底部加号，以追加下一批视频…');
        waitingLogged = true;
      }
      await page.waitForTimeout(500).catch(() => {});
      continue;
    }
    const scopedLocator = currentDialog?.locator?.('input[type="file"]');
    const scopedInput = typeof scopedLocator?.first === 'function' ? scopedLocator.first() : scopedLocator;
    const pageInput = pageFileInput(page, 'input[type="file"]');
    const input = scopedInput && await scopedInput.count().catch(() => 0)
      ? scopedInput
      : pageInput;
    if (!input || !await input.count().catch(() => 0)) {
      if (!waitingLogged) {
        logger('正在等待上传面板重新显示下一批加号…');
        waitingLogged = true;
      }
      if (typeof page.waitForEvent === 'function') {
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
        const plusClicked = await clickUploadPlus(page, currentDialog);
        const chooser = plusClicked ? await chooserPromise : null;
        if (chooser) {
          await chooser.setFiles(filePaths);
          return;
        }
      } else {
        await clickUploadPlus(currentDialog);
      }
      await page.waitForTimeout(150).catch(() => {});
      await page.waitForTimeout(500).catch(() => {});
      continue;
    }

    try {
      if (typeof page.waitForEvent === 'function') {
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
        const clicked = await input.click({ force: true }).then(() => true).catch(() => false);
        const chooser = clicked ? await chooserPromise : null;
        if (chooser) {
          await chooser.setFiles(filePaths);
          return;
        }
      }

      await input.setInputFiles(filePaths);
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(500).catch(() => {});
    }
  }
  throw lastError || new Error(requirePlus
    ? '必须通过上传面板加号追加下一批，未直接覆盖已选视频'
    : '上传弹窗中找不到加号对应的文件选择控件');
}

async function resolveUploadDialogAndInput(page, inputSelector, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const dialog = await findUploadDialog(page);
    if (dialog) {
      const input = dialog.locator(inputSelector).first();
      if (await input.count().catch(() => 0)) {
        try {
          await input.waitFor({ state: 'attached', timeout: Math.min(2000, timeoutMs) });
          return { dialog, input };
        } catch {
          // The upload component can replace its file input while opening.
        }
      } else {
        return { dialog, input: null };
      }
    }
    const pageInput = pageFileInput(page, inputSelector);
    if (pageInput && typeof pageInput.count === 'function' && await pageInput.count().catch(() => 0)) {
      try {
        await pageInput.waitFor({ state: 'attached', timeout: Math.min(2000, timeoutMs) });
        return { dialog, input: pageInput };
      } catch {
        // The page-level input may also be replaced while the modal mounts.
      }
    }
    await page.waitForTimeout(100);
  }
  throw new Error('上传弹窗已打开，但找不到批量上传区域中的文件控件');
}

async function findEnabledConfirmButton(dialog) {
  if (!dialog) return null;
  const candidates = [];
  if (typeof dialog.getByRole === 'function') {
    candidates.push(dialog.getByRole('button', { name: /^确定$/ }));
  }
  if (typeof dialog.locator === 'function') {
    candidates.push(dialog.locator('button, [role="button"]'));
  }

  for (const candidateSet of candidates) {
    const count = typeof candidateSet?.count === 'function'
      ? await candidateSet.count().catch(() => 0)
      : 0;
    for (let index = 0; index < count; index += 1) {
      const candidate = typeof candidateSet.nth === 'function' ? candidateSet.nth(index) : candidateSet.first?.();
      const visible = typeof candidate?.isVisible === 'function'
        ? await candidate.isVisible().catch(() => false)
        : false;
      if (!candidate || !visible) continue;
      const text = typeof candidate.innerText === 'function'
        ? await candidate.innerText().catch(() => '')
        : '';
      const ariaLabel = typeof candidate.getAttribute === 'function'
        ? await candidate.getAttribute('aria-label').catch(() => '')
        : '';
      const label = `${text || ''} ${ariaLabel || ''}`.trim();
      if (label !== '确定') continue;
      const disabled = typeof candidate.getAttribute === 'function'
        ? await candidate.getAttribute('disabled').catch(() => null)
        : null;
      const ariaDisabled = typeof candidate.getAttribute === 'function'
        ? await candidate.getAttribute('aria-disabled').catch(() => 'false')
        : 'false';
      const enabled = typeof candidate.isEnabled === 'function'
        ? await candidate.isEnabled().catch(() => false)
        : !disabled && ariaDisabled !== 'true';
      if (enabled) return candidate;
    }
  }
  return null;
}

async function confirmUploadDialog(page, dialog, {
  timeoutMs = 120000,
  pollMs = 500,
  logger = () => {}
} = {}) {
  // 文件上传结束后百度还会异步生成缩略图；此时“确定”仍是置灰状态。
  // 持续观察同一个弹窗，直到按钮真正可用，避免把正常加载误报为失败。
  const startedAt = Date.now();
  let lastDialog = dialog;
  while (Date.now() - startedAt < timeoutMs) {
    lastDialog = await findUploadDialog(page).catch(() => null) || lastDialog;
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/(上传失败|校验失败|解析失败|upload failed|upload error)/i.test(bodyText)) {
      throw new Error('页面报告本批次上传失败，请检查页面并重试。');
    }
    const confirmButton = await findEnabledConfirmButton(lastDialog);
    if (confirmButton) {
      await confirmButton.click();
      return;
    }
    if (Date.now() - startedAt >= 1000 && (Date.now() - startedAt) % 5000 < Math.max(100, pollMs + 50)) {
      logger('视频仍在加载，正在等待“确定”按钮恢复可用…');
    }
    await page.waitForTimeout(pollMs);
  }
  throw new Error(`视频加载完成后等待“确定”按钮可用超过 ${Math.round(timeoutMs / 60000)} 分钟`);
}

export async function uploadBatches(page, batches, {
  inputSelector = 'input[type="file"]',
  timeoutMs,
  stableMs,
  minWaitMs,
  autoConfirm = false,
  removeFailedItems = false,
  confirmTimeoutMs = 120000,
  confirmPollMs = 500,
  logger = defaultLogger
} = {}) {
  const inputTimeoutMs = 120000;
  const { dialog } = await resolveUploadDialogAndInput(page, inputSelector, inputTimeoutMs);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    logger(`正在点击加号并选择第 ${index + 1}/${batches.length} 批（${batch.length} 个视频）`);
    // 每批都重新解析弹窗，避免沿用上一批加入后被百度替换的 DOM 节点。
    await selectBatchFiles(page, index === 0 ? dialog : null, batch.map((file) => file.path), {
      timeoutMs: 120000,
      logger,
      requirePlus: index > 0
    });
    logger(`第 ${index + 1}/${batches.length} 批已加入上传面板`);
  }

  await waitForBatchSettled(page, {
    timeoutMs,
    stableMs,
    minWaitMs,
    logger,
    allowFailedItems: removeFailedItems
  });
  for (let index = 0; index < batches.length; index += 1) {
    logger(`第 ${index + 1}/${batches.length} 批已完成`);
  }

  let removedFailedItems = 0;
  let confirmationDialog = dialog;
  if (removeFailedItems) {
    confirmationDialog = await findUploadDialog(page).catch(() => null) || dialog;
    removedFailedItems = await removeFailedUploadItems(confirmationDialog, {
      timeoutMs: confirmTimeoutMs,
      logger
    });
    const fileCount = batches.reduce((total, batch) => total + batch.length, 0);
    if (removedFailedItems >= fileCount && !autoConfirm) {
      throw new Error('所有视频均上传失败，未点击“确定”，请检查上传弹窗');
    }
  }

  if (autoConfirm) {
    await confirmUploadDialog(page, confirmationDialog, {
      timeoutMs: confirmTimeoutMs,
      pollMs: confirmPollMs,
      logger
    });
    logger('所有视频已加载完成，已自动点击“确定”');
  }

  return {
    batchCount: batches.length,
    fileCount: batches.reduce((total, batch) => total + batch.length, 0),
    awaitingConfirmation: !autoConfirm,
    ...(removeFailedItems ? { removedFailedItems } : {}),
    ...(autoConfirm ? { confirmed: true } : {})
  };
}
