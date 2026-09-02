# 百度视频批量上传器：聊天交接文档

## 2026-09-01 自动确认回归修复

- 用户明确授权：失败视频条目自动删除完成后继续自动点击上传弹窗“确定”。此前 `src/uploader.js` 在删除数量覆盖原始批次文件数时无条件抛出“所有视频均上传失败”，因此不会进入确认阶段。
- `src/uploader.js` 现仅在未启用 `autoConfirm` 的兼容路径保留该保护；主进程的 `autoConfirm: true` 路径会继续等待可用按钮并点击，按钮置灰、找不到或页面仍报告失败时仍会报错且不点击。
- `test/uploader.test.js` 新增“删除失败条目后自动确认”回归测试，验证动作顺序为选择文件、删除失败条目、点击“确定”。
- 验证：`npm test` 85/85 通过；`node --check src/uploader.js`、`electron/main.js`、`electron/preload.cjs`、`electron/renderer/app.js` 通过。旧 Electron 已结束并以 `npm start` 启动新版；尚未在真实百度页面完成端到端上传验收。

## 2026-09-01 空 BrowserContext 回收

- 用户反馈只关闭 Chrome 网页后，后续任务偶尔无法删除失败条目或点击“确定”。原因是标签关闭不一定关闭 Playwright `BrowserContext`，空上下文仍可能保留 profile 锁并干扰下一次任务。
- `src/browser-session.js` 新增 `closeBrowserContextIfEmpty()`；`electron/main.js` 在启动同一账户新任务前只回收该账户已无页面的旧上下文。有页面的检查现场仍保留，登录缓存和 profile 文件不删除。
- `test/browser-session.test.js` 覆盖空上下文关闭和有页面上下文保留。`npm test` 86/86 通过，主进程和会话模块语法检查通过。Electron 已重新启动新版。

## 2026-09-01 停止任务后重试的失败条目删除修复

- 用户说明：桌面应用保持打开，点击“停止任务”并关闭当前 Chrome 窗口后，再次上传时偶发无法自动删除失败视频和点击“确定”。本次失败日志为“发现失败视频条目，但找不到该条目内的删除按钮”。
- 失败 HTML 确认真实结构：`.video-box-panel` 直接包含 `.refresh-button` 重试按钮和无文字的 SDK `role="button"` 删除 `×`；此前从 `.video-box` 回溯到 panel 后仍使用 `.video-box-panel > ...`，在 panel 作用域内匹配不到自身，通用回退又无法区分无文字删除按钮。
- `src/uploader.js` 现在优先使用 `:scope > [role="button"].cc-creative-sdk-veui-button:not(.refresh-button)`（并保留无 SDK class 的 direct role-button 回退），只在失败条目父 panel 范围内点击删除按钮，不会点击刷新或上传加号。
- `test/uploader.test.js` 新增停止/关闭浏览器后重试的真实 DOM 形态回归测试。验证：`npm test` 87/87 通过；`node --check src/uploader.js`、`electron/main.js`、`src/browser-session.js` 通过。Electron 已完全重启新版；真实百度端到端仍需用户单账户复测。

## 2026-08-31 多账户上传方式调整

