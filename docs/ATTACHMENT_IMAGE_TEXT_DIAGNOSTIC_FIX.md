# 图片附件文本解析诊断修复

## 结论

附件文本解析工程是工作的，但它只覆盖文本、代码、PDF、Office/OpenXML 等可提取文本的文件；图片截图不会进入本地文本解析，也没有本地 OCR。

因此，当用户上传的是 PNG/JPG 截图，并且当前 API/模型按纯文本模式发送时，AI 只能看到文件名、类型、大小、本地路径和兼容说明，看不到截图中的题目。

## 本次修复

1. 后端保存图片附件时也写入 `metadata.extraction` 诊断信息：
   - `status: unsupported`
   - `parser: image-no-ocr`
   - 明确说明“图片不走本地 OCR，需要视觉模型/API 或粘贴文字”。
2. 前端附件卡片状态把这类图片显示为“图片未 OCR”，避免误以为已解析正文。
3. 纯文本请求上下文中增加更强约束：AI 不得推测图片内容，需要提示用户切换视觉模型/API 或粘贴题目文字。

## 验证

- `.txt` 附件：`plain-text` 解析成功，正文会进入 prompt。
- `.png` 附件：标记为 `image-no-ocr`，不会伪装成已解析正文。
- DeepSeek / 非视觉模型：请求体为纯文本，不含 `image_url`。
- OpenAI `gpt-4.1-mini`、`qwen-vl-*` 等视觉模型名：请求体包含 `image_url`。
