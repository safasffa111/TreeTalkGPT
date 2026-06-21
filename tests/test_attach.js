const fs = require('fs');
const path = require('path');
const { extractAttachmentText } = require('../backend/attachment-text-extractor');

(async () => {
  const tmp = path.join('/tmp', 'attach-tests');
  fs.mkdirSync(tmp, { recursive: true });

  const txt = path.join(tmp, 'sample.txt');
  fs.writeFileSync(txt, '这是一个附件文本解析测试。\n第二行包含：多元微积分、矩阵、公式。');
  const resTxt = await extractAttachmentText(txt, {
    fileName: 'sample.txt',
    type: 'text/plain',
    size: fs.statSync(txt).size,
  });
  console.log('TXT_RESULT', JSON.stringify({
    ok: resTxt.ok,
    status: resTxt.status,
    parser: resTxt.parser,
    text: resTxt.text,
  }, null, 2));

  const png = path.join(tmp, 'sample.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
  const resPng = await extractAttachmentText(png, {
    fileName: 'sample.png',
    type: 'image/png',
    kind: 'image',
    size: fs.statSync(png).size,
  });
  console.log('PNG_RESULT', JSON.stringify({
    ok: resPng.ok,
    status: resPng.status,
    parser: resPng.parser,
    message: resPng.message,
    textLen: (resPng.text || '').length,
  }, null, 2));
})();
