# 知识仓库文件 Session 隔离修复

## 修复目标

1. 工作台保存到知识仓库的文件超过两个后，不再因为相同 `Q0/Q1` 节点 ID 或打字机计时器残留出现串流。
2. 每个知识文件打开后，辅助栏逻辑树和逻辑图必须来自该文件自己的新树，而不是上一个文件或工作台树。

## 根因

保存到知识仓库的子树会被重映射为 `Q0/Q1/...`。这是正确的“新树”结构，但多个文件内部都会有相同节点 ID。

旧实现里部分运行时状态只按 `nodeId` 判断，例如：

- 内容渲染 key 没有包含文件 session 身份。
- 打字机计时器只用 `nodeId` 作为 key。
- 打开知识文件时没有统一冻结保存快照中的 typing 状态。

因此当多个知识文件都包含 `Q0` 时，切换文件后可能出现：

- 上一个文件的打字机继续写入当前文件的 `Q0`。
- 树/图 render key 认为还是同一个 `Q0`，没有稳定触发对应文件的新树渲染。

## 修复方式

### 1. AppStore learningData 增加 sessionId

`learningData` 新增：

```js
sessionId
```

并加入：

- 内容栏 render key
- 逻辑树 render key
- 逻辑图 render key
- prompt UI render key

这样即使两个文件内部都叫 `Q0`，只要文件 session 不同，渲染层也会认为它们是两个不同的树。

### 2. 知识文件保存为独立 session

每个知识文件使用：

```js
knowledge-file:<fileId>
```

作为 sessionId，并写入：

```js
file.session.metadata.sessionId
file.session.learning.sessionId
```

### 3. 统一 normalizeKnowledgeFileSession

新增知识文件 session 规范化逻辑：

- 校验节点父子关系。
- 过滤不属于该文件树的消息。
- 过滤不属于该文件树的 graph positions。
- 打开/保存时冻结 typing 状态：
  - `isTyping = false`
  - `displayedAnswer = answer`
  - 清理 `loadingText/loadingMeta`

### 4. 打字机按 sessionId + nodeId 隔离

`answer-typewriter.js` 计时器 key 从：

```js
nodeId
```

改为：

```js
sessionId::nodeId
```

tick 时如果发现当前 session 已经变化，会自动停止旧计时器，防止旧文件内容写入新文件。

## 测试

已执行：

```bash
node --check frontend/*.js
node --check frontend/modules/*.js
node --check backend/*.js
```

并新增脚本级 smoke test：

1. 保存两个不同工作台子树到知识仓库根目录。
2. 确认两个文件拥有不同 sessionId。
3. 确认两个文件内部都从 `Q0` 开始，但互不共享 session。
4. 确认打开文件 A 渲染 A 的树，打开文件 B 渲染 B 的树。
5. 确认 typing 状态被冻结，不会发生串流。
6. 确认 answer typewriter session 切换后不会继续写入同名 `Q0`。
