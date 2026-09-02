# Windows 安装包交付说明

## 1. 交付结论

本项目已经打包为 Windows 当前用户安装包。普通用户只需要收到一个安装文件：

```text
百度视频批量上传 Setup 1.0.0.exe
```

当前最新一次成功生成的安装包为：

```text
D:\project\baidu-auto-upload\release-20260902-local\百度视频批量上传 Setup 1.0.0.exe
```

文件信息：

```text
大小：95,757,226 bytes
SHA-256：EF9C1736779C72E8FED0F28F7F1F0C2D0181080C31D9626DB97988529DE253A8
签名：未签名
```

未签名意味着 Windows SmartScreen 首次可能显示“未知发布者”。这是当前首版发布策略，不代表安装包不能使用。

## 2. 用户安装和使用

1. 目标电脑安装 Google Chrome。
2. 双击 `百度视频批量上传 Setup 1.0.0.exe`。
3. 按安装向导安装。安装范围是当前 Windows 用户，不要求管理员权限。
4. 从桌面或开始菜单打开“百度视频批量上传”。
5. 填写百度账户名称、账户 ID，选择视频文件夹，然后开始上传。
6. 首次运行在应用打开的 Chrome 窗口中扫码登录百度。

应用不需要目标电脑安装 Node.js、npm 或 Playwright。Google Chrome 是唯一需要用户另外安装的主要运行依赖；如果检测不到，应用会提示并打开官方下载页。

## 3. 安装包使用的技术

### 应用本身

| 技术 | 版本/来源 | 作用 |
|---|---|---|
| Electron | 37.10.3 | 将桌面 GUI、Node.js 主进程和 Chromium 应用壳打包为 Windows 程序 |
| Node.js | 随 Electron 内置 | 运行主进程、文件扫描、配置和任务调度代码 |
| Playwright | 1.55.x | 控制本机 Google Chrome，完成百度账户导航和视频上传 |
| HTML/CSS/JavaScript | `electron/renderer/` | 实现深色玻璃质感桌面界面、账户表单、日志和进度 |

### Windows 安装包

| 技术 | 配置 | 作用 |
|---|---|---|
| electron-builder | 26.15.3 | 执行 Electron 应用的 Windows 构建和资源收集 |
| NSIS | electron-builder 内置目标 | 生成 `Setup.exe` 安装向导、快捷方式和卸载程序 |
| ASAR | `asar: true` | 将应用源码和运行时 JavaScript 归档到 `resources/app.asar` |
| x64 Windows target | `win.target` | 生成 64 位 Windows 安装包 |

当前用户安装由以下配置决定：

```json
{
  "oneClick": false,
  "perMachine": false,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "deleteAppDataOnUninstall": false
}
```

`perMachine: false` 表示安装到当前用户范围，不安装到需要管理员权限的系统级目录。`deleteAppDataOnUninstall: false` 表示卸载程序不会主动删除百度登录态、账户配置和调试文件。

## 4. 构建命令

日常构建使用：

```powershell
cd D:\project\baidu-auto-upload
npm install
npm test
npm run dist
```

默认产物目录是 `dist\`。

在本机网络或 Electron 下载服务不稳定时，已验证可以使用本地 Electron 发行目录构建：

```powershell
cd D:\project\baidu-auto-upload
$env:TEMP = "D:\project\baidu-auto-upload\build-temp-0902"
$env:TMP = $env:TEMP
$env:NODE_OPTIONS = "--use-system-ca"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npm exec electron-builder -- --win nsis --publish never --config.electronDist=node_modules/electron/dist --config.directories.output=release-20260902-local
```

构建机第一次执行可能需要外网下载 Electron、NSIS、7-Zip 等构建资源。资源进入 electron-builder 缓存后，后续构建可以复用缓存；这只是发布者构建时的需求，不是普通用户运行软件时的 Node/npm 依赖。

## 5. 安装包包含和排除内容

会打进 `app.asar` 的内容：

- `electron/`：主进程、preload 和 renderer GUI。
- `src/`：百度导航、上传、配置、登录态和 Chrome 检查逻辑。
- `assets/`：应用静态资源。
- `node_modules/playwright`：运行时需要的 Playwright 代码。

不会打进安装包的内容：

- `test/`：开发测试。
- `bin/`：命令行开发入口。
- `.chrome-profile*`、`.baidu-profile`：本机浏览器登录目录。
- `.baidu-debug*`：本机调试现场。
- 用户的视频文件和项目临时文件。

## 6. 用户数据位置

安装目录只放程序文件。运行时可变数据保存在当前 Windows 用户的应用数据目录，通常类似：

```text
%APPDATA%\baidu-video-batch-uploader\
```

其中包括：

- `profiles/`：Playwright 使用的 Google Chrome 自动化 profile。
- 加密百度登录状态文件。
- 账户配置备份和 renderer 保存的账户偏好。
- `debug/`：导航或上传失败时的截图和 HTML 调试产物。

不同 Windows 用户之间不会共享百度登录态。不要把这些目录复制给其他人，因为其中可能包含可复用的登录状态。

## 7. 升级、卸载和限制

- 新版本发布时，用户下载新的 `Setup.exe` 并覆盖安装即可。
- 覆盖安装不会主动删除账户配置和登录态。
- 卸载安装程序不会主动删除用户数据，便于重新安装后继续使用。
- 本版本没有应用内自动更新。
- 本版本没有 Windows 代码签名证书。
- 应用必须访问百度网站，实际上传流程仍需用户具备百度账户权限。
- 本项目是本地桌面应用，不需要服务器或数据库。

## 8. 发布前检查

发布新的安装包前执行：

```powershell
npm test
node --check electron\main.js
node --check src\navigation.js
node --check src\uploader.js
npm run dist
```

安装包生成后，应检查：

1. `Setup.exe` 文件存在且大小合理。
2. 安装器可以在普通 Windows 用户下启动。
3. 安装后桌面或开始菜单快捷方式可用。
4. 未安装 Node.js 时应用仍可启动。
5. 未安装 Chrome 时出现提示并打开官方 Chrome 下载页。
6. 首次扫码登录后重启应用可以恢复登录态。
7. 覆盖安装后账户配置仍保留。
8. 在真实百度页面先用单账户完成一次上传验收。