- 多账户上传改为方式一：每个账户行提供独立“上传视频”按钮；一次点击只启动该账户的任务和独立 Google Chrome 持久配置，账户之间不再共享 BrowserContext 或上传弹窗。
- renderer 已移除全局“一次性开始上传”按钮，账户行按钮支持上传中停止、失败重试；账户结果继续在监视区显示。
- `upload:start` 保留原 IPC channel，但要求单账户配置；`upload:stop` 可接收 `{ accountId }` 停止单账户，省略参数时停止全部任务或关闭检查页面。
- 主进程按账户 ID 使用独立 profile/auth state；`loginGroup` 仅为旧配置兼容字段，当前方式一不参与任务分组。
- 使用 `accountProfile(accountId)` 直接打开已迁移的 `.chrome-profile-account-<账户ID>`；不得改回 `.chrome-profile-login-account-<账户ID>`，后者是本次单账户改造意外创建的空 profile，无法复用原先跑通的登录态。
- 主进程已恢复传入 `autoConfirm: true`。只有视频上传稳定、无失败状态且“确定”按钮可用时才点击，随后仍保留 Chrome 页面。
- 验证：`npm test` 78/78 通过；`node --check electron/main.js`、`electron/preload.cjs`、`electron/renderer/app.js`、`src/job-config.js`、`src/navigation.js`、`src/uploader.js`、`src/runtime-paths.js` 通过。真实百度页面尚未验收，需完全退出旧 GUI 后重新运行 `npm start`，先单账户验证。
- 追加修复：`electron/main.js` 现在接收 `navigateToVideoLibrary()` 返回的实际推广/视频库页面；百度“电商推广”新开标签时，后续上传步骤不再误操作原账户首页。登录页会等待用户在当前自动化 Chrome 完成扫码后自动继续。
- 2026-08-31 追加修复：失败账户曾停留在“电商推广”首页，旧逻辑点击任意“视频库”文本节点后可能只展开菜单而未触发链接。`src/navigation.js` 现在在资产中心菜单展开后优先点击可见的真实 `a[href*="/assetsCenter/creative/video/user/"]` 链接，再回退到文本点击；`electron/main.js` 和 `src/account-discovery.js` 传入账户 ID 作为调试标识。账户失败现场分别保存为 `.baidu-debug-account-<ID>.*`、`.baidu-debug-assets-<ID>.*`、`.baidu-debug-upload-<ID>.*`。新增菜单链接回归测试；`npm test` 78/78 通过，相关文件语法检查通过。真实百度页面仍需重启 GUI 后单账户复测。
- 2026-08-31 失败视频处理：截图中的“重复上传视频”红色失败条目现在可在弹窗内被识别；程序只点击该视频条目内部的 `×/删除/移除` 控件，不点击弹窗右上角关闭按钮或重试按钮。清理失败条目后才等待并点击“确定”；若全部视频失败则不确认并保留页面。主进程启用 `removeFailedItems: true`。新增批次路径唯一性和失败条目删除测试。
- 2026-08-31 真实截图对齐：失败条目控件可能同时在文本和 `aria-label` 中显示 `×`，现按属性分别识别；也兼容无文字但 class 含 `close/delete/remove` 的 SVG。`README.md` 已更新为当前自动确认和失败条目清理行为。`npm test` 79/79 通过；新版 Electron 已重启，真实百度页面仍需单账户验证。
- 2026-08-31 16:10 失败回归：真实页面报“发现失败视频条目，但找不到该条目内的删除 × 按钮”。截图显示删除 `×` 是普通图标节点而非标准 button/role button；失败条目内控件范围已扩展到 `span/i/div/svg`，仍仅在该条目容器中匹配 `×/删除/移除/close/delete/remove`，不会点击重试或弹窗右上角关闭。`npm test` 79/79 通过，Electron 已于 16:18 重启；待真实单账户复测。
- 2026-08-31 滚动修复：失败视频条目可能位于上传弹窗可视区域之外；删除前现在调用 `scrollIntoViewIfNeeded()` 将条目滚入视口，再解析其内部删除控件，删除后重新扫描。日志会记录“正在滚动到失败视频条目…”。新增离屏条目回归测试，目标测试 27/27 通过；需重启 Electron 后真实复测。
- 2026-08-31 父容器修复：真实页面的失败标记节点与删除 `×` 可能是兄弟节点，删除控件不在 `.video-box` 子树内。现在从失败节点向上回溯最多三层父容器查找 `×/删除/移除/close/delete/remove`，并继续只在条目范围内操作。主进程失败时保存 `.baidu-debug-upload-<账号ID>.html/png`。`npm test` 81/81 通过，相关语法检查通过；Electron 需重启后复测。
- 2026-08-31 16:36 真实 DOM 对齐：失败现场 HTML 显示结构为 `.video-box-panel`、`.refresh-button`（重试）和同级无文本 VEUI 按钮（删除 `×`）。新增 `.video-box-panel > [role="button"].cc-creative-sdk-veui-button:not(.refresh-button)` 精确选择器，明确排除重试按钮；失败条目清理前仍会滚动到条目。`npm test` 目标 81/81，Electron 需重启后复测。

更新时间：2026-08-27

## 2026-08-27 最新交接补充

### 自动确认与账号级结果（2026-08-28）

- 用户已在当前对话明确授权：某个账号的全部视频上传且页面稳定后，自动点击百度上传弹窗中的“确定”。除此以外不得点击发布、提交或其他不可逆业务按钮。
- `src/uploader.js` 的 `uploadBatches()` 新增可选 `autoConfirm`，默认仍保持 `awaitingConfirmation: true` 兼容语义；主进程传入 `autoConfirm: true`。只有 `waitForBatchSettled()` 已确认没有上传中、处理中或失败状态，且当前上传弹窗内存在可见、可用、精确文本为“确定”的按钮时才点击。找不到或禁用时，该账号明确失败且不会伪报成功。
- `electron/main.js` 会在每个账号确认成功后发出 `upload:state` 的 `account_completed` 状态；单账号异常发出 `account_failed`，记录账号 ID 和错误，并继续同一登录组的后续串行队列。全部成功后状态为 `completed`，不再停在“等待确认”。Chrome 页面依旧保持打开。
- `electron/renderer/index.html`、`electron/renderer/app.js`、`electron/renderer/styles.css` 新增“账户结果”区域，实时显示账号名称、ID、成功（“上传成功，已确定”）或失败原因。
- 新增 `test/uploader.test.js` 回归用例：可用的“确定”在稳定后点击；禁用的“确定”不能被点击且任务报错；页面报告上传失败时不得确认。最新验证：`node --test test/uploader.test.js` 为 `24/24 passed`，`npm test` 为 `70/70 passed`；`node --check src/uploader.js electron/main.js electron/renderer/app.js` 通过。新版逻辑尚未在真实百度页面验收，需完全退出旧 Electron 后执行 `npm start`，先使用单账号验证。

### “确定”置灰加载与文件夹重复打开修复（2026-08-28）

- 用户反馈证实“第 N/N 批已完成”只代表上传传输已结束，不代表百度已完成视频加载；此时“确定”仍会置灰。此前自动确认只检查一次可用按钮，错误报为“找不到可用的确定按钮”。
- `src/uploader.js` 现在在上传完成后继续在上传弹窗内等待“确定”按钮从置灰变为可用，默认最多等待 2 分钟，主进程按 GUI 的单批最长等待时间传入同样上限。等待中如页面出现上传/校验/解析失败提示，立即失败且绝不点击确认；超时会记录“等待确定按钮可用超过 N 分钟”。
- `electron/renderer/app.js` 的默认文件夹和每个账户的文件夹按钮现在有各自的异步打开锁，并在原生选择器打开期间置灰该按钮，避免连续点击并发打开多个系统选择器造成卡顿。
- 新增“按钮先置灰、随后可用才确认”回归测试。最新验证：`node --test test/uploader.test.js` 为 `25/25 passed`，`npm test` 为 `71/71 passed`；`node --check src/uploader.js electron/main.js electron/renderer/app.js` 通过。
- 当前用户保留的 Electron/Chrome 检查现场仍加载旧代码。不要直接关闭其中的 Chrome 页面；待用户完成检查后，完全退出旧 GUI 再执行 `npm start` 载入本次修复。

