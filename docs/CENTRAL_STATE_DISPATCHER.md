# 中央状态调度器推进说明

本版本把 `app-store.js` 从“状态快照观察器”继续推进为“学习栈写操作入口”。为了降低重构风险，当前采取渐进迁移策略：

1. 现有渲染器仍然可以读取旧的 `stackState`。
2. 新增/修改/出栈/重置等关键学习栈写操作优先通过 `appStore` helper 执行。
3. `appStore` 每次写入后都会同步生成 `learningData`，让后续 renderer 可以逐步改为只读 store selector。

## 新增状态片

`Slice.LEARNING_DATA`：保存学习树的可选择快照。

包含：

- `hasMainQuestion`
- `activeQuestionId`
- `nodeOrder`
- `nodesById`
- `questionStack`
- `messages`
- `activeSelection`
- `selectedAttachments`
- `richContextMode`
- `nextQuestionIndex`
- `lastMutation`
- `lastMutationAt`

## 新增学习栈 Action

- `learning/node-created`
- `learning/node-patched`
- `learning/message-added`
- `learning/requesting-changed`
- `learning/active-changed`
- `learning/node-popped`
- `learning/selection-changed`
- `learning/selection-cleared`
- `learning/attachments-changed`
- `learning/rich-context-changed`
- `learning/tree-reset`

## 新增 helper

推荐后续业务模块优先使用这些 helper，而不是直接改 `stackState`：

- `appStore.createLearningNode(...)`
- `appStore.patchLearningNode(...)`
- `appStore.addLearningMessage(...)`
- `appStore.setLearningRequesting(...)`
- `appStore.setActiveQuestion(...)`
- `appStore.popActiveLearningNode(...)`
- `appStore.setLearningSelection(...)`
- `appStore.clearLearningSelection(...)`
- `appStore.setLearningAttachments(...)`
- `appStore.setLearningRichContextMode(...)`
- `appStore.resetLearningTree(...)`
- `appStore.syncLearningDataFromStack(...)`

## 本次已迁移的写操作

- 创建主问题 / 追问
- 节点请求中 / 成功 / 失败 / 等待 API
- assistant message 追加
- 当前节点出栈
- 主问题树重置
- 图谱中打开节点
- 文本选区上下文写入 / 清空
- 附件添加 / 移除 / 消费
- 富文本上下文开关

## 后续迁移建议

下一步可以把 `workbench-renderer.js`、`graph-renderer.js` 从读取 `stackState` 逐步改成读取：

```js
appStore.select('learningData')
appStore.select('activeNode')
appStore.select('questionStack')
```

等渲染层完全只读 store 后，再把 legacy `stackState` 降级为兼容层，最后移除。

## v4 渐进迁移：渲染层开始优先读取 AppStore

本轮继续推进中央状态调度器从“写入口”变成“真实状态源”，重点迁移读取路径，而不是新增业务功能。

### 已迁移读取方

- `workbench-renderer.js`
  - 问题树节点列表优先来自 `appStore.getLearningNodes()` / `getRootLearningNodes()`。
  - 当前激活节点优先来自 `appStore.select('activeQuestionId')`。
  - 栈顶状态优先来自 `appStore.select('stackTopId')`。
  - 点击问题树节点时优先通过 `appStore.setActiveQuestion()` 修改当前节点。

- `graph-renderer.js`
  - 图谱节点与根节点优先从 `appStore` 读取。
  - 激活态、栈顶态优先从 `appStore` 读取。
  - 图谱 pan/zoom 仍暂时保留在 legacy `stackState.graph`，因为这是纯 UI 局部状态，后续可单独迁移到 `ui.graph`。

- `prompt-builder.js`
  - 富上下文 transcript 优先从 `appStore.learningData` 读取。
  - 节点深度优先通过 `appStore.getLearningNodeDepth()` 计算。
  - `richContextMode`、`hasMainQuestion` 优先从 store 判断。

- `renderer.js`
  - 为渲染器和 prompt builder 注入 `appStore`。
  - 新增 `learningData` 订阅：当中央状态变更时，自动调度工作台树、图谱、当前页、输入占位和按钮状态同步。

