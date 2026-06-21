# DOCX MathType/OLE 公式准确性保护修复

## 背景

用户的 `复件 高等数学D2复习题详细解答.docx` 中，公式主要不是 Word 原生 OMML，也不是可直接读取的 LaTeX/KaTeX，而是 MathType / Equation OLE 对象。普通 DOCX 文本层只包含正文，公式位置会变成空白；上一版虽然能从 `Equation Native` 中提取近似字符，但会把结构压扁，例如上下标、分式、根式、求和上下限、矩阵等可能被线性化，导致 AI 把近似字符误改成“看起来正确”的 LaTeX。

## 本次修复目标

本次目标不是伪造“100% LaTeX 还原”，而是实现准确性优先：

1. 不再把 MathType/OLE 公式统一标为“近似转写”。
2. 对每个公式计算置信度。
3. 高置信公式可以直接作为较可靠转写。
4. 中/低置信公式必须标记为“需按预览校验”。
5. 导出每个公式的原始 WMF 预览和 manifest，作为原文视觉依据。
6. Prompt 明确禁止 AI 把低置信公式静默改写成标准 LaTeX。
7. 解析缓存版本升级，避免复用旧的错误提取结果。

## 新解析器名称

```text
parser: docx-openxml-mathtype-visual-guard
```

## 新公式标记

高置信：

```text
【公式001（MathType高置信转写）：...；preview=word/media/image1.wmf】
```

需校验：

```text
【公式002（MathType需按预览校验；置信度=medium/0.55；近似字符：...；preview=word/media/image2.wmf；object=word/embeddings/oleObject2.bin）】
```

无法转写：

```text
【公式003（MathType/OLE对象，未能自动转写，需查看原始预览；object=...；preview=...）】
```

## 导出文件

上传 DOCX 后，会在附件目录下生成：

```text
formula-previews/
  formula-001.wmf
  formula-002.wmf
  ...
  formula-preview-manifest.json
  formula-preview-index.md
```

默认导出 WMF 原始预览，不默认批量转 PNG，避免 200+ 公式导致上传卡顿。如果需要 PNG，可设置：

```powershell
$env:ATTACHMENT_EXPORT_FORMULA_PNG="1"
$env:ATTACHMENT_FORMULA_PNG_LIMIT="48"
```

然后确保系统安装 ImageMagick，或设置：

```powershell
$env:MAGICK_CMD="C:\Program Files\ImageMagick-7.1.1-Q16-HDRI\magick.exe"
```

## Prompt 保护

附件上下文会加入说明：

- `MathType高置信转写` 可作为较可靠转写。
- `MathType需按预览校验` 不能当作准确 LaTeX。
- 回答、提取题目、总结、保存知识仓库时，禁止把需校验公式静默改写成标准公式。
- 若无法校验，必须保留公式编号和校验标记。

## 真实文件回归结果

对用户提供的 `复件 高等数学D2复习题详细解答.docx` 测试：

```text
parser: docx-openxml-mathtype-visual-guard
MathType/OLE 公式对象: 205
高置信: 154
需按预览校验: 42
已导出公式预览资产: 205
```

## 重要边界

这版解决的是“不能让 AI 静默错改公式”的工程问题。对于 MathType/OLE 这类老公式对象，若没有完整 MathType Native 结构解析器或视觉转写能力，纯文本层不能承诺 100% 还原为 LaTeX。工程上应以原始 WMF/PNG 预览作为权威校验依据。
