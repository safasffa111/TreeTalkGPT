const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { extractAttachmentText, _internals } = require('../backend/attachment-text-extractor');

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
  fat.writeInt32LE(-3, 0);
  fat.writeInt32LE(-2, 4);
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
  const tmp = path.join('/tmp', 'attach-doc-readonly-unreadable-tests');
  fs.mkdirSync(tmp, { recursive: true });

  const readonlyPath = path.join(tmp, 'readonly.doc');
  fs.writeFileSync(readonlyPath, createMinimalCfbDoc('只读 DOC 测试：这里有可读正文和公式 $x^2+y^2=z^2$。'));
  fs.chmodSync(readonlyPath, 0o444);
  const readonly = await extractAttachmentText(readonlyPath, { fileName: 'readonly.doc', type: 'application/msword' });
  console.log('DOC_READONLY_RESULT', JSON.stringify({ parser: readonly.parser, status: readonly.status, ok: readonly.ok, text: readonly.text }, null, 2));
  assert(readonly.ok, readonly.message);
  assert(readonly.text.includes('只读 DOC 测试'));
  assert(readonly.text.includes('$x^2+y^2=z^2$'));

  const garbagePath = path.join(tmp, 'garbage.doc');
  const garbage = Buffer.alloc(8192, 0);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(garbage, 0);
  for (let i = 8; i < garbage.length; i += 1) garbage[i] = (i * 37 + 19) % 256;
  fs.writeFileSync(garbagePath, garbage);
  const unreadable = await extractAttachmentText(garbagePath, { fileName: 'garbage.doc', type: 'application/msword' });
  console.log('DOC_UNREADABLE_RESULT', JSON.stringify({ parser: unreadable.parser, status: unreadable.status, ok: unreadable.ok, message: unreadable.message }, null, 2));
  assert.strictEqual(unreadable.ok, false);
  assert.strictEqual(unreadable.status, 'unreadable');
  assert.strictEqual(unreadable.text, '');

  assert.strictEqual(_internals.isReadableExtractedText('WordDocument\n\u0000\u0001\u0002ÿþÿþ'), false);
})();
