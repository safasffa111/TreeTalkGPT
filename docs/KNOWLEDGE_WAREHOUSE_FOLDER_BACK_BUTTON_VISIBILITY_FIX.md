# 知识仓库返回按钮可见性修复

基线版本：`v9_knowledge_warehouse_folder_nav_animation`。

## 问题

进入知识仓库子文件夹后，标题旁边的“返回上一级”按钮在部分状态下不稳定，容易看起来没有出现。根因是按钮同时受 `class`、`hidden`、`aria-hidden`、宽度动画和文件夹切换动画影响，状态切换时缺少一个明确的全局状态标记。

## 修复

1. 增加 `shell.dataset.knowledgeCanGoUp`：
   - 根目录：`false`
   - 子文件夹：`true`
2. 返回按钮不再依赖 `hidden` 直接显示/隐藏，而是始终保留在标题布局里，用 CSS 做渐进/渐出。
3. CSS 同时支持：
   - `.knowledge-folder-back.is-visible`
   - `.app-shell[data-module="knowledge"][data-knowledge-can-go-up="true"] .knowledge-folder-back`

这样即使某一次 class 同步被动画队列打断，只要当前文件夹有上级，返回按钮也会被全局状态强制显示。

## 交互规则

- 根目录：返回按钮渐出并不可点击。
- 进入任意子文件夹：返回按钮在“知识仓库”标题右侧渐进出现。
- 点击返回按钮：回到上一级，旧列表渐出，新列表渐入。
