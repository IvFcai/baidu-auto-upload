import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildBatches, listVideoFiles, uploadBatches } from '../src/uploader.js';
import { openVideoUpload, navigateToVideoLibrary } from '../src/navigation.js';
import { buildAccountJobConfig, buildJobConfig } from '../src/job-config.js';
import { buildFolderDialogOptions } from '../src/folder-dialog.js';
import { chromeLaunchOptions } from '../src/browser-config.js';
import { closeBrowserContextIfEmpty, releaseBrowserContext } from '../src/browser-session.js';
import { buildRuntimePaths, ensureRuntimePaths, migrateLegacyProfile } from '../src/runtime-paths.js';
import { chromeDownloadUrl, findChromeExecutable } from '../src/chrome-check.js';
import {
  loadEncryptedAuthState,
  restoreBaiduAuthState,
  saveEncryptedAuthState
} from '../src/auth-state.js';
import { loadSavedAccounts, loadSavedAccountsSync, saveSavedAccounts } from '../src/config-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow;
let browserContext;
const browserContexts = new Set();
const contextOwners = new Map();
const activeJobs = new Map();
let running = false;
let appQuitting = false;
let reviewPending = false;
let runtimePaths;
let chromeExecutable;
let runtimeReady = Promise.resolve();

function send(channel, payload) {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function log(message, tone = 'info') {
  send('upload:log', { message, tone, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
}

function chromeProfilePath() {
  return getRuntimePaths().primaryProfile;
}

function getRuntimePaths() {
  if (!runtimePaths) runtimePaths = buildRuntimePaths({ userDataPath: app.getPath('userData'), legacyRoot: app.getAppPath() });
  return runtimePaths;
}

function authStatePath(accountKey = '') {
  if (!accountKey) return path.join(app.getPath('userData'), 'baidu-auth-state.bin');
  const safeKey = String(accountKey).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(app.getPath('userData'), `baidu-auth-state-${safeKey}.bin`);
}

function accountConfigPath() {
  return path.join(app.getPath('userData'), 'account-config.json');
}

async function restoreSavedAuthState(context, accountKey = '') {
  if (!safeStorage.isEncryptionAvailable()) {
    log('系统加密存储不可用，将仅使用 Chrome 配置目录保存登录状态', 'warning');
    return;
  }
  try {
    let state = null;
    const candidates = [authStatePath(accountKey)];
    if (accountKey) candidates.push(authStatePath(), authStatePath('auto-1'));
    for (const candidate of candidates) {
      try {
        state = await loadEncryptedAuthState(candidate, { safeStorage });
        if (state) break;
      } catch (error) {
        log(`读取百度登录态失败（${path.basename(candidate)}）：${error.message}`, 'warning');
      }
    }
    if (!state) {
      log('尚未保存百度登录状态，首次运行请扫码登录');
      return;
    }
    await restoreBaiduAuthState(context, state);
    log('已恢复加密保存的百度登录状态', 'success');
  } catch (error) {
    log(`恢复百度登录状态失败，将使用 Chrome 现有登录状态：${error.message}`, 'warning');
  }
}

async function saveCurrentAuthState(context, accountKey = '') {
  if (!context || !safeStorage.isEncryptionAvailable()) return false;
  try {
    const state = await context.storageState();
    const saved = await saveEncryptedAuthState(authStatePath(accountKey), state, { safeStorage });
    if (saved) log('百度登录状态已加密保存，下次启动将自动恢复', 'success');
    return saved;
  } catch (error) {
    log(`保存百度登录状态失败：${error.message}`, 'warning');
    return false;
  }
}

function trackBrowserContext(context, primary = false) {
  browserContexts.add(context);
  if (primary) browserContext = context;
  context.on('close', () => {
    browserContexts.delete(context);
    contextOwners.delete(context);
    if (browserContext === context) browserContext = null;
    if (reviewPending && browserContexts.size === 0) {
      reviewPending = false;
      send('upload:state', { state: 'review_closed' });
    }
  });
  return context;
}

async function launchTrackedContext(profile, accountKey = '', primary = false) {
  const context = await chromium.launchPersistentContext(profile, chromeLaunchOptions({ executablePath: chromeExecutable }));
  trackBrowserContext(context, primary);
  await restoreSavedAuthState(context, accountKey);
  return context;
}

function safeSessionKey(value) {
  return String(value || 'auto').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'auto';
}

function sessionProfilePath(sessionKey) {
  return getRuntimePaths().loginProfile(safeSessionKey(sessionKey));
}

function accountProfilePath(accountId) {
  return getRuntimePaths().accountProfile(accountId);
}

async function cleanupEmptyAccountContexts(accountId) {
  const staleContexts = [...contextOwners.entries()]
    .filter(([, ownerId]) => ownerId === accountId)
    .map(([context]) => context);
  for (const context of staleContexts) {
    const closed = await closeBrowserContextIfEmpty(context);
    if (closed) {
      browserContexts.delete(context);
      contextOwners.delete(context);
      if (browserContext === context) browserContext = null;
    }
  }
}

async function prepareRuntime() {
  const paths = getRuntimePaths();
  await ensureRuntimePaths(paths);
  const legacyEntries = await import('node:fs/promises').then((module) => module.readdir(paths.legacyRoot, { withFileTypes: true })).catch(() => []);
  for (const entry of legacyEntries.filter((item) => item.isDirectory() && item.name.startsWith('.chrome-profile'))) {
    const name = entry.name;
    await migrateLegacyProfile({
      legacyPath: path.join(paths.legacyRoot, name),
      targetPath: path.join(paths.profileRoot, name)
    }).catch(() => {});
  }
  if (!legacyEntries.some((item) => item.isDirectory() && item.name === '.chrome-profile')) {
    await migrateLegacyProfile({
      legacyPath: path.join(paths.legacyRoot, '.baidu-profile'),
      targetPath: paths.primaryProfile
    }).catch(() => {});
  }
  chromeExecutable = await findChromeExecutable();
  if (!chromeExecutable) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: '需要安装 Google Chrome',
      message: '本应用必须使用 Google Chrome。当前电脑未找到 Chrome，请安装后重新启动。',
      buttons: ['打开官方下载页', '稍后处理'],
      defaultId: 0,
      cancelId: 1
    });
    if (response === 0) void shell.openExternal(chromeDownloadUrl());
    throw new Error('未找到 Google Chrome，请安装后重试');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240, height: 820, minWidth: 980, minHeight: 680,
    backgroundColor: '#07080b', title: 'Baidu Video Relay', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('browser:status', () => ({
  browser: 'Google Chrome',
  profile: chromeProfilePath(),
  configPath: accountConfigPath()
}));
ipcMain.on('config:load-sync', (event) => {
  event.returnValue = loadSavedAccountsSync(accountConfigPath());
});
ipcMain.handle('config:load', async () => loadSavedAccounts(accountConfigPath()));
ipcMain.handle('config:save', async (_event, accounts) => {
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('账户列表不能为空');
  return saveSavedAccounts(accountConfigPath(), accounts);
});
ipcMain.handle('folder:choose', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, buildFolderDialogOptions(options));
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('upload:start', async (_event, rawConfig) => {
  await runtimeReady;
  if (!chromeExecutable) throw new Error('未找到 Google Chrome，请安装后重新启动应用');
  const config = buildJobConfig(rawConfig);
  const accounts = config.accounts || [{
    accountName: config.accountName,
    accountId: config.accountId,
    loginGroup: 'auto',
    folder: config.folder
  }];
  if (accounts.length !== 1) throw new Error('请在要上传的账户行点击“上传视频”，每次只处理一个账户');
  const accountConfig = buildAccountJobConfig(rawConfig, accounts[0]);
  const account = accountConfig.accounts[0];
  if (activeJobs.has(account.accountId)) throw new Error(`账户 ${account.accountId} 已有上传任务在运行`);
  await cleanupEmptyAccountContexts(account.accountId);
  if ([...contextOwners.values()].includes(account.accountId)) throw new Error(`账户 ${account.accountId} 已有待检查页面，请先关闭检查页面`);
  const job = { account, stopRequested: false, context: null };
  activeJobs.set(account.accountId, job);
  running = true;
  send('upload:state', { state: 'preparing', account, config: accountConfig });

  const accountLogger = (message, tone = 'info') => log(`[${account.accountName}（${account.accountId}）] ${message}`, tone);
  let page = null;
  try {
    accountLogger(`使用视频目录：${account.folder}`);
    const files = await listVideoFiles(account.folder, { recursive: accountConfig.recursive });
    const batches = buildBatches(files, accountConfig.batchSize);
    if (!files.length) throw new Error(`视频文件夹中没有可上传的视频`);
    accountLogger(`扫描完成：${files.length} 个视频，${batches.length} 批`, 'success');
    send('upload:plan', { account, totalFiles: files.length, totalBatches: batches.length });

    const profile = accountProfilePath(account.accountId);
    accountLogger(`启动该账户独立 Google Chrome：${profile}`);
    job.context = await launchTrackedContext(profile, account.accountId, false);
    contextOwners.set(job.context, account.accountId);
    page = await job.context.newPage();
    page = await navigateToVideoLibrary(page, {
      accountId: account.accountId,
      accountName: account.accountName,
      timeout: Math.min(accountConfig.waitMinutes * 60 * 1000, 120000),
      logger: accountLogger,
      openUpload: false,
      debugTag: account.accountId,
      debugDir: getRuntimePaths().debugRoot
    });
    await saveCurrentAuthState(job.context, account.accountId);
    await openVideoUpload(page, {
      timeout: 120000,
      logger: accountLogger,
      assumeVideoLibrary: true,
      debugDir: getRuntimePaths().debugRoot,
      debugTag: account.accountId
    });
    await saveCurrentAuthState(job.context, account.accountId);
    send('upload:state', { state: 'uploading', account });
    const uploadResult = await uploadBatches(page, batches, {
      timeoutMs: accountConfig.waitMinutes * 60 * 1000,
      minWaitMs: 5000,
      autoConfirm: true,
      removeFailedItems: true,
      confirmTimeoutMs: accountConfig.waitMinutes * 60 * 1000,
      logger: (message) => {
        if (job.stopRequested) throw new Error('用户已请求停止');
        accountLogger(message, message.includes('已完成') ? 'success' : 'info');
      }
    });
    await saveCurrentAuthState(job.context, account.accountId);
    accountLogger('全部视频上传成功，已自动点击“确定”；该账户 Chrome 页面将保持打开', 'success');
    send('upload:state', { state: 'account_completed', account, uploadResult });
    send('upload:state', { state: 'completed', account, browserOpen: true });
    reviewPending = true;
    return { ok: true, account, uploadResult };
  } catch (error) {
    if (page) {
      const debugPrefix = path.join(getRuntimePaths().debugRoot, `.baidu-debug-upload-${String(account.accountId).replace(/[^a-zA-Z0-9_-]/g, '_')}`);
      await page.screenshot({ path: `${debugPrefix}.png`, fullPage: true }).catch(() => {});
      const html = await page.content().catch(() => '');
      if (html) {
        const fs = await import('node:fs/promises');
        await fs.writeFile(`${debugPrefix}.html`, html, 'utf8').catch(() => {});
      }
      accountLogger(`已保存上传失败现场：${debugPrefix}.png/html`, 'warning');
    }
    const browserOpen = !job.stopRequested && browserContexts.has(job.context);
    reviewPending = reviewPending || browserOpen;
    const failure = { ok: false, account, error: error.message };
    send('upload:state', { state: 'account_failed', failure });
    send('upload:state', { state: job.stopRequested ? 'stopped' : 'error', account, browserOpen });
    log(`[${account.accountName}（${account.accountId}）] 上传失败：${error.message}`, 'error');
    return failure;
  } finally {
    activeJobs.delete(account.accountId);
    running = activeJobs.size > 0;
  }
});

ipcMain.handle('upload:stop', async (_event, options = {}) => {
  const targetId = String(options?.accountId || '').trim();
  const targetJob = targetId ? activeJobs.get(targetId) : null;
  const targetContext = targetId && !targetJob
    ? [...contextOwners.entries()].find(([, accountId]) => accountId === targetId)?.[0]
    : null;
  const jobs = targetJob ? [targetJob] : [...activeJobs.values()];
  if (!jobs.length && !browserContexts.size) return { ok: false, error: '当前没有运行中的任务或检查页面' };
  const wasRunning = jobs.length > 0;
  jobs.forEach((job) => { job.stopRequested = true; });
  log(wasRunning ? '正在停止任务…' : '正在关闭检查页面…', 'warning');
  const contexts = targetJob ? [targetJob.context].filter(Boolean) : targetContext ? [targetContext] : [...browserContexts];
  browserContext = null;
  contexts.forEach((context) => { browserContexts.delete(context); contextOwners.delete(context); });
  reviewPending = browserContexts.size > 0;
  await Promise.all(contexts.map(async (context) => {
    await saveCurrentAuthState(context);
    await releaseBrowserContext(context);
  }));
  if (!wasRunning || !targetJob) {
    send('upload:state', { state: 'review_closed' });
    log('检查页面已关闭');
  }
  return { ok: true };
});

app.whenReady().then(async () => {
  createWindow();
  runtimeReady = prepareRuntime();
  try {
    await runtimeReady;
    log(`运行数据目录：${getRuntimePaths().root}`);
  } catch (error) {
    log(error.message, 'error');
  }
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('before-quit', (event) => {
  if (appQuitting || !browserContexts.size) return;
  event.preventDefault();
  appQuitting = true;
  const contexts = [...browserContexts];
  browserContext = null;
  browserContexts.clear();
  void (async () => {
    await Promise.all(contexts.map(async (context) => {
      await saveCurrentAuthState(context);
      await context.close().catch(() => {});
    }));
    app.quit();
  })();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
