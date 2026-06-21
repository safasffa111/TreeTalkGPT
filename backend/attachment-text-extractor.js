const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const zlib = require('zlib');

const MAX_EXTRACT_CHARS = 180000;
const MAX_SOURCE_BYTES = 96 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 20000;
const MAX_ZIP_ENTRY_BYTES = 80 * 1024 * 1024;
const MAX_TOTAL_UNZIPPED_BYTES = 180 * 1024 * 1024;
const CHUNK_SIZE = 7000;
const CHUNK_OVERLAP = 600;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.html', '.htm', '.css', '.scss', '.less', '.py', '.java', '.c', '.cc', '.cpp', '.cxx', '.h',
  '.hpp', '.hh', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.kts', '.scala', '.sh',
  '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.sql', '.xml', '.yaml', '.yml', '.toml', '.ini',
  '.cfg', '.conf', '.csv', '.tsv', '.log', '.tex', '.r', '.lua', '.vue', '.svelte', '.dockerfile',
  '.svg', '.srt', '.vtt', '.asm', '.ini', '.gradle', '.cmake', '.makefile', '.gitignore', '.env'
]);

const OFFICE_OPEN_XML_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx']);
const LEGACY_BINARY_EXTENSIONS = new Set(['.doc', '.ppt', '.xls']);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif'
]);

const MATH_PLACEHOLDER_PREFIX = '\uE000ATTACH_MATH_';
const MATH_PLACEHOLDER_SUFFIX = '_\uE001';

function protectMathSegments(text = '') {
  const source = String(text || '');
  const segments = [];
  const push = (match) => {
    const token = `${MATH_PLACEHOLDER_PREFIX}${segments.length}${MATH_PLACEHOLDER_SUFFIX}`;
    segments.push(match);
    return token;
  };
  const protectedText = source.replace(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^\n$]{1,3000}?\$|\\begin\{([a-zA-Z*]+)\}[\s\S]*?\\end\{\1\}/g, push);
  return {
    text: protectedText,
    restore(value = '') {
      return String(value || '').replace(new RegExp(`${MATH_PLACEHOLDER_PREFIX}(\\d+)${MATH_PLACEHOLDER_SUFFIX}`, 'g'), (_, index) => segments[Number(index)] || '');
    },
  };
}

function normalizeWhitespace(text = '') {
  const prepared = String(text || '').replace(/\r\n?/g, '\n');
  const protectedMath = protectMathSegments(prepared);
  const normalized = protectedMath.text
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ \u00a0]{2,}/g, ' ')
    .replace(/\n[ \u00a0]+/g, '\n')
    .replace(/[ \u00a0]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return protectedMath.restore(normalized).trim();
}

function normalizePlainText(text = '') {
  const prepared = String(text || '').replace(/\r\n?/g, '\n');
  const protectedMath = protectMathSegments(prepared);
  const normalized = protectedMath.text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, '')
    .replace(/[ \u00a0]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return protectedMath.restore(normalized).trim();
}

function hasUnclosedMathDelimiter(text = '') {
  const source = String(text || '');
  const count = (pattern) => (source.match(pattern) || []).length;
  if (count(/(^|[^\\])\$\$/g) % 2 === 1) return true;
  if (count(/(^|[^\\])\$(?!\$)/g) % 2 === 1) return true;
  if ((source.match(/\\\[/g) || []).length > (source.match(/\\\]/g) || []).length) return true;
  if ((source.match(/\\\(/g) || []).length > (source.match(/\\\)/g) || []).length) return true;
  return false;
}

function safeSliceMathAware(text = '', maxChars = MAX_EXTRACT_CHARS, lookahead = 2400) {
  const source = String(text || '');
  if (source.length <= maxChars) return source;
  let end = Math.max(0, maxChars);
  let sliced = source.slice(0, end);
  if (!hasUnclosedMathDelimiter(sliced)) return sliced;
  const nextCandidates = ['$$', '$', '\\]', '\\)']
    .map((needle) => source.indexOf(needle, end))
    .filter((pos) => pos >= end && pos <= end + lookahead)
    .sort((a, b) => a - b);
  if (nextCandidates.length) {
    const closePos = nextCandidates[0];
    end = closePos + (source.startsWith('$$', closePos) || source.startsWith('\\]', closePos) || source.startsWith('\\)', closePos) ? 2 : 1);
    return source.slice(0, end);
  }
  const lastDollar = Math.max(sliced.lastIndexOf('$$'), sliced.lastIndexOf('$'), sliced.lastIndexOf('\\['), sliced.lastIndexOf('\\('));
  if (lastDollar > Math.max(0, maxChars - lookahead)) return source.slice(0, lastDollar).trimEnd();
  return sliced;
}

function truncateText(text = '', maxChars = MAX_EXTRACT_CHARS) {
  const normalized = String(text || '');
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false, originalLength: normalized.length };
  }
  const sliced = safeSliceMathAware(normalized, maxChars);
  return {
    text: `${sliced}\n\n[附件解析文本过长，已截断到 ${maxChars} 字符；完整文本已保存到 extracted-text-full.txt；已尽量避免截断 KaTeX/LaTeX 公式。]`,
    truncated: true,
    originalLength: normalized.length,
  };
}

function decodeXmlEntities(text = '') {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    });
}

function stripXmlTags(text = '') {
  return decodeXmlEntities(String(text || '').replace(/<[^>]+>/g, ''));
}

function decodeUtf16Be(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const swapped = Buffer.alloc(source.length - (source.length % 2));
  for (let i = 0; i + 1 < source.length; i += 2) {
    swapped[i] = source[i + 1];
    swapped[i + 1] = source[i];
  }
  return swapped.toString('utf16le');
}

function decodeTextBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return '';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.slice(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return decodeUtf16Be(buffer.slice(2));
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.slice(3).toString('utf8');
  const utf8 = buffer.toString('utf8');
  const replacementRatio = (utf8.match(/\uFFFD/g) || []).length / Math.max(1, utf8.length);
  if (replacementRatio < 0.02) return utf8;
  return buffer.toString('latin1');
}

function looksBinary(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let zero = 0;
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) zero += 1;
    if (byte < 8 || (byte > 13 && byte < 32)) control += 1;
  }
  return zero > 0 || control / Math.max(1, sample.length) > 0.08;
}

function getExtension(name = '', mime = '') {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext) return ext;
  const type = String(mime || '').toLowerCase();
  if (type === 'application/pdf') return '.pdf';
  if (type.includes('wordprocessingml.document')) return '.docx';
  if (type.includes('presentationml.presentation')) return '.pptx';
  if (type.includes('spreadsheetml.sheet')) return '.xlsx';
  if (type.includes('rtf')) return '.rtf';
  if (type.startsWith('text/')) return '.txt';
  return '';
}

function extractPrintableStrings(buffer, options = {}) {
  const minLength = Number(options.minLength || 4);
  const maxLines = Number(options.maxLines || 5000);
  const chunks = [];
  let current = [];
  const flush = () => {
    if (current.length >= minLength) chunks.push(Buffer.from(current).toString('latin1'));
    current = [];
  };
  for (const byte of buffer) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 160) {
      current.push(byte);
    } else {
      flush();
      if (chunks.length >= maxLines) break;
    }
  }
  flush();
  return normalizeWhitespace(chunks.join('\n'));
}

function isUsefulTextCodePoint(code) {
  return code === 9 || code === 10 || code === 13 ||
    (code >= 32 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd);
}

function extractUtf16LeStrings(buffer, options = {}) {
  const minLength = Number(options.minLength || 3);
  const maxLines = Number(options.maxLines || 8000);
  const chunks = [];
  let current = [];
  const flush = () => {
    const text = current.join('').trim();
    if (text.length >= minLength && /[\u4e00-\u9fffA-Za-z0-9\$\\]/.test(text)) chunks.push(text);
    current = [];
  };
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  for (let i = 0; i + 1 < source.length; i += 2) {
    const code = source.readUInt16LE(i);
    if (isUsefulTextCodePoint(code) && code !== 0xfffe && code !== 0xffff) {
      const ch = String.fromCharCode(code);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(ch)) flush();
      else current.push(ch);
    } else {
      flush();
      if (chunks.length >= maxLines) break;
    }
  }
  flush();
  return normalizePlainText(chunks.join('\n'));
}

function cleanBinaryExtractedText(text = '') {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const cleaned = [];
  const seen = new Set();
  for (const line of lines) {
    if (cleaned.length >= 12000) break;
    const textChars = (line.match(/[\u4e00-\u9fffA-Za-z0-9，。！？；：、,.!?;:()（）\[\]{}$\\_+=<>\/^*%-]/g) || []).length;
    const ratio = textChars / Math.max(1, line.length);
    if (line.length < 2 && !/[A-Za-z0-9\u4e00-\u9fff]/.test(line)) continue;
    if (line.length > 16 && ratio < 0.38) continue;
    const key = line.replace(/\s+/g, ' ').slice(0, 220);
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(line);
  }
  return normalizePlainText(cleaned.join('\n'));
}

function scoreExtractedText(text = '') {
  const source = String(text || '');
  const useful = (source.match(/[\u4e00-\u9fffA-Za-z0-9]/g) || []).length;
  const math = (source.match(/\$|\\\(|\\\[|\\frac|\\sum|\\int|\\sqrt/g) || []).length * 8;
  const replacement = (source.match(/\uFFFD/g) || []).length * 20;
  return useful + math - replacement;
}


function getTextQualityMetrics(text = '') {
  const source = String(text || '');
  const compact = source.replace(/\s+/g, '');
  const length = compact.length;
  const useful = (compact.match(/[\u4e00-\u9fffA-Za-z0-9，。！？；：、,.!?;:()（）\[\]{}$\\_+=<>\/^*%\-\s]/g) || []).length;
  const cjk = (compact.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (compact.match(/[A-Za-z]/g) || []).length;
  const digits = (compact.match(/[0-9]/g) || []).length;
  const math = (compact.match(/\$|\\\(|\\\[|\\frac|\\sum|\\int|\\sqrt|[=+\-*/^]/g) || []).length;
  const replacement = (source.match(/\uFFFD/g) || []).length;
  const controls = (source.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) || []).length;
  const suspicious = (compact.match(/[\uE000-\uF8FF\uFFF0-\uFFFF]/g) || []).length;
  const readableRatio = length ? useful / length : 0;
  const badRatio = length ? (replacement * 2 + controls * 2 + suspicious) / length : 0;
  const lineCount = source.split(/\n+/).filter((line) => line.trim()).length;
  return { length, useful, cjk, latin, digits, math, replacement, controls, suspicious, readableRatio, badRatio, lineCount };
}

function isReadableExtractedText(text = '', options = {}) {
  const minUsefulChars = Number(options.minUsefulChars || 24);
  const metrics = getTextQualityMetrics(text);
  if (metrics.length < minUsefulChars) return false;
  if ((metrics.cjk + metrics.latin + metrics.digits + metrics.math) < minUsefulChars) return false;
  if (metrics.badRatio > 0.10) return false;
  if (metrics.readableRatio < 0.52) return false;
  const source = String(text || '');
  const binaryMarkers = (source.match(/\b(?:WordDocument|Root Entry|CompObj|ObjectPool|Data|Table|SummaryInformation)\b/g) || []).length;
  if (binaryMarkers >= 4 && metrics.cjk < 20) return false;
  const noisyLines = source.split('\n').filter(Boolean).filter((line) => {
    const compact = line.trim().replace(/\s+/g, '');
    if (!compact) return false;
    if (compact.length < 12) return false;
    const useful = (compact.match(/[\u4e00-\u9fffA-Za-z0-9，。！？；：、,.!?;:()（）\[\]{}$\\_+=<>\/^*%\-]/g) || []).length;
    return useful / Math.max(1, compact.length) < 0.45;
  }).length;
  if (metrics.lineCount >= 8 && noisyLines / metrics.lineCount > 0.42) return false;
  return true;
}

function makeUnusableDocPayload(parser, extra = {}) {
  const warnings = Array.isArray(extra.warnings) ? extra.warnings.filter(Boolean) : [];
  return {
    ok: false,
    status: 'unreadable',
    parser,
    text: '',
    fullText: '',
    fullLength: 0,
    truncated: false,
    chunkCount: 0,
    chunks: [],
    headings: [],
    warnings,
    message: [
      '旧版 .doc 附件已读取，但当前本地解析结果主要是 Word 二进制结构残留或乱码，已阻止把乱码注入 AI 上下文。',
      '这通常不是“文件只读”导致的；只读文件可以被读取。真正原因是 .doc 是老式 OLE 二进制格式，纯字符串扫描无法可靠还原正文。',
      '建议安装 LibreOffice，并确保 soffice.exe 在 PATH 中，或设置 SOFFICE_CMD / LIBREOFFICE_CMD 指向 soffice.exe；程序会把只读原文件复制到临时目录后转换，不会改写原文件。',
      '也可以手动另存为 .docx 或 PDF 后再上传。',
    ].join('\n'),
  };
}

function execFileWithTimeout(command, args = [], options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      timeout: Number(options.timeout || 25000),
      maxBuffer: Number(options.maxBuffer || 12 * 1024 * 1024),
      windowsHide: true,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        command,
        args,
        stdout: stdout || '',
        stderr: stderr || '',
        error: error ? (error.message || String(error)) : '',
      });
    });
  });
}

