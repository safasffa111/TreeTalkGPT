# Knowledge Warehouse Item Create/Delete Animation

基于 `v9_knowledge_workbench_switch_delete_anim_fix`。

## 修改目标

1. 新建文件夹时，新文件夹项不再直接出现，而是播放渐进出现动画。
2. 删除文件或文件夹时，对应列表项不再直接消失，而是先播放渐出消失动画，动画结束后再真正从知识仓库树结构中删除。

## 实现要点

- `knowledge-warehouse.js`
  - 新增 `enteringItemIds`，用于标记刚创建的文件夹项。
  - 新增 `deletingItemIds`，用于防止同一项目被快速重复删除。
  - 新增 `waitForItemAnimation()`，等待列表项动画完成。
  - 删除流程拆为：
    1. 给当前 DOM 项添加 `is-item-leaving`。
    2. 等待动画完成。
    3. 再执行树结构递归删除。
  - 新建流程会给新文件夹添加 `is-item-entering`，并在动画完成后清理临时状态。

- `styles.css`
  - 新增 `knowledgeItemFadeIn`。
  - 新增 `knowledgeItemFadeOut`。
  - 新增 `.knowledge-item.is-item-entering` 与 `.knowledge-item.is-item-leaving`。

## 行为

- 新建文件夹：渐进出现，同时保持重命名输入框可用。
- 删除文件夹：该文件夹列表项渐出消失，然后递归删除子文件夹和文件。
- 删除文件：该文件列表项渐出消失，然后删除文件数据。
- 删除当前打开的文件：列表项渐出后，内容栏清空，退出当前文件。
