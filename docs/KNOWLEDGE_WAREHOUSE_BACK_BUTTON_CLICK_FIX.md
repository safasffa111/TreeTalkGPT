# 知识仓库返回上一级按钮点击修复

## 问题

上一版返回上一级按钮已经能根据子文件夹状态显示，但点击后不一定执行返回。

根因是按钮可见性主要由 `data-knowledge-can-go-up` 和 CSS 控制，但 DOM 上的原生 `disabled` 状态可能仍处于旧值；当浏览器认为按钮 disabled 时，会直接抑制 click 事件，导致看起来按钮能显示但点击没有效果。

另外，在 Electron/CSS transition 状态下，`click` 事件也可能被过渡中的布局状态吞掉。

## 修复

- 返回按钮不再依赖原生 `disabled` 控制可点击状态。
- 使用 `aria-disabled`、`tabIndex` 和 CSS `pointer-events` 控制交互状态。
- 每次渲染标题时写入：
  - `data-current-folder-id`
  - `data-target-folder-id`
- 点击返回时优先读取 `data-target-folder-id`，保证一定回到当前文件夹的父级。
- 增加 `pointerup` 兜底监听，避免过渡动画期间 `click` 被吞。
- 暴露 `debugGoUpFolder()` 方便调试。

## 预期

进入子文件夹后，标题右侧返回按钮渐进显示；点击后旧列表渐出，返回上一级，新列表渐入。回到根目录后按钮渐出消失。
