# Knowledge Warehouse Rename / Delete Mode

基线版本：`v9_knowledge_warehouse_tree_parent_nav_fix`。

## 本次新增

1. 文件夹右键重命名
   - 在知识仓库列表中右键点击文件夹，会进入原有的内联重命名状态。
   - 空名称提交时仍使用 `新建文件夹1/2/3...` 兜底。

2. 标题右侧删除按钮
   - 知识仓库标题右侧新增无边框删除图标按钮。
   - 点击后切换删除状态，再点一次退出删除状态。

3. 删除状态
   - 进入删除状态后，每个文件 / 文件夹最左侧会渐进出现无边框删除图标。
   - 点击文件的删除图标会删除该文件。
   - 点击文件夹的删除图标会递归删除该文件夹及其所有子文件夹、文件。
   - 如果删除的是当前内容栏打开的文件，内容栏会清空并退出当前文件。

## 结构说明

文件夹仍使用树结构维护：

```js
folderTree: {
  rootId: 'root',
  nodes: {
    root: { id: 'root', parentId: null, children: [...] },
    folderA: { id: 'folderA', parentId: 'root', children: [...] }
  }
}
```

删除文件夹时通过 `parentId` 递归收集所有后代节点，确保文件夹下的内容一并删除。

## 验证

已完成：

```bash
node --check frontend/*.js
node --check frontend/modules/*.js
node --check backend/*.js
```

并做了脚本级 smoke test：

- 创建 A 文件夹
- 在 A 下创建 B 文件夹
- 删除 A
- 验证 A/B 都被删除
- 验证删除状态和重命名入口可调用
