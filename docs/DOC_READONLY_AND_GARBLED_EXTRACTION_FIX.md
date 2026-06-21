# 旧版 .doc 只读文件与乱码解析修复

## 背景

用户反馈：`复件 高等数学D2复习题详细解答.doc` 上传后，附件解析结果大部分是二进制残留和乱码，AI 无法识别题目或解答内容；同时该文件是只读文件，不应被改写。

## 根因

`.doc` 是旧版 Word OLE/CFB 二进制格式。上一版虽然增强了 UTF-16/可打印字符串兜底提取，但对真实复杂 `.doc` 文件仍可能把 `WordDocument`、表结构、控制字节、对象残留等误判为正文。

只读属性本身不是根因：只读文件仍可以被读取。风险点在于转换器如果直接操作原文件，可能尝试写临时锁文件或副产物。因此本修复要求所有外部转换都先复制到系统临时目录，再转换临时副本，绝不改写原附件。

## 修复内容

1. `.doc` 优先尝试外部只读安全转换：
   - LibreOffice / soffice：复制到临时目录后 `--headless --convert-to txt:Text`
   - antiword
   - catdoc
   - wvText

2. 增加环境变量支持：
   - `SOFFICE_CMD`
   - `LIBREOFFICE_CMD`
   - `ANTIWORD_CMD`
   - `CATDOC_CMD`
   - `WVTEXT_CMD`

3. 增加文本质量门禁：
   - 如果提取结果主要是二进制残留、乱码、控制字符或不可读符号，则返回 `status: unreadable`。
   - 不再把乱码注入 prompt，避免 AI 基于垃圾文本回答。

4. 前端状态显示增加：
   - `解析结果不可读`

## Windows 推荐配置

安装 LibreOffice 后，如果 `soffice` 没有加入 PATH，可在 PowerShell 中设置：

```powershell
$env:SOFFICE_CMD="C:\Program Files\LibreOffice\program\soffice.exe"
```

程序会复制只读 `.doc` 到临时目录后转换，不会修改原文件。

## 测试

新增：

```text
tests/test_doc_readonly_unreadable.js
```

覆盖：

- 只读 `.doc` 可读取，不需要改写原文件。
- 乱码/二进制残留 `.doc` 会被标记为 `unreadable`，并阻止注入 AI 上下文。
