# 后台 AI 请求与历史列表加载圆环

本版本修复了：当前主问题仍在等待 AI 回复时，返回历史列表并切换到其他主问题后，原请求不再继续写回/渲染的问题。

## 核心原则

AI 请求生命周期不能依赖当前工作台是否仍然打开该 session：

- 请求开始时记录 `sessionId + nodeId` 到运行时 in-flight registry。
- 如果用户切换到历史列表或打开别的主问题，请求仍然继续。
- 请求完成时：
  - 如果该 session 当前仍打开，直接写入当前 `appStore`，并启动打字机渲染。
  - 如果该 session 已在后台，直接更新对应 `sessions/<sessionId>.json` 归档文件。
- 用户之后回到该 session 时，会看到已完成的回答；如果请求仍在进行中，会恢复为“正在思考…”状态。

## 历史列表加载圆环

历史列表每个主问题右侧会根据运行时 in-flight registry 显示无边框圆环：

```text
persistence.isSessionInFlight(sessionId) === true
→ 显示 .history-session-loader
```

圆环是运行时状态，不会持久化为永久状态。因此重启应用后不会出现“永远加载中”的旧 session。

## 新增接口

### preload / main

- `desktopShell.writeLearningSessionById(sessionId, payload)`
- IPC: `learning-session:write-by-id`

用于后台请求完成后只更新对应历史 session，不覆盖当前工作台 session。

### learning-session-persistence

- `ensureSessionId()`
- `getSessionId()`
- `markRequestInFlight(sessionId, nodeId)`
- `markRequestComplete(sessionId, nodeId)`
- `getInFlightNodeIds(sessionId)`
- `isSessionInFlight(sessionId)`
- `subscribeInFlight(listener)`
- `completeBackgroundRequest({ sessionId, nodeId, answer, providerName })`
- `failBackgroundRequest({ sessionId, nodeId, errorMessage })`

## 避免的冲突

- 圆环只存在于历史列表条目右侧，不参与逻辑树/逻辑图/内容栏动画。
- in-flight 变化只刷新历史列表，不触发内容栏重建。
- `requesting` 不再作为全局 UI 阻塞条件，避免旧 session 的请求影响新 session 的研究。
