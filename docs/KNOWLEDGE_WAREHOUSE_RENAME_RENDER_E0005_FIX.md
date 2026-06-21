# E0005 知识仓库重命名渲染修复

## 问题

在知识仓库中新建/重命名文件夹时，点击其他地方会触发 `pointerdown`，提交重命名并调用 `renderList()`。旧列表里还包含正在编辑的 input，`renderList()` 清空 DOM 时会触发 input 的 `blur`，blur 又再次调用 `commitRename()` 和 `renderList()`。

两个 `renderList()` 互相嵌套时，浏览器会在 `replaceChildren()` 删除旧节点的过程中发现某个节点已经被另一次渲染移走，于是抛出：

```text
NotFoundError: Failed to execute 'replaceChildren' on 'Element': The node to be removed is no longer a child of this node.
```

## 修复

1. 增加 `isCommittingRename`，避免重命名提交重入。
2. blur 提交前检查 `renamingItemId` 是否仍是当前 item，避免旧 input 被移除后再次提交。
3. `renderList()` 不再直接使用 `replaceChildren()`，改为安全的手动节点清理和追加。
4. 清理列表 DOM 时临时开启 `suppressBlurCommit`，防止移除 input 触发 blur 再次提交。

## 影响

- 新建文件夹后点击其他地方仍会自动命名。
- 右键重命名文件夹后点击其他地方仍会保存。
- 不会再因为 blur 和列表重绘互相嵌套导致 E0005。
