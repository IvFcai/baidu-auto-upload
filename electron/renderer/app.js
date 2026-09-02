const $ = (id) => document.getElementById(id);
const state = { running: false, totalFiles: 0, totalBatches: 0, completedBatches: 0, accountResults: new Map(), accountPlans: new Map(), activeAccounts: new Set() };
const ACCOUNT_PREFERENCE_KEY = 'baidu-video-relay.accounts';
let defaultFolderDialogOpen = false;
const accountFolderDialogsOpen = new WeakSet();

function readSavedAccount() {
  try {
    const raw = window.localStorage.getItem(ACCOUNT_PREFERENCE_KEY) || window.localStorage.getItem('baidu-video-relay.account');
    const saved = JSON.parse(raw || 'null');
    const accounts = Array.isArray(saved) ? saved : [saved];
    return accounts.map((account) => ({
      accountName: String(account?.accountName || '').trim(),
      accountId: String(account?.accountId || '').trim(),
      loginGroup: String(account?.loginGroup || 'auto').trim() || 'auto',
      folder: String(account?.folder || '').trim()
    })).filter((account) => account.accountName && account.accountId);
  } catch { return null; }
}

async function writeSavedAccounts(accounts) {
  const saved = accounts.map((account) => ({
    accountName: String(account.accountName || '').trim(),
    accountId: String(account.accountId || '').trim(),
    loginGroup: String(account.loginGroup || 'auto').trim() || 'auto',
    folder: String(account.folder || '').trim()
  }));
  if (!saved.length || saved.some((account) => !account.accountName || !account.accountId)) throw new Error('每个账户都必须填写账户名称和账户 ID');
  window.localStorage.setItem(ACCOUNT_PREFERENCE_KEY, JSON.stringify(saved));
  await window.baiduUploader.saveConfig(saved);
  return saved;
}

function accountRows() { return [...document.querySelectorAll('[data-account-row]')]; }
function getAccounts() {
  return accountRows().map((row) => ({
    accountName: row.querySelector('.account-name').value,
    accountId: row.querySelector('.account-id').value,
    loginGroup: 'auto',
    folder: row.querySelector('.account-folder').value
  }));
}
function assertAccountFolders(accounts) {
  if (accounts.length <= 1) return;
  if (accounts.some((account) => !String(account.folder || '').trim())) {
    throw new Error('多账户任务必须为每个账户分别选择视频文件夹');
  }
}

let accountSaveTimer;
function scheduleAccountSave() {
  window.clearTimeout(accountSaveTimer);
  accountSaveTimer = window.setTimeout(async () => {
    const accounts = getAccounts();
    if (!accounts.length || accounts.some((account) => !account.accountName.trim() || !account.accountId.trim())) return;
    try { await writeSavedAccounts(accounts); } catch {}
  }, 250);
}
async function chooseAccountFolder(row) {
  if (!row || accountFolderDialogsOpen.has(row)) return;
  accountFolderDialogsOpen.add(row);
  const button = row.querySelector('.choose-account-folder');
  if (button) button.disabled = true;
  const currentFolder = row.querySelector('.account-folder').value.trim();
  try {
    const folder = await window.baiduUploader.chooseFolder({ defaultPath: currentFolder });
    if (!folder) return;
    // 选择器是从该行按钮打开的，直接写回原行，避免账号 ID 编辑/重复时串到其他行。
    row.querySelector('.account-folder').value = folder;
    row.querySelector('.account-folder').title = folder;
    scheduleAccountSave();
  } finally {
    accountFolderDialogsOpen.delete(row);
    if (button) button.disabled = state.running;
  }
}
function addAccountRow(account = {}) {
  const row = document.createElement('div');
  row.className = 'account-row';
  row.dataset.accountRow = '';
  row.innerHTML = '<div class="field-group"><label>账户名称</label><input class="account-name" type="text"></div><div class="field-group"><label>账户 ID</label><input class="account-id" type="text"></div><div class="field-group"><label>视频文件夹</label><div class="input-with-action"><input class="account-folder" type="text" placeholder="该账户的视频目录" autocomplete="off"><button class="icon-button choose-account-folder" type="button" title="选择该账户的视频文件夹" aria-label="选择该账户的视频文件夹">⌁</button></div></div><div class="account-row-actions"><button class="account-upload-button" type="button">上传视频</button><button class="remove-account" type="button" title="删除账户" aria-label="删除账户">×</button></div>';
  row.querySelector('.account-name').value = account.accountName || '';
  row.querySelector('.account-id').value = account.accountId || '';
  row.querySelector('.account-folder').value = account.folder || '';
  row.querySelector('.account-folder').title = account.folder || '';
  row.querySelector('.choose-account-folder').addEventListener('click', () => chooseAccountFolder(row));
  row.querySelector('.account-upload-button').addEventListener('click', () => startAccountUpload(row));
  row.querySelector('.remove-account').addEventListener('click', () => { if (accountRows().length > 1) row.remove(); });
  $('accountList').append(row);
  return row;
}

