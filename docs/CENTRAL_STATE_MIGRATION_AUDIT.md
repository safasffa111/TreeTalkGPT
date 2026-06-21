# 中央状态迁移审计 v7

本审计只统计与学习栈核心状态相关的迁移，不把 API 设置、错误日志、普通 UI 动画全部算入学习栈迁移进度。

## 当前迁移结论

截至 v7，中央状态调度器已经从“store-first，legacy-mirror”继续推进到“command + effect 分层”的早期形态：

- 新学习栈写入优先走 `appStore` action/helper。
- 渲染层、状态机、选区、附件、图谱 viewport 大多优先从 `appStore` 读取。
- `workbench-actions.js` 不再直接承载完整 API 请求生命周期，API 调用和请求状态副作用被拆到 `workbench-effects.js`。
- `stackState` 仍存在，但定位继续收缩为兼容镜像和 fallback，而不是新代码的首选状态源。

## v7 新增迁移点

### 1. 拆出 `workbench-effects.js`

新增模块：

```text
frontend/modules/workbench-effects.js
```

职责：

- 检查当前 API 配置是否完整。
- 发起 AI 请求。
- 组装 API 请求 payload。
- 调用 `appStore` 请求生命周期 command。
- 触发状态机事件。
- 调度请求开始、成功、失败、结束后的 UI 同步。

`workbench-actions.js` 现在主要保留：

- 用户输入事件。
- Enter / 按钮行为分发。
- 主问题 / 追问节点创建。
- 出栈动作。
- 把节点交给 `workbench-effects` 请求回答。

### 2. 请求生命周期进一步收敛

请求中的状态变化现在集中在 `workbench-effects.js` 内，并优先通过这些 store command：

- `appStore.markLearningNodeWaitingApi(...)`
- `appStore.startLearningNodeRequest(...)`
- `appStore.completeLearningNodeRequest(...)`
- `appStore.failLearningNodeRequest(...)`
- `appStore.settleLearningNodeRequest(...)`

这让 `workbench-actions.js` 不再直接拼接大块 node patch / message / requesting 状态。

### 3. 修复 renderer 组装层重复注入

修复 `renderer.js` 里 `graphRenderer` 创建参数中重复传入 `getStackTopId` 的问题。

## 迁移完成度估算

| 维度 | v6 | v7 | 说明 |
|---|---:|---:|---|
| 学习栈写操作集中化 | 85% | 88% | 创建、patch、message、request、active、selection、attachments、pop、reset 已走 store；仍有 fallback。 |
| 学习栈读取 store-first | 75% | 77% | 本轮主要不是读路径迁移，但请求副作用读写边界更清晰。 |
| API 请求生命周期 command 化 | 65% | 82% | API 请求副作用已从 `workbench-actions` 拆出，并集中调用 store command。 |
| UI 图谱状态迁移 | 80% | 80% | 本轮未继续动图谱，只保留 v5/v6 成果。 |
| 状态机 store 化 | 75% | 76% | 状态机事件仍在 effect/action 层触发，读取仍为 store-first。 |
| legacy 移除准备度 | 35% | 45% | `workbench-actions` 已明显瘦身，但 renderer/bootstrap 仍强依赖 legacy 注入。 |

综合估计：**核心中央状态迁移约 78% 完成，剩余约 22%**。

## 当前残留统计

静态粗扫核心 legacy 关键词，排除 `app-store.js` 和 `stack-state.js` 后，业务模块仍有约 **61 处**核心 legacy 引用。

按文件粗略分布：

| 模块 | 残留量 | 当前判断 |
|---|---:|---|
| `renderer.js` | 高 | 主要是 bootstrap 注入、fallback helper、全局胶水代码。 |
| `main-tree-reset.js` | 中 | reset 动画和 legacy fallback 仍在一起。 |
| `workbench-actions.js` | 中低 | 主要是 create/pop 的 legacy fallback，API 副作用已拆出。 |
| `selection-fingerprint.js` | 低 | 主要是没有 store 时的 selection fallback。 |
| `graph-renderer.js` | 低 | 主要是 graph viewport fallback。 |
| `attachment-controller.js` | 低 | 主要是附件 fallback。 |
| `workbench-renderer.js` | 很低 | 只剩 active fallback 和 nodes fallback。 |
| `prompt-builder.js` | 很低 | 只剩 nodes fallback。 |
| `learning-stack-state-machine.js` | 很低 | 只剩 nodes fallback。 |
| `workbench-effects.js` | 很低 | 只保留没有 store 时的 messages/requesting fallback。 |

注意：这些残留不是全部都应该马上删除。当前阶段仍需要一部分 fallback 保证旧逻辑不崩。

## 剩余需要迁移的部分

### 最高优先级：`renderer.js`

`renderer.js` 仍然承担太多职责：

- 创建 `stackState`。
- 创建 `appStore`。
- 创建所有 controller。
- 写大量 glue helper。
- 同时把 `stackState` 和 `appStore` 注入各模块。

下一步建议把它拆成 bootstrap 层：

```text
bootstrap-store.js
bootstrap-controllers.js
bootstrap-workbench.js
bootstrap-ui.js
```

### 第二优先级：`main-tree-reset.js`

当前 reset 仍是：

```text
DOM 动画副作用 + legacy state 清理 + store reset
```

下一步建议拆成两阶段：

```text
appStore.beginLearningTreeReset()
→ DOM 动画执行
→ appStore.completeLearningTreeReset()
```

### 第三优先级：冻结 legacy 写入

建议在 v8/v9 后加入开发期约束：

```text
禁止新业务模块直接写 state.nodes / state.activeQuestionId / state.questionStack
只允许 app-store.js 和 stack-state.js 做 legacy mirror
```

## 后续路线

### v8 建议

目标：拆 `renderer.js` 组装层。

建议形态：

```text
renderer.js
→ 只负责调用 bootstrap

bootstrap/store.js
→ 创建 stackState + appStore

bootstrap/controllers.js
→ 创建 settings/errorlogs/attachment/prompt/workbench controller

bootstrap/workbench.js
→ 创建 stateMachine/renderers/effects/actions
```

### v9 建议

目标：把 `main-tree-reset.js` 拆成 reset command + DOM effect。

### v10 建议

目标：冻结 legacy，只保留 debug mirror，为会话持久化做准备。

---

## v8 收口迁移补充

本轮不再继续扩大迁移面，而是完成“应该迁移”的核心路径并加上稳定边界：

- renderer 不再订阅整个 `learningData`。
- 新增内容栏、树、图谱、输入区的 narrow render key。
- 内容栏重绘加入 render key guard。
- selectionchange 改为 RAF 合并更新。
- 打字机 tick 可节流同步 store，但不会触发内容栏重建。
- 图谱 viewport 只更新 transform，不触发内容栏或节点内容渲染。

当前判断：核心中央状态迁移已达到可收口状态。剩余 legacy fallback 暂不建议删除，应作为兼容镜像保留到本地 UI 回归测试稳定后再清理。
