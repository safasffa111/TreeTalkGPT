const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'attachment-utils.js'), 'utf8');
const sandbox = { window: {}, File: class File {}, FileReader: class FileReader {} };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'attachment-utils.js' });

const attachment = {
  name: '复件 高等数学D2复习题详细解答.docx',
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: 1000,
  kind: 'file',
  extractionParser: 'docx-openxml-mathtype-clean-latex',
  extractionStatus: 'parsed',
  extraction: { parser: 'docx-openxml-mathtype-clean-latex', status: 'parsed', fullLength: 80, warnings: ['MathType/OLE 公式来自老式嵌入对象，系统会尽量把可解析字符转换为 LaTeX；回答、提取题目、总结或入库时应保留这些 $...$ 公式，不要改成省略号或“缺失”。'], formulaAssetCount: 3, formulaPreviewDir: '/tmp/formula-previews', formulaManifestPath: '/tmp/formula-previews/formula-preview-manifest.json' },
  extractedText: '１、设$\\vec{a}=(1,k,2)$，且$\\vec{a}\\perp \\vec{b}$则$k=$。',
  formulaAssetCount: 3,
  formulaPreviewDir: '/tmp/formula-previews',
  formulaManifestPath: '/tmp/formula-previews/formula-preview-manifest.json',
};
const context = sandbox.window.AttachmentUtils.buildAttachmentPromptContext([attachment], { prompt: '提取题目' });
console.log('MATHTYPE_PROMPT_CONTEXT', context);
assert(context.includes('MathType/OLE公式说明'));
assert(context.includes('必须保留这些公式'));
assert(context.includes('$\\vec{a}=(1,k,2)$'));
assert(context.includes('公式预览：已导出 3 个原始预览'));
assert(!context.includes('设……且……则'));
