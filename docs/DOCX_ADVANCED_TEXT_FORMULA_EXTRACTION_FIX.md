# DOCX 文本与公式提取增强

本修复基于 `codex_style_desktop_shell_v9_doc_readonly_unreadable_fix_full.zip`，未接入 OCR，仍然沿用附件文本解析链路。

## 问题

上一版 `.docx` 提取器主要依赖段落正则和简单 OMML 替换：

- 只按 `<w:p>...</w:p>` 正则切段，遇到文本框、嵌套段落或复杂结构容易漏内容。
- Word 公式 OMML 只覆盖分式、上标、下标、根式等少数节点。
- 表格内公式、域代码公式、页眉页脚、脚注、批注等内容提取不够完整。
- `EQ` 域公式可能和域结果重复出现。

## 修复

### 1. 轻量 XML 树解析

新增内部 XML 树解析器，替代 `.docx` 主体文本提取中的段落正则扫描。现在会按结构遍历：

- `word/document.xml`
- `word/header*.xml`
- `word/footer*.xml`
- `word/footnotes.xml`
- `word/endnotes.xml`
- `word/comments.xml`
- `word/glossary/document.xml`
- 部分 chart / diagram XML 文本兜底

### 2. 表格与嵌套块提取

表格会按行、单元格顺序输出：

```text
单元格A	单元格B
下一行A	下一行B
```

嵌套表格、文本框内段落会尽量递归读取。

### 3. OMML Word 公式转 LaTeX 增强

新增覆盖：

- 分式：`\frac{a}{b}`
- 上标 / 下标 / 上下标：`x^{2}`、`a_{n}`、`x_{0}^{2}`
- 根式：`\sqrt{x}`、`\sqrt[n]{x}`
- 求和 / 积分 / 连乘：`\sum`、`\int`、`\prod`
- 极限下标：`\lim_{x\to0}`
- 函数：`\sin x`、`\cos x`、`\ln x`、`\log x`
- 括号组：`\left( ... \right)`
- 矩阵：`\begin{matrix} ... \end{matrix}`
- 方程组/对齐：`\begin{aligned} ... \end{aligned}`
- 横线、重音、overbrace / underbrace 等常见结构

### 4. Word EQ 域公式优化

对 `w:fldChar + w:instrText` 组成的域公式做状态处理：

- `EQ \f(x+1,y)` 转为 `$\frac{x+1}{y}$`
- 如果域结果文本存在，会跳过重复结果，避免 AI 上下文里出现公式和旧渲染结果双份内容。

## 测试

新增：

```text
tests/test_docx_advanced_extraction.js
```

覆盖：

- 普通段落文本
- 上标、根式、积分
- 表格内矩阵公式
- Word EQ 域公式
- 页眉文本

已验证：

```text
node --check backend/main.js
node --check backend/attachment-text-extractor.js
node --check backend/attachment-extraction-worker.js
node --check backend/preload.js
node --check frontend/renderer.js
node --check frontend/modules/*.js

node tests/test_attach.js
node tests/test_prompt_parts.js
node tests/test_doc_formula_extraction.js
node tests/test_doc_readonly_unreadable.js
node tests/test_docx_advanced_extraction.js
```

## 边界

`.docx` 中如果公式本质是图片、MathType/OLE 嵌入对象、扫描截图，当前无 OCR 版不会识别图片内容。若 Word 内部保存的是标准 OMML 公式，则本修复会尽量转为 LaTeX。