### 36 个视频只加入首批 12 个：追加加号外层卡片修复

- 用户最新截图确认账户 `83515948` 的百度上传弹窗只显示首批 12 个文件，虽然所选网络共享目录包含 36 个 MP4；此时页面底部仍可见大号 `+`。
- 排查确认扫描和分批逻辑不以 12 为总数限制：任务会按所选目录的全部视频构造计划，36 个应为 3 批。问题位于第 2 批及后续批次的文件选择触发路径。
- `src/uploader.js` 现在在命中内部 SVG/文本加号但该节点不可点击时，向上查找可见的上传卡片/role button 后重试一次，并继续等待同一次 Playwright `filechooser`；不会回退到可能覆盖已选视频的隐藏 input。
- `src/uploader.js` 追加加号点击后如果百度异步挂载新的隐藏 `input[type=file]` 而不发出 `filechooser`，现在最多等待 1.5 秒并只接受点击后新出现的 input；同时检查加号节点、上传卡片祖先及页面级 input，不会复用点击前已存在的 input 覆盖上一批。
- `test/uploader.test.js` 新增回归用例，覆盖“内部加号节点不可触发 filechooser、外层上传卡片可触发”“追加加号异步挂载新 input”及“追加加号异步挂载页面级 input”的结构。最新验证：`npm test` 为 `67/67 passed`；`node --check src/uploader.js`、`node --check src/navigation.js`、`node --check electron/main.js` 均通过。
- 当前 Electron 进程在本次源码修改前已启动，Electron 不热加载。真实复测前需退出 GUI 并重新运行 `npm start`；不要关闭用户需要检查的 Chrome 页面。复测时先运行账户 `83515948`，GUI 日志必须依次出现第 `1/3`、`2/3`、`3/3` 批已加入上传面板，且弹窗中保留 36 个条目。仍不得点击百度“确定”。

### 账号目录选择器修复

- GUI 点击账号行的文件夹按钮时，会把该行输入框中的现有目录作为 Windows 文件夹选择器的初始位置，并只把选择结果写回该账号行。
- `src/folder-dialog.js` 统一生成选择器参数；UNC 网络共享路径（例如 `\\192.168.1.206\e\账号目录`）不再被过滤，因此不会再因为缺少 `defaultPath` 而沿用上一次打开的目录。
- `electron/main.js` 的 `folder:choose` IPC 保持原 channel 名称，并使用上述参数构造逻辑。
- 新增 UNC 默认目录回归测试。最新验证：`node --check electron/main.js`、`node --check electron/renderer/app.js`、`node --check src/folder-dialog.js` 均通过；`npm test` 为 `63/63 passed`。
- 已完全退出本项目旧 Electron 进程并重新执行 `npm start`。Windows 原生选择器是否在用户实际网络共享环境中准确落到指定子目录，仍需在当前新版 GUI 中分别点击两个账号行确认。

### 36 个视频只剩 24 个的修复

- 真实现象对应 3 批（12+12+12）中后续批次覆盖前面已加入的视频：追加批次曾命中加号关联的隐藏 `input[type=file]`，直接 `setInputFiles()` 会让百度上传面板替换已有列表。
- `src/uploader.js` 现仅允许首批使用加号关联的隐藏 input；第 2 批及以后强制点击当前面板底部 `+` 并等待新的 Playwright `filechooser`，再追加文件。
- 新增回归测试验证追加批次不会调用关联 input 覆盖已有批次。最新验证：`npm test` 为 `64/64 passed`，`node --check src/uploader.js` 通过。
- 已重启新版 Electron GUI。真实百度页面仍需用户用该 36 视频目录复测；预期日志应显示 `3/3 批`，且上传面板保留 36 个视频条目。

### 用户最新复测现场

- 用户确认账号行与视频目录已经对应；截图显示目标目录内有 36 个 MP4 文件。
- 实际上传后百度页面只保留/显示 24 个视频，符合追加批次覆盖前面批次的现象，尚不能视为 36 个视频全部上传成功。
- 本次代码修复后必须重新启动 GUI 再复测；真实百度页面尚未确认第 3 批是否成功追加。

### 当前已确认的用户流程

- 用户已确认自动批量上传流程可以运行。
- 每个账号应在 GUI 账号行中选择自己的视频文件夹；顶部“默认视频文件夹”只作为未填写账号目录时的兼容回退。
- 一个账号目录超过一批时，第一批加入后应立即通过上传弹窗底部的 `+` 追加下一批，不等待上一批完成，不删除或替换已加入的视频。
- 所有批次加入上传面板后才等待页面上传状态稳定；绝不自动点击百度“确定”、发布或提交。

### 最近修复与实现事实