function uniqueTruthy(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function getLibreOfficeCandidates() {
  return uniqueTruthy([
    process.env.SOFFICE_CMD,
    process.env.LIBREOFFICE_CMD,
    'soffice',
    'libreoffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ]);
}

async function readNewestConvertedTextFile(dir, beforeNames = new Set()) {
  const entries = await fs.readdir(dir).catch(() => []);
  const candidates = [];
  for (const name of entries) {
    if (beforeNames.has(name)) continue;
    if (!/\.(txt|text|html|htm|rtf)$/i.test(name)) continue;
    const fullPath = path.join(dir, name);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (stat?.isFile()) candidates.push({ name, fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size);
  for (const candidate of candidates) {
    const buffer = await fs.readFile(candidate.fullPath).catch(() => null);
    if (!buffer) continue;
    const text = /\.html?$/i.test(candidate.name) ? extractHtmlText(buffer) : decodeTextBuffer(buffer);
    const normalized = normalizePlainText(text);
    if (isReadableExtractedText(normalized, { minUsefulChars: 16 })) return normalized;
  }
  return '';
}

async function tryLibreOfficeDocText(filePath = '', metadata = {}) {
  const commands = getLibreOfficeCandidates();
  const attempts = [];
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'learning-stack-doc-convert-'));
  try {
    const safeName = path.basename(String(metadata.originalName || metadata.name || metadata.fileName || filePath || 'attachment.doc')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'attachment.doc';
    const sourceCopy = path.join(tmpRoot, safeName.toLowerCase().endsWith('.doc') ? safeName : `${safeName}.doc`);
    await fs.copyFile(filePath, sourceCopy);
    await fs.chmod(sourceCopy, 0o600).catch(() => {});
    const beforeNames = new Set(await fs.readdir(tmpRoot).catch(() => []));
    for (const command of commands) {
      const result = await execFileWithTimeout(command, [
        '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--nolockcheck',
        '--convert-to', 'txt:Text', '--outdir', tmpRoot, sourceCopy,
      ], { cwd: tmpRoot, timeout: 35000 });
      attempts.push(`${command}: ${result.ok ? 'ok' : result.error || result.stderr || 'failed'}`.slice(0, 280));
      const text = await readNewestConvertedTextFile(tmpRoot, beforeNames);
      if (text) {
        return {
          ok: true,
          parser: 'doc-libreoffice-txt',
          text,
          warnings: [
            '旧版 .doc 已通过 LibreOffice 复制到临时目录后转换为文本；原始附件未被改写。',
          ],
          attempts,
        };
      }
    }
    return { ok: false, parser: 'doc-libreoffice-txt', text: '', attempts };
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function tryCommandStdoutText(command, args = [], parser = 'external-doc-converter') {
  const result = await execFileWithTimeout(command, args, { timeout: 30000 });
  if (!result.ok || !result.stdout) return { ok: false, parser, text: '', error: result.error || result.stderr };
  const text = normalizePlainText(result.stdout);
  return isReadableExtractedText(text, { minUsefulChars: 16 }) ? { ok: true, parser, text } : { ok: false, parser, text: '', error: 'output-unreadable' };
}

async function tryExternalLegacyDocText(filePath = '', metadata = {}) {
  const warnings = [];
  const errors = [];
  try {
    const libre = await tryLibreOfficeDocText(filePath, metadata);
    if (libre.ok && libre.text) return libre;
    if (Array.isArray(libre.attempts) && libre.attempts.length) errors.push(...libre.attempts.slice(0, 4));
  } catch (error) {
    errors.push(`LibreOffice: ${error?.message || String(error)}`);
  }

  const antiword = await tryCommandStdoutText(process.env.ANTIWORD_CMD || 'antiword', ['-m', 'UTF-8', filePath], 'doc-antiword');
  if (antiword.ok) return { ...antiword, warnings: ['旧版 .doc 已通过 antiword 读取；原始附件未被改写。'] };
  if (antiword.error) errors.push(`antiword: ${antiword.error}`.slice(0, 220));

  const catdoc = await tryCommandStdoutText(process.env.CATDOC_CMD || 'catdoc', ['-d', 'utf-8', filePath], 'doc-catdoc');
  if (catdoc.ok) return { ...catdoc, warnings: ['旧版 .doc 已通过 catdoc 读取；原始附件未被改写。'] };
  if (catdoc.error) errors.push(`catdoc: ${catdoc.error}`.slice(0, 220));

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'learning-stack-wvtext-'));
  try {
    const outPath = path.join(tmpRoot, 'out.txt');
    const wv = await execFileWithTimeout(process.env.WVTEXT_CMD || 'wvText', [filePath, outPath], { timeout: 30000 });
    if (wv.ok) {
      const buffer = await fs.readFile(outPath).catch(() => null);
      const text = buffer ? normalizePlainText(decodeTextBuffer(buffer)) : '';
      if (isReadableExtractedText(text, { minUsefulChars: 16 })) return { ok: true, parser: 'doc-wvText', text, warnings: ['旧版 .doc 已通过 wvText 读取；原始附件未被改写。'] };
    }
    if (wv.error || wv.stderr) errors.push(`wvText: ${wv.error || wv.stderr}`.slice(0, 220));
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }

  warnings.push('未找到可用的外部 .doc 转换器，或转换结果不可读；将尝试内置二进制兜底解析。');
  return { ok: false, parser: 'doc-external-unavailable', text: '', warnings, errors };
}

function isOleCompoundFile(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 512 &&
    buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 && buffer[5] === 0xb1 && buffer[6] === 0x1a && buffer[7] === 0xe1;
}

function readCfbStreams(buffer) {
  if (!isOleCompoundFile(buffer)) return new Map();
  const sectorShift = buffer.readUInt16LE(0x1e);
  const miniSectorShift = buffer.readUInt16LE(0x20);
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;
  const firstDirSector = buffer.readInt32LE(0x30);
  const miniCutoff = buffer.readUInt32LE(0x38);
  const firstMiniFatSector = buffer.readInt32LE(0x3c);
  const numMiniFatSectors = buffer.readUInt32LE(0x40);
  const difat = [];
  for (let i = 0; i < 109; i += 1) {
    const sid = buffer.readInt32LE(0x4c + i * 4);
    if (sid >= 0) difat.push(sid);
  }
  const sectorOffset = (sid) => (sid + 1) * sectorSize;
  const fat = [];
  difat.forEach((sid) => {
    const start = sectorOffset(sid);
    if (start < 0 || start + sectorSize > buffer.length) return;
    for (let pos = start; pos + 4 <= start + sectorSize; pos += 4) fat.push(buffer.readInt32LE(pos));
  });
  const readChain = (startSid, expectedSize = 0, fatTable = fat, sectorReader = null, guardLimit = 200000) => {
    if (startSid < 0) return Buffer.alloc(0);
    const chunks = [];
    const visited = new Set();
    let sid = startSid;
    let guard = 0;
    while (sid >= 0 && sid < fatTable.length && !visited.has(sid) && guard < guardLimit) {
      visited.add(sid);
      const chunk = sectorReader ? sectorReader(sid) : (() => {
        const start = sectorOffset(sid);
        if (start < 0 || start + sectorSize > buffer.length) return Buffer.alloc(0);
        return buffer.subarray(start, start + sectorSize);
      })();
      if (!chunk.length) break;
      chunks.push(chunk);
      const next = fatTable[sid];
      if (next < 0 || next === 0xfffffffe) break;
      sid = next;
      guard += 1;
    }
    const joined = Buffer.concat(chunks);
    return expectedSize ? joined.subarray(0, Math.min(expectedSize, joined.length)) : joined;
  };
  const dirBuffer = readChain(firstDirSector);
  const entries = [];
  for (let pos = 0; pos + 128 <= dirBuffer.length; pos += 128) {
    const entry = dirBuffer.subarray(pos, pos + 128);
    const nameLength = entry.readUInt16LE(64);
    const rawName = nameLength >= 2 ? entry.subarray(0, Math.min(64, nameLength - 2)).toString('utf16le') : '';
    const type = entry[66];
    const startSector = entry.readInt32LE(116);
    const sizeLow = entry.readUInt32LE(120);
    entries.push({ name: rawName, type, startSector, size: sizeLow });
  }
  const rootEntry = entries.find((entry) => entry.type === 5);
  const miniStream = rootEntry ? readChain(rootEntry.startSector, rootEntry.size) : Buffer.alloc(0);
  const miniFatBuffer = firstMiniFatSector >= 0 && numMiniFatSectors > 0
    ? readChain(firstMiniFatSector, numMiniFatSectors * sectorSize)
    : Buffer.alloc(0);
  const miniFat = [];
  for (let pos = 0; pos + 4 <= miniFatBuffer.length; pos += 4) miniFat.push(miniFatBuffer.readInt32LE(pos));
  const readMiniChain = (startSid, expectedSize = 0) => {
    if (!miniStream.length || !miniFat.length || startSid < 0) return Buffer.alloc(0);
    return readChain(startSid, expectedSize, miniFat, (sid) => {
      const start = sid * miniSectorSize;
      if (start < 0 || start + miniSectorSize > miniStream.length) return Buffer.alloc(0);
      return miniStream.subarray(start, start + miniSectorSize);
    }, 200000);
  };
  const streams = new Map();
  entries.forEach((entry) => {
    if (entry.type !== 2 || !entry.name) return;
    const data = entry.size > 0 && entry.size < miniCutoff
      ? readMiniChain(entry.startSector, entry.size)
      : readChain(entry.startSector, entry.size);
    if (data.length) streams.set(entry.name, data);
  });
  return streams;
}

function extractLegacyOfficeBinaryText(buffer, options = {}) {
  const streams = isOleCompoundFile(buffer) ? readCfbStreams(buffer) : new Map();
  const candidates = [];
  const streamOrder = ['WordDocument', '1Table', '0Table', 'Data', 'PowerPoint Document', 'Workbook', 'Book'];
  const selectedBuffers = [];
  streamOrder.forEach((name) => {
    const data = streams.get(name);
    if (data) selectedBuffers.push(data);
  });
  if (!selectedBuffers.length) selectedBuffers.push(buffer);
  const combined = Buffer.concat(selectedBuffers.slice(0, 8));
  const utf16Text = cleanBinaryExtractedText(extractUtf16LeStrings(combined, { minLength: 2, maxLines: 12000 }));
  const printableText = cleanBinaryExtractedText(extractPrintableStrings(combined, { minLength: 4, maxLines: 10000 }));
  if (utf16Text.length >= 12 && /[\u4e00-\u9fff]|\$|\\\(|\\\[|\\frac/.test(utf16Text) && scoreExtractedText(utf16Text) >= Math.max(16, scoreExtractedText(printableText) * 0.55)) {
    return utf16Text;
  }
  candidates.push(utf16Text, printableText, cleanBinaryExtractedText(`${utf16Text || ''}\n${printableText || ''}`));
  candidates.sort((a, b) => scoreExtractedText(b) - scoreExtractedText(a));
  return candidates[0] || '';
}

function extractLegacyDocText(buffer) {
  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1');
  const trimmed = head.trimStart();
  if (/^\{\\rtf/i.test(trimmed)) return extractRtfText(buffer);
  if (/^<(!doctype\s+html|html|\?xml)/i.test(trimmed)) return extractHtmlText(buffer);
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) return extractDocxText(buffer);
  return extractLegacyOfficeBinaryText(buffer, { kind: 'doc' });
}

function findEndOfCentralDirectory(buffer) {
  const sig = 0x06054b50;
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === sig) return i;
  }
  return -1;
}

function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error('不是有效的 ZIP/OpenXML 文件');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error(`ZIP 条目过多（${entryCount}），已拒绝解析`);
  const entries = [];
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < entryCount && offset + 46 <= buffer.length; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameBuffer = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const name = nameBuffer.toString((flags & 0x0800) ? 'utf8' : 'utf8');
    totalUncompressed += uncompressedSize;
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw new Error(`ZIP 条目过大：${name}`);
    if (totalUncompressed > MAX_TOTAL_UNZIPPED_BYTES) throw new Error('ZIP 解压后体积过大，已拒绝解析');
    entries.push({ name, compression, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntryData(buffer, entry) {
  const local = entry.localHeaderOffset;
  if (local < 0 || local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) return Buffer.alloc(0);
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const dataStart = local + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart < 0 || dataEnd > buffer.length) return Buffer.alloc(0);
  const compressed = buffer.subarray(dataStart, dataEnd);
  if (entry.compression === 0) return compressed;
  if (entry.compression === 8) return zlib.inflateRawSync(compressed);
  return Buffer.alloc(0);
}

function readZipDataMap(buffer, predicate = () => true) {
  const entries = readZipEntries(buffer);
  const map = new Map();
  for (const entry of entries) {
    if (!predicate(entry.name)) continue;
    try {
      const data = readZipEntryData(buffer, entry);
      if (data.length) map.set(entry.name, data);
    } catch {
      // Ignore malformed optional entries.
    }
  }
  return map;
}

function readZipTextMap(buffer, predicate = () => true) {
  const dataMap = readZipDataMap(buffer, predicate);
  const map = new Map();
  dataMap.forEach((data, name) => map.set(name, data.toString('utf8')));
  return map;
}


function localXmlName(name = '') {
  return String(name || '').split(':').pop();
}

function parseXmlAttributes(source = '') {
  const attrs = {};
  const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(String(source || '')))) {
    attrs[match[1]] = decodeXmlEntities(match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function getXmlAttr(node, names = []) {
  const wanted = Array.isArray(names) ? names : [names];
  const attrs = node?.attrs || {};
  for (const key of wanted) {
    if (Object.prototype.hasOwnProperty.call(attrs, key)) return attrs[key];
  }
  const wantedLocals = new Set(wanted.map(localXmlName));
  for (const [key, value] of Object.entries(attrs)) {
    if (wantedLocals.has(localXmlName(key))) return value;
  }
  return '';
}

function parseXmlTree(xml = '') {
  const root = { name: '#root', local: '#root', attrs: {}, children: [], parent: null };
  const stack = [root];
  const pattern = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<[^>]+>|[^<]+/g;
  let match;
  while ((match = pattern.exec(String(xml || '')))) {
    const token = match[0];
    if (!token) continue;
    if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<!DOCTYPE') || token.startsWith('<!doctype')) continue;
    if (token.startsWith('<![CDATA[')) {
      const text = match[1] || '';
      if (text) stack[stack.length - 1].children.push({ name: '#text', local: '#text', text, attrs: {}, children: [], parent: stack[stack.length - 1] });
      continue;
    }
    if (token[0] !== '<') {
      const text = decodeXmlEntities(token);
      if (text) stack[stack.length - 1].children.push({ name: '#text', local: '#text', text, attrs: {}, children: [], parent: stack[stack.length - 1] });
      continue;
    }
    if (/^<\s*\//.test(token)) {
      const closeName = (token.match(/^<\s*\/\s*([^\s>]+)/) || [])[1] || '';
      const closeLocal = localXmlName(closeName);
      for (let i = stack.length - 1; i > 0; i -= 1) {
        const node = stack.pop();
        if (node.local === closeLocal || node.name === closeName) break;
      }
      continue;
    }
    const inner = token.slice(1, -1).trim();
    const selfClosing = /\/\s*$/.test(inner);
    const tagName = (inner.match(/^([^\s/>]+)/) || [])[1] || '';
    if (!tagName) continue;
    const attrSource = inner.slice(tagName.length).replace(/\/\s*$/, '');
    const node = {
      name: tagName,
      local: localXmlName(tagName),
      attrs: parseXmlAttributes(attrSource),
      children: [],
      parent: stack[stack.length - 1],
    };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function childElements(node, local = '') {
  return (node?.children || []).filter((child) => child.local === local);
}

function firstChildElement(node, local = '') {
  return childElements(node, local)[0] || null;
}

function walkXmlNodes(node, visitor) {
  if (!node) return;
  visitor(node);
  (node.children || []).forEach((child) => walkXmlNodes(child, visitor));
}

function collectTextByLocal(node, locals = []) {
  const wanted = new Set((Array.isArray(locals) ? locals : [locals]).map(localXmlName));
  const parts = [];
  walkXmlNodes(node, (current) => {
    if (wanted.has(current.local)) {
      const text = (current.children || []).filter((child) => child.local === '#text').map((child) => child.text || '').join('');
      if (text) parts.push(text);
    }
  });
  return parts.join('');
}

function getNodePlainText(node) {
  const parts = [];
  walkXmlNodes(node, (current) => {
    if (current.local === '#text') parts.push(current.text || '');
  });
  return parts.join('');
}

function findFirstDescendant(node, local = '') {
  let found = null;
  walkXmlNodes(node, (current) => {
    if (!found && current.local === local) found = current;
  });
  return found;
}

function unwrapFirstXmlBlock(xml = '', tag = '') {
  if (!tag) return '';
  const root = parseXmlTree(xml);
  const node = findFirstDescendant(root, localXmlName(tag));
  if (!node) return '';
  return serializeXmlChildren(node);
}

function serializeXmlNode(node) {
  if (!node) return '';
  if (node.local === '#text') return decodeXmlEntities(node.text || '');
  const attrs = Object.entries(node.attrs || {}).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
  return `<${node.name}${attrs}>${serializeXmlChildren(node)}</${node.name}>`;
}

function serializeXmlChildren(node) {
  return (node?.children || []).map(serializeXmlNode).join('');
}

function normalizeLatex(text = '') {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/−/g, '-')
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/∑/g, '\\sum ')
    .replace(/∏/g, '\\prod ')
    .replace(/∫/g, '\\int ')
    .replace(/√/g, '\\sqrt')
    .replace(/∞/g, '\\infty')
    .replace(/≤/g, '\\le ')
    .replace(/≥/g, '\\ge ')
    .replace(/≠/g, '\\ne ')
    .replace(/≈/g, '\\approx ')
    .replace(/α/g, '\\alpha ')
    .replace(/β/g, '\\beta ')
    .replace(/γ/g, '\\gamma ')
    .replace(/δ/g, '\\delta ')
    .replace(/ε/g, '\\varepsilon ')
    .replace(/θ/g, '\\theta ')
    .replace(/λ/g, '\\lambda ')
    .replace(/μ/g, '\\mu ')
    .replace(/π/g, '\\pi ')
    .replace(/σ/g, '\\sigma ')
    .replace(/φ/g, '\\varphi ')
    .replace(/ω/g, '\\omega ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([_^])/g, '$1')
    .replace(/([_^])\s+\{/g, '$1{')
    .replace(/\\(frac|sqrt|sum|prod|int|lim|sin|cos|tan|ln|log)\s+\{/g, '\\$1{')
    .replace(/\\left\s+/g, '\\left')
    .replace(/\\right\s+/g, '\\right')
    .trim();
}

function latexArg(value = '') {
  const text = normalizeLatex(value);
  return text || ' ';
}

function mapOmmlOperator(value = '') {
  const v = decodeXmlEntities(String(value || '')).trim();
  const map = {
    '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod',
    '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint',
    '⋂': '\\bigcap', '⋃': '\\bigcup', '∨': '\\bigvee', '∧': '\\bigwedge',
  };
  return map[v] || v || '\\sum';
}

function mapDelimiter(value = '', fallback = '.') {
  const v = decodeXmlEntities(String(value || '')).trim();
  if (!v) return fallback;
  const map = { '(': '(', ')': ')', '[': '[', ']': ']', '{': '\\{', '}': '\\}', '|': '|', '‖': '\\|', '〈': '\\langle', '〉': '\\rangle', '〈': '\\langle', '〉': '\\rangle' };
  return map[v] || v;
}

function firstDescendantAttr(node, local = '', attrNames = ['val']) {
  const target = findFirstDescendant(node, local);
  return target ? getXmlAttr(target, attrNames) : '';
}

function renderOmmlChildren(node, options = {}) {
  const parts = [];
  (node?.children || []).forEach((child) => {
    const value = renderOmmlNode(child, options);
    if (value) parts.push(value);
  });
  return normalizeLatex(parts.join(' '));
}

function renderOmmlNode(node, options = {}) {
  if (!node) return '';
  if (node.local === '#text') return '';
  const local = node.local;
  if (/Pr$/.test(local) || ['ctrlPr', 'rPr'].includes(local)) return '';
  if (local === 't') return normalizeLatex(getNodePlainText(node));
  if (local === 'br') return ' \\\\ ';
  if (local === 'chr') return normalizeLatex(getXmlAttr(node, ['m:val', 'w:val', 'val']));
  if (['oMath', 'oMathPara', 'r', 'e', 'num', 'den', 'sub', 'sup', 'deg', 'lim', 'fName'].includes(local)) {
    return renderOmmlChildren(node, options) || normalizeLatex(collectTextByLocal(node, ['t']));
  }
  if (local === 'f') {
    const num = renderOmmlNode(firstChildElement(node, 'num')) || collectTextByLocal(firstChildElement(node, 'num'), ['t']);
    const den = renderOmmlNode(firstChildElement(node, 'den')) || collectTextByLocal(firstChildElement(node, 'den'), ['t']);
    return `\\frac{${latexArg(num)}}{${latexArg(den)}}`;
  }
  if (local === 'sSup') {
    const base = renderOmmlNode(firstChildElement(node, 'e'));
    const sup = renderOmmlNode(firstChildElement(node, 'sup'));
    return `${latexArg(base)}^{${latexArg(sup)}}`;
  }
  if (local === 'sSub') {
    const base = renderOmmlNode(firstChildElement(node, 'e'));
    const sub = renderOmmlNode(firstChildElement(node, 'sub'));
    return `${latexArg(base)}_{${latexArg(sub)}}`;
  }
  if (local === 'sSubSup') {
    const base = renderOmmlNode(firstChildElement(node, 'e'));
    const sub = renderOmmlNode(firstChildElement(node, 'sub'));
    const sup = renderOmmlNode(firstChildElement(node, 'sup'));
    return `${latexArg(base)}_{${latexArg(sub)}}^{${latexArg(sup)}}`;
  }
  if (local === 'sPre') {
    const base = renderOmmlNode(firstChildElement(node, 'e'));
    const sub = renderOmmlNode(firstChildElement(node, 'sub'));
    const sup = renderOmmlNode(firstChildElement(node, 'sup'));
    return `{}_{${latexArg(sub)}}^{${latexArg(sup)}}${latexArg(base)}`;
  }
  if (local === 'rad') {
    const deg = renderOmmlNode(firstChildElement(node, 'deg'));
    const base = renderOmmlNode(firstChildElement(node, 'e'));
    return deg ? `\\sqrt[${latexArg(deg)}]{${latexArg(base)}}` : `\\sqrt{${latexArg(base)}}`;
  }
  if (local === 'nary') {
    const pr = firstChildElement(node, 'naryPr');
    const op = mapOmmlOperator(firstDescendantAttr(pr, 'chr', ['m:val', 'w:val', 'val']));
    const sub = renderOmmlNode(firstChildElement(node, 'sub'));
    const sup = renderOmmlNode(firstChildElement(node, 'sup'));
    const expr = renderOmmlNode(firstChildElement(node, 'e'));
    let result = op;
    if (sub) result += `_{${latexArg(sub)}}`;
    if (sup) result += `^{${latexArg(sup)}}`;
    return `${result} ${latexArg(expr)}`.trim();
  }
  if (local === 'limLow') {
    const base = renderOmmlNode(firstChildElement(node, 'e'));
    const lim = renderOmmlNode(firstChildElement(node, 'lim'));
    if (/^lim$/i.test(base)) return `\\lim_{${latexArg(lim)}}`;
    return `${latexArg(base)}_{${latexArg(lim)}}`;
  }
  if (local === 'limUpp') {
    const base = renderOmmlNode(firstChildElement(node, 'e'));
    const lim = renderOmmlNode(firstChildElement(node, 'lim'));
    return `${latexArg(base)}^{${latexArg(lim)}}`;
  }
  if (local === 'func') {
    const name = normalizeLatex(renderOmmlNode(firstChildElement(node, 'fName')) || collectTextByLocal(firstChildElement(node, 'fName'), ['t']));
    const arg = renderOmmlNode(firstChildElement(node, 'e'));
    const map = { sin: '\\sin', cos: '\\cos', tan: '\\tan', cot: '\\cot', sec: '\\sec', csc: '\\csc', ln: '\\ln', log: '\\log', lim: '\\lim' };
    return `${map[name] || name} ${latexArg(arg)}`.trim();
  }
  if (local === 'd') {
    const pr = firstChildElement(node, 'dPr');
    const beg = mapDelimiter(firstDescendantAttr(pr, 'begChr', ['m:val', 'w:val', 'val']), '(');
    const end = mapDelimiter(firstDescendantAttr(pr, 'endChr', ['m:val', 'w:val', 'val']), ')');
    const elems = childElements(node, 'e').map((item) => renderOmmlNode(item)).filter(Boolean);
    const sep = normalizeLatex(firstDescendantAttr(pr, 'sepChr', ['m:val', 'w:val', 'val']) || ',');
    return `\\left${beg} ${elems.join(` ${sep} `)} \\right${end}`;
  }
  if (local === 'm') {
    const rows = childElements(node, 'mr').map((row) => childElements(row, 'e').map((cell) => latexArg(renderOmmlNode(cell))).join(' & ')).filter(Boolean);
    return rows.length ? `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}` : renderOmmlChildren(node, options);
  }
  if (local === 'eqArr') {
    const rows = childElements(node, 'e').map((row) => latexArg(renderOmmlNode(row))).filter(Boolean);
    return rows.length ? `\\begin{aligned} ${rows.join(' \\\\ ')} \\end{aligned}` : renderOmmlChildren(node, options);
  }
  if (local === 'bar') {
    const expr = renderOmmlNode(firstChildElement(node, 'e'));
    const pos = firstDescendantAttr(firstChildElement(node, 'barPr'), 'pos', ['m:val', 'w:val', 'val']);
    return /bot/i.test(pos) ? `\\underline{${latexArg(expr)}}` : `\\overline{${latexArg(expr)}}`;
  }
  if (local === 'acc') {
    const expr = renderOmmlNode(firstChildElement(node, 'e'));
    const chr = firstDescendantAttr(firstChildElement(node, 'accPr'), 'chr', ['m:val', 'w:val', 'val']);
    const map = { '^': '\\hat', 'ˆ': '\\hat', '¯': '\\bar', 'ˉ': '\\bar', '~': '\\tilde', '˜': '\\tilde', '→': '\\vec', '⃗': '\\vec', '.': '\\dot', '..': '\\ddot' };
    const cmd = map[chr] || '\\hat';
    return `${cmd}{${latexArg(expr)}}`;
  }
  if (local === 'groupChr') {
    const expr = renderOmmlNode(firstChildElement(node, 'e'));
    const pr = firstChildElement(node, 'groupChrPr');
    const chr = firstDescendantAttr(pr, 'chr', ['m:val', 'w:val', 'val']);
    const pos = firstDescendantAttr(pr, 'pos', ['m:val', 'w:val', 'val']);
    if (/[⏞︷\{]/.test(chr) || /top/i.test(pos)) return `\\overbrace{${latexArg(expr)}}`;
    if (/[⏟︸]/.test(chr) || /bot/i.test(pos)) return `\\underbrace{${latexArg(expr)}}`;
    return latexArg(expr);
  }
  if (['box', 'borderBox', 'phant'].includes(local)) return renderOmmlNode(firstChildElement(node, 'e')) || renderOmmlChildren(node, options);
  return renderOmmlChildren(node, options) || normalizeLatex(collectTextByLocal(node, ['t']));
}

function extractOmmlRunText(xml = '') {
  const root = parseXmlTree(xml);
  const text = collectTextByLocal(root, ['t']);
  return normalizeWhitespace(text);
}

function convertOmmlMathToLatex(xml = '') {
  const root = parseXmlTree(xml);
  const parts = [];
  (root.children || []).forEach((child) => {
    const value = renderOmmlNode(child);
    if (value) parts.push(value);
  });
  const rendered = normalizeLatex(parts.join(' ')) || normalizeLatex(collectTextByLocal(root, ['t']));
  return rendered;
}

function convertWordEqFieldToLatex(text = '') {
  const raw = normalizeWhitespace(text);
  if (!/^EQ\s+/i.test(raw)) return raw;
  let eq = raw.replace(/^EQ\s+/i, '').trim();
  for (let i = 0; i < 8; i += 1) {
    const before = eq;
    eq = eq.replace(/\\f\(([^,()]+),([^()]+)\)/gi, (_, a, b) => `\\frac{${a.trim()}}{${b.trim()}}`);
    eq = eq.replace(/\\r\((?:[^,()]*,)?([^()]+)\)/gi, (_, a) => `\\sqrt{${a.trim()}}`);
    eq = eq.replace(/\\s\(([^()]+)\)/gi, (_, a) => a.trim());
    eq = eq.replace(/\\i\((?:[^,()]*,)?(?:[^,()]*,)?([^()]+)\)/gi, (_, a) => `\\int ${a.trim()}`);
    if (eq === before) break;
  }
  return normalizeLatex(eq || raw);
}

function wrapInlineMath(text = '') {
  const value = normalizeLatex(text);
  if (!value) return '';
  if (/^\$[\s\S]*\$$/.test(value) || /^\\\([\s\S]*\\\)$/.test(value) || /^\\\[[\s\S]*\\\]$/.test(value)) return value;
  return `$${value}$`;
}

function parseRelationshipMap(xml = '') {
  const rels = new Map();
  const pattern = /<Relationship\b([^>]*?)\bId=("[^"]*"|'[^']*')([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(String(xml || '')))) {
    const attrSource = `${match[1] || ''} Id=${match[2] || ''} ${match[3] || ''}`;
    const attrs = parseXmlAttributes(attrSource);
    const id = attrs.Id || attrs.id || '';
    if (!id) continue;
    rels.set(id, {
      id,
      type: attrs.Type || attrs.type || '',
      target: attrs.Target || attrs.target || '',
      targetMode: attrs.TargetMode || attrs.targetMode || '',
    });
  }
  return rels;
}

function getPartRelsPath(partName = '') {
  const normalized = String(partName || '').replace(/\\/g, '/');
  const dir = path.posix.dirname(normalized);
  const base = path.posix.basename(normalized);
  return path.posix.join(dir, '_rels', `${base}.rels`);
}

function resolveRelationshipTarget(partName = '', target = '') {
  const raw = String(target || '').replace(/\\/g, '/');
  if (!raw) return '';
  if (/^[a-z]+:/i.test(raw)) return raw;
  if (raw.startsWith('/')) return raw.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(String(partName || '')), raw));
}


function getImageMagickCandidates() {
  return uniqueTruthy([
    process.env.MAGICK_CMD,
    process.env.IMAGEMAGICK_CMD,
    'magick',
    'convert',
    'C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe',
    'C:\\Program Files\\ImageMagick-7.1.0-Q16-HDRI\\magick.exe',
  ]);
}

function getFormulaConfidenceInfo(text = '') {
  const value = cleanupMathTypeLinearText(text);
  if (!value) return { level: 'missing', score: 0, reasons: ['没有可用字符序列'] };
  const reasons = [];
  let score = 0.78;
  if (/[蛠]|@B|OpI|BCp|Cpz|\$\+|\[\]|\{\}/.test(value)) { score -= 0.35; reasons.push('含 MathType 内部控制残留'); }
  if (/(?:\b[a-zA-Z]{2,}\(\)|\)\(|\d[A-Za-z]{2,}\d|[A-Za-z]\d{2,}[A-Za-z])/.test(value)) { score -= 0.18; reasons.push('上下标/函数结构疑似被线性压扁'); }
  if ((value.match(/[(){}]/g) || []).length > 18 && value.length > 80) { score -= 0.12; reasons.push('括号结构复杂'); }
  if (value.length > 140) { score -= 0.1; reasons.push('公式过长，可能包含多行推导'); }
  if (/[∑∫√]|lim|frac|sin|cos|ln|e\^|\^|_/.test(value)) score += 0.08;
  if (/^\\?vec\{?[A-Za-z]/.test(value) || /^[A-Za-z]\([^)]+\)$/.test(value)) score += 0.06;
  score = Math.max(0, Math.min(1, score));
  const level = score >= 0.72 ? 'high' : score >= 0.45 ? 'medium' : 'low';
  return { level, score: Number(score.toFixed(2)), reasons };
}

function makeFormulaPreviewFileName(index = 0, ext = '.wmf') {
  const safeExt = String(ext || '.wmf').startsWith('.') ? String(ext || '.wmf').toLowerCase() : `.${String(ext || 'wmf').toLowerCase()}`;
  return `formula-${String(index).padStart(3, '0')}${safeExt.replace(/[^.a-z0-9]/g, '') || '.wmf'}`;
}

async function tryConvertFormulaPreviewToPng(sourcePath = '', targetPath = '') {
  const commands = getImageMagickCandidates();
  const errors = [];
  for (const command of commands) {
    const args = String(command).toLowerCase().includes('convert') && !String(command).toLowerCase().includes('magick')
      ? [sourcePath, '-trim', '+repage', '-background', 'white', '-alpha', 'remove', '-alpha', 'off', targetPath]
      : [sourcePath, '-trim', '+repage', '-background', 'white', '-alpha', 'remove', '-alpha', 'off', targetPath];
    const result = await execFileWithTimeout(command, args, { timeout: 12000, maxBuffer: 2 * 1024 * 1024 });
    if (result.ok) {
      const stat = await fs.stat(targetPath).catch(() => null);
      if (stat?.isFile() && stat.size > 0) return { ok: true, command };
    }
    errors.push(`${command}: ${result.error || result.stderr || 'no-output'}`.slice(0, 180));
  }
  return { ok: false, errors };
}

async function exportMathTypeFormulaPreviews(filePath = '', buffer, docxResult = {}) {
  const placeholders = Array.isArray(docxResult?.mathType?.placeholders) ? docxResult.mathType.placeholders : [];
  const convertPngEnabled = /^1|true|yes$/i.test(String(process.env.ATTACHMENT_EXPORT_FORMULA_PNG || ''));
  const maxPngConversions = Math.max(0, Number(process.env.ATTACHMENT_FORMULA_PNG_LIMIT || 48) || 0);
  if (!placeholders.length || !Buffer.isBuffer(buffer)) return null;
  const mediaMap = readZipDataMap(buffer, (name) => /^word\/media\//i.test(name));
  const baseDir = path.join(path.dirname(filePath), 'formula-previews');
  await fs.mkdir(baseDir, { recursive: true });
  const assets = [];
  let pngCount = 0;
  let wmfCount = 0;
  let missingCount = 0;
  const seenPreviewPaths = new Map();
  for (const item of placeholders) {
    const id = String(item.index || assets.length + 1).padStart(3, '0');
    const previewPath = item.previewPath || '';
    const previewBuffer = previewPath ? mediaMap.get(previewPath) : null;
    const confidence = getFormulaConfidenceInfo(item.linear || '');
    const asset = {
      id,
      index: item.index,
      progId: item.progId || '',
      object: item.olePath || '',
      sourcePreview: previewPath,
      nativeLength: item.nativeLength || 0,
      approximateText: item.linear || '',
      confidence,
      originalPreviewPath: '',
      pngPreviewPath: '',
      relativeOriginalPreviewPath: '',
      relativePngPreviewPath: '',
    };
    if (previewBuffer) {
      const ext = path.extname(previewPath) || '.wmf';
      const originalName = makeFormulaPreviewFileName(item.index, ext);
      const originalPath = path.join(baseDir, originalName);
      if (!seenPreviewPaths.has(previewPath)) {
        await fs.writeFile(originalPath, previewBuffer).catch(() => {});
        seenPreviewPaths.set(previewPath, originalPath);
      }
      const storedOriginalPath = seenPreviewPaths.get(previewPath) || originalPath;
      asset.originalPreviewPath = storedOriginalPath;
      asset.relativeOriginalPreviewPath = path.relative(path.dirname(filePath), storedOriginalPath).replace(/\\/g, '/');
      if (/\.wmf$/i.test(ext)) wmfCount += 1;
      if (convertPngEnabled && pngCount < maxPngConversions) {
        const pngName = makeFormulaPreviewFileName(item.index, '.png');
        const pngPath = path.join(baseDir, pngName);
        const converted = await tryConvertFormulaPreviewToPng(storedOriginalPath, pngPath);
        if (converted.ok) {
          asset.pngPreviewPath = pngPath;
          asset.relativePngPreviewPath = path.relative(path.dirname(filePath), pngPath).replace(/\\/g, '/');
          pngCount += 1;
        } else if (converted.errors?.length) {
          asset.previewConversionError = converted.errors[0];
        }
      }
    } else {
      missingCount += 1;
    }
    assets.push(asset);
  }
  const manifest = {
    schemaVersion: 1,
    sourceFile: path.basename(filePath),
    generatedAt: new Date().toISOString(),
    count: assets.length,
    pngCount,
    wmfCount,
    missingCount,
    note: `MathType/OLE 公式的近似字符序列不是权威 LaTeX；WMF 原始预览是原文可视依据。PNG 转换默认关闭，可设置 ATTACHMENT_EXPORT_FORMULA_PNG=1 开启，最多转换 ${maxPngConversions} 个。`,
    assets,
  };
  const manifestPath = path.join(baseDir, 'formula-preview-manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8').catch(() => {});
  const indexMd = [
    '# MathType/OLE 公式预览索引',
    '',
    '这些公式来自 DOCX 内嵌 MathType / Equation OLE 对象。近似字符序列仅用于检索，不能当成 100% 准确 LaTeX。',
    '',
    '| 编号 | 置信度 | 近似字符 | 预览 | 对象 |',
    '|---|---:|---|---|---|',
    ...assets.map((a) => `| ${a.id} | ${a.confidence?.level || 'missing'} ${a.confidence?.score ?? 0} | ${String(a.approximateText || '').replace(/\|/g, '\\|').slice(0, 160)} | ${a.relativePngPreviewPath || a.relativeOriginalPreviewPath || ''} | ${a.object || ''} |`),
  ].join('\n');
  const indexPath = path.join(baseDir, 'formula-preview-index.md');
  await fs.writeFile(indexPath, `${indexMd}\n`, 'utf8').catch(() => {});
  return {
    dir: baseDir,
    manifestPath,
    indexPath,
    count: assets.length,
    pngCount,
    wmfCount,
    missingCount,
    assets,
  };
}

function createDocxPackageContext(buffer) {
  const dataMap = readZipDataMap(buffer, (name) => /^(word\/(?:_rels\/.*\.rels|embeddings\/.*|media\/.*)|customXml\/.*)$/i.test(name));
  const relsCache = new Map();
  return {
    dataMap,
    relsCache,
    mathTypeCount: 0,
    mathTypeApproxCount: 0,
    mathTypeMissingCount: 0,
    mathTypePlaceholders: [],
    getRels(partName = '') {
      const relsPath = getPartRelsPath(partName);
      if (relsCache.has(relsPath)) return relsCache.get(relsPath);
      const xml = dataMap.get(relsPath)?.toString('utf8') || '';
      const rels = parseRelationshipMap(xml);
      relsCache.set(relsPath, rels);
      return rels;
    },
  };
}

function isLikelyMathOleProgId(progId = '') {
  return /(?:Equation|MathType|DSMT)/i.test(String(progId || ''));
}

function extractMathTypeNativeStream(oleBuffer) {
  if (!Buffer.isBuffer(oleBuffer) || !oleBuffer.length) return Buffer.alloc(0);
  const streams = readCfbStreams(oleBuffer);
  return streams.get('Equation Native') || streams.get('\u0003Equation Native') || Buffer.alloc(0);
}

function isUsefulMathTypeCodePoint(code) {
  if (code === 0x20) return true;
  if (code >= 0x21 && code <= 0x7e) return true;
  if (code >= 0x00a0 && code <= 0xffff) return true;
  return false;
}

function cleanupMathTypeLinearText(text = '') {
  const map = {
    '−': '-',
    '∗': '*',
    '∙': '·',
    '⋅': '·',
    '≤': '≤',
    '≥': '≥',
    '≠': '≠',
    '∞': '∞',
    '∑': '∑',
    '∫': '∫',
    '⇒': '⇒',
    '⇔': '⇔',
    '→': '→',
    '⊥': '⊥',
  };
  const normalized = String(text || '')
    .split('')
    .map((ch) => map[ch] || ch)
    .join('')
    .replace(/[\u0000-\u001f]+/g, '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/[À-ÖØ-öø-ÿ]/g, '')
    .replace(/[§¡¢£¤¥¦¨©ª«¬®¯°±²³´µ¶¸¹º»¼½¾¿]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!normalized || !/[A-Za-z0-9\u4e00-\u9fff=+\-*/^_{}()（）∞∑∫√→⇒⇔≤≥≠⊥·]/.test(normalized)) return '';
  return normalized.length > 260 ? `${normalized.slice(0, 260)}…` : normalized;
}

function extractMathTypeLinearTextFromNative(nativeBuffer) {
  if (!Buffer.isBuffer(nativeBuffer) || nativeBuffer.length < 8) return '';
  const chars = [];
  for (let i = 0; i + 4 < nativeBuffer.length; i += 1) {
    if (nativeBuffer[i] !== 0x02) continue;
    const options = nativeBuffer[i + 1];
    const typeface = nativeBuffer[i + 2];
    if (typeface < 0x80 || typeface > 0x9f) continue;
    let code = 0;
    if (options & 0x04) {
      code = nativeBuffer.readUInt16LE(i + 3);
      if (!isUsefulMathTypeCodePoint(code)) continue;
      chars.push(String.fromCharCode(code));
      i += 4;
      continue;
    }
    code = nativeBuffer[i + 3];
    const endByte = nativeBuffer[i + 4];
    if (endByte !== 0 && endByte < 0x20) continue;
    if (!isUsefulMathTypeCodePoint(code)) continue;
    chars.push(String.fromCharCode(code));
    i += 4;
  }
  return cleanupMathTypeLinearText(chars.join(''));
}

function extractMathTypeOleApproxText(oleBuffer) {
  const native = extractMathTypeNativeStream(oleBuffer);
  const linear = extractMathTypeLinearTextFromNative(native);
  return {
    nativeLength: native.length,
    linear,
  };
}

function stripMathTypeControlTokens(text = '') {
  return String(text || '')
    .replace(/\\:@B/g, ' ')
    .replace(/@Bsb|@B|OpI|BCp|Cpz|s!CP|cn\/|蛠|\$\+/g, ' ')
    .replace(/:sb:/g, ' ')
    .replace(/\b(sb|Cp|Cpf|cyp|Bpx|Bpx|Up|ups|sx|sy)\b/g, ' ')
    .replace(/^[\s:;]+|[\s:;]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function protectLatexCommandsForCleanup(value = '') {
  return String(value || '')
    .replace(/\\lim\s*_?\{?([^\s{}]+)\\to\\infty\}?/g, '\\lim_{$1\\to\\infty}')
    .replace(/\\pi(\d+)\b/g, '\\frac{\\pi}{$1}');
}

function convertCommonMathTypeLinearPatterns(value = '') {
  let text = String(value || '').trim();
  const exact = new Map([
    ['x-12=y3=z-2', '\\frac{x-1}{2}=\\frac{y}{3}=z-2'],
    ['x-41=y+3-1=z-1', '\\frac{x-4}{1}=\\frac{y+3}{-1}=\\frac{z}{-1}'],
    ['2x+2y-z+23=0,3x+8y+z-18=0,{', '\\begin{cases}2x+2y-z+23=0\\\\3x+8y+z-18=0\\end{cases}'],
    ['x+y+3z=1,x-y-z=3,{', '\\begin{cases}x+y+3z=1\\\\x-y-z=3\\end{cases}'],
    ['\\pi2', '\\frac{\\pi}{2}'],
  ]);
  if (exact.has(text)) return exact.get(text);

  text = text
    .replace(/([xyz])-([0-9]+)([0-9])=([xyz])([+-]?\d+)?([+-]?\d)=([xyz])([+-]?\d+)$/g, (m, v1, c1, d1, v2, c2, d2, v3, tail) => {
      const num2 = c2 ? `${v2}${c2}` : v2;
      return `\\frac{${v1}-${c1}}{${d1}}=\\frac{${num2}}{${d2}}=${v3}${tail}`;
    })
    .replace(/^([xyz])-([0-9]+)([0-9])=([xyz])([+-]?\d+)?([+-]?\d)=([xyz])([+-]?\d+)$/g, (m, v1, c1, d1, v2, c2, d2, v3, d3) => {
      const num2 = c2 ? `${v2}${c2}` : v2;
      return `\\frac{${v1}-${c1}}{${d1}}=\\frac{${num2}}{${d2}}=\\frac{${v3}}{${d3}}`;
    });

  // Summation forms produced by MathType's linear character stream, e.g. "xnn=1\infty\sum".
  text = text.replace(/([^\s，。；;]+?)n=1\\infty\\sum/g, (_, body) => `\\sum_{n=1}^{\\infty} ${convertSeriesBody(body)}`);
  text = text.replace(/([^\s，。；;]+?)n=1∞sum/g, (_, body) => `\\sum_{n=1}^{\\infty} ${convertSeriesBody(body)}`);

  return text;
}

function convertSeriesBody(body = '') {
  let b = String(body || '').trim();
  const exact = new Map([
    ['unn', 'u_n'],
    ['un2', 'u_n^2'],
    ['anxnn', 'a_n x^n'],
    ['n2p-3', 'n^{2p-3}'],
    ['2n3n', '\\frac{2^n}{3^n}'],
    ['2n\\cdot n!nn', '\\frac{2^n\\cdot n!}{n^n}'],
    ['n3-12n3+n+3', '\\frac{n^3-1}{2n^3+n+3}'],
    ['e2n-1()', 'e^{\\frac{2}{n}}-1'],
    ['ln1+3n4()', '\\ln(1+\\frac{3}{n^4})'],
    ['3nn\\cdot 2n', '\\frac{3^n}{n\\cdot 2^n}'],
    ['1nln1+1n()', '\\frac{1}{n}\\ln(1+\\frac{1}{n})'],
    ['(-1)nsin1n', '(-1)^n\\sin\\frac{1}{n}'],
    ['-1()nlnn+1()', '\\frac{(-1)^n}{\\ln(n+1)}'],
    ['-1()n+1lnnn', '(-1)^{n+1}\\frac{\\ln n}{n}'],
    ['-1()n-132n+1', '(-1)^{n-1}\\frac{3}{2n+1}'],
    ['xnn\\cdot 3n', '\\frac{x^n}{n\\cdot 3^n}'],
    ['(-1)nx2nn\\cdot 2n', '\\frac{(-1)^n x^{2n}}{n\\cdot 2^n}'],
    ['-1()nx+2()nn', '\\frac{(-1)^n (x+2)^n}{n}'],
  ]);
  if (exact.has(b)) return exact.get(b);
  b = b
    .replace(/-1\(\)n\+1/g, '(-1)^{n+1}')
    .replace(/-1\(\)n-1/g, '(-1)^{n-1}')
    .replace(/-1\(\)n/g, '(-1)^n')
    .replace(/([a-zA-Z])nn/g, '$1^n')
    .replace(/([a-zA-Z])n2/g, '$1_n^2')
    .replace(/([a-zA-Z])n\b/g, '$1_n')
    .replace(/([a-zA-Z])([234])\b/g, '$1^$2')
    .replace(/ln/g, '\\ln ')
    .replace(/sin/g, '\\sin ');
  return b;
}

function applyMathTypeLatexHeuristics(value = '') {
  let text = String(value || '');
  text = convertCommonMathTypeLinearPatterns(text);
  text = text
    .replace(/fx,y\(\)/g, 'f(x,y)')
    .replace(/zx,y\(\)/g, 'z(x,y)')
    .replace(/Fx,y,z\(\)/g, 'F(x,y,z)')
    .replace(/\b([A-Za-z])\(([^)]*)\)\(\)/g, '$1($2)')
    .replace(/\b([+-]?\d+(?:,[+-]?\d+){1,8})\(\)/g, '($1)')
    .replace(/\b([A-Z])([+-]?\d+(?:,[+-]?\d+){1,8})\(\)/g, '$1($2)')
    .replace(/\(\)/g, '');

  text = text
    .replace(/limx,y\s*\(\)?→0,0\s*\(\)?/g, '\\lim_{(x,y)\\to(0,0)}')
    .replace(/lim([a-zA-Z])\s*→\s*∞/g, '\\lim_{$1\\to\\infty}')
    .replace(/lim([a-zA-Z])\\to\\infty/g, '\\lim_{$1\\to\\infty}')
    .replace(/∂([A-Za-z])∂([A-Za-z])/g, '\\frac{\\partial $1}{\\partial $2}')
    .replace(/([A-Za-z])'\(([^)]*)\)/g, "$1'($2)")
    .replace(/excosy/g, 'e^x\\cos y')
    .replace(/exsiny/g, 'e^x\\sin y')
    .replace(/e\^?xy/g, 'e^{xy}')
    .replace(/eusinv/g, 'e^u\\sin v')
    .replace(/eucosv/g, 'e^u\\cos v')
    .replace(/sinx\+y/g, '\\sin(x+y)')
    .replace(/cosx\+y/g, '\\cos(x+y)')
    .replace(/sinv/g, '\\sin v')
    .replace(/cosv/g, '\\cos v')
    .replace(/sinxx/g, '\\frac{\\sin x}{x}')
    .replace(/D\\int\\int/g, '\\iint_D')
    .replace(/Ω\\int\\int\\int/g, '\\iiint_\\Omega')
    .replace(/Σ\\int\\int/g, '\\iint_\\Sigma')
    .replace(/L\\int/g, '\\int_L')
    .replace(/dσ/g, 'd\\sigma')
    .replace(/\bdv\b/g, 'dV')
    .replace(/→/g, '\\to ');

  // Common variables with numeric exponents in MathType's flattened stream.
  text = text
    .replace(/([xyzt])([234])\b/g, '$1^$2')
    .replace(/([xyzt])([234])(?=[+\-*/=,)])/g, '$1^$2')
    .replace(/([abuv])n\b/g, '$1_n')
    .replace(/\bL([12])\b/g, 'L_$1')
    .replace(/\bf([xy])\b/g, 'f_$1')
    .replace(/\bF([xyz])\b/g, 'F_$1')
    .replace(/\\pi([0-9])\b/g, '\\frac{\\pi}{$1}');

  // A few high-frequency fraction repairs that come from flattened MathType streams.
  text = text
    .replace(/1-cos\(?x\^2\+y\^2\)?/g, '1-\\cos(x^2+y^2)')
    .replace(/x\^2\+y\^2\(\)/g, '(x^2+y^2)')
    .replace(/3-x\^2-y\^2/g, '\\sqrt{3-x^2-y^2}')
    .replace(/lnx\^2\+y\^2-1/g, '\\ln(x^2+y^2-1)')
    .replace(/9-x\^2-y\^2/g, '\\sqrt{9-x^2-y^2}')
    .replace(/1-x\^2-y\^2/g, '\\sqrt{1-x^2-y^2}')
    .replace(/y=1x\b/g, 'y=\\frac{1}{x}')
    .replace(/32n\+1/g, '\\frac{3}{2n+1}')
    .replace(/1n\b/g, '\\frac{1}{n}')
    .replace(/3n4\b/g, '\\frac{3}{n^4}')
    .replace(/2n\b/g, '\\frac{2}{n}');

  return protectLatexCommandsForCleanup(text)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;，。；:：])/g, '$1')
    .trim();
}

function normalizeMathTypeLinearForPrompt(text = '') {
  let value = cleanupMathTypeLinearText(text);
  if (!value) return '';
  value = stripMathTypeControlTokens(value)
    .replace(/lim([A-Za-z])→∞([A-Za-z])([A-Za-z0-9]*)/g, (_, v, base, sub) => `\\lim_{${v}\\to\\infty} ${base}${sub ? `_${sub}` : ''}`)
    .replace(/([A-Za-z])→(∞|[+-]?\d+(?:\.\d+)?)/g, '$1\\to $2')
    .replace(/([A-Za-z])([0-9]*)→/g, (_, name, sub) => sub ? `\\vec{${name}}_{${sub}}` : `\\vec{${name}}`)
    .replace(/π/g, '\\pi')
    .replace(/φ/g, '\\varphi')
    .replace(/∞/g, '\\infty')
    .replace(/∑/g, '\\sum')
    .replace(/∫/g, '\\int')
    .replace(/√/g, '\\sqrt')
    .replace(/≤/g, '\\le ')
    .replace(/≥/g, '\\ge ')
    .replace(/≠/g, '\\ne ')
    .replace(/⊥/g, '\\perp ')
    .replace(/⇒/g, '\\Rightarrow ')
    .replace(/⇔/g, '\\Leftrightarrow ')
    .replace(/·/g, '\\cdot ')
    .replace(/=([+-]?[A-Za-z0-9.]+(?:,[+-]?[A-Za-z0-9.]+){1,8})\{\}/g, '={$1}')
    .replace(/\{([+-]?[A-Za-z0-9.]+(?:,[+-]?[A-Za-z0-9.]+){1,8})\}/g, '($1)')
    .replace(/\b([A-Z])([+-]?\d+(?:,[+-]?\d+){1,8})\(\)/g, '$1($2)')
    .replace(/\s{2,}/g, ' ')
    .trim();
  value = applyMathTypeLatexHeuristics(value);
  return value.length > 320 ? `${value.slice(0, 320)}…` : value;
}

function renderMathTypeFormulaInline(id = '', approx = {}, paths = {}) {
  const value = normalizeMathTypeLinearForPrompt(approx.linear || '');
  if (value) return wrapInlineMath(value);
  return `【公式${id}待转写】`;
}

function renderEmbeddedObjectNode(node, context = {}) {
  const oleNode = findFirstDescendant(node, 'OLEObject');
  const imageNode = findFirstDescendant(node, 'imagedata') || findFirstDescendant(node, 'blip');
  const progId = getXmlAttr(oleNode, ['ProgID', 'progID', 'progId']) || 'OLEObject';
  const oleRelId = getXmlAttr(oleNode, ['r:id', 'id']);
  const imageRelId = getXmlAttr(imageNode, ['r:id', 'r:embed', 'embed', 'id']);
  const rels = context.rels || new Map();
  const partName = context.partName || 'word/document.xml';
  const oleRel = rels.get(oleRelId) || null;
  const imageRel = rels.get(imageRelId) || null;
  const olePath = oleRel ? resolveRelationshipTarget(partName, oleRel.target) : '';
  const previewPath = imageRel ? resolveRelationshipTarget(partName, imageRel.target) : '';
  const isEquation = isLikelyMathOleProgId(progId) || /Equation|oleObject/i.test(olePath);
  if (!isEquation) {
    return `[嵌入对象:${progId}${olePath ? `; object=${olePath}` : ''}${previewPath ? `; preview=${previewPath}` : ''}]`;
  }
  const pkg = context.package || null;
  const index = pkg ? (pkg.mathTypeCount += 1) : 1;
  const oleBuffer = pkg?.dataMap?.get(olePath) || Buffer.alloc(0);
  const approx = extractMathTypeOleApproxText(oleBuffer);
  const id = String(index).padStart(3, '0');
  if (pkg) {
    if (approx.linear) pkg.mathTypeApproxCount += 1;
    else pkg.mathTypeMissingCount += 1;
    pkg.mathTypePlaceholders.push({ index, progId, olePath, previewPath, nativeLength: approx.nativeLength, linear: approx.linear, confidence: getFormulaConfidenceInfo(approx.linear) });
  }
  return renderMathTypeFormulaInline(id, approx, { olePath, previewPath, confidence: getFormulaConfidenceInfo(approx.linear) });
}

function getFldCharType(node) {
  const fld = findFirstDescendant(node, 'fldChar');
  return fld ? getXmlAttr(fld, ['w:fldCharType', 'fldCharType']) : '';
}

function renderWordSymbol(node) {
  const sym = findFirstDescendant(node, 'sym') || node;
  const raw = getXmlAttr(sym, ['w:char', 'char']);
  if (!raw) return '';
  const code = Number.parseInt(raw, 16);
  if (!Number.isFinite(code)) return '';
  try { return String.fromCharCode(code); } catch { return ''; }
}

function renderWordInlineNode(node, context = {}) {
  if (!node) return '';
  if (node.local === '#text') return '';
  if (node.local === 't') return getNodePlainText(node);
  if (node.local === 'tab') return '\t';
  if (node.local === 'br' || node.local === 'cr') return '\n';
  if (node.local === 'instrText') {
    const raw = getNodePlainText(node);
    const converted = convertWordEqFieldToLatex(raw);
    return /^EQ\s+/i.test(raw.trim()) ? wrapInlineMath(converted) : converted;
  }
  if (node.local === 'sym') return renderWordSymbol(node);
  if (node.local === 'oMath' || node.local === 'oMathPara') return wrapInlineMath(renderOmmlNode(node));
  if (node.local === 'object') return renderEmbeddedObjectNode(node, context);
  if (node.local === 'p') return `\n${renderWordParagraphNode(node, context)}`;
  if (node.local === 'tbl') return `\n${renderWordTableNode(node, context)}`;
  const parts = [];
  (node.children || []).forEach((child) => {
    const value = renderWordInlineNode(child, context);
    if (value) parts.push(value);
  });
  return parts.join('');
}

function normalizeWordLine(text = '') {
  const protectedMath = protectMathSegments(String(text || '').replace(/\r\n?/g, '\n'));
  const normalized = protectedMath.text
    .replace(/[ \u00a0]{2,}/g, ' ')
    .replace(/[ \u00a0]+\n/g, '\n')
    .replace(/\n[ \u00a0]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return protectedMath.restore(normalized).trim();
}

function renderWordParagraphNode(node, context = {}) {
  const parts = [];
  let fieldInstruction = '';
  let collectingField = false;
  let skippingFieldResult = false;
  const flushInstruction = () => {
    const raw = normalizeWhitespace(fieldInstruction);
    if (!raw) return;
    const converted = convertWordEqFieldToLatex(raw);
    parts.push(/^EQ\s+/i.test(raw) ? wrapInlineMath(converted) : converted);
  };
  (node.children || []).forEach((child) => {
    const fldType = getFldCharType(child);
    if (/^begin$/i.test(fldType)) {
      fieldInstruction = '';
      collectingField = true;
      skippingFieldResult = false;
      return;
    }
    const directInstr = collectTextByLocal(child, ['instrText']);
    if (directInstr) {
      fieldInstruction += directInstr;
      if (!collectingField) {
        flushInstruction();
        fieldInstruction = '';
      }
      return;
    }
    if (/^separate$/i.test(fldType)) {
      const raw = normalizeWhitespace(fieldInstruction);
      flushInstruction();
      skippingFieldResult = /^EQ\s+/i.test(raw);
      collectingField = false;
      return;
    }
    if (/^end$/i.test(fldType)) {
      skippingFieldResult = false;
      collectingField = false;
      fieldInstruction = '';
      return;
    }
    if (skippingFieldResult) return;
    const rendered = renderWordInlineNode(child, context);
    if (rendered) parts.push(rendered);
  });
  if (fieldInstruction) flushInstruction();
  return normalizeWordLine(parts.join(''));
}

function renderWordTableNode(node, context = {}) {
  const rows = childElements(node, 'tr').map((row) => {
    const cells = childElements(row, 'tc').map((cell) => {
      const blocks = [];
      (cell.children || []).forEach((child) => {
        if (child.local === 'p') {
          const paragraph = renderWordParagraphNode(child, context);
          if (paragraph) blocks.push(paragraph);
        } else if (child.local === 'tbl') {
          const nested = renderWordTableNode(child, context);
          if (nested) blocks.push(nested);
        }
      });
      return normalizeWordLine(blocks.join(' / '));
    });
    return cells.join('\t').trim();
  }).filter(Boolean);
  return rows.join('\n');
}

function renderWordBlockNode(node, context = {}) {
  if (!node) return '';
  if (node.local === 'p') return renderWordParagraphNode(node, context);
  if (node.local === 'tbl') return renderWordTableNode(node, context);
  return '';
}

function collectWordBlocksInOrder(node, out = [], context = {}) {
  if (!node) return out;
  if (node.local === 'p' || node.local === 'tbl') {
    const rendered = renderWordBlockNode(node, context);
    if (rendered) out.push(rendered);
    return out;
  }
  (node.children || []).forEach((child) => collectWordBlocksInOrder(child, out, context));
  return out;
}

function extractStructuredTextFromWordXml(xml = '', context = {}) {
  const root = parseXmlTree(xml);
  const body = findFirstDescendant(root, 'body') || root;
  const blocks = [];
  (body.children || []).forEach((child) => collectWordBlocksInOrder(child, blocks, context));
  if (!blocks.length) collectWordBlocksInOrder(root, blocks, context);
  return normalizePlainText(blocks.join('\n'));
}

function extractParagraphTextFromWordXml(xml = '', context = {}) {
  return extractStructuredTextFromWordXml(xml, context);
}

function buildDocxMathTypeWarnings(packageContext) {
  const warnings = [];
  const count = Number(packageContext?.mathTypeCount || 0);
  if (!count) return warnings;
  const approx = Number(packageContext?.mathTypeApproxCount || 0);
  const missing = Number(packageContext?.mathTypeMissingCount || 0);
  warnings.push(`检测到 ${count} 个 MathType/Equation OLE 公式对象，已使用清爽 LaTeX 模式按原文位置插入；其中 ${approx} 个已转成 $...$，${missing} 个保留为简短待转写标记。`);
  warnings.push('MathType/OLE 公式来自老式嵌入对象，系统会尽量把可解析字符转换为 LaTeX；回答、提取题目、总结或入库时应保留这些 $...$ 公式，不要改成省略号或“缺失”。');
  warnings.push('程序仍会导出 formula-previews/formula-xxx.wmf/png 和 manifest，供少数待转写公式或复杂公式人工核对；这些诊断信息不再塞进正文。');
  const examples = (packageContext.mathTypePlaceholders || [])
    .filter((item) => item.linear)
    .slice(0, 6)
    .map((item) => `#${String(item.index).padStart(3, '0')}=${normalizeMathTypeLinearForPrompt(item.linear) || item.linear}`);
  if (examples.length) warnings.push(`MathType 转写样例：${examples.join('；')}`);
  return warnings;
}

function extractDocxTextWithDiagnostics(buffer) {
  const xmls = readZipTextMap(buffer, (name) => /^(word\/(document|footnotes|endnotes|comments|commentsExtended|glossary\/document)\.xml|word\/(header|footer)\d+\.xml|word\/charts\/chart\d+\.xml|word\/diagrams\/data\d+\.xml)$/i.test(name));
  const packageContext = createDocxPackageContext(buffer);
  const parts = [];
  const names = [
    'word/document.xml',
    ...[...xmls.keys()].filter((name) => /^word\/header\d+\.xml$/i.test(name)).sort(naturalSortByNumber),
    ...[...xmls.keys()].filter((name) => /^word\/footer\d+\.xml$/i.test(name)).sort(naturalSortByNumber),
    'word/footnotes.xml',
    'word/endnotes.xml',
    'word/comments.xml',
    'word/commentsExtended.xml',
    'word/glossary/document.xml',
    ...[...xmls.keys()].filter((name) => /^word\/charts\/chart\d+\.xml$/i.test(name)).sort(naturalSortByNumber),
    ...[...xmls.keys()].filter((name) => /^word\/diagrams\/data\d+\.xml$/i.test(name)).sort(naturalSortByNumber),
  ];
  const seen = new Set();
  names.forEach((name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const xml = xmls.get(name);
    if (!xml) return;
    const context = {
      package: packageContext,
      partName: name,
      rels: packageContext.getRels(name),
    };
    let text = extractStructuredTextFromWordXml(xml, context);
    if (!text) {
      const fallback = extractTextTags(xml, 'w:t') || extractTextTags(xml, 'a:t') || collectTextByLocal(parseXmlTree(xml), ['t']);
      text = normalizePlainText(fallback);
    }
    if (text) parts.push(name === 'word/document.xml' ? text : `【${name}】\n${text}`);
  });
  return {
    text: normalizePlainText(parts.join('\n\n')),
    warnings: buildDocxMathTypeWarnings(packageContext),
    mathType: {
      count: packageContext.mathTypeCount,
      approxCount: packageContext.mathTypeApproxCount,
      missingCount: packageContext.mathTypeMissingCount,
      highConfidenceCount: packageContext.mathTypePlaceholders.filter((item) => item.confidence?.level === 'high').length,
      needsPreviewCheckCount: packageContext.mathTypePlaceholders.filter((item) => item.confidence?.level === 'medium' || item.confidence?.level === 'low').length,
      placeholders: packageContext.mathTypePlaceholders,
    },
  };
}

function extractDocxText(buffer) {
  return extractDocxTextWithDiagnostics(buffer).text;
}

function extractTextTags(xml = '', tagName = 'a:t') {
  const escaped = tagName.replace(':', '\\:');
  const pattern = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'gi');
  const parts = [];
  let match;
  while ((match = pattern.exec(String(xml || '')))) {
    const value = decodeXmlEntities(match[1]);
    if (value) parts.push(value);
  }
  return normalizeWhitespace(parts.join('\n'));
}

function naturalSortByNumber(a, b) {
  const ax = String(a).match(/(\d+)/g)?.map(Number) || [];
  const bx = String(b).match(/(\d+)/g)?.map(Number) || [];
  for (let i = 0; i < Math.max(ax.length, bx.length); i += 1) {
    const diff = (ax[i] || 0) - (bx[i] || 0);
    if (diff) return diff;
  }
  return String(a).localeCompare(String(b));
}

function extractPptxText(buffer) {
  const xmls = readZipTextMap(buffer, (name) => /^(ppt\/slides\/slide\d+\.xml|ppt\/notesSlides\/notesSlide\d+\.xml)$/i.test(name));
  const slideNames = [...xmls.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).sort(naturalSortByNumber);
  const noteNames = [...xmls.keys()].filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name)).sort(naturalSortByNumber);
  const parts = [];
  slideNames.forEach((name, index) => {
    const text = extractTextTags(xmls.get(name), 'a:t');
    if (text) parts.push(`【幻灯片 ${index + 1}】\n${text}`);
  });
  noteNames.forEach((name, index) => {
    const text = extractTextTags(xmls.get(name), 'a:t');
    if (text) parts.push(`【备注 ${index + 1}】\n${text}`);
  });
  return normalizeWhitespace(parts.join('\n\n'));
}

function columnNameToNumber(name = '') {
  return String(name || '').toUpperCase().split('').reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0);
}

function parseWorkbookSheetNames(xmls) {
  const workbook = xmls.get('xl/workbook.xml') || '';
  const rels = xmls.get('xl/_rels/workbook.xml.rels') || '';
  const relMap = new Map();
  const relPattern = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*>/gi;
  let rel;
  while ((rel = relPattern.exec(rels))) relMap.set(rel[1], rel[2]);
  const sheetMap = new Map();
  const sheetPattern = /<sheet\b[^>]*name="([^"]+)"[^>]*(?:r:id="([^"]+)")[^>]*>/gi;
  let match;
  while ((match = sheetPattern.exec(workbook))) {
    const name = decodeXmlEntities(match[1] || '');
    const relId = match[2] || '';
    const target = relMap.get(relId) || '';
    if (target) sheetMap.set(`xl/${target.replace(/^\//, '').replace(/^xl\//, '')}`, name);
  }
  return sheetMap;
}

function extractXlsxText(buffer) {
  const xmls = readZipTextMap(buffer, (name) => /^(xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels)$/i.test(name));
  const sheetLabels = parseWorkbookSheetNames(xmls);
  const shared = [];
  const sharedXml = xmls.get('xl/sharedStrings.xml') || '';
  const siBlocks = sharedXml.match(/<si\b[\s\S]*?<\/si>/g) || [];
  siBlocks.forEach((block) => {
    const text = extractTextTags(block, 't') || extractTextTags(block, 'a:t') || stripXmlTags(block);
    shared.push(normalizeWhitespace(text));
  });
  const sheetNames = [...xmls.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort(naturalSortByNumber);
  const parts = [];
  sheetNames.forEach((name, index) => {
    const xml = xmls.get(name) || '';
    const rows = [];
    const rowBlocks = xml.match(/<row\b[\s\S]*?<\/row>/g) || [];
    rowBlocks.forEach((row) => {
      const cells = [];
      const cellBlocks = row.match(/<c\b[\s\S]*?<\/c>/g) || [];
      cellBlocks.forEach((cell) => {
        const type = (cell.match(/\bt="([^"]+)"/) || [])[1] || '';
        const ref = (cell.match(/\br="([A-Z]+)(\d+)"/) || [])[1] || '';
        const col = ref ? columnNameToNumber(ref) : cells.length + 1;
        while (cells.length < col - 1) cells.push('');
        const v = stripXmlTags((cell.match(/<v\b[^>]*>[\s\S]*?<\/v>/) || [''])[0] || '');
        const inline = extractTextTags(cell, 't');
        const formula = stripXmlTags((cell.match(/<f\b[^>]*>[\s\S]*?<\/f>/) || [''])[0] || '');
        let value = '';
        if (type === 's') value = shared[Number(v)] || '';
        else if (type === 'inlineStr' || type === 'str') value = inline || v;
        else value = v || inline;
        if (formula && value) value = `${value}（公式：${formula}）`;
        else if (formula) value = `公式：${formula}`;
        cells.push(value);
      });
      const line = cells.map((cell) => String(cell || '').trim()).join('\t').trim();
      if (line) rows.push(line);
    });
    if (rows.length) parts.push(`【工作表：${sheetLabels.get(name) || `第 ${index + 1} 个工作表`}】\n${rows.join('\n')}`);
  });
  return normalizeWhitespace(parts.join('\n\n'));
}

function extractIpynbText(buffer) {
  const data = JSON.parse(decodeTextBuffer(buffer) || '{}');
  const cells = Array.isArray(data.cells) ? data.cells : [];
  const parts = [];
  cells.forEach((cell, index) => {
    const type = cell.cell_type || 'cell';
    const source = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
    if (source.trim()) parts.push(`【${type} ${index + 1}】\n${source.trim()}`);
    const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
    const outputText = outputs.map((output) => {
      if (Array.isArray(output.text)) return output.text.join('');
      if (typeof output.text === 'string') return output.text;
      if (Array.isArray(output?.data?.['text/plain'])) return output.data['text/plain'].join('');
      if (typeof output?.data?.['text/plain'] === 'string') return output.data['text/plain'];
      return '';
    }).filter(Boolean).join('\n');
    if (outputText.trim()) parts.push(`【输出 ${index + 1}】\n${outputText.trim()}`);
  });
  return normalizePlainText(parts.join('\n\n'));
}

function extractHtmlText(buffer) {
  const html = decodeTextBuffer(buffer);
  const noScript = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const withBreaks = noScript
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t');
  return normalizePlainText(stripXmlTags(withBreaks));
}

function extractRtfText(buffer) {
  let rtf = decodeTextBuffer(buffer);
  rtf = rtf.replace(/\\par[d]?/g, '\n');
  rtf = rtf.replace(/\\line/g, '\n');
  rtf = rtf.replace(/\\tab/g, '\t');
  rtf = rtf.replace(/\\u(-?\d+)\??/g, (_, code) => {
    let n = Number(code);
    if (n < 0) n += 65536;
    try { return String.fromCharCode(n); } catch { return ''; }
  });
  rtf = rtf.replace(/\\'[0-9a-fA-F]{2}/g, (m) => String.fromCharCode(Number.parseInt(m.slice(2), 16)));
  rtf = rtf.replace(/\{\\\*[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
  rtf = rtf.replace(/\\[a-zA-Z]+-?\d* ?/g, '');
  rtf = rtf.replace(/[{}]/g, '');
  return normalizePlainText(rtf);
}

function decodePdfLiteralString(raw = '') {
  let text = String(raw || '');
  text = text.replace(/\\([nrtbf()\\])/g, (_, ch) => {
    if (ch === 'n') return '\n';
    if (ch === 'r') return '\r';
    if (ch === 't') return '\t';
    if (ch === 'b') return '\b';
    if (ch === 'f') return '\f';
    return ch;
  });
  text = text.replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(Number.parseInt(oct, 8)));
  text = text.replace(/\\\r?\n/g, '');
  return text;
}

function decodePdfHexString(raw = '') {
  const clean = String(raw || '').replace(/[^0-9a-f]/gi, '');
  if (!clean) return '';
  const even = clean.length % 2 === 0 ? clean : `${clean}0`;
  const bytes = Buffer.from(even, 'hex');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16Be(bytes.slice(2));
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.slice(2).toString('utf16le');
  const utf16BeLikely = bytes.length > 4 && bytes[0] === 0 && bytes[2] === 0 && bytes[4] === 0;
  if (utf16BeLikely) return decodeUtf16Be(bytes);
  const utf8 = bytes.toString('utf8');
  if ((utf8.match(/\uFFFD/g) || []).length < Math.max(1, utf8.length) * 0.02) return utf8;
  return bytes.toString('latin1');
}

function extractPdfTextOperators(streamText = '') {
  const source = String(streamText || '');
  const parts = [];
  let match;
  const literalPattern = /\((?:\\.|[^\\()])*\)\s*Tj/g;
  while ((match = literalPattern.exec(source))) parts.push(decodePdfLiteralString(match[0].replace(/\)\s*Tj$/, '').slice(1)));
  const hexPattern = /<([0-9a-fA-F\s]+)>\s*Tj/g;
  while ((match = hexPattern.exec(source))) parts.push(decodePdfHexString(match[1]));
  const arrayPattern = /\[((?:\s*(?:\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>|-?\d+(?:\.\d+)?))+\s*)\]\s*TJ/g;
  while ((match = arrayPattern.exec(source))) {
    const arr = match[1] || '';
    const sub = [];
    const tokenPattern = /\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>|-?\d+(?:\.\d+)?/g;
    let token;
    while ((token = tokenPattern.exec(arr))) {
      const value = token[0];
      if (value.startsWith('(')) sub.push(decodePdfLiteralString(value.slice(1, -1)));
      else if (value.startsWith('<')) sub.push(decodePdfHexString(value.slice(1, -1)));
      else if (Number(value) < -120) sub.push(' ');
    }
    if (sub.length) parts.push(sub.join(''));
  }
  return parts.join('\n');
}

function getPdfStreams(buffer) {
  const raw = buffer.toString('latin1');
  const streams = [];
  const pattern = /(<<[\s\S]{0,5000}?>>)[\r\n\s]*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match;
  while ((match = pattern.exec(raw))) {
    const dict = match[1] || '';
    const body = match[2] || '';
    const bodyBuffer = Buffer.from(body, 'latin1');
    if (/\/Image\b|\/DCTDecode\b|\/JPXDecode\b/i.test(dict)) continue;
    if (/\/FlateDecode\b/.test(dict)) {
      try {
        streams.push(zlib.inflateSync(bodyBuffer));
        continue;
      } catch {
        try {
          streams.push(zlib.inflateRawSync(bodyBuffer));
          continue;
        } catch {}
      }
    }
    streams.push(bodyBuffer);
  }
  return streams;
}

function extractPdfText(buffer) {
  const streams = getPdfStreams(buffer);
  const parts = [];
  for (const stream of streams) {
    const text = extractPdfTextOperators(stream.toString('latin1'));
    if (text) parts.push(text);
  }
  const joined = normalizeWhitespace(parts.join('\n'));
  if (joined.length >= 8) return joined;
  const rawFallback = extractPdfTextOperators(buffer.toString('latin1')) || extractPrintableStrings(buffer, { minLength: 8, maxLines: 3000 });
  return normalizeWhitespace(rawFallback);
}

function extractHeadings(text = '') {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const headings = [];
  for (const line of lines) {
    if (headings.length >= 40) break;
    if (/^#{1,6}\s+/.test(line) || /^第[一二三四五六七八九十百\d]+[章节部分]/.test(line) || /^\d+(?:\.\d+)*[、.)）\s]+\S/.test(line)) {
      headings.push(line.slice(0, 120));
      continue;
    }
    if (line.length <= 36 && /[\u4e00-\u9fa5A-Za-z]/.test(line) && !/[。！？.!?；;]/.test(line)) headings.push(line);
  }
  return [...new Set(headings)].slice(0, 40);
}

function chunkText(text = '', options = {}) {
  const size = Number(options.size || CHUNK_SIZE);
  const overlap = Number(options.overlap || CHUNK_OVERLAP);
  const source = String(text || '');
  if (!source) return [];
  const chunks = [];
  let start = 0;
  while (start < source.length && chunks.length < 200) {
    let end = Math.min(source.length, start + size);
    if (end < source.length) {
      const boundary = source.lastIndexOf('\n\n', end);
      if (boundary > start + size * 0.55) end = boundary;
      else {
        const lineBoundary = source.lastIndexOf('\n', end);
        if (lineBoundary > start + size * 0.6) end = lineBoundary;
      }
    }
    const textPart = source.slice(start, end).trim();
    if (textPart) chunks.push({ index: chunks.length, start, end, text: textPart, preview: textPart.slice(0, 360) });
    if (end >= source.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function buildExtractionPayload(parser, text, extra = {}) {
  const normalized = normalizePlainText(text);
  const truncated = truncateText(normalized);
  const chunks = chunkText(normalized);
  const headings = extractHeadings(normalized);
  return {
    ok: Boolean(normalized),
    status: normalized ? (truncated.truncated ? 'parsed_truncated' : 'parsed') : 'empty',
    parser,
    text: truncated.text,
    fullText: normalized,
    fullLength: normalized.length,
    truncated: truncated.truncated,
    chunkCount: chunks.length,
    chunks,
    headings,
    warnings: Array.isArray(extra.warnings) ? extra.warnings.filter(Boolean) : [],
    mathType: extra.mathType || null,
    formulaAssets: extra.formulaAssets || null,
    formulaAssetCount: Number(extra.formulaAssets?.count || 0),
    formulaPreviewDir: extra.formulaAssets?.dir || '',
    formulaManifestPath: extra.formulaAssets?.manifestPath || '',
    message: normalized
      ? (truncated.truncated ? `已解析文本，原文 ${normalized.length} 字，发送上下文已截断。` : `已解析文本 ${normalized.length} 字。`)
      : '没有从附件中提取到可用文本。扫描版 PDF 或图片型文档需要 OCR。',
  };
}

async function extractAttachmentText(filePath = '', metadata = {}) {
  const startedAt = Date.now();
  const name = metadata.originalName || metadata.name || metadata.fileName || filePath;
  const type = String(metadata.type || '').toLowerCase();
  const ext = getExtension(name, type);
  const warnings = [];
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { ok: false, status: 'failed', error: '附件不是普通文件', text: '', elapsedMs: Date.now() - startedAt };
    if (type.startsWith('image/') || IMAGE_EXTENSIONS.has(ext) || metadata.kind === 'image') {
      return {
        ok: false,
        status: 'unsupported',
        parser: 'image-no-ocr',
        text: '',
        message: '图片附件不走本地文本解析；当前工程不会对截图做 OCR。请使用支持视觉输入的模型/API，或把截图题目转成文字/PDF 后再提问。',
        warnings: ['图片附件已保存并可预览，但没有本地 OCR 文本结果。'],
        elapsedMs: Date.now() - startedAt,
      };
    }
    if (stat.size > MAX_SOURCE_BYTES) {
      return {
        ok: false,
        status: 'too_large',
        parser: 'size-guard',
        text: '',
        message: `文件超过 ${(MAX_SOURCE_BYTES / 1024 / 1024).toFixed(0)}MB，已跳过自动解析。`,
        size: stat.size,
        elapsedMs: Date.now() - startedAt,
      };
    }
    const buffer = await fs.readFile(filePath);
    let parser = '';
    let extracted = '';
    if (ext === '.ipynb') {
      parser = 'jupyter-notebook';
      extracted = extractIpynbText(buffer);
    } else if (ext === '.rtf' || type.includes('rtf')) {
      parser = 'rtf-basic';
      extracted = extractRtfText(buffer);
    } else if (ext === '.html' || ext === '.htm') {
      parser = 'html-text';
      extracted = extractHtmlText(buffer);
    } else if (TEXT_EXTENSIONS.has(ext) || type.startsWith('text/') || (!looksBinary(buffer) && !OFFICE_OPEN_XML_EXTENSIONS.has(ext) && ext !== '.pdf')) {
      parser = 'plain-text';
      extracted = decodeTextBuffer(buffer);
    } else if (ext === '.docx') {
      parser = 'docx-openxml-mathtype-clean-latex';
      const docxResult = extractDocxTextWithDiagnostics(buffer);
      extracted = docxResult.text;
      warnings.push(...(docxResult.warnings || []));
      metadata.__docxMathType = docxResult.mathType || null;
      metadata.__formulaAssets = await exportMathTypeFormulaPreviews(filePath, buffer, docxResult).catch((error) => ({
        count: 0,
        pngCount: 0,
        warning: `MathType 公式预览导出失败：${error?.message || String(error)}`,
      }));
      if (metadata.__formulaAssets?.count) {
        warnings.push(`已导出 ${metadata.__formulaAssets.count} 个 MathType/OLE 公式原始预览到 formula-previews；PNG ${metadata.__formulaAssets.pngCount || 0} 个。`);
        warnings.push('MathType/OLE 公式预览已导出，可用于核对少数待转写公式；正文默认使用清爽 LaTeX 模式。');
      } else if (metadata.__formulaAssets?.warning) {
        warnings.push(metadata.__formulaAssets.warning);
      }
    } else if (ext === '.pptx') {
      parser = 'pptx-openxml';
      extracted = extractPptxText(buffer);
    } else if (ext === '.xlsx') {
      parser = 'xlsx-openxml';
      extracted = extractXlsxText(buffer);
    } else if (ext === '.pdf' || type === 'application/pdf') {
      parser = 'pdf-basic-stream';
      extracted = extractPdfText(buffer);
      if (!extracted || extracted.length < 40) warnings.push('PDF 可能是扫描件或使用复杂字体编码，本地基础解析器只能提取可复制文本。');
    } else if (ext === '.doc') {
      const external = await tryExternalLegacyDocText(filePath, { ...metadata, fileName: name });
      if (external.ok && external.text) {
        parser = external.parser || 'doc-external-converter';
        warnings.push(...(external.warnings || []));
        extracted = external.text;
      } else {
        parser = isOleCompoundFile(buffer) ? 'doc-legacy-cfb-text' : 'doc-legacy-auto';
        warnings.push('旧版 .doc 未能通过外部转换器读取，已启用内置二进制兜底解析；复杂 Word 二进制排版可能无法还原。');
        warnings.push(...(external.warnings || []));
        if (Array.isArray(external.errors) && external.errors.length) warnings.push(`外部转换器诊断：${external.errors.slice(0, 3).join('；')}`);
        extracted = extractLegacyDocText(buffer);
        if (!isReadableExtractedText(extracted, { minUsefulChars: 16 })) {
          return {
            ...makeUnusableDocPayload('doc-legacy-unreadable', { warnings }),
            elapsedMs: Date.now() - startedAt,
          };
        }
      }
    } else if (LEGACY_BINARY_EXTENSIONS.has(ext)) {
      parser = 'legacy-office-binary-text';
      warnings.push('旧版 Office 二进制格式已使用 UTF-16/可打印字符串兜底提取，正文和公式可能不完整。');
      extracted = extractLegacyOfficeBinaryText(buffer);
    } else {
      return {
        ok: false,
        status: 'unsupported',
        parser: 'unsupported',
        text: '',
        message: '当前附件类型没有可用的本地文本解析器。',
        elapsedMs: Date.now() - startedAt,
      };
    }
    const payload = buildExtractionPayload(parser, extracted, {
      warnings,
      mathType: metadata.__docxMathType || null,
      formulaAssets: metadata.__formulaAssets || null,
    });
    return {
      ...payload,
      elapsedMs: Date.now() - startedAt,
      message: payload.ok ? payload.message : '没有从附件中提取到可用文本。扫描版 PDF 或图片型文档需要 OCR。',
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      parser: 'error',
      text: '',
      error: error?.message || String(error),
      message: `附件解析失败：${error?.message || String(error)}`,
      elapsedMs: Date.now() - startedAt,
    };
  }
}

module.exports = {
  extractAttachmentText,
  _internals: {
    decodeTextBuffer,
    readZipEntries,
    readZipEntryData,
    readZipDataMap,
    parseRelationshipMap,
    createDocxPackageContext,
    extractDocxText,
    extractDocxTextWithDiagnostics,
    extractMathTypeOleApproxText,
    extractMathTypeLinearTextFromNative,
    normalizeMathTypeLinearForPrompt,
    getFormulaConfidenceInfo,
    exportMathTypeFormulaPreviews,
    extractPptxText,
    extractXlsxText,
    extractPdfText,
    extractIpynbText,
    extractRtfText,
    extractHtmlText,
    extractLegacyDocText,
    extractLegacyOfficeBinaryText,
    extractUtf16LeStrings,
    convertOmmlMathToLatex,
    convertWordEqFieldToLatex,
    protectMathSegments,
    safeSliceMathAware,
    chunkText,
    normalizeWhitespace,
    normalizePlainText,
    getTextQualityMetrics,
    isReadableExtractedText,
    tryExternalLegacyDocText,
  },
};
