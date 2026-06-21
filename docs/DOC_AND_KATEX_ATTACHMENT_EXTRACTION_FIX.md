# .doc 与 KaTeX/LaTeX 附件文本解析修复

本修复基于 `codex_style_desktop_shell_v9_attachment_image_text_diagnostic_full.zip`，没有引入 OCR 版代码。

## 解决的问题

1. 旧版 Word `.doc` 附件之前只走 `legacy-binary-strings`，中文正文、UTF-16 文本和公式很容易丢失或变成乱码。
2. `.docx` 解析之前主要读取 `w:t`，会漏掉 Word 公式常见的 `m:oMath / m:t / w:instrText` 内容。
3. 附件文本进入 prompt 前会按预算截断，可能刚好切断 `$...$`、`\(...\)`、`\[...\]` 这类 KaTeX/LaTeX 公式片段。
4. prompt 中没有明确告诉模型“附件公式是原文，必须保留反斜杠和数学分隔符”。

## 主要改动

### 1. 增强 `.doc` 解析

`backend/attachment-text-extractor.js` 新增：

- `isOleCompoundFile`
- `readCfbStreams`
- `extractUtf16LeStrings`
- `extractLegacyOfficeBinaryText`
- `extractLegacyDocText`

`.doc` 现在优先识别 OLE Compound File Binary，再从 `WordDocument / 1Table / 0Table / Data` 等流中提取 UTF-16/可打印文本。

解析器标识：

```text
.doc OLE 文件：doc-legacy-cfb-text
.doc 非 OLE 兜底：doc-legacy-auto
.ppt/.xls 旧格式兜底：legacy-office-binary-text
```

注意：旧 `.doc` 是复杂二进制格式，本修复不保证 100% 还原复杂排版、嵌入对象和所有公式，但比原先的纯 printable strings 兜底更适合中文正文和数学文本。

### 2. 增强 `.docx` Word 公式提取

`extractParagraphTextFromWordXml` 不再只读 `w:t`，现在额外处理：

- `m:oMathPara`
- `m:oMath`
- `m:t`
- `m:f` 分式
- `m:sSup` 上标
- `m:sSub` 下标
- `m:sSubSup` 上下标
- `m:rad` 根式
- `w:instrText` 中的 Word EQ 域，例如 `EQ \f(a+b,c)`

示例输出：

```text
$\frac{1}{2}$
$x^{2}$
$\sqrt{x}$
$\frac{a+b}{c}$
```

### 3. KaTeX/LaTeX 保护

后端新增：

- `protectMathSegments`
- `safeSliceMathAware`
- `hasUnclosedMathDelimiter`

`normalizeWhitespace` 和 `normalizePlainText` 在压缩普通空白前，会临时保护这些数学片段：

```text
$...$
$$...$$
\(...\)
\[...\]
\begin{...}...\end{...}
```

这样可以避免公式内部空格、反斜杠和分隔符被普通文本清洗逻辑破坏。

### 4. prompt 注入阶段公式提示

`frontend/modules/attachment-utils.js` 在附件上下文里新增公式保护提示：

```text
公式保护：附件文本中的 KaTeX/LaTeX 片段（如 $...$、$$...$$、\(...\)、\[...\]、\frac、\sum）是原始内容，回答和保存时不要删掉反斜杠或数学分隔符。
```

同时，长附件按关键词截取、开头截取、首尾截取时，使用 math-aware slice，尽量避免切断未闭合公式。

## 测试

新增测试：

```text
tests/test_doc_formula_extraction.js
```

覆盖：

1. `.docx` 中 OMML 分式提取。
2. `.docx` 中 `$x^2+\frac{1}{x}$` 原始 KaTeX 保留。
3. `.docx` 中 `w:instrText` / `EQ \f(a+b,c)` 转换。
4. 旧 `.doc` CFB/UTF-16 文本提取。
5. `normalizePlainText` 不压缩公式内部空格。

完整验证命令：

```bash
node --check backend/main.js
node --check backend/attachment-text-extractor.js
node --check backend/attachment-extraction-worker.js
node --check backend/preload.js
node --check frontend/renderer.js
for f in frontend/modules/*.js; do node --check "$f"; done

node tests/test_attach.js
node tests/test_prompt_parts.js
node tests/test_doc_formula_extraction.js
```
