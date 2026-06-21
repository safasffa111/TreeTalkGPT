# TreeTalk Desktop

TreeTalk Desktop 是一个面向深度学习与知识整理的本地优先桌面应用。它把连续追问组织成可回退的“学习调用栈”，并将问题树、回答、附件与知识图谱保存到本地知识仓库，帮助用户在复杂学习过程中保持清晰的上下文和结构。

当前仓库包含完整桌面源码、业务回归测试、Windows 11 安装器配置、macOS 双架构构建配置和 GitHub Actions 自动构建流程。

## 核心能力

- **学习调用栈**：围绕主问题逐层追问、压栈和出栈，保留完整学习路径。
- **问题树与知识图谱**：将主问题、子问题和回答关系可视化。
- **本地知识仓库**：保存学习会话、问题树、附件和生成内容。
- **附件解析**：支持常见文档内容提取，并尽量保留公式信息。
- **公式渲染**：内置 KaTeX 与化学公式扩展，可离线显示数学和化学公式。
- **桌面端体验**：无边框窗口、历史记录、错误日志、动画队列和中央状态调度。
- **跨平台分发**：Windows 11 x64，以及 macOS Intel x64 / Apple Silicon arm64。

## 普通用户是否需要 Node.js

不需要。Node.js 只用于开发和生成安装包。构建完成的 `.exe`、`.dmg` 或 `.app` 已包含 Electron 运行时，普通用户直接安装即可。

## 当前技术基线

- Electron `42.4.1`
- electron-builder `26.0.20`
- Node.js `22.16.0`（仅开发与 CI）
- KaTeX `0.17.0`
- 应用 ID：`com.treetalk.desktop`
- 产品名称：`TreeTalk Desktop`

## 项目结构

```text
backend/                 Electron 主进程、preload 与附件解析
frontend/                桌面界面、状态管理、知识图谱与交互逻辑
frontend/vendor/katex/   离线公式渲染资源
build/                   Windows / macOS 应用图标
scripts/                 检查、测试、清理与国内环境修复脚本
tests/                   关键业务逻辑回归测试
docs/                    功能记录与发布说明
.github/workflows/       Windows / macOS 自动构建流程
```

## 本地开发

开发电脑安装 Node.js 22 后，在项目目录运行：

```bash
npm install
npm start
```

项目根目录的 `.npmrc` 已配置国内 npm、Electron 和 electron-builder 镜像。Windows 上如果 Electron 下载中断，可运行：

```powershell
npm run fix:electron:cn
```

## 回归检查

```bash
npm run preflight
```

该命令依次执行：

1. 47 个 JavaScript 源文件语法检查；
2. 17 组业务回归测试；
3. 安装包文件、图标、应用身份和前端本地资源检查。

## Windows 11 安装包

必须在 Windows 环境或 GitHub Actions 的 Windows runner 中构建：

```bash
npm run build:win
```

输出目录：

```text
dist/TreeTalk-Desktop-0.2.0-win-x64.exe
```

另有免安装版本：

```bash
npm run build:win:portable
```

NSIS 安装器支持：

- 中文 / 英文安装界面；
- 选择安装位置；
- 桌面和开始菜单快捷方式；
- 当前用户安装，不强制管理员权限；
- 卸载时默认保留用户学习数据。

## macOS 安装包

必须在 macOS 环境或 GitHub Actions 的 macOS runner 中构建：

```bash
npm run build:mac
```

会同时生成：

```text
TreeTalk-Desktop-0.2.0-mac-x64.dmg
TreeTalk-Desktop-0.2.0-mac-x64.zip
TreeTalk-Desktop-0.2.0-mac-arm64.dmg
TreeTalk-Desktop-0.2.0-mac-arm64.zip
```

当前自动构建产物是**未签名测试包**。正式公开分发前必须配置 Apple Developer ID 签名和 Apple 公证，否则 macOS 会显示“无法验证开发者”或阻止直接打开。

## GitHub Actions 自动构建

源码推送到 `main` 后，打开仓库：

```text
Actions → Build TreeTalk Desktop → Run workflow
```

流程会并行执行：

- Windows 11 x64：测试并生成 NSIS `.exe`；
- macOS：测试并生成 Intel / Apple Silicon 的 `.dmg` 与 `.zip`。

构建完成后，在对应运行记录底部下载 Artifacts：

```text
TreeTalk-Desktop-Windows-11-x64
TreeTalk-Desktop-macOS-x64-arm64
```

## 数据目录

- Windows 有 `D:` 盘时：`D:\TreeTalkDesktopData`
- Windows 没有 `D:` 盘时：用户“文档”目录下的 `TreeTalkDesktopData`
- macOS：用户“文稿”目录下的 `TreeTalkDesktopData`

也可以通过环境变量 `TREE_TALK_DATA_DIR` 指定其他目录。安装和升级不会主动删除学习数据。

## 发布前必须完成

- Windows 代码签名，减少 SmartScreen 警告；
- macOS Developer ID 签名与公证；
- 在没有 Node.js 的干净 Windows 11 电脑测试安装、升级和卸载；
- 在 Intel Mac 与 Apple Silicon Mac 上分别测试；
- 检查 API Key、本地附件、公式、知识仓库和历史数据；
- 生成安装包 SHA-256 校验值并发布版本说明。

更完整的发布流程见 [`docs/DESKTOP_PACKAGING_RELEASE_GUIDE.md`](docs/DESKTOP_PACKAGING_RELEASE_GUIDE.md)。

## 数据与隐私

TreeTalk Desktop 采用本地优先设计。学习会话、知识仓库与附件默认保存在用户设备上。请勿将 API Key、账号凭据或个人知识库数据提交到仓库。

## 许可证

当前仓库暂未开放开源许可证，代码默认保留全部权利。公开发布前请补充正式许可证与第三方依赖声明。
