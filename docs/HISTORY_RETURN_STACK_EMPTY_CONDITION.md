# 历史列表返回状态判定修复

## 背景

上一版把底部删除按钮 / Enter 的“返回历史学习列表”状态，主要绑定在主问题根节点（Q0/root）是否已经出栈完成上。

这会产生一个语义问题：如果当前主问题栈里还有未出栈的问题，仅依赖 Q0/root 的状态可能让底部按钮过早进入“返回历史列表”状态。

## 新规则

现在底部按钮 / Enter 的状态判定改为：

```text
当前主问题栈 questionStack 规范化后是否为空
```

### questionStack 不为空

说明当前主问题下仍有未完成/未出栈节点。

此时：

```text
底部按钮：出栈按钮
Enter：有输入则发送；无输入则执行出栈逻辑
```

如果当前打开的节点不是栈顶，则按钮保持非返回状态，但仍会按原逻辑提示“当前页面不是栈顶，无法出栈”。

### questionStack 为空

说明当前主问题栈已经全部完成。

此时：

```text
底部按钮：返回历史学习列表
Enter：有输入则发送；无输入则返回历史学习列表
```

## 修改文件

```text
frontend/modules/learning-stack-state-machine.js
frontend/modules/stack-state.js
```

## 兼容说明

函数名 `canResetMainQuestionTree()` 暂时保留，避免大范围改名影响旧模块。

但它现在的实际语义已经变为：

```text
当前会话是否可以通过底部按钮 / Enter 返回历史学习列表
```

后续清理 legacy 命名时，可以重命名为：

```text
canReturnToHistoryList()
```
