# 历史学习列表与多会话 JSON 底座

本版本在本地 JSON 持久化基础上增加了历史学习列表。工作台打开后，辅助栏默认进入 `history` 状态，展示历史提出过的主问题；点击历史主问题后加载对应 session，并根据辅助栏宽度切换到逻辑树或逻辑图。

## 文件存储

Electron 主进程现在维护三类文件：

```text
<Electron userData>/learning-sessions/current-session.json
<Electron userData>/learning-sessions/sessions-index.json
<Electron userData>/learning-sessions/sessions/<sessionId>.json
```

`current-session.json` 仍表示当前工作台快照；`sessions/<sessionId>.json` 是历史会话归档；`sessions-index.json` 是历史列表索引。

## 历史列表状态

`app-shell` 新增：

```html
data-workbench-panel="history | session"
```

- `history`：辅助栏显示历史学习列表，内容栏保持提出主问题状态。
- `session`：辅助栏显示原来的逻辑树或逻辑图。

正常辅助栏宽度下显示逻辑树；1.5 倍辅助栏宽度下显示逻辑图。

## 状态圆点

历史列表复用了逻辑树节点按钮的圆点样式：

- 红色：未解决 / active
- 绿色：已解决 / done

当前判定为：会话内所有节点 `stackStatus === 'done'` 且问题栈为空时视为已解决。

## 动画队列

新增 `frontend/modules/workbench-history.js`，维护辅助栏面板切换队列：

```text
历史列表渐出
→ 恢复目标 session
→ 根据辅助栏宽度显示逻辑树或逻辑图
→ 内容栏同步渐进
```

返回按钮触发：

```text
当前 session 保存
→ 内容栏渐出
→ 清空当前工作台镜像
→ 历史列表刷新并渐进
```

## 后续扩展

这个版本只做历史学习列表和多 session JSON 底座。后续知识仓库可以继续扩展：

- 会话重命名
- 会话删除 / 归档
- 按学科标签分类
- 搜索问题和回答
- 导出 Markdown / JSON
- 保存为知识条目