- `src/account-discovery.js`：账户发现使用 `navigateToVideoLibrary()` 返回的实际推广页/视频库页，解决新标签页打开后仍把账户列表页传给上传队列的问题。
- `src/uploader.js`：每批开始前重新发现上传面板；第二批及后续批次强制使用底部追加 `+` 和 Playwright `filechooser`，禁止通过隐藏文件输入 `setInputFiles()` 覆盖前一批。
- `src/uploader.js`：加号定位优先匹配精确 `+`、添加文件或选择文件语义，避免已有视频条目的控件排在前面时被误点。
- `src/uploader.js`：文件选择路径使用 locator 点击，不再使用坐标点击；点击后未收到 `filechooser` 时只失败一次并保留页面，避免反复弹出 Windows“打开”窗口。
- `src/job-config.js`、`electron/renderer/index.html`、`electron/renderer/app.js`、`src/account-preferences.js`：支持每个账号独立视频目录，并保存/恢复该配置；全局目录仍可作为旧配置回退。
- `electron/main.js`：启动浏览器前按账号目录分别扫描和分批，任务计划统计为各账号实际视频数/批次数之和；同一登录组内上传继续串行。

### 验证状态

- 最新本地测试：`npm test`，`64/64 passed`。
- 本轮相关 JavaScript 语法检查已通过：`electron/main.js`、`electron/renderer/app.js`、`src/folder-dialog.js`、`src/uploader.js`。
- 新增回归测试覆盖：UNC 路径作为文件夹选择器默认位置；追加批次不得通过关联隐藏 input 覆盖已有批次。
- 最新“每账号目录”与“避免重复弹出系统文件选择框”的真实百度页面行为尚未在新 GUI 进程中完整复验。
- 之前检测到旧 Electron 进程；Electron 不热加载源码。真实复测前必须完全退出旧 GUI，再在项目目录执行 `npm start`。

### 下一步真实复测

1. 完全退出旧 Electron GUI；不要为此关闭用户仍需检查的 Chrome 页面，除非用户明确要求。
2. 执行 `npm start`，先只测试一个账号和包含 36 个视频的目录。
3. 观察 GUI 日志应先显示扫描到 36 个视频、共 3 批；第 1 批加入后，程序应滚到底部 `+` 并依次追加第 2、3 批，上传面板中原有视频不能被替换。
4. 再测试多账号：每个账号填写不同目录，确认日志和计划统计分别对应各目录，且同一登录组内账号上传串行。
5. 如果仍只显示 24 个，保留 Chrome 页面并收集完整 GUI 日志、上传面板截图和带账号标识的调试产物；重点确认是否出现 `第 3/3 批已加入上传面板`，不要仅凭截图猜选择器。

### 不可变约束

- 必须使用 Google Chrome，并遵循账户首页搜索、ID 精确核验、“电商推广”、菜单进入“完整视频”的流程；不得硬编码视频库 URL 绕过账户选择。
- 稳定函数签名和 GUI IPC channel 见本文件后文及 `AGENTS.md`，修改时必须同步调用方和测试。
- 成功、失败、停止时保留 Chrome 页面；只有 GUI“关闭检查页面”或应用退出才关闭相应上下文。
- 不得记录密码、Cookie、授权头、可复用登录状态或完整本地文件清单；不得清理用户 profile、视频目录或既有调试产物。

## 2026-08-26 当前状态快照（压缩保留）

### 2026-08-26 最新修复

- `navigateToVideoLibrary()` 在点击“电商推广”新开标签时会返回新的推广页；此前 `electron/main.js` 的账户发现流程忽略该返回值，错误地把原“全部广告账户”页交给上传队列。这会导致用户看到视频库已打开，但自动化实际在错误页上查找“上传视频”。
- 新增 `src/account-discovery.js`，账户发现现在将实际返回的视频库 `Page` 传给上传队列；`electron/main.js` 改为调用该模块。
- `test/account-discovery.test.js` 覆盖新标签页场景。最新本地验证：`npm test` 为 `54/54 passed`；`node --check electron/main.js src/navigation.js src/uploader.js src/account-discovery.js` 通过。
- `src/uploader.js` 现在在每批加入前重新发现当前上传弹窗；百度在首批加入后重绘面板时，第二批及后续批次会滚动到新渲染的底部 `+` 后再选择文件，而不再复用失效的旧弹窗引用。
- `test/uploader.test.js` 覆盖首批后面板重绘、重新滚动并点击新加号的场景。最新本地验证更新为 `npm test`：`55/55 passed`。
- 对第二批及后续批次，`src/uploader.js` 现强制经上传面板底部 `+` 触发 `filechooser` 后追加文件，绝不回退到 `input.setInputFiles()`。此前该回退可能替换隐藏文件输入的已选文件，从而使前一批在界面上消失。
- `test/uploader.test.js` 现验证三批均依次经 `+` 加入、全部加入前不等待上传完成，以及追加失败时不直接覆盖前一批。最新本地验证更新为 `npm test`：`56/56 passed`。
- `src/uploader.js` 的加号候选不再直接取第一个可见 upload 控件：先匹配精确 `+`、添加文件或选择文件的语义，再回退到专用加号卡片/SVG，避免页面中已有视频条目排在前面时误点击其控件并替换前一批。
- `test/uploader.test.js` 覆盖“已有视频条目在前、真正追加加号在后”的顺序，验证只会点击后者。最新本地验证更新为 `npm test`：`57/57 passed`。
- 每个账户现在支持独立 `folder`：`src/job-config.js` 优先使用账户目录，旧配置未填账户目录时仍回退到全局默认目录；`electron/main.js` 在启动 Chrome 前分别扫描每个账户目录并按各自文件数/批次数计算总计划。
- GUI 的每个账户行增加视频文件夹输入及选择按钮，目录随账户列表保存和恢复。`test/job-config.test.js`、`test/account-preferences.test.js` 覆盖独立目录和偏好保存。最新本地验证更新为 `npm test`：`59/59 passed`。
- 本次未执行 `npm start` GUI 烟测：发现已有 Electron 进程，运行中的窗口不会热加载，且不得在未授权时关闭用户的检查页面。真实 GUI 验证前需由用户完全退出旧 GUI 后再启动。
- 上传弹窗内反复出现 Windows“打开”窗口的原因是旧逻辑用鼠标坐标点击 `+`，未可靠取得 Playwright `filechooser` 事件后会在重试循环中再次点击。`src/uploader.js` 已改为文件选择路径只使用 locator 点击；追加批次未取得 `filechooser` 时立即报错并保留页面，不再重复触发系统文件选择窗口。
- `test/uploader.test.js` 覆盖 locator 点击和未收到 `filechooser` 时只点击一次。最新本地验证更新为 `npm test`：`60/60 passed`。
- 真实百度页面仍未复验。必须完全退出旧 Electron GUI 后执行 `npm start`，只跑一个账户；页面应在“完整视频”出现后点击左上“上传视频”，在批量上传弹窗中通过 `+` 逐批加入 GUI 选定目录的视频，且始终不点击百度“确定”。