- `answer-typewriter.js`
  - 打字机开始与完成时会通过 `appStore.patchLearningNode()` 同步 `isTyping/displayedAnswer`，避免渲染器改读 store 后看到陈旧状态。

### 新增 AppStore 读取 helper

- `getLearningNodes()`
- `getRootLearningNodes()`
- `getLearningNode(id)`
- `getActiveLearningNode()`
- `getStackTopLearningNode()`
- `getLearningNodeDepth(id)`

### 仍然保留 legacy 的原因

当前还没有完全切断 `stackState`：

- 状态机仍依赖 legacy `stackState`。
- 选区指纹、动画、打字机仍有少量直接读取/写入。
- 图谱 pan/zoom 暂时属于局部 UI 状态，保留在 `stackState.graph`。

下一步建议迁移：

1. 把 `learning-stack-state-machine.js` 的读取源改成 AppStore selector。
2. 把 `selection-fingerprint.js` 的 active node / annotations 读取改成 AppStore helper。
3. 将 `stackState.graph` 拆到 `appStore.ui.graph` 或 `appStore.animation.graphViewport`。
4. 最后把 legacy `stackState` 降级为兼容镜像，所有新代码禁止直接写入。

## v5 渐进迁移：状态机、选区与图谱 viewport 接入 AppStore

本轮继续收缩 legacy `stackState` 的职责：保留它作为兼容镜像，但让更多判断、读取和 UI 状态优先走 `appStore`。

### 1. 状态机读取源迁移

`learning-stack-state-machine.js` 现在会优先从 `appStore.learningData` 与 `appStore.learning` 派生运行态：

- `activeQuestionId`
- `questionStack`
- `stackTopId`
- `rootQuestionId`
- `isRequesting`
- `nodes`
- `activeNode`

状态机仍会把计算出的 `phase/canPop/canReset/canSend` 同步回 legacy 字段，保证旧 UI 不断裂。

### 2. 选区指纹迁移

`selection-fingerprint.js` 现在优先使用：

- `appStore.select('activeQuestionId')`
- `appStore.getLearningNode(id)`
- `appStore.getActiveLearningNode()`
- `appStore.setActiveQuestion(id)`
- `appStore.setLearningSelection(...)`
- `appStore.clearLearningSelection(...)`

点击回答中的指纹标记时，不再直接写 `stackState.activeQuestionId`，而是优先通过中央 action 切换当前节点。

### 3. 图谱 viewport 状态迁移

新增 `ui.graph` 状态：

```js
{
  scale: 1,
  x: 18,
  y: 18,
  positions: {},
  manualPositions: {}
}
```

新增 action / helper：

- `ui/graph-changed`
- `ui/graph-reset`
- `appStore.getGraphViewport()`
- `appStore.setGraphViewport(patch, meta)`
- `appStore.resetGraphViewport(meta)`

`graph-renderer.js` 现在通过 store 读写 pan / zoom / layout positions，并同步回 `stackState.graph` 作为兼容镜像。

### 4. 附件读取路径补强

`attachment-controller.js` 写操作本来已经走 store，本轮补强了读取路径：

- 附件列表优先读 `learningData.selectedAttachments`
- 富上下文开关优先读 `learningData.richContextMode`

这样 `hasPromptPayload()`、附件托盘和默认附件问题文本都更接近 store-driven。

### 5. 当前遗留点

仍保留 legacy `stackState` 的地方主要是：

- `workbench-actions.js` 的部分提交流程仍把 `state` 作为兼容上下文。
- `main-tree-reset.js` 仍负责较复杂的 DOM 动画副作用。
- `renderer.js` 仍是组装层，会同时把 store 和 legacy state 传给各模块。

下一轮建议：把 `workbench-actions.js` 的提交/出栈流程拆成更明确的 command action，让 `appStore` 承担更多 reducer 职责，controller 只负责 API 副作用和 UI 调度。

## v6 渐进迁移：workbench command 与 reset 继续 store-first

