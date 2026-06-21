# 知识仓库文件夹树与返回父节点修复

## 背景

之前知识仓库返回上一级按钮依赖 `currentFolderId`、按钮 `data-target-folder-id` 和扁平 `parentId` 的组合判断。由于按钮显示状态、动画队列和 DOM dataset 的同步时机不同，按钮可能已经显示，但点击时读取到的目标父级不稳定，导致无法返回上一级。

## 修复

本次把知识仓库文件夹导航改为树结构维护：

- 所有文件夹节点组成 `folderTree`。
- 每个文件夹树节点保存 `id`、`parentId`、`children`。
- 返回上一级不再读取按钮 dataset 作为真相，而是读取当前文件夹树节点的 `parentId`。
- `ensureStoreShape()` 每次加载 / 保存都会重建 `folderTree`，修复旧数据或异常数据中的父子关系。
- 按钮 click / pointerup 仍保留兜底，但业务目标由树结构决定。

## 行为

```text
进入文件夹 B
→ 当前树节点为 B
→ 点击返回上一级
→ 读取 B.parentId
→ 进入父文件夹 A
```

如果当前已经在根目录：

```text
root.parentId = null
→ 返回按钮渐出隐藏
→ 点击无效
```

## 测试

已执行：

```text
node --check frontend/modules/knowledge-warehouse.js
node --check frontend/*.js
node --check frontend/modules/*.js
node --check backend/*.js
```

并新增脚本级 smoke test 验证：

```text
root → A → B
返回：B → A
返回：A → root
```

结果通过。
