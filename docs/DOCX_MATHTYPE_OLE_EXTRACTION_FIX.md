# DOCX MathType / OLE 公式对象提取修复

## 背景

用户提供的 `复件 高等数学D2复习题详细解答.docx` 中，正文文字可以被 OpenXML 正常提取，但数学公式不是 Word 原生 `m:oMath` / OMML 公式，也不是 `w:instrText` 的 EQ 域公式。

该文件中大量公式以 OLE 对象嵌入，典型结构为：

```xml
<w:object>
  <v:shape>
    <v:imagedata r:id="..."/>
  </v:shape>
  <o:OLEObject ProgID="Equation.DSMT4" r:id="..."/>
</w:object>
```

这类对象通常来自 MathType / Design Science / Microsoft Equation，真实公式数据保存在 `word/embeddings/oleObject*.bin` 的 OLE Compound File 里，预览图保存在 `word/media/image*.wmf`。

## 原问题

旧逻辑只提取：

- 普通 `w:t` 文本
- Word 原生 OMML 公式 `m:oMath`
- Word EQ 域公式 `w:instrText`

因此遇到 MathType/OLE 公式对象时，该位置会被跳过，最终出现：

```text
若级数（缺失）收敛，则（缺失）= ______
```

## 本次修复

### 1. DOCX 遍历时识别 `w:object / o:OLEObject`

新增对嵌入对象的原文位置渲染，遇到 `Equation.DSMT4` / `Equation.3` / `MathType` 等对象时，不再让它空白消失，而是在原位置插入：

```text
[MathType公式#001: ...]
```

### 2. 解析 `.rels` 关系

通过 `word/_rels/document.xml.rels` 解析：

- `r:id` → `word/embeddings/oleObject*.bin`
- `r:id` → `word/media/image*.wmf`

这样可以定位公式对象和预览图来源。

### 3. 支持 OLE Compound File 小流读取

之前的 CFB 解析器跳过 mini stream。MathType 的 `Equation Native` 通常是小流，必须读取 MiniFAT / MiniStream 才能拿到。

现在 `readCfbStreams()` 支持：

- FAT stream
- Directory stream
- Root Entry mini stream
- MiniFAT
- 小流读取

### 4. 从 `Equation Native` 中提取近似字符序列

新增轻量 MathType Native 字符扫描器：

```text
Equation Native → MathType CHAR records → 近似字符序列
```

它可以提取出类似：

```text
limn→∞an
(3an-4n2+1n2+n)n=1∞∑
```

注意：这不是完整 LaTeX 转换。它只能保留可识别字符，分式、上下标、矩阵等结构可能不完整。

### 5. 给 prompt 加清晰提示

附件上下文中会提示：

```text
若出现 [MathType公式#编号: ...]，表示原 docx 中该位置是 MathType/OLE 嵌入公式；冒号后的内容是从对象中提取的近似字符序列，不保证完整排版。
```

## 真实文件测试结果

对用户文件 `复件 高等数学D2复习题详细解答.docx` 测试：

```text
parser: docx-openxml-mathtype-aware
status: parsed
fullLength: 12864
MathType/Equation OLE objects: 205
with approximate char sequence: 196
unresolved: 9
```

级数部分现在从：

```text
若级数（缺失）收敛，则（缺失）= .
```

变为：

```text
若级数[MathType公式#159: (3an-4n2+1n2+n)n=1∞∑]收敛，则[MathType公式#160: limn→∞an]= .
```

## 边界

这版解决的是“公式对象不能空白丢失”的问题，并尽量提取 MathType Native 中的字符序列。

但它仍不是完整 MathType → LaTeX 引擎：

- 分式结构可能变成连续字符
- 上下标结构可能丢失层级
- 矩阵/方程组不能完整还原
- 部分对象只有 WMF 预览图，没有可读 Native 字符

后续若要完整还原，需要接入专门的 MathType / Equation Native 转 LaTeX 解析器，或走公式图片识别链路。
