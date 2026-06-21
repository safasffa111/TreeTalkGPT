# DOCX MathType/OLE 清爽 LaTeX 提取修复

## 背景

部分 `.docx` 文件中的公式不是 Word 原生 OMML，也不是可直接读取的 LaTeX，而是 MathType / Equation OLE 嵌入对象。上一版为了防止误判，在正文中输出了 `MathType高置信转写`、`MathType需按预览校验`、`preview=...`、`object=...` 等诊断信息。该格式适合调试，但不适合学习文本，会干扰模型提取题目。

## 本次修复

解析器改为：

```text
parser: docx-openxml-mathtype-clean-latex
```

核心变化：

1. 默认把可解析的 MathType/OLE 公式直接插入为 `$...$` LaTeX 片段。
2. 不再把置信度、preview 路径、object 路径塞进正文。
3. 只有完全无法提取字符序列的公式，才保留简短 `【公式001待转写】` 标记。
4. 仍然导出 `formula-previews/`、`formula-preview-manifest.json` 作为人工核对依据，但这些诊断信息默认不进入正文。
5. 增强 MathType 线性字符流到 LaTeX 的启发式转换，包括：
   - 向量：`a→` → `\vec{a}`
   - 点坐标：`M-1,0,2()` → `M(-1,0,2)`
   - 常见空间直线式：`x-12=y3=z-2` → `\frac{x-1}{2}=\frac{y}{3}=z-2`
   - 方程组：`2x+2y-z+23=0,3x+8y+z-18=0,{` → `\begin{cases}...\end{cases}`
   - 上标：`x2,y2,t3` → `x^2,y^2,t^3`
   - 常见求和：`xnn=1\infty\sum` → `\sum_{n=1}^{\infty} x^n`
   - 常见微分/积分符号：`∂z∂x`、`D\int\int` 等。

## 输出示例

修复前：

```text
设【公式001（MathType需按预览校验；置信度=low/0.43；近似字符：\vec{a}=(1,k,2)；preview=word/media/image1.wmf】
```

修复后：

```text
设$\vec{a}=(1,k,2)$
```

修复前：

```text
与直线【公式013（MathType高置信转写）：x-12=y3=z-2；preview=word/media/image13.wmf】垂直
```

修复后：

```text
与直线$\frac{x-1}{2}=\frac{y}{3}=z-2$垂直
```

## 缓存版本

```text
2026-06-21-docx-mathtype-clean-latex-v4
```

升级后同一文件会重新解析，不会继续命中上一版 visual guard 缓存。

## 边界

MathType/OLE 是老式二进制公式对象。此修复把正文输出从“调试诊断模式”改为“学习文本模式”，并增强常见结构转换；但少数复杂公式仍可能只能保留为 `【公式001待转写】`，需要结合导出的预览核对。
