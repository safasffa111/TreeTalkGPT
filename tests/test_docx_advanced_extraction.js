const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { extractAttachmentText } = require('../backend/attachment-text-extractor');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function w16(buffer, value, offset) { buffer.writeUInt16LE(value, offset); }
function w32(buffer, value, offset) { buffer.writeUInt32LE(value >>> 0, offset); }
function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach(({ name, data }) => {
    const nameBuffer = Buffer.from(name, 'utf8');
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const crc = crc32(dataBuffer);
    const local = Buffer.alloc(30 + nameBuffer.length);
    w32(local, 0x04034b50, 0); w16(local, 20, 4); w16(local, 0x0800, 6); w16(local, 0, 8);
    w32(local, crc, 14); w32(local, dataBuffer.length, 18); w32(local, dataBuffer.length, 22); w16(local, nameBuffer.length, 26);
    nameBuffer.copy(local, 30);
    localParts.push(local, dataBuffer);
    const central = Buffer.alloc(46 + nameBuffer.length);
    w32(central, 0x02014b50, 0); w16(central, 20, 4); w16(central, 20, 6); w16(central, 0x0800, 8); w16(central, 0, 10);
    w32(central, crc, 16); w32(central, dataBuffer.length, 20); w32(central, dataBuffer.length, 24); w16(central, nameBuffer.length, 28); w32(central, offset, 42);
    nameBuffer.copy(central, 46);
    centralParts.push(central);
    offset += local.length + dataBuffer.length;
  });
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  w32(eocd, 0x06054b50, 0); w16(eocd, entries.length, 8); w16(eocd, entries.length, 10); w32(eocd, central.length, 12); w32(eocd, centralOffset, 16);
  return Buffer.concat([...localParts, central, eocd]);
}

(async () => {
  const tmp = path.join('/tmp', 'attach-docx-advanced-tests');
  fs.mkdirSync(tmp, { recursive: true });
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
  const documentXml = `<?xml version="1.0"?><w:document ${ns}><w:body>
<w:p><w:r><w:t>第一题：证明</w:t></w:r>
<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>
<w:r><w:t>加根式</w:t></w:r><m:oMath><m:rad><m:e><m:r><m:t>a+b</m:t></m:r></m:e></m:rad></m:oMath></w:p>
<w:p><w:r><w:t>积分：</w:t></w:r><m:oMath><m:nary><m:naryPr><m:chr m:val="∫"/></m:naryPr><m:sub><m:r><m:t>0</m:t></m:r></m:sub><m:sup><m:r><m:t>1</m:t></m:r></m:sup><m:e><m:r><m:t>x dx</m:t></m:r></m:e></m:nary></m:oMath></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格A</w:t></w:r></w:p></w:tc><w:tc><w:p><m:oMath><m:m><m:mr><m:e><m:r><m:t>1</m:t></m:r></m:e><m:e><m:r><m:t>0</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>0</m:t></m:r></m:e><m:e><m:r><m:t>1</m:t></m:r></m:e></m:mr></m:m></m:oMath></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>EQ \\f(x+1,y)</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>域结果不应重复</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
</w:body></w:document>`;
  const headerXml = `<?xml version="1.0"?><w:hdr ${ns}><w:p><w:r><w:t>页眉文本</w:t></w:r></w:p></w:hdr>`;
  const docxPath = path.join(tmp, 'advanced.docx');
  fs.writeFileSync(docxPath, createStoredZip([
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/header1.xml', data: headerXml },
  ]));
  const result = await extractAttachmentText(docxPath, { fileName: 'advanced.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  console.log('DOCX_ADVANCED_RESULT', JSON.stringify({ parser: result.parser, status: result.status, text: result.text }, null, 2));
  assert(result.ok);
  assert(result.text.includes('第一题：证明'));
  assert(result.text.includes('$x^{2}$'));
  assert(result.text.includes('$\\sqrt{a+b}$'));
  assert(result.text.includes('$\\int_{0}^{1} x dx$'));
  assert(result.text.includes('表格A'));
  assert(result.text.includes('\\begin{matrix}'));
  assert(result.text.includes('$\\frac{x+1}{y}$'));
  assert(!result.text.includes('域结果不应重复'));
  assert(result.text.includes('页眉文本'));
})();