### 当前目标

Electron + Playwright 必须在同一个自动化 Chrome 页面完成真实流程：从 `https://cc.baidu.com/homepage` 搜索账户名称、用账户 ID 精确核验、点击“电商推广”、经菜单进入“完整视频”视频库、点击左上蓝色“上传视频”，在“上传视频（支持批量上传）”弹窗中点击左侧大 `+` 并批量选择 GUI 指定目录的视频。默认每批 12 个；不得点击百度弹窗“确定”；成功、异常、停止时都保留 Chrome 页面。

### 已经修改的文件

- `src/navigation.js`：登录页明确报未完成登录；兼容“资产中心”/“资产管理”；进入视频库须实际出现“完整视频”；上传阶段页面不对时重新导航；上传按钮增加 role、class、文本、DOM 原生和坐标点击回退；上传弹窗失败时保存 `.baidu-debug-upload.html/png`。
- `src/uploader.js`：弹窗大 `+` 支持 class、role、aria、半角/全角加号、坐标点击、`filechooser` 与 `input[type=file]` 回退。
- `electron/main.js`：同一个 `BrowserContext` 内的账户上传改为队列串行。
- `test/navigation.test.js`、`test/uploader.test.js`：新增登录、菜单别名、首页误判、上传按钮回退、加号回退测试。

### 尚未解决的问题

- 真实百度运行仍未证明自动化控制的同一个 `Page` 能稳定从“电商推广首页”进入“完整视频”。
- `2026-08-26 13:41` 的 `.baidu-debug-upload.html` 是“百度电商推广首页 / 数据概览”，没有“完整视频”或“上传视频”；日志中所有上传按钮 selector 为 0 的根因是页面错误，并非已证实 selector 写错。
- 尚未取得真正视频库内蓝色“上传视频”的实际 `outerHTML/class/role`，也未在真实页面确认自动打开弹窗、点击大 `+`、选择文件。
- 当前多个账户会覆盖同名 `.baidu-debug-upload.*`，应改为按账户 ID 保存调试文件，保留各自现场。

### 不能改变的接口约定

- `navigateToVideoLibrary(page, { accountId, accountName, timeout, logger, openUpload })`
- `openVideoUpload(page, { timeout, logger, assumeVideoLibrary })`
- `clickUploadVideoButton(page, { timeout, forceFallback, logger })`
- `openUploadDialog(page, { timeout, logger })`
- `uploadBatches(page, batches, options)`
- GUI IPC：`browser:status`、`folder:choose`、`upload:start`、`upload:stop`、`upload:log`、`upload:state`、`upload:plan`。
- 必须继续使用 Google Chrome；不得硬编码视频库 URL 绕过账户选择；账户搜索按名称/备注、ID 仅作精确核验；同组多账户可开多个标签但上传串行；不得自动关闭 Chrome 或点击百度“确定”。系统自动打开的普通 Chrome 和项目 `.chrome-profile` 是不同会话，Playwright 不能直接接管前者。

### 下一步测试命令

```powershell
cd D:\project\baidu-auto-upload
npm test
node --check src/navigation.js
node --check src/uploader.js
node --check electron/main.js
npm start
```

## 2026-08-31 失败条目删除修复

用户现场账户 `83515948` 的上传失败 HTML 已确认真实结构：失败行是 `.cc-creative-video-upload-item`，扫描到的失败节点是内部 `.video-box`；其父级 `.video-box-panel` 直接包含一个 `.refresh-button` 重试按钮和一个无文字、无 aria-label 的 SDK `role="button"` 删除 `×`。

已修改 `src/uploader.js`：失败控件查询现在在当前 scope 直接查找 `[role="button"].cc-creative-sdk-veui-button:not(.refresh-button)`，同时保留面板后代回退选择器，因此从 `.video-box` 回溯到 `.video-box-panel` 时可命中无语义删除按钮且不会误点重试。新增测试覆盖该真实 DOM 形态：`test/uploader.test.js`。

验证结果：

