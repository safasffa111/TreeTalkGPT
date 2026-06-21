# 知识仓库文件夹切换动画

本次调整针对知识仓库原尺寸辅助栏的文件夹导航：

- 返回上一级按钮移动到标题右侧，不再在标题左侧占位；
- 进入子文件夹时，返回按钮以无边框左箭头渐进出现；
- 回到根目录时，返回按钮渐出消失；
- 文件夹切换使用队列维护，避免快速点击文件夹/返回时列表动画互相覆盖；
- 切换时旧列表先渐出，新文件夹列表再渐入。

## 关键实现

`knowledge-warehouse.js` 新增了文件夹切换队列：

```js
folderTransitionQueue = folderTransitionQueue
  .catch(() => {})
  .then(() => runFolderTransition(folderId));
```

`runFolderTransition()` 会按顺序执行：

1. 当前列表添加 `is-folder-leaving`；
2. 等待渐出动画结束；
3. 切换 `currentFolderId`；
4. 渲染新文件夹列表；
5. 新列表添加/移除 `is-folder-entering`，执行渐入。

返回按钮不再使用 `hidden` 的 display none 切换，而是通过 `.is-visible` 控制宽度、透明度和可点击状态，从而实现渐入/渐出。
