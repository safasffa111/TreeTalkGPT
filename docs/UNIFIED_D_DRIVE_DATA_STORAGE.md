# D 盘统一数据目录

应用数据根目录现在固定为：

```text
D:\TreeTalkDesktopData
```

该目录统一承载：

- `learning-sessions/`：当前会话、历史会话和索引。
- `learning-attachments/`：附件、文本提取结果、分块和公式预览缓存。
- `Local Storage/`：知识仓库、API 设置和 Prompt 设置。
- Electron/Chromium 维护的其他必要配置数据。

首次启动时，程序只复制当前包名对应的旧 `userData` 持久数据，不会删除旧目录，也不会混入其他旧应用的数据。

启动完成后可在 DevTools 查看实际路径：

```js
window.desktopShell.meta().then(console.log)
```

返回结果中的 `dataRoot` 应为 `D:\\TreeTalkDesktopData`。
