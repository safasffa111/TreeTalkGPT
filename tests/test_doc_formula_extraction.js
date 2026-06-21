const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { extractAttachmentText, _internals } = require('../backend/attachment-text-extractor');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt16(buffer, value, offset) { buffer.writeUInt16LE(value, offset); }
function writeUInt32(buffer, value, offset) { buffer.writeUInt32LE(value >>> 0, offset); }

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach(({ name, data }) => {
    const nameBuffer = Buffer.from(name, 'utf8');
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const crc = crc32(dataBuffer);
    const local = Buffer.alloc(30 + nameBuffer.length);
    writeUInt32(local, 0x04034b50, 0);
    writeUInt16(local, 20, 4);
    writeUInt16(local, 0x0800, 6);
    writeUInt16(local, 0, 8);
    writeUInt32(local, crc, 14);
    writeUInt32(local, dataBuffer.length, 18);
    writeUInt32(local, dataBuffer.length, 22);
    writeUInt16(local, nameBuffer.length, 26);
    nameBuffer.copy(local, 30);
    localParts.push(local, dataBuffer);

    const central = Buffer.alloc(46 + nameBuffer.length);
    writeUInt32(central, 0x02014b50, 0);
    writeUInt16(central, 20, 4);
    writeUInt16(central, 20, 6);
    writeUInt16(central, 0x0800, 8);
    writeUInt16(central, 0, 10);
    writeUInt32(central, crc, 16);
    writeUInt32(central, dataBuffer.length, 20);
    writeUInt32(central, dataBuffer.length, 24);
    writeUInt16(central, nameBuffer.length, 28);
    writeUInt32(central, offset, 42);
    nameBuffer.copy(central, 46);
    centralParts.push(central);
    offset += local.length + dataBuffer.length;
  });
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  writeUInt32(eocd, 0x06054b50, 0);
  writeUInt16(eocd, entries.length, 8);
  writeUInt16(eocd, entries.length, 10);
  writeUInt32(eocd, central.length, 12);
  writeUInt32(eocd, centralOffset, 16);
  return Buffer.concat([...localParts, central, eocd]);
}

function writeDirectoryEntry(buffer, index, name, type, startSector, size) {
  const offset = index * 128;
  const nameBuffer = Buffer.from(`${name}\0`, 'utf16le');
  nameBuffer.copy(buffer, offset, 0, Math.min(nameBuffer.length, 64));
  buffer.writeUInt16LE(Math.min(nameBuffer.length, 64), offset + 64);
  buffer[offset + 66] = type;
  buffer.writeInt32LE(-1, offset + 68);
  buffer.writeInt32LE(-1, offset + 72);
  buffer.writeInt32LE(-1, offset + 76);
  buffer.writeInt32LE(startSector, offset + 116);
  buffer.writeUInt32LE(size >>> 0, offset + 120);
}

function createMinimalCfbDoc(text) {
  const sectorSize = 512;
  const textBuffer = Buffer.from(text, 'utf16le');
  const streamSize = Math.max(4608, textBuffer.length);
  const streamSectors = Math.ceil(streamSize / sectorSize);
  const sectorCount = 2 + streamSectors;
  const header = Buffer.alloc(sectorSize, 0xff);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header, 0);
  header.fill(0, 8, 0x1e);
  header.writeUInt16LE(0x003e, 0x18);
  header.writeUInt16LE(0x0003, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(1, 0x2c);
  header.writeInt32LE(1, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeInt32LE(-2, 0x3c);
  header.writeUInt32LE(0, 0x40);
  header.writeInt32LE(-2, 0x44);
  header.writeUInt32LE(0, 0x48);
  header.writeInt32LE(0, 0x4c);
  for (let pos = 0x50; pos < 512; pos += 4) header.writeInt32LE(-1, pos);

  const fat = Buffer.alloc(sectorSize, 0xff);
  fat.writeInt32LE(-3, 0); // FAT sector
  fat.writeInt32LE(-2, 4); // directory sector
  for (let i = 0; i < streamSectors; i += 1) {
    fat.writeInt32LE(i === streamSectors - 1 ? -2 : 3 + i, (2 + i) * 4);
  }

  const dir = Buffer.alloc(sectorSize, 0);
  writeDirectoryEntry(dir, 0, 'Root Entry', 5, -2, 0);
  writeDirectoryEntry(dir, 1, 'WordDocument', 2, 2, streamSize);

  const stream = Buffer.alloc(streamSectors * sectorSize, 0);
  textBuffer.copy(stream);
  return Buffer.concat([header, fat, dir, stream]);
}

(async () => {
  const tmp = path.join('/tmp', 'attach-doc-formula-tests');
  fs.mkdirSync(tmp, { recursive: true });

  const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>
<w:p><w:r><w:t>题目：计算</w:t></w:r><m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath><w:r><w:t>，并保留 $x^2+\\frac{1}{x}$。</w:t></w:r></w:p>
<w:p><w:r><w:instrText>EQ \\f(a+b,c)</w:instrText></w:r></w:p>
</w:body></w:document>`;
  const docxPath = path.join(tmp, 'formula.docx');
  fs.writeFileSync(docxPath, createStoredZip([{ name: 'word/document.xml', data: docxXml }]));
  const docx = await extractAttachmentText(docxPath, { fileName: 'formula.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  console.log('DOCX_FORMULA_RESULT', JSON.stringify({ parser: docx.parser, status: docx.status, text: docx.text }, null, 2));
  assert(docx.ok);
  assert(docx.text.includes('$\\frac{1}{2}$'));
  assert(docx.text.includes('$x^2+\\frac{1}{x}$'));
  assert(docx.text.includes('$\\frac{a+b}{c}$'));

  const docPath = path.join(tmp, 'legacy.doc');
  fs.writeFileSync(docPath, createMinimalCfbDoc('旧版 DOC 测试：请保留公式 $E=mc^2$ 和 \\(a^2+b^2=c^2\\)，中文正文不能丢。'));
  const doc = await extractAttachmentText(docPath, { fileName: 'legacy.doc', type: 'application/msword' });
  console.log('DOC_LEGACY_RESULT', JSON.stringify({ parser: doc.parser, status: doc.status, text: doc.text }, null, 2));
  assert(doc.ok);
  assert(doc.text.includes('旧版 DOC 测试'));
  assert(doc.text.includes('$E=mc^2$'));
  assert(doc.text.includes('\\(a^2+b^2=c^2\\)'));

  const normalized = _internals.normalizePlainText('公式 $x   +   y$ 外部    多空格');
  assert(normalized.includes('$x   +   y$'));
  assert(normalized.includes('外部 多空格'));
})();