function setStatus(name, detail, tone = 'idle') {
  $('statusLabel').textContent = name;
  $('statusDetail').textContent = detail;
  $('statusDot').dataset.tone = tone;
  $('liveState').textContent = tone === 'active' ? 'LIVE' : tone === 'success' ? 'COMPLETE' : tone === 'error' ? 'ERROR' : 'OFFLINE';
  $('liveState').dataset.tone = tone;
}

function addLog({ message, tone = 'info', at }) {
  const list = $('logList');
  list.querySelector('.log-empty')?.remove();
  const row = document.createElement('div');
  row.className = `log-row ${tone}`;
  row.innerHTML = `<span class="log-time">${at}</span><span class="log-marker"></span><span class="log-message"></span>`;
  row.querySelector('.log-message').textContent = message;
  list.append(row);
  list.scrollTop = list.scrollHeight;
}

function updateProgress() {
  const percent = state.totalBatches ? Math.round((state.completedBatches / state.totalBatches) * 100) : 0;
  $('progressBar').style.width = `${percent}%`;
  $('progressText').textContent = state.totalBatches ? `${state.completedBatches} / ${state.totalBatches} 批 · ${percent}%` : '等待启动';
}

function renderAccountResults() {
  const results = [...state.accountResults.values()];
  const list = $('resultList');
  list.innerHTML = '';
  if (!results.length) {
    list.innerHTML = '<div class="result-empty">完成后将在这里显示各账户结果</div>';
    $('resultSummary').textContent = '等待任务';
    return;
  }
  const successCount = results.filter((result) => result.ok).length;
  const failureCount = results.length - successCount;
  $('resultSummary').textContent = failureCount ? `${successCount} 成功 / ${failureCount} 失败` : `${successCount} 个账户已成功`;
  for (const result of results) {
    const row = document.createElement('div');
    row.className = `result-row ${result.ok ? 'success' : 'error'}`;
    const accountName = String(result.account?.accountName || '未知账户');
    const accountId = String(result.account?.accountId || '未知 ID');
    row.innerHTML = '<span class="result-marker"></span><span class="result-account"></span><span class="result-status"></span>';
    row.querySelector('.result-account').textContent = `${accountName}（${accountId}）`;
    row.querySelector('.result-status').textContent = result.ok ? '上传成功，已确定' : `失败：${result.error || '请检查页面'}`;
    list.append(row);
  }
}

function readConfig() {
  return {
    folder: $('folder').value,
    accounts: getAccounts(),
    batchSize: Number($('batchSize').value),
    waitMinutes: Number($('waitMinutes').value),
    recursive: $('recursive').checked,
    profile: state.profile
  };
}

function updateTaskState() {
  state.running = state.activeAccounts.size > 0;
  $('stopButton').disabled = !state.running && !state.accountResults.size;
  $('chooseFolder').disabled = state.running;
  $('addAccount').disabled = state.running;
  $('saveAccount').disabled = state.running;
  for (const row of accountRows()) {
    const accountId = row.querySelector('.account-id').value.trim();
    const active = state.activeAccounts.has(accountId);
    row.querySelectorAll('input, .choose-account-folder, .remove-account').forEach((control) => { control.disabled = active; });
    const button = row.querySelector('.account-upload-button');
    const result = state.accountResults.get(accountId);
    button.disabled = Boolean(result);
    if (active) button.textContent = '停止任务';
    else if (result?.ok) button.textContent = '上传完成';
    else if (result) button.textContent = '等待检查';
    else button.textContent = '上传视频';
  }
}

