# TreeTalk Desktop

<p align="center">
  <strong>把连续的 AI 追问组织成可回退、可沉淀的知识结构。</strong>
</p>

<p align="center">
  <a href="https://github.com/safasffa111/tree-talk-desktop/releases/latest">下载最新版</a>
  ·
  <a href="https://github.com/safasffa111/tree-talk-desktop/issues">提交问题</a>
  ·
  <a href="LICENSE">MIT License</a>
</p>

TreeTalk Desktop 是一个本地优先的 AI 对话与知识获取桌面应用。它使用“调用栈 + 问题树”组织连续追问，让用户可以沿着问题链路深入探索、回退到任意节点，并把有价值的对话保存到本地知识仓库。

## 下载

前往 [Releases](https://github.com/safasffa111/tree-talk-desktop/releases/latest) 下载适合自己设备的版本。

| 平台 | 文件 | 说明 |
|---|---|---|
| Windows 11 x64 | `TreeTalk-Desktop-0.2.3-Windows-Setup-x64.exe` | 推荐，带安装向导 |
| Windows 11 x64 | `TreeTalk-Desktop-0.2.3-Windows-Portable-x64.zip` | 免安装版本 |
| macOS Apple Silicon | `TreeTalk-Desktop-0.2.3-mac-arm64.dmg` | M1、M2、M3、M4 等芯片 |
| macOS Apple Silicon | `TreeTalk-Desktop-0.2.3-mac-arm64.zip` | `.app` 压缩包 |
| macOS Intel | `TreeTalk-Desktop-0.2.3-mac-x64.dmg` | Intel 处理器 Mac |
| macOS Intel | `TreeTalk-Desktop-0.2.3-mac-x64.zip` | `.app` 压缩包 |

发布页同时提供 `SHA256SUMS.txt`，可用于校验下载文件是否完整。

## 核心能力

- **AI 学习调用栈**：提问入栈、逐层追问，并可回退到之前的问题节点。
- **问题树与逻辑图**：以结构化方式查看主问题、子问题和回答之间的关系。
- **框选追问**：选中回答里的文本、公式或代码，直接针对选中内容继续提问。
- **本地知识仓库**：保存会话、问题树、附件和生成内容，默认保存在用户设备中。
- **附件解析**：支持图片和常见文档，并尽量保留公式信息。
- **公式渲染**：内置 KaTeX，可离线显示数学公式与化学公式。
- **跨平台桌面体验**：支持 Windows 11、macOS Intel 和 macOS Apple Silicon。

## macOS 窗口说明

TreeTalk 主窗口采用自定义无边框设计，因此不会显示 macOS 左上角的红、黄、绿三个系统按钮，而是继续使用应用右上角的自定义窗口按钮。

需要登录网页服务时打开的独立登录窗口仍使用 macOS 原生窗口，并保留红、黄、绿按钮。

## 安装

### Windows

运行安装程序并按提示完成安装。免安装版本解压后直接运行 `TreeTalk Desktop.exe`。

### macOS

打开 `.dmg`，将 `TreeTalk Desktop.app` 拖入“应用程序”。当前公开构建未使用 Apple Developer ID 签名，首次启动可能需要：

1. 在 Finder 中右键应用；
2. 选择“打开”；
3. 再次确认打开。

仍被系统阻止时，可在终端运行：

```bash
xattr -dr com.apple.quarantine "/Applications/TreeTalk Desktop.app"
```

## 数据与隐私

TreeTalk Desktop 采用本地优先设计。学习会话、知识仓库和附件默认保存在本地，不会因为安装或升级而主动删除。

默认数据位置：

- Windows 有 `D:` 盘时：`D:\TreeTalkDesktopData`
- Windows 没有 `D:` 盘时：用户“文档”目录下的 `TreeTalkDesktopData`
- macOS：用户“文稿”目录下的 `TreeTalkDesktopData`

也可以设置环境变量 `TREE_TALK_DATA_DIR` 指定其他目录。

请勿把 API Key、账号凭据或个人知识库数据提交到 GitHub。

## 项目结构

```text
backend/                 Electron 主进程、preload 与附件解析
frontend/                桌面界面、状态管理、问题树与交互逻辑
frontend/vendor/katex/   离线公式渲染资源
build/                   Windows / macOS 图标与构建资源
scripts/                 检查、测试、清理和打包脚本
tests/                   关键业务回归测试
docs/                    功能记录与发布说明
.github/workflows/       跨平台构建和 Release 工作流
```

## 本地开发

需要 Node.js 22：

```bash
git clone https://github.com/safasffa111/tree-talk-desktop.git
cd tree-talk-desktop
npm install
npm start
```

普通用户运行已经构建好的安装包时不需要安装 Node.js。

## 测试

运行完整的发布前检查：

```bash
npm run preflight
```

该命令包括 JavaScript 语法检查、业务回归测试和打包资源检查。

## 构建

### Windows

```bash
npm run build:win
```

生成 Windows NSIS 安装程序。

### macOS

```bash
npm run build:mac
```

生成 Intel x64 与 Apple Silicon arm64 的 DMG 和 ZIP。

macOS 安装包必须在 macOS 或 GitHub Actions 的 macOS Runner 上生成。

## 贡献

欢迎通过 Issue 报告问题、提出功能建议，或提交 Pull Request。

提交代码前请运行：

```bash
npm run preflight
```

贡献代码即表示你同意按照本仓库的 MIT License 发布相应贡献。

## 开源许可证

TreeTalk Desktop 使用 [MIT License](LICENSE) 开源。

第三方依赖仍分别遵循各自的许可证。主要依赖包括 Electron、electron-builder 和 KaTeX。
