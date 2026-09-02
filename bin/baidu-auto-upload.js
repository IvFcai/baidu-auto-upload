#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chromium } from 'playwright';
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_URL,
  buildBatches,
  listVideoFiles,
  uploadBatches
} from '../src/uploader.js';
import { DEFAULT_ACCOUNT_ID, navigateToVideoLibrary } from '../src/navigation.js';

export function parseArgs(argv) {
  const options = { url: DEFAULT_URL, batchSize: DEFAULT_BATCH_SIZE, recursive: false, chromeChannel: 'chrome', accountId: DEFAULT_ACCOUNT_ID, homepage: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--recursive') options.recursive = true;
    else if (arg === '--direct') options.homepage = false;
    else if (arg.startsWith('--')) {
      const [key, inlineValue] = arg.slice(2).split('=', 2);
      const value = inlineValue ?? argv[++index];
      if (!value) throw new Error(`缺少参数值: --${key}`);
      if (key === 'folder') options.folder = value;
      else if (key === 'url') options.url = value;
      else if (key === 'account-id') options.accountId = value;
      else if (key === 'account-name') options.accountName = value;
      else if (key === 'batch-size') options.batchSize = Number(value);
      else if (key === 'profile') options.profile = value;
      else if (key === 'chrome-path') options.chromePath = value;
      else if (key === 'input-selector') options.inputSelector = value;
      else if (key === 'wait-minutes') options.waitMinutes = Number(value);
      else throw new Error(`未知参数: --${key}`);
    } else if (!options.folder) options.folder = arg;
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
    throw new Error('--batch-size 必须是正整数');
  }
  return options;
}

async function askFolder() {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question('请输入视频文件夹路径: ')).trim();
  } finally {
    rl.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const folder = path.resolve(options.folder || await askFolder());
  const files = await listVideoFiles(folder, { recursive: options.recursive });
  const batches = buildBatches(files, options.batchSize);
  if (files.length === 0) {
    throw new Error(`文件夹中没有可上传的视频: ${folder}`);
  }

  console.log(`找到 ${files.length} 个视频，将分 ${batches.length} 批上传。`);
  const browser = await chromium.launchPersistentContext(
    path.resolve(options.profile || '.chrome-profile'),
    options.chromePath
      ? { headless: false, executablePath: path.resolve(options.chromePath) }
      : { headless: false, channel: options.chromeChannel }
  );
  let page = browser.pages()[0] || await browser.newPage();
  if (options.homepage !== false) {
    page = await navigateToVideoLibrary(page, {
      accountId: options.accountId,
      accountName: options.accountName,
      logger: console.log
    });
  } else {
    await page.goto(options.url, { waitUntil: 'domcontentloaded' });
    console.log('浏览器已打开指定页面。');
  }
  console.log('脚本会自动寻找 input[type=file]；如果页面没有该控件，请用 --input-selector 指定。');

  try {
    await uploadBatches(page, batches, {
      inputSelector: options.inputSelector,
      timeoutMs: (options.waitMinutes || 15) * 60 * 1000,
      minWaitMs: 5000,
      logger: console.log
    });
    console.log('全部视频上传完成。');
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`上传终止: ${error.message}`);
    process.exitCode = 1;
  });
}
