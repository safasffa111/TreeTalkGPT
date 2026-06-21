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

function createMinimalCfbStream(streamName, streamData) {
  const sectorSize = 512;
  const paddedSize = Math.max(4096, streamData.length);
  const streamSectors = Math.ceil(paddedSize / sectorSize);
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
  for (let i = 0; i < streamSectors; i += 1) fat.writeInt32LE(i === streamSectors - 1 ? -2 : 3 + i, (2 + i) * 4);

  const dir = Buffer.alloc(sectorSize, 0);
  writeDirectoryEntry(dir, 0, 'Root Entry', 5, -2, 0);
  writeDirectoryEntry(dir, 1, streamName, 2, 2, paddedSize);

  const stream = Buffer.alloc(streamSectors * sectorSize, 0);
  streamData.copy(stream);
  return Buffer.concat([header, fat, dir, stream]);
}

(async () => {
  const tmp = path.join('/tmp', 'attach-docx-mathtype-ole-tests');
  fs.mkdirSync(tmp, { recursive: true });
  const native = Buffer.from([
    0x1c,0x00,0x00,0x00,0x02,0x00,0x09,0xc2,0x2b,0x01,0x00,0x00,
    0x02,0x02,0x82,0x6c,0x00, // l
    0x02,0x00,0x82,0x69,0x00, // i
    0x02,0x00,0x82,0x6d,0x00, // m
    0x02,0x00,0x83,0x6e,0x00, // n
    0x02,0x04,0x86,0x92,0x21,0xae, // →
    0x02,0x04,0x86,0x1e,0x22,0xa5, // ∞
    0x02,0x00,0x83,0x61,0x00, // a
    0x02,0x00,0x83,0x6e,0x00, // n
  ]);
  assert.strictEqual(_internals.extractMathTypeLinearTextFromNative(native), 'limn→∞an');
  const ole = createMinimalCfbStream('Equation Native', native);
  assert.strictEqual(_internals.extractMathTypeOleApproxText(ole).linear, 'limn→∞an');

  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
  const documentXml = `<?xml version="1.0"?><w:document ${ns}><w:body><w:p><w:r><w:t>若级数</w:t></w:r><w:r><w:object><v:shape id="Object 1" o:ole=""><v:imagedata r:id="rId1"/></v:shape><o:OLEObject Type="Embed" ProgID="Equation.DSMT4" r:id="rId2"/></w:object></w:r><w:r><w:t>收敛</w:t></w:r></w:p></w:body></w:document>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.wmf"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/></Relationships>`;
  const docxPath = path.join(tmp, 'mathtype.docx');
  fs.writeFileSync(docxPath, createStoredZip([
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/_rels/document.xml.rels', data: rels },
    { name: 'word/embeddings/oleObject1.bin', data: ole },
    { name: 'word/media/image1.wmf', data: Buffer.from('dummy-preview') },
  ]));
  const result = await extractAttachmentText(docxPath, { fileName: 'mathtype.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  console.log('DOCX_MATHTYPE_OLE_RESULT', JSON.stringify({ parser: result.parser, status: result.status, warnings: result.warnings, text: result.text }, null, 2));
  assert(result.ok);
  assert.strictEqual(result.parser, 'docx-openxml-mathtype-clean-latex');
  assert(result.text.includes('若级数$\\lim_{n\\to\\infty} a_n$收敛'), result.text);
  assert(!result.text.includes('若级数……收敛'));
  assert(result.text.includes('收敛'));
  assert(result.warnings.some((item) => item.includes('MathType/Equation OLE')));
  assert(result.formulaAssetCount >= 1);
  assert(result.formulaManifestPath && fs.existsSync(result.formulaManifestPath));
})();
