# TreeTalk Desktop 桌面应用化与跨平台发布流程

## 一、当前已经完成的工程化基础

- 正式应用名、应用 ID 和版本号；
- Windows `.ico`、macOS `.icns` 和通用 PNG 图标；
- Windows NSIS 安装器与便携版配置；
- macOS Intel / Apple Silicon 的 DMG 与 ZIP 配置；
- 应用源码打入 `asar`，附件解析 Worker 单独解包；
- 打包后 Worker 路径兼容；
- 单实例运行，避免重复启动同时写本地数据；
- Windows 无 D 盘时自动回退到“文档”目录；
- 国内 npm / Electron / electron-builder 下载镜像；
- GitHub Actions Windows 与 macOS 自动构建；
- 语法检查、17 组回归测试和安装包资源检查。

## 二、开发包和安装包的区别

开发源码需要 Node.js，是因为需要 npm 下载 Electron 和构建工具。

发布给用户的安装包已经把以下内容放进去：

```text
TreeTalk 业务源码
Electron 可执行程序
Chromium 渲染引擎
Electron 内置 Node.js 运行时
KaTeX 字体和渲染资源
```

因此普通用户不需要安装 Node.js、npm 或 Electron。

## 三、第一阶段：生成未签名测试安装包

### 方式 A：GitHub Actions

1. 将本目录全部源码提交到仓库 `main`。
2. 打开 GitHub 仓库的 `Actions`。
3. 选择 `Build TreeTalk Desktop`。
4. 点击 `Run workflow`。
5. Windows 与 macOS 两个任务完成后下载 Artifacts。

这种方式不要求本地同时拥有 Windows 和 Mac 构建机。

### 方式 B：本地 Windows 构建

```powershell
npm.cmd install
npm.cmd run preflight
npm.cmd run build:win
```

国内网络安装 Electron 失败时：

```powershell
npm.cmd run fix:electron:cn
npm.cmd run build:win
```

### 方式 C：本地 macOS 构建

```bash
npm install
npm run preflight
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac
```

## 四、第二阶段：干净设备验收

### Windows 11

测试电脑不能预装项目源码、Node.js 或 npm。至少验证：

1. 双击安装器可以选择目录并完成安装；
2. 桌面和开始菜单快捷方式有效；
3. 第一次启动不闪退；
4. 没有 D 盘时能正常创建数据目录；
5. 有 D 盘时数据保存到 `D:\TreeTalkDesktopData`；
6. API 设置可以保存并成功发起请求；
7. 新建问题、追问、出栈、历史记录和知识仓库正常；
8. TXT、DOCX、PDF 等附件流程正常；
9. 数学与化学公式显示正常；
10. 升级安装不会覆盖用户数据；
11. 卸载程序后用户数据仍然保留；
12. 任务管理器中只存在一个主应用实例。

### macOS

Intel 与 Apple Silicon 必须分别验证：

1. DMG 可挂载，应用可拖入 Applications；
2. 应用图标、应用名和菜单显示正确；
3. 窗口关闭、最小化、最大化行为正确；
4. 文稿目录数据读写正常；
5. 附件打开与外部链接打开正常；
6. 应用退出和重新打开后历史数据存在；
7. x64 包在 Intel Mac 运行；
8. arm64 包在 Apple Silicon Mac 原生运行。

## 五、第三阶段：签名与公证

### Windows

未签名的 `.exe` 可以安装，但其他用户可能看到 SmartScreen 警告。正式分发需要购买可信代码签名证书，并把证书配置到 CI 的加密 Secrets 中。签名完成后必须检查安装器和主程序的数字签名。

### macOS

公开分发需要：

1. Apple Developer Program 账号；
2. `Developer ID Application` 证书；
3. Hardened Runtime；
4. Apple Notarization；
5. Stapling 公证票据；
6. 在一台从未运行过该应用的 Mac 上重新验证。

没有签名和公证的 DMG 只能作为内部测试包，不应称为面向普通用户的“直接安装版”。

## 六、第四阶段：版本发布

推荐每次发布执行：

```text
更新 package.json 版本号
→ npm run preflight
→ 推送版本提交
→ 生成 Windows/macOS 构建产物
→ 干净设备冒烟测试
→ 签名与公证验证
→ 计算 SHA-256
→ 创建 GitHub Release
→ 上传安装包和版本说明
```

版本号建议遵守：

```text
0.2.0  当前桌面应用化测试版
0.2.1  Bug 修复
0.3.0  新增较大功能
1.0.0  达到稳定公开发布标准
```

## 七、当前尚未完成的事项

- 依赖锁文件 `package-lock.json` 需要在网络正常的构建环境生成并提交；
- Windows 正式代码签名证书尚未配置；
- Apple Developer ID 与公证凭据尚未配置；
- 还没有在真实 Windows 11、Intel Mac、Apple Silicon Mac 上完成安装验收；
- 自动更新功能尚未接入，第一批版本建议使用手动下载安装升级；
- 崩溃日志、安装遥测和发布回滚流程仍需继续完善。