function setRunning(running) {
  if (!running) state.activeAccounts.clear();
  updateTaskState();
}

function setStopButtonLabel(label) {
  $('stopButton').textContent = label;
}

$('chooseFolder').addEventListener('click', async () => {
  if (defaultFolderDialogOpen) return;
  defaultFolderDialogOpen = true;
  $('chooseFolder').disabled = true;
  try {
    const folder = await window.baiduUploader.chooseFolder();
    if (folder) {
      $('folder').value = folder;
      $('folderHint').textContent = '目录已就绪，可以开始扫描';
      $('folderHint').dataset.tone = 'ready';
    }
  } finally {
    defaultFolderDialogOpen = false;
    $('chooseFolder').disabled = state.running;
  }
});

function applySavedAccounts(saved) {
  if (!saved?.length) return;
  const first = accountRows()[0];
  first.querySelector('.account-name').value = saved[0].accountName;
  first.querySelector('.account-id').value = saved[0].accountId;
  first.querySelector('.account-folder').value = saved[0].folder || '';
  first.querySelector('.account-folder').title = saved[0].folder || '';
  saved.slice(1).forEach(addAccountRow);
  $('saveAccount').textContent = '已恢复保存账户';
}

async function restoreSavedAccount() {
  try {
    const saved = window.baiduUploader.loadConfigSync()
      || await window.baiduUploader.loadConfig().catch(() => null)
      || readSavedAccount();
    if (!saved?.length) return;
    applySavedAccounts(saved);
    window.localStorage.setItem(ACCOUNT_PREFERENCE_KEY, JSON.stringify(saved));
    void window.baiduUploader.saveConfig(saved).catch(() => {});
  } finally {
    document.body.classList.remove('config-loading');
  }
}

