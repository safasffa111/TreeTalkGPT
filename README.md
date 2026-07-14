# TreeTalk

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

TreeTalk 是一个使用“调用栈 + 问题树”组织 AI 连续追问的桌面应用。当前仓库只保留本次根据用户提供的 Windows 成品包恢复、移植和发布的 TreeTalk 项目；此前仓库中的旧桌面项目源码、旧构建配置和旧文档已经全部移除。

## 下载

前往 [Releases](https://github.com/safasffa111/tree-talk-desktop/releases/latest) 下载适合自己设备的版本：

- Windows x64
- macOS Apple Silicon（M1、M2、M3、M4 等）
- macOS Intel
- SHA-256 校验文件

## 核心能力

- AI 连续提问入栈、回退与问题树导航
- 针对回答中的文字、公式或代码继续追问
- 本地知识仓库与会话数据保存
- API 模式与浏览器桥接模式
- Windows 与 macOS 跨平台支持

## macOS 窗口行为

- TreeTalk 主窗口使用自定义无边框窗口，不显示左上角红、黄、绿三个系统按钮。
- 主窗口继续使用界面右上角的最小化、最大化和关闭按钮。
- ChatGPT 登录窗口保留正常的 macOS 原生红、黄、绿按钮。

## 项目来源

当前版本以用户提供的 `TreeTalk-win-x64(2).zip` 为唯一迁移来源。macOS Intel 与 Apple Silicon 版本由该安装包中的 Electron 应用代码恢复和打包，不复用此前仓库中的旧项目业务源码。

## 数据与隐私

TreeTalk 采用本地优先设计。学习会话、知识仓库和附件默认保存在用户设备中。请勿将 API Key、登录凭据或个人知识库数据提交到 Issues。

## License

本项目采用 [MIT License](LICENSE)。