- `node --test test/uploader.test.js`：29/29 通过。
- `npm test`：82/82 通过。
- `node --check src/uploader.js`、`node --check electron/main.js`：通过。
- 用保存的 `.baidu-debug-upload-83515948.html` 只读 DOM 烟测：失败面板 `1` 个非重试按钮、`1` 个重试按钮。

已完全退出并重新启动 Electron。尚未在真实百度页面再次完成单账户端到端验收；下一步使用账户 `83515948` 测试，观察是否出现“已删除失败视频条目”及随后“已自动点击‘确定’”。

## 2026-08-31 17:00 文件选择器与剩余成功项修复

现场截图显示失败项删除后仍有一个成功视频，弹窗“确定”已变为可用；此前 `removedFailedItems >= 原始文件数` 会误判为“所有视频均失败”，因此没有确认。另有一次删除后的 DOM 重绘触发了上传加号，打开系统文件选择器。

已修改 `src/uploader.js`：

- 删除按钮选择器限定为 `.video-box-panel` 的直接子 `role="button"`，并排除 `.refresh-button`，避免重绘后误点上传加号。
- 新增成功条目检测，只在没有任何可见成功视频且删除数量覆盖原始文件数时报告“全部失败”；仍有成功视频时继续等待并点击“确定”。

新增 `test/uploader.test.js` 回归测试，覆盖上述两种行为。验证结果：上传器 `30/30`、全量 `83/83`，`src/uploader.js` 和 `electron/main.js` 语法检查通过。Electron 已重启，真实百度页面需再次单账户复测。

## 2026-09-01 无动作/误扫加号修复

现场 09:01 调试截图仍显示失败视频红条和删除 `×`，说明上一版删除定位在部分重绘状态下没有稳定命中；同时失败扫描可能把外层 `.cc-creative-video-upload-item` 与内部 `.video-box` 重复作为两个失败项，父级回溯有误触上传加号的风险。

已修改 `src/uploader.js`：

- `findFailedUploadRows()` 优先只扫描 `.cc-creative-video-upload-item`，没有该结构时才回退通用选择器，避免同一失败视频重复处理。
- 删除控件查询拆成两级：优先面板直接子 `.cc-creative-sdk-veui-button:not(.refresh-button)`，再接受不带 SDK class 的直接 `[role="button"]`；始终排除 `.refresh-button`，不再把泛化查询用于触发上传加号。

新增回归测试覆盖外层/内层重复节点和无 SDK class 的删除按钮。验证结果：上传器 `32/32`、全量 `85/85`，语法检查通过。Electron 已于 09:54 完全重启；真实页面尚未再次端到端验收，下一步只测试账户 `83515948`，重点观察日志是否连续出现“正在滚动…”、“已删除失败视频条目”以及“已自动点击确定”。

## 2026-09-01 回退到 17:00 修复前版本

用户要求撤销导致文件选择器弹出且自动删除失效的后续改动。由于项目目录无 Git 历史，未使用过旧备份目录覆盖；已精确恢复 `src/uploader.js` 到 17:00 之前的失败项扫描和删除选择器逻辑，并撤销“外层条目去重、无 SDK class 直接按钮回退、剩余成功项判断”这几项后续改动。多账户独立窗口、12 个一批、追加批次、自动确认和 `removeFailedItems: true` 保留。

回退后验证：`npm test` 81/81 通过；`node --check src/uploader.js`、`node --check electron/main.js` 通过。Electron 已于 10:53 完全重启。真实百度页面待账户 `83515948` 单账户复测；预期恢复此前日志中的“已删除失败视频条目”。

### 下一步现场排查

1. 完全退出旧 Electron GUI 后执行 `npm start`，只跑一个账户。
2. 收集从“正在打开百度营销账户首页...”到最终异常的完整 GUI 日志。
3. 对照本次新生成的 `.baidu-debug-assets.html/png` 与 `.baidu-debug-upload.html/png`。
4. 只有当 upload 调试 HTML 已确认是真正视频库时，才依据其中的真实按钮 DOM 添加精确 selector；不能再根据截图猜测。

## 压缩保留摘要

### 当前目标

在 Google Chrome 中按“全部广告账户 -> 搜索账户名称 -> ID 精确核验 -> 电商推广 -> 资产中心 -> 视频库 -> 上传视频 -> 弹窗加号”的真实流程，自动把 GUI 指定目录的视频按每批 12 个加入百度视频上传弹窗；不点击百度“确定”，不关闭检查页面。

### 已经修改的文件

- `electron/main.js`：多账户/登录组调度、账户发现后立即启动上传、保存登录状态、保留检查页面。
- `electron/renderer/index.html`、`electron/renderer/app.js`、`electron/renderer/styles.css`：桌面 GUI、账户行、参数和日志显示。
- `src/navigation.js`：账户搜索、抗 DOM 重绘的“电商推广”点击、视频库导航、“上传视频”按钮多重点击、上传弹窗识别。
- `src/uploader.js`：视频扫描、12 个一批、弹窗加号/文件选择和连续批次加入。
- `src/job-config.js`、`src/account-preferences.js`：账户配置和保存恢复。
- `src/auth-state.js`、`src/browser-config.js`、`src/browser-session.js`：Chrome 登录持久化与页面保留。
- `test/*.test.js`：现有 42 个 Node 测试。

### 尚未解决的问题

