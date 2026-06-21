# 本地 JSON 学习会话存储

本版本加入了本地 JSON 持久化底座，用于保存当前工作台学习会话，为后续“历史学习会话”“知识仓库”“导出复习资料”做准备。

## 统一存储位置

应用会在 Electron 启动前把整个 `userData` 根目录固定到：

```text
D:\TreeTalkDesktopData
```

因此学习会话、附件、知识仓库、API/Prompt 设置以及 Chromium 的本地存储都会集中在这个根目录中。内部仍按数据类型保留子目录，避免文件名冲突。

如需临时覆盖位置，可在启动前设置环境变量：

```powershell
$env:TREE_TALK_DATA_DIR = 'D:\MyTreeTalkData'
```

首次使用新目录时，程序会从原来的 Electron `userData` 目录复制持久数据；旧目录不会被删除，可作为迁移备份。

## 学习会话位置

Electron 主进程会把当前会话写入：

```text
D:\TreeTalkDesktopData\learning-sessions\current-session.json
```

附件及其解析缓存写入：

```text
D:\TreeTalkDesktopData\learning-attachments
```

如果运行环境没有 `desktopShell` IPC，前端会退化到 `localStorage`，键名为：

```text
ai-learning-stack.current-session.v1
```

## 保存内容

当前 JSON schema 保存这些核心数据：

```text
metadata
learning.hasMainQuestion
learning.activeQuestionId
learning.nodeOrder
learning.nodes
learning.questionStack
learning.messages
learning.activeSelection
learning.selectedAttachments
learning.richContextMode
learning.nextQuestionIndex
graph
attachments.selectedAttachments
attachments.richContextMode
```

其中：

- `learning.nodes` 保存问题树、问题、回答、父子关系、框选上下文、节点附件、回答标注等。
- `learning.messages` 保存对话消息索引，方便后续知识仓库或导出复盘。
- `graph` 保存逻辑图缩放、平移、节点位置。
- `selectedAttachments` 保存当前输入区尚未发送的附件状态。
- 节点内的 `attachments` 保存当次问题已经消费的附件元数据、文本内容或图片 dataUrl。

## 自动保存策略

前端 `learning-session-persistence.js` 监听中央状态调度器：

```text
learning/* action
store/batch 中的 learningData 变化
ui/graph-changed
ui/graph-reset
```

保存是防抖的，默认约 650ms 后写入，避免输入、框选、图谱布局等高频事件频繁刷盘。

## 启动恢复策略

应用启动后：

```text
read current-session.json
→ appStore.restoreLearningSession(...)
→ 恢复 stackState 兼容镜像
→ 恢复 appStore.learningData
→ 恢复图谱 viewport
→ 重绘树、图谱、内容栏、附件托盘
```

恢复时会把运行中状态归一化：

- `isTyping` 会变成 `false`
- `displayedAnswer` 会恢复成完整 `answer`
- `requesting` 节点会变成 `pending` 或 `answered`
- `isRequesting` 会变成 `false`

这样避免重新打开应用时卡在“正在思考”。

## 调试入口

开发者控制台可用：

```js
window.__LEARNING_SESSION_PERSISTENCE__.debug()
window.__LEARNING_SESSION_PERSISTENCE__.saveNow()
window.__LEARNING_SESSION_PERSISTENCE__.clear()
```

`debug()` 会返回当前 session id、保存路径、最近保存时间、错误信息和当前序列化快照。

## 后续扩展方向

当前版本只保存 `current-session.json`。后续知识仓库可以扩展为：

```text
learning-sessions/index.json
learning-sessions/<session-id>.json
knowledge-repository/<topic-id>.json
exports/<session-title>.md
```

当前 schema 已经包含 `metadata.sessionId/title/createdAt/updatedAt/nodeCount/messageCount/attachmentCount`，可以直接作为历史会话列表索引来源。
