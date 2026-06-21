# 附件文本解析工程链路

本版本将附件处理从“保存文件名和本地路径”扩展为“本地保存 + 后端解析 + 文本上下文注入 + 问题卡片状态展示”。

## 支持范围

- 文本/代码：txt、md、json、js、ts、py、cpp、c、java、html、css、xml、yaml、csv、log 等。
- Office OpenXML：docx、pptx、xlsx。
- PDF：内置基础 PDF 文本流解析，支持常见可复制文字 PDF；扫描版 PDF 需要 OCR，不会编造内容。
- 旧 Office 二进制：doc、ppt、xls 使用可打印字符串兜底提取，结果可能不如 OpenXML 精确。
- 图片：仍走现有图片视觉附件与无边框预览，不做 OCR。

## 数据流

1. 渲染进程读取用户选择的附件。
2. 后端保存到 `userData/learning-attachments/<attachmentId>/原文件名`。
3. 后端解析文件正文，写入 `extracted-text.txt`，并把解析状态写入 `metadata.json`。
4. 附件对象记录 `extractedText`、`extractionStatus`、`extractionParser` 等字段。
5. AI 请求构造时，优先将解析文本放入附件上下文。
6. 问题卡片显示附件保存状态和解析状态。

## 设计原则

- 不破坏图片附件预览和视觉输入。
- 不把普通二进制 base64 塞入学习会话 JSON。
- 解析失败时只告诉 AI 限制，不编造附件内容。
- 大文件超过安全阈值会跳过自动解析。