用户已经确认可以到达正确的视频库页面，但真实百度页面上自动化仍可能没有真正打开蓝色“上传视频”按钮对应的弹窗。因此也无法保证自动点击弹窗中的大 `+` 并选择 GUI 目录。最新代码有三层点击和多 selector 兜底，但尚未通过真实页面验收。下一步必须在失败分支保存当前页面 HTML、截图、上传按钮和弹窗/加号的 `outerHTML`，根据真实 DOM 修正，不能继续只按截图猜 selector。

### 不能改变的接口约定

- GUI 输入：视频文件夹、账户名称、账户 ID、登录组、每批数量、最长等待时间、是否递归扫描；账户列表可保存/恢复。
- `buildJobConfig()` 继续返回标准化账户数组；账户 ID 不可重复；未填登录组默认为 `auto`。
- `navigateToVideoLibrary(page, { accountId, accountName, timeout, logger, openUpload })` 保持可调用；`openUpload: false` 仅进入视频库，供发现阶段使用。
- `openVideoUpload(page, { timeout, logger, assumeVideoLibrary })` 必须负责打开“上传视频”弹窗，不能只停在视频库。
- `uploadBatches(page, batches, ...)` 接收已分好的视频批次，每批默认 12 个，返回 `awaitingConfirmation: true`，且不得点击百度“确定”。
- 必须使用 Google Chrome；不得改为 Edge、扩展插件或跳过“全部广告账户”的账户选择流程。
- 成功、失败、停止时均保留浏览器页面；只有 GUI 的“关闭检查页面”或应用退出才能关闭。

### 下一步测试命令

```powershell
cd D:\project\baidu-auto-upload
node --check electron\main.js
node --check src\navigation.js
node --check src\uploader.js
npm test
npm start
```

## 当前目标

这是一个 Electron 桌面应用，使用本机 Google Chrome + Playwright 自动完成百度电商推广视频库的批量上传。

用户的最终操作目标：

1. 在 GUI 选择本地或网络共享中的视频目录。
2. 在 GUI 填写一个或多个目标账户：账户名称、账户 ID、登录组。
3. 自动从 `https://cc.baidu.com/homepage` 的“全部广告账户”中搜索账户名称。
4. 以账户 ID 精确核验搜索结果，点击该行“电商推广”。
5. 进入该账户的资产中心 -> 视频库。
6. 自动点击视频库页面左上角的“上传视频”。
7. 在“上传视频（支持批量上传）”弹窗中自动点击左侧大 `+` 号。
8. 读取 GUI 指定目录，按每批 12 个视频连续加入上传列表。
9. 不点击百度弹窗中的“确定”；成功、异常和停止时均保留 Chrome 页面，供用户检查。

## 用户的重要偏好与约束

- 使用 Google Chrome，明确不再使用 Edge，也不使用浏览器扩展。
- 必须按账户管理流程进入，不能硬编码账户视频库 URL 后跳过账户选择。
- 账户搜索框搜索的是账户名称或备注，不是账户 ID；ID 仅用于搜索结果精确匹配。
- GUI 账户名称和账户 ID 允许保存、下次恢复。
- 一个 Chrome 登录账号下的多个广告账户应在同一登录组、同一 Chrome profile 中处理；没有该账户时才需要打开独立 Chrome 窗口扫码。
- 上传时不等前一批完成，加入一批 12 个后应继续寻找弹窗底部加号加入下一批；不得重复选择已有文件。
- 用户不接受任务结束后自动关闭页面。
- GUI 是深黑色、透明玻璃质感的桌面应用，已有实现；不要无关重做 UI。

## 当前关键现象（最后一次用户反馈）

用户最新截图显示已经到达正确的视频库页面：

`https://shoppingads.baidu.com/shop/assetsCenter/creative/video/user/83515948`

页面左侧有一个肉眼可见、蓝色的“上传视频”按钮，但自动化没有打开上传弹窗。此前也出现过：

- 账户表格点击“电商推广”时报 `element was detached from the DOM`。
- 上传弹窗已由用户截图确认真实结构为“上传视频（支持批量上传）”，左侧大加号为选择文件入口。
- 多账户时，页面会同时开多个标签页；截图中可见多个“百度营销-客户中心 / 电商推广”标签页。

## 最近已做但尚未由真实页面确认的修复

最新修改在 `src/navigation.js`：

- `clickUploadVideoButton()` 增加 `.btn-upload` 定位。
- 对“上传视频”使用三层点击：Playwright `click({ force: true })`，失败后 DOM 原生 `element.click()`，最后按元素中心点用 `page.mouse.click()`。
- `openUploadDialog()` 最多尝试点击三次；每次点击后最多等待 6 秒确认弹窗是否出现。
- 日志会显示：`上传按钮已点击（第 N 次），正在等待批量上传面板…`。

最新修改在 `src/uploader.js` / `src/navigation.js`：

- 上传弹窗和加号使用多个 selector，包含 `.video-box`、上传相关 class、`aria-label`、`role=button` 和 `svg.add`。
- 弹窗标题“上传视频（支持批量上传）”可作为识别锚点。
- 弹窗可能先出现标题和加号，稍后才挂载 `input[type=file]`；代码会继续等待。

最新修改在 `src/navigation.js`：

- 点击“电商推广”时，每次重试都重新查询账户行，避免表格重绘后旧 locator 被 detach。
- 最多重试 5 次。

状态说明：以上修复已经通过单元测试和语法检查，但**用户尚未在真实百度页面复测确认成功**。不要宣称上传按钮问题已解决；下一步应优先让用户重启 GUI 实测并收集新的 GUI 日志与调试 HTML。

## 当前实现概览

### GUI / Electron

