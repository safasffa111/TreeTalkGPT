# 知识仓库文件重命名显示同步修复

## 问题

知识仓库文件右键重命名后，输入框提交看似成功，但列表/内容区/知识树仍可能显示旧名字。

## 根因

当被重命名的是当前已打开的知识文件时，提交重命名前会先调用 `saveActiveFileSession()` 保存当前运行态。该函数会重新规范化并替换 `store` 对象，导致 `commitRename()` 一开始拿到的 `item` 引用变成旧对象。

后续代码把新名字写到了这个旧引用上，没有写回新的 `store.items`，所以刷新后仍显示旧名字。

同时，文件 session 的 `metadata.title` 被更新了，但 Q0 根节点的 `question` 和挂载到工作台的当前学习运行态没有同步，因此内容页/树图仍可能显示旧标题。

## 修复

1. `saveActiveFileSession()` 后重新通过 `getItem(itemId)` 获取最新文件对象。
2. 文件重命名时同步更新：
   - `item.name`
   - `session.metadata.title`
   - Q0 根节点 `question`
   - Q0 对应 user message 内容
3. 如果重命名的是当前打开文件，立即将更新后的 snapshot restore 到工作台运行态，并刷新树、图、内容页。
4. 修复 `ensureActiveKnowledgeFileMounted()` 中误用未定义 `latestFile` 的问题。

## 验证

新增/增强测试：

```bash
node tests/test_knowledge_file_rename.js
```

覆盖：

- 文件右键重命名提交；
- 同级重名自动追加序号；
- 文件夹重命名仍可用；
- 当前打开文件重命名后，列表、session metadata、Q0 标题、当前工作台显示同步更新。
