# 知识仓库独立学习流修复

## 问题

知识仓库中的文件复用了工作台的内容栏、逻辑树、逻辑图和追问机制，但运行时仍有部分逻辑默认把当前学习流当作工作台历史会话处理，导致：

- 在知识仓库追问时可能写入工作台历史会话。
- 保存到知识仓库的新树可能被历史列表持久化逻辑影响。
- 打开知识文件后可能显示上次停留的追问，而不是该文件的新树根节点 Q0。
- 从工作台保存到知识仓库的新树中，框选标注的 childId 若没有重映射，会导致点击框选痕迹无法进入对应追问。
- 知识仓库中的追问回复不能稳定只保存在当前知识文件 session 内。

## 修复

### 1. 知识仓库请求上下文独立化

`workbench-effects.js` 新增运行时请求上下文：

- `mode: "workbench"`
- `mode: "knowledge"`

知识仓库内发起追问时，请求上下文为：

```js
{
  mode: 'knowledge',
  sessionId: 'knowledge-file:<fileId>',
  knowledgeFileId: '<fileId>',
  nodeId: '<Q id>'
}
```

知识仓库请求不再调用历史会话的 `saveNow()`，因此不会新建或污染历史列表。

### 2. 知识文件后台完成写回知识文件

当知识仓库请求完成时：

- 如果当前仍打开该知识文件，则直接写回 appStore 并在内容栏打字显示。
- 如果当前已经切走，则写回对应知识文件的 `file.session`，不写历史文件。

### 3. 打开知识文件强制显示 Q0

`restoreFileToWorkspace()` 打开文件时会把 activeQuestionId 强制设为 `Q0`。

这只影响“打开文件的第一屏”，用户在文件内点击树节点或框选痕迹后仍可进入对应追问。

### 4. 保存到知识仓库的新树重映射 annotations

保存工作台子树时，不仅重映射节点 ID、children、messages，也会重映射：

```js
node.annotations[].childId
```

因此知识文件内的框选痕迹可以正确点击进入新树中的对应追问。

## 修改文件

- `frontend/modules/workbench-effects.js`
- `frontend/modules/workbench-actions.js`
- `frontend/modules/knowledge-warehouse.js`
- `frontend/renderer.js`

## 验证

已验证：

- 知识仓库追问不会调用历史会话 `saveNow()`。
- 知识仓库追问回复能在当前知识 session 内完成。
- 保存工作台子树到知识仓库后，新树从 Q0 开始。
- 新树中的 annotations childId 正确重映射，框选痕迹点击能进入对应追问。
- 打开知识文件时首屏强制显示 Q0。