- `electron/main.js`：任务编排、Chrome profile、登录状态、账户发现、多账户多登录组、上传任务。
- `electron/preload.cjs`：主进程与 GUI 的安全 IPC。
- `electron/renderer/index.html`：GUI 结构。
- `electron/renderer/app.js`：GUI 状态、账户行、日志与保存配置。
- `electron/renderer/styles.css`：黑色玻璃质感界面。

### 业务逻辑

- `src/navigation.js`：
  - 从百度账户首页查找账户。
  - 点击“电商推广”。
  - 导航资产中心、视频库。
  - 点击“上传视频”、识别批量上传弹窗。
- `src/uploader.js`：扫描视频、每批 12 个、选择弹窗的文件控件、连续加入批次、等待上传完成。
- `src/job-config.js`：GUI 配置校验与账户行标准化。
- `src/account-preferences.js`：账户偏好保存/读取。
- `src/auth-state.js`：加密保存/恢复百度登录状态。
- `src/browser-config.js`：Chrome 启动参数。
- `src/browser-session.js`：是否保留/关闭浏览器上下文。

## 多账户与登录组策略

GUI 每行有：账户名称、账户 ID、登录组。

- `auto`：先在主 Chrome profile `.chrome-profile` 的当前登录中查找。
- 当前登录找到的多个账户共用主 profile，通过多个标签页处理。
- 当前登录找不到时，会打开独立 profile：`.chrome-profile-login-auto-1`、`auto-2` 等，让用户扫码。
- 新扫码窗口会尝试所有待处理账户，找到的账户归入同一窗口，避免同一账号重复扫码。
- 显式组名（例如 `A`）使用 `.chrome-profile-login-group-A`。

注意：当前策略默认是“发现一个账户后立即排队上传”，这是为了避免先发现的页面长时间停留在视频库。

## 登录状态

- 主 profile：`.chrome-profile`
- 独立 profile：`.chrome-profile-login-*`
- 加密状态文件由 Electron `userData` 保存：主组为 `baidu-auth-state.bin`，其他组为 `baidu-auth-state-<key>.bin`。
- GUI 里的“关闭检查页面”才应主动关闭 Chrome 页面。
- 应用退出时也会统一关闭上下文。

## 调试文件

项目目录当前有：

- `.baidu-debug-account.html` / `.png`：账户查找或点击电商推广失败时保存。
- `.baidu-debug-assets.html` / `.png`：资产中心/视频库导航失败时保存。

注意：目前已有 `.baidu-debug-assets.*` 时间较早，内容可能是旧失败现场，不能把它当成最新上传页面 DOM。下一步如再次失败，建议在 `openUploadDialog()` 超时分支也保存：

- 当前页面截图。
- `await page.content()` 输出。
- `page.locator('.btn-upload').evaluateAll(...)` 的按钮 class/text/outerHTML。
- 可见标题、`[role=dialog]`、`input[type=file]`、`[role=button]` 的数量与文本。

这样可根据真实 DOM 精确调整 selector，不要继续凭截图猜 class。

## 当前已知风险 / 推荐排查顺序

1. 先完整关闭旧 GUI 并使用 `npm start` 启动，确认运行的是最后修改后的代码。
2. 跑一个单账户任务，观察 GUI 日志是否出现：
   - `账户视频库已就绪，正在立即打开上传视频弹窗…`
   - `上传按钮已点击（第 1 次）…`
   - `批量上传面板已打开。`
   - `正在点击加号并选择第 1/N 批…`
3. 若仍停在视频库：不要再只根据截图改 selector。请在上传按钮点击失败时自动保存最新 `.baidu-debug-upload.html/png`，并记录按钮真实 DOM。
4. 若弹窗已打开但没有选文件：记录弹窗里 `input[type=file]` 和加号控件的真实 HTML；百度当前实现可能使用 shadow DOM、隐藏 input 或非标准元素。
5. 若第一批成功、第二批失败：加号位于上传弹窗最下方，应 `scrollIntoViewIfNeeded()` 后重新定位，不可复用第一批的 locator。
6. 多账户并行时要注意同一 `BrowserContext` 的多个页面可并行；对同一登录组不要误关页面或重复上传。

## 测试状态

最近一次执行：

```powershell
npm test
```

结果：`42/42 passed`。

近期也已执行：

```powershell
node --check src/navigation.js
node --check src/uploader.js
node --check electron/main.js
```

无语法错误。

现有测试偏向纯逻辑和 mock，不足以证明百度生产页面 selector 正确。因此真实页面 DOM 调试是当前最高优先级。

## 启动方式

在 PowerShell：

```powershell
cd D:\project\baidu-auto-upload
npm start
```

如已有 Electron GUI 在运行，先关闭旧窗口，确保代码变更被加载。

## 新对话可直接使用的首条工作指令

```text
请继续处理 D:\project\baidu-auto-upload。当前最大问题是：已经进入百度电商推广的视频库页面，但自动化没有真正点击“上传视频”并在弹窗内点击加号选择 GUI 指定目录的视频。请先阅读 CHAT_HANDOFF.md，然后在不关闭用户现有 Chrome 页面的前提下，检查当前 src/navigation.js 和 src/uploader.js。不要再凭截图重复猜 selector；请在上传按钮/弹窗失败分支保存最新页面 HTML、截图和关键元素 outerHTML/数量，用真实 DOM 修正，再运行 npm test。中文沟通，修改用 apply_patch，任务成功/异常时保留浏览器页面。
```
