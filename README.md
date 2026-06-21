# TreeTalk Desktop

TreeTalk Desktop 是一个面向深度学习与知识整理的本地优先桌面应用。它把连续追问组织成可回退的学习调用栈，并将问题树、回答、附件与知识图谱保存在本地知识仓库中。

## 当前版本

- 应用版本：`0.2.2`
- Electron：`42.4.1`
- electron-builder：`26.0.20`
- Node.js：仅开发和构建需要，普通用户不需要安装
- Windows：Windows 11 x64 NSIS 安装包
- macOS：Intel x64 与 Apple Silicon arm64 的 DMG / ZIP

## 核心能力

- 学习调用栈与问题树
- 本地知识仓库
- 知识图谱与搜索
- 附件文本和公式提取
- KaTeX 数学与化学公式渲染
- 历史记录、错误日志和中央状态调度

## 项目结构

```text
backend/                 Electron 主进程、preload、启动诊断与附件解析
frontend/                桌面界面、状态管理、知识图谱与交互逻辑
build/                   Windows 与 macOS 图标资源
scripts/                 检查、测试和清理脚本
tests/                   关键业务回归测试
docs/                    功能记录与发布说明
.github/workflows/       Windows 与 macOS 自动构建流程
```

## 本地开发

开发电脑安装 Node.js 22 后运行：

```bash
npm install
npm start
```

## 回归检查

```bash
npm run preflight
```

该命令执行源文件语法检查、17 组业务回归测试和安装包资源检查。

## Windows 11 安装包

```bash
npm run build:win
```

输出示例：

```text
TreeTalk-Desktop-0.2.2-win-x64.exe
```

GitHub Actions 会构建安装包，并通过独立的 Windows Runtime Check 在干净环境中安装、启动和检查窗口创建结果。

## macOS 安装包

```bash
npm run build:mac
```

输出示例：

```text
TreeTalk-Desktop-0.2.2-mac-x64.dmg
TreeTalk-Desktop-0.2.2-mac-x64.zip
TreeTalk-Desktop-0.2.2-mac-arm64.dmg
TreeTalk-Desktop-0.2.2-mac-arm64.zip
```

当前 macOS 构建为未签名测试包。正式公开分发前仍需配置 Developer ID 签名和 Apple 公证。

## GitHub Actions

打开：

```text
Actions → Build TreeTalk Desktop
Actions → Windows Runtime Check
```

构建和诊断产物包括：

```text
TreeTalk-Desktop-Windows-11-x64
TreeTalk-Desktop-macOS-x64-arm64
TreeTalk-Windows-Runtime-Diagnostics
```

## 数据目录

- Windows 有 D 盘且可写：`D:\TreeTalkDesktopData`
- Windows 其他情况：用户文档目录下的 `TreeTalkDesktopData`
- macOS：用户文稿目录下的 `TreeTalkDesktopData`

也可以通过 `TREE_TALK_DATA_DIR` 指定其他目录。安装和升级不会主动删除学习数据。

## 发布前事项

- Windows 代码签名
- macOS Developer ID 签名与公证
- Windows 11 实机安装、升级和卸载测试
- Intel Mac 与 Apple Silicon Mac 实机测试
- API、附件、公式、知识仓库和历史数据回归
- 发布 SHA-256 校验值和版本说明

## 数据与隐私

项目采用本地优先设计。请勿将 API Key、账号凭据或个人知识库数据提交到仓库。

## 许可证

当前仓库暂未开放开源许可证，代码默认保留全部权利。
