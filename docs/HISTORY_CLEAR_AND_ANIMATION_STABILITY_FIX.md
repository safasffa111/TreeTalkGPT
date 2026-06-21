# 历史列表清空与动画稳定性修复

本版本基于 `v9_stack_empty_return_condition` 修复三个体验问题：

1. 历史列表状态下提出主问题后，内容栏渐进动画结束时偶发闪烁。
2. 历史列表标题右侧新增无边框“清空”按钮。
3. 历史列表标题由“历史学习”改为“历史列表”。

## 内容栏闪烁根因

历史列表状态下创建 Q0 时，`learningContentRenderKey` 的 store 订阅会先触发一次内容栏自动渲染。随后 `workbench-history.enterSessionView()` 又会进入 session 视图并强制执行一次内容栏渐进渲染。等于同一份 Q0 内容被挂载两次，第一次由 store 自动渲染，第二次由历史面板切换队列渲染，所以在进入动画结束后容易出现一次视觉闪烁。

修复方式：

- 当 `data-workbench-panel="history"` 时，`learningContentRenderKey` 的通用订阅不再自动重建内容栏。
- 从历史列表进入逻辑树/逻辑图时，只允许 `workbench-history.enterSessionView()` 统一调度内容栏渐进渲染。
- 辅助栏面板进入动画增加 `is-history-preparing-enter` 和稳定态清理，避免基础 CSS transition 与显式 enter animation 在结束帧冲突。

## 清空历史列表

历史列表标题右侧新增：

```html
<button class="assist-title-action workbench-history-clear">清空</button>
```

点击后执行：

1. 重置当前内存工作台。
2. 重置图谱 viewport。
3. 清空当前 session 文件。
4. 清空 `sessions-index.json`。
5. 删除 `learning-sessions/sessions/*.json` 归档文件。
6. 刷新历史列表为空状态。

Electron 主进程新增 IPC：

```text
learning-session:clear-all
```

preload 暴露：

```js
desktopShell.clearAllLearningSessions()
```

前端 persistence 暴露：

```js
learningSessionPersistence.clearAllSessions()
```

localStorage fallback 下会清除：

- `ai-learning-stack.current-session.v1`
- `ai-learning-stack.sessions-index.v1`
- 所有 `ai-learning-stack.session.<sessionId>`

## 动画稳定原则

后续新增历史/内容栏切换动画时应遵守：

- 历史列表状态下不由通用 store 订阅自动渲染内容栏。
- 面板切换只能走 `workbench-history` 的队列。
- 内容栏切换只能走 `workbench-renderer` 的队列。
- 动画结束前先进入 settled 状态，再移除 entering class。
- 清理动画 class 时不能让元素回落到基础 transition 中再闪一次。
