# 附件文本解析工程链路优化

本次优化在不改变现有附件展示、图片预览和本地保存逻辑的前提下，增强了附件解析工程系统。

## 关键改动

1. 解析线程化
   - 附件解析在 `attachment-extraction-worker.js` 中执行，避免大 PDF / Office 文档解析阻塞 Electron 主进程。
   - 设置超时保护，解析过慢时返回可解释状态，不让上传链路卡死。

2. 内容哈希缓存
   - 每个附件保存后计算 SHA-256。
   - 相同文件再次上传时直接复用 `.extraction-cache/<hash>` 下的解析结果。
   - 问题卡片会标记“缓存”。

3. 文本产物分层
   - `extracted-text.txt`：发送给 AI 的安全截断文本。
   - `extracted-text-full.txt`：本地完整解析文本。
   - `extracted-chunks.json`：本地文本切片索引，用于后续搜索/摘要/局部检索扩展。
   - `metadata.json`：记录 parser、状态、耗时、片段数、结构线索、警告和路径。

4. 类型支持增强
   - 保留 `.docx/.pptx/.xlsx/.pdf` 解析。
   - 增强 `.xlsx` 工作表名、公式、inline string 提取。
   - 新增 `.rtf/.ipynb/.html/.svg/.srt/.vtt` 等文本提取。
   - 增加 ZIP/OpenXML 安全保护，避免异常文件、超大条目和 zip bomb。

5. AI 请求上下文优化
   - 不再对大附件无脑塞完整 12 万字符。
   - 会根据用户当前问题抽取关键词命中片段。
   - “总结/梳理/全文/大纲”类问题使用文档开头 + 结构线索 + 尾部片段。
   - 多附件时按总预算分配上下文，降低 API 请求膨胀和卡顿。

## 不改变的功能

- 图片附件仍按原逻辑作为视觉附件，并保留无边框浮窗预览。
- 问题卡片仍显示附件卡片。
- 非图片附件仍可打开本地文件。
- 已保存附件仍在 `userData/learning-attachments` 下。