$('addAccount').addEventListener('click', () => addAccountRow());
document.querySelector('[data-account-row] .remove-account').addEventListener('click', (event) => {
  if (accountRows().length > 1) event.currentTarget.closest('[data-account-row]').remove();
});
document.querySelector('[data-account-row] .choose-account-folder').addEventListener('click', (event) => chooseAccountFolder(event.currentTarget.closest('[data-account-row]')));
document.querySelector('[data-account-row] .account-upload-button').addEventListener('click', (event) => startAccountUpload(event.currentTarget.closest('[data-account-row]')));
$('accountList').addEventListener('input', scheduleAccountSave);
$('accountList').addEventListener('change', scheduleAccountSave);
$('saveAccount').addEventListener('click', async () => {
  try {
    const accounts = getAccounts();
    assertAccountFolders(accounts);
    await writeSavedAccounts(accounts);
    $('saveAccount').textContent = '账户列表已保存';
    window.setTimeout(() => { $('saveAccount').textContent = '保存当前账户'; }, 1800);
  } catch (error) {
    addLog({ message: error.message, tone: 'error', at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
  }
});

async function startAccountUpload(row) {
  try {
    const currentId = row.querySelector('.account-id').value.trim();
    if (state.activeAccounts.has(currentId)) {
      await window.baiduUploader.stop({ accountId: currentId });
      return;
    }
    const config = readConfig();
    const account = config.accounts.find((item) => item.accountId === currentId);
    if (!account?.accountName || !account.accountId) throw new Error('请先填写该账户名称和账户 ID');
    account.folder = account.folder || config.folder;
    if (!account.folder) throw new Error('请先为该账户选择视频文件夹');
    await writeSavedAccounts(config.accounts);
    state.activeAccounts.add(account.accountId);
    state.accountResults.delete(account.accountId);
    row.querySelector('.account-upload-button').textContent = '上传中…';
    $('logList').querySelector('.log-empty')?.remove();
    updateTaskState();
    const result = await window.baiduUploader.start({ ...config, accounts: [account] });
    if (!result?.ok) return;
  } catch (error) {
    addLog({ message: error.message, tone: 'error', at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
    state.activeAccounts.delete(currentId);
    updateTaskState();
  }
}

$('stopButton').addEventListener('click', () => window.baiduUploader.stop());
$('clearLog').addEventListener('click', () => { $('logList').innerHTML = '<div class="log-empty">任务日志会显示在这里</div>'; });
$('batchSize').addEventListener('input', () => { $('metricSize').textContent = $('batchSize').value || '—'; });

window.baiduUploader.onPlan(({ account, totalFiles, totalBatches }) => {
  if (account?.accountId) state.accountPlans.set(account.accountId, { totalFiles, totalBatches });
  state.totalFiles = [...state.accountPlans.values()].reduce((sum, plan) => sum + plan.totalFiles, 0);
  state.totalBatches = [...state.accountPlans.values()].reduce((sum, plan) => sum + plan.totalBatches, 0);
  $('metricFiles').textContent = state.totalFiles; $('metricBatches').textContent = state.totalBatches; updateProgress();
});
window.baiduUploader.browserStatus().then(({ browser, profile, configPath }) => {
  $('edgeChip').innerHTML = `<i></i> ${browser}`;
  $('connectorDetail').textContent = 'Chrome 登录配置：持久保存';
  $('connectorDetail').title = `Chrome 配置：${profile}\n账户配置：${configPath || '未提供'}`;
}).catch(() => { $('connectorDetail').textContent = 'Chrome 配置读取失败'; });
void restoreSavedAccount();
window.baiduUploader.onLog((payload) => {
  addLog(payload);
  if (payload.message.includes('已完成')) { state.completedBatches += 1; updateProgress(); }
});
window.baiduUploader.onState(({ state: next, browserOpen = false, account, uploadResult, failure }) => {
  const accountId = account?.accountId || failure?.account?.accountId;
  if (next === 'preparing') { if (accountId) state.activeAccounts.add(accountId); setStopButtonLabel('停止任务'); updateTaskState(); setStatus('准备中', '正在打开该账户的独立 Google Chrome', 'active'); }
  if (next === 'uploading') { if (accountId) state.activeAccounts.add(accountId); setStopButtonLabel('停止任务'); updateTaskState(); setStatus('上传中', '账户正在独立 Chrome 中上传视频', 'active'); }
  if (next === 'account_completed') {
    state.accountResults.set(account.accountId, { ok: true, account, uploadResult });
    state.activeAccounts.delete(account.accountId);
    renderAccountResults();
    updateTaskState();
    setStatus('已完成', `${account.accountName}（${account.accountId}）上传成功，已自动点击确定；Chrome 页面保持打开`, 'success');
  }
  if (next === 'account_failed') {
    state.accountResults.set(failure.account.accountId, failure);
    state.activeAccounts.delete(failure.account.accountId);
    renderAccountResults();
    updateTaskState();
    setStatus('需要检查', `${failure.account.accountName}（${failure.account.accountId}）失败，请检查对应 Chrome 页面`, 'error');
  }
  if (next === 'completed') {
    if (browserOpen) setStopButtonLabel('关闭检查页面');
    updateTaskState();
  }
  if (next === 'awaiting_confirmation') { setStopButtonLabel('关闭检查页面'); updateTaskState(); setStatus('等待确认', '视频已加入上传面板，Chrome 保持打开且未点击确定', 'success'); }
  if (next === 'review_closed') { setStopButtonLabel('停止任务'); state.accountResults.clear(); updateTaskState(); setStatus('检查结束', '上传页面已关闭，可以开始下一次任务', 'idle'); }
  if (next === 'stopped') { if (accountId) state.activeAccounts.delete(accountId); updateTaskState(); setStatus('已停止', '任务已由用户停止', 'idle'); }
  if (next === 'error') {
    if (browserOpen) setStopButtonLabel('关闭检查页面');
    updateTaskState();
    setStatus('需要检查', browserOpen ? '任务异常终止，Chrome 页面已保留，请检查上传进度' : '任务异常终止，请查看日志', 'error');
  }
});
updateTaskState();