本轮继续推进 `appStore` 从“状态读取源”升级为“业务 command 调度器”。重点不是新增功能，而是把提交、请求、出栈、重置中的状态读写进一步集中。

### 1. AppStore 新增读取 helper

新增：

- `getActiveQuestionId()`
- `getStackTopQuestionId()`
- `getLearningSelection()`
- `getLearningMessages()`
- `hasMainQuestion()`
- `isLearningRequesting()`

这些 helper 用于替代业务模块中的：

```js
state.activeQuestionId
state.questionStack
state.activeSelection
state.hasMainQuestion
state.isRequesting
```

### 2. AppStore 新增请求生命周期 command

新增：

- `markLearningNodeWaitingApi(nodeId, providerName, meta)`
- `startLearningNodeRequest(nodeId, providerName, meta)`
- `completeLearningNodeRequest(nodeId, answer, providerName, meta)`
- `failLearningNodeRequest(nodeId, errorMessage, meta)`
- `settleLearningNodeRequest(meta)`

`workbench-actions.js` 现在优先调用这些 command，而不是在 controller 内直接拼接多个 node patch / message / requesting 写入。

### 3. workbench-actions 读取路径迁移

`workbench-actions.js` 现在优先通过 store 获取：

- 当前节点 id
- 栈顶节点 id
- 当前 active node
- 当前选区上下文
- 是否已有主问题
- 是否正在请求
- 主根节点

legacy `state` 只作为 fallback 保留。

### 4. main-tree-reset 迁移

`main-tree-reset.js` 的 reset 判断现在优先通过：

- `stateMachine.canResetMainQuestionTree()`
- `appStore.guards.canResetMainQuestionTree()`
- `appStore.getLearningNodes()`

只有在没有 store 时才回退到 `state.nodes.length` 和 `StackStateUtils`。

### 5. renderer 组装层继续收缩 legacy 读取

`renderer.js` 的这些 helper 已改成优先 store-first：

- `getStackTopId()`
- `isActiveNodeStackTop()`
- `getMainRootNode()`
- `syncSendState()` 中的 requesting 判断
- `getNodeDepth()`

### 6. 新增迁移审计

新增文档：

- `docs/CENTRAL_STATE_MIGRATION_AUDIT.md`

用于记录当前完成度、剩余迁移模块和后续 v7/v8/v9/v10 路线。

## v7 渐进迁移：workbench action/effect 分层

本轮继续推进中央状态调度器的架构边界：不再让 `workbench-actions.js` 同时负责用户事件、API 请求、副作用渲染和状态写入，而是拆出独立的 effect 层。

### 1. 新增 `workbench-effects.js`

新增文件：

```text
frontend/modules/workbench-effects.js
```

它负责：

- API 配置完整性检查。
- 构建 API 请求 payload。
- 调用 `ApiClient.requestChat`。
- 请求开始 / 成功 / 失败 / 结束时调用 `appStore` command。
- 转发状态机事件。
- 调度请求生命周期后的 UI 同步。

### 2. `workbench-actions.js` 职责收缩

`workbench-actions.js` 现在更接近用户行为 controller：

- 处理表单提交。
- 处理全局 Enter。
- 处理出栈按钮。
- 创建主问题 / 追问节点。
- 把节点提交给 `workbench-effects` 请求回答。

API 请求生命周期不再直接放在 actions 模块里。

### 3. 请求生命周期 command 保持集中

`workbench-effects.js` 优先调用：

- `appStore.markLearningNodeWaitingApi(...)`
- `appStore.startLearningNodeRequest(...)`
- `appStore.completeLearningNodeRequest(...)`
- `appStore.failLearningNodeRequest(...)`
- `appStore.settleLearningNodeRequest(...)`

这使请求状态写入继续向中央调度器集中。

### 4. 当前剩余迁移方向

v7 后，剩余重点已经从“业务功能迁移”变成“bootstrap/legacy 清理”：

1. 拆 `renderer.js`，让它不再是所有模块的胶水大文件。
2. 拆 `main-tree-reset.js`，把 reset command 和 DOM 动画副作用分开。
3. 冻结 legacy fallback，逐步禁止业务模块直接写 `stackState`。
