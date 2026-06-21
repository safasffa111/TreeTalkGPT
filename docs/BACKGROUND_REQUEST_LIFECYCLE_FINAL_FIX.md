# 后台请求生命周期最终修复

本次修复目标：AI 请求只发送一次；切换到历史列表或其他主问题后，原请求继续在后台完成；回到该主问题时不再重新请求，只恢复已接收到的回答与打字机进度。

## 根因

上一版后台请求存在两个问题：

1. 请求完成后仍尝试 patch 当前打开的工作台节点，而不是按 `sessionId + nodeId` 回写原 session。切换到其他主问题后，原节点可能已经不在当前 store 中，甚至可能误命中另一个 session 的同名 `Q0`。
2. `runtimeInFlight` 在后台完成分支没有被可靠清理，历史列表因此一直显示“请求继续中”。

## 修复策略

请求创建时记录：

```text
sessionId + nodeId
```

请求完成时判断：

```text
如果该 session 当前仍打开：写入当前 appStore，并启动可见打字机。
如果该 session 已在后台：写入对应历史 JSON，并启动后台打字机。
```

请求失败同理：后台失败只写回对应历史 JSON，不修改当前打开的其他 session。

## 后台打字机

当 API 已经返回，但用户不在该 session 内时：

```text
node.answer = 完整回答
node.displayedAnswer = 后台逐步增长的片段
node.isTyping = true/false
```

后台打字机只会定时写入 session JSON。用户回到该主问题时：

```text
停止后台打字机
恢复当前 displayedAnswer
启动前台可见打字机继续渲染
```

因此不会重新请求 API。

## 历史列表圆环

历史列表右侧圆环现在表示：

```text
API 请求中 或 后台打字机进行中
```

但是打开该 session 时，只有真正的 API in-flight 节点会显示“后台请求继续中”。如果 API 已经完成、只是打字机没打完，会直接显示已有回答并继续打字机。
