const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { extractAttachmentText } = require('../backend/attachment-text-extractor');

(async () => {
  const source = '/mnt/data/复件 高等数学D2复习题详细解答.docx';
  if (!fs.existsSync(source)) {
    console.log('真实 docx 未挂载，跳过真实文件测试');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mathtype-clean-latex-'));
  const file = path.join(dir, '复件 高等数学D2复习题详细解答.docx');
  fs.copyFileSync(source, file);
  const result = await extractAttachmentText(file, { originalName: path.basename(file), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.parser, 'docx-openxml-mathtype-clean-latex');
  assert.ok(result.fullText.includes('$\\vec{a}=(1,k,2)$'), '应默认输出清爽 LaTeX 公式');
  assert.ok(!/MathType需按预览校验|MathType高置信转写|置信度=/.test(result.fullText), '正文不应再塞入置信度诊断标签');
  assert.ok(result.mathType && result.mathType.count >= 200, `应检测到 200+ MathType 对象，实际 ${result.mathType && result.mathType.count}`);
  assert.ok(result.formulaAssetCount >= 200, `应导出 200+ 公式预览资产，实际 ${result.formulaAssetCount}`);
  assert.ok(result.formulaManifestPath && fs.existsSync(result.formulaManifestPath), '应生成公式预览 manifest');
  assert.ok(result.warnings.some((w) => /清爽 LaTeX|保留这些 \$\.\.\.\$ 公式|预览/.test(w)), '应给出清爽 LaTeX/预览说明');
  assert.ok(!/【公式0+1（MathType近似转写）/.test(result.fullText), '不应再使用容易被误认为准确的近似转写标签');
  console.log('MATHTYPE_CLEAN_LATEX_REAL_OK', {
    parser: result.parser,
    formulas: result.mathType.count,
    high: result.mathType.highConfidenceCount,
    needsPreview: result.mathType.needsPreviewCheckCount,
    assets: result.formulaAssetCount,
    manifest: result.formulaManifestPath,
  });
})();
