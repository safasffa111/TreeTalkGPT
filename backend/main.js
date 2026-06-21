const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { pathToFileURL } = require('url');
const { extractAttachmentText } = require('./attachment-text-extractor');
const {
  collectAttachmentIdsFromJsonFiles,
  deleteAttachmentDirectories,
  isPathInside,
  normalizeAttachmentIds,
} = require('./local-data-deletion');

const isWindows = process.platform === 'win32';
const legacyUserDataPath = app.getPath('userData');
const windowsPreferredDataPath = 'D:\\TreeTalkDesktopData';
const windowsFallbackDataPath = path.join(app.getPath('documents'), 'TreeTalkDesktopData');
const defaultUnifiedUserDataPath = isWindows
  ? (fsSync.existsSync('D:\\') ? windowsPreferredDataPath : windowsFallbackDataPath)
  : path.join(app.getPath('documents'), 'TreeTalkDesktopData');
const unifiedUserDataPath = path.resolve(
  String(process.env.TREE_TALK_DATA_DIR || defaultUnifiedUserDataPath).trim() || defaultUnifiedUserDataPath
);
const userDataMigrationMarkerName = '.tree-talk-data-root.json';
const userDataMigrationVersion = 1;
const persistentUserDataEntries = [
  'learning-sessions',
  'learning-attachments',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Preferences',
  'Local State',
];

let mainWindow = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

// Set this before Electron becomes ready so Chromium storage (including
// localStorage) and the application's own JSON/attachment data share one root.
app.setPath('userData', unifiedUserDataPath);

function normalizePathForComparison(value = '') {
  const normalized = path.resolve(String(value || '')).replace(/[\\/]+$/, '');
  return isWindows ? normalized.toLowerCase() : normalized;
}

async function prepareUnifiedUserData() {
  await fs.mkdir(unifiedUserDataPath, { recursive: true });
  const markerPath = path.join(unifiedUserDataPath, userDataMigrationMarkerName);
  const existingMarker = await readJsonFile(markerPath, null);
  if (Number(existingMarker?.migrationVersion || 0) >= userDataMigrationVersion) {
    return { ...existingMarker, markerPath, skipped: true };
  }

  const sourcePath = path.resolve(legacyUserDataPath);
  const targetPath = path.resolve(unifiedUserDataPath);
  const migratedEntries = [];
  const migrationErrors = [];
  const samePath = normalizePathForComparison(sourcePath) === normalizePathForComparison(targetPath);

  if (!samePath) {
    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    if (sourceStat?.isDirectory()) {
      for (const entryName of persistentUserDataEntries) {
        const sourceEntry = path.join(sourcePath, entryName);
        const targetEntry = path.join(targetPath, entryName);
        const entryStat = await fs.stat(sourceEntry).catch(() => null);
        if (!entryStat) continue;
        try {
          await fs.cp(sourceEntry, targetEntry, {
            recursive: entryStat.isDirectory(),
            force: false,
            errorOnExist: false,
          });
          migratedEntries.push(entryName);
        } catch (error) {
          migrationErrors.push({ entryName, error: error?.message || String(error) });
        }
      }
    }
  }

  const migrationResult = {
    schemaVersion: 1,
    migrationVersion: migrationErrors.length ? 0 : userDataMigrationVersion,
    sourcePath,
    targetPath,
    migratedEntries,
    errors: migrationErrors,
    completedAt: new Date().toISOString(),
  };
  await writeJsonFile(markerPath, migrationResult);
  return { ...migrationResult, markerPath };
}

function normalizeChatCompletionsUrl(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

function pickAssistantText(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const content = choice?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof data?.output_text === 'string') return data.output_text;
  return '';
}


function messageContentHasNonTextParts(content) {
  return Array.isArray(content) && content.some((part) => {
    if (!part || typeof part !== 'object') return false;
    const type = String(part.type || '').trim();
    return type && type !== 'text';
  });
}

function convertMessageContentToTextOnly(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  const textParts = [];
  let imageCount = 0;
  let fileCount = 0;
  content.forEach((part) => {
    if (typeof part === 'string') {
      if (part.trim()) textParts.push(part);
      return;
    }
    if (!part || typeof part !== 'object') return;
    const type = String(part.type || '').trim();
    if (type === 'text') {
      if (typeof part.text === 'string' && part.text.trim()) textParts.push(part.text);
      return;
    }
    if (type === 'image_url' || type === 'input_image') {
      imageCount += 1;
      return;
    }
    fileCount += 1;
  });
  const notices = [];
  if (imageCount) {
    notices.push(`【图片附件兼容说明】当前 API 接口不支持 image_url 多模态消息字段，本次请求已自动改为纯文本模式；${imageCount} 个图片附件未作为视觉输入发送，请仅依据附件文本、文件名、本地保存路径和用户问题作答。`);
  }
  if (fileCount) {
    notices.push(`【附件兼容说明】当前 API 接口不支持非文本消息字段，本次请求已忽略 ${fileCount} 个非文本消息块，只发送可解析的文本上下文。`);
  }
  return [...textParts, ...notices].filter(Boolean).join('\n\n');
}

function convertMessagesToTextOnly(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    ...message,
    content: convertMessageContentToTextOnly(message?.content),
  }));
}

function messagesHaveNonTextParts(messages = []) {
  return (Array.isArray(messages) ? messages : []).some((message) => messageContentHasNonTextParts(message?.content));
}

function isImagePartUnsupportedError(message = '') {
  return /unknown variant [`']?image_url|expected [`']?text|image_url.*expected|unsupported.*image|content.*text/i.test(String(message || ''));
}

async function postChatCompletion({ url, apiKey, model, messages, temperature }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: Number.isFinite(temperature) ? temperature : 0.35,
      stream: false,
    }),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { response, text, data };
}

function extractApiErrorMessage(result = {}) {
  return result?.data?.error?.message || result?.data?.message || result?.text || `HTTP ${result?.response?.status || ''}`.trim();
}


const learningSessionSchemaVersion = 1;

function getLearningSessionsDir() {
  return path.join(app.getPath('userData'), 'learning-sessions');
}

function getCurrentLearningSessionPath() {
  return path.join(getLearningSessionsDir(), 'current-session.json');
}

function getLearningSessionArchiveDir() {
  return path.join(getLearningSessionsDir(), 'sessions');
}

function getLearningSessionIndexPath() {
  return path.join(getLearningSessionsDir(), 'sessions-index.json');
}

function sanitizeSessionId(sessionId = '') {
  const safe = String(sessionId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96);
  return safe || `session-${Date.now()}`;
}

function getLearningSessionArchivePath(sessionId = '') {
  return path.join(getLearningSessionArchiveDir(), `${sanitizeSessionId(sessionId)}.json`);
}

function getLearningAttachmentsDir() {
  return path.join(app.getPath('userData'), 'learning-attachments');
}


const ATTACHMENT_EXTRACTION_CACHE_VERSION = '2026-06-21-docx-mathtype-clean-latex-v4';

function getAttachmentExtractionCacheDir() {
  return path.join(getLearningAttachmentsDir(), '.extraction-cache');
}

async function readJsonFile(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, data = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer || Buffer.alloc(0)).digest('hex');
}

function compactExtractionForMetadata(extraction = {}, overrides = {}) {
  return {
    status: extraction?.status || 'unknown',
    parser: extraction?.parser || '',
    message: extraction?.message || extraction?.error || '',
    fullLength: Number(extraction?.fullLength || extraction?.text?.length || 0),
    truncated: Boolean(extraction?.truncated),
    elapsedMs: Number(extraction?.elapsedMs || 0),
    chunkCount: Number(extraction?.chunkCount || 0),
    headings: Array.isArray(extraction?.headings) ? extraction.headings.slice(0, 40) : [],
    warnings: Array.isArray(extraction?.warnings) ? extraction.warnings.slice(0, 16) : [],
    mathType: extraction?.mathType ? {
      count: Number(extraction.mathType.count || 0),
      approxCount: Number(extraction.mathType.approxCount || 0),
      missingCount: Number(extraction.mathType.missingCount || 0),
      highConfidenceCount: Number(extraction.mathType.highConfidenceCount || 0),
      needsPreviewCheckCount: Number(extraction.mathType.needsPreviewCheckCount || 0),
    } : null,
    formulaAssetCount: Number(extraction?.formulaAssetCount || extraction?.formulaAssets?.count || 0),
    formulaPreviewDir: overrides.formulaPreviewDir || extraction?.formulaPreviewDir || extraction?.formulaAssets?.dir || '',
    formulaManifestPath: overrides.formulaManifestPath || extraction?.formulaManifestPath || extraction?.formulaAssets?.manifestPath || '',
    cacheHit: Boolean(overrides.cacheHit),
    contentHash: overrides.contentHash || extraction?.contentHash || '',
    extractedTextPath: overrides.extractedTextPath || extraction?.extractedTextPath || '',
    extractedTextFullPath: overrides.extractedTextFullPath || extraction?.extractedTextFullPath || '',
    extractedChunksPath: overrides.extractedChunksPath || extraction?.extractedChunksPath || '',
    extractedAt: overrides.extractedAt || new Date().toISOString(),
    cacheVersion: overrides.cacheVersion || extraction?.cacheVersion || ATTACHMENT_EXTRACTION_CACHE_VERSION,
  };
}

function resolvePackagedBackendFile(fileName = '') {
  const normalPath = path.join(__dirname, fileName);
  if (!app.isPackaged) return normalPath;
  const asarSegment = `${path.sep}app.asar${path.sep}`;
  if (!normalPath.includes(asarSegment)) return normalPath;
  const unpackedPath = normalPath.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`);
  return fsSync.existsSync(unpackedPath) ? unpackedPath : normalPath;
}

function runExtractionWorker(filePath = '', metadata = {}, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 30000);
  return new Promise((resolve) => {
    let settled = false;
    const workerPath = resolvePackagedBackendFile('attachment-extraction-worker.js');
    const worker = new Worker(workerPath, { workerData: { filePath, metadata } });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => {});
      resolve({
        ok: false,
        status: 'timeout',
        parser: 'worker-timeout',
        text: '',
        message: `附件解析超过 ${Math.round(timeoutMs / 1000)} 秒，已中止。`,
      });
    }, timeoutMs);
    worker.once('message', (message = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      resolve(message.result || message || { ok: false, status: 'failed', parser: 'worker-empty', text: '', message: '附件解析工作线程未返回结果。' });
    });
    worker.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      resolve({ ok: false, status: 'failed', parser: 'worker-error', text: '', message: `附件解析工作线程失败：${error?.message || String(error)}` });
    });
    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, status: 'failed', parser: 'worker-exit', text: '', message: `附件解析工作线程提前退出：${code}` });
    });
  });
}

async function copyFileIfExists(source = '', target = '') {
  if (!source || !target) return false;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    return true;
  } catch {
    return false;
  }
}

async function copyDirIfExists(source = '', target = '') {
  if (!source || !target) return false;
  try {
    const stat = await fs.stat(source).catch(() => null);
    if (!stat?.isDirectory()) return false;
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function writeExtractionArtifacts(dir = '', extraction = {}, contentHash = '') {
  const fullText = extraction?.fullText || extraction?.text || '';
  const sendText = extraction?.text || '';
  const extractedTextPath = sendText ? path.join(dir, 'extracted-text.txt') : '';
  const extractedTextFullPath = fullText ? path.join(dir, 'extracted-text-full.txt') : '';
  const extractedChunksPath = Array.isArray(extraction?.chunks) && extraction.chunks.length ? path.join(dir, 'extracted-chunks.json') : '';
  if (extractedTextPath) await fs.writeFile(extractedTextPath, sendText, 'utf8');
  if (extractedTextFullPath) await fs.writeFile(extractedTextFullPath, fullText, 'utf8');
  if (extractedChunksPath) {
    await writeJsonFile(extractedChunksPath, {
      schemaVersion: 1,
      contentHash,
      chunkSize: 7000,
      chunkCount: extraction.chunks.length,
      chunks: extraction.chunks,
    });
  }
  return { extractedTextPath, extractedTextFullPath, extractedChunksPath };
}

async function readCachedExtraction(contentHash = '') {
  if (!contentHash) return null;
  const cacheDir = path.join(getAttachmentExtractionCacheDir(), contentHash);
  const metadataPath = path.join(cacheDir, 'extraction.json');
  const meta = await readJsonFile(metadataPath, null);
  if (!meta?.status) return null;
  if (meta.cacheVersion !== ATTACHMENT_EXTRACTION_CACHE_VERSION) return null;
  let text = '';
  let fullText = '';
  try { text = await fs.readFile(path.join(cacheDir, 'extracted-text.txt'), 'utf8'); } catch {}
  try { fullText = await fs.readFile(path.join(cacheDir, 'extracted-text-full.txt'), 'utf8'); } catch {}
  if (!text && !fullText && meta.status?.startsWith?.('parsed')) return null;
  const cachedFormulaDir = path.join(cacheDir, 'formula-previews');
  const formulaDirStat = await fs.stat(cachedFormulaDir).catch(() => null);
  const formulaPreviewDir = formulaDirStat?.isDirectory() ? cachedFormulaDir : (meta.formulaPreviewDir || '');
  const formulaManifestPath = formulaPreviewDir ? path.join(formulaPreviewDir, 'formula-preview-manifest.json') : (meta.formulaManifestPath || '');
  return { ...meta, formulaPreviewDir, formulaManifestPath, text: text || fullText || '', fullText: fullText || text || '', cacheDir };
}

async function writeCachedExtraction(contentHash = '', extraction = {}) {
  if (!contentHash || !extraction) return null;
  const cacheDir = path.join(getAttachmentExtractionCacheDir(), contentHash);
  await fs.mkdir(cacheDir, { recursive: true });
  const artifacts = await writeExtractionArtifacts(cacheDir, extraction, contentHash);
  let cachedFormulaPreviewDir = '';
  let cachedFormulaManifestPath = '';
  const sourceFormulaDir = extraction.formulaPreviewDir || extraction.formulaAssets?.dir || '';
  if (sourceFormulaDir) {
    const targetFormulaDir = path.join(cacheDir, 'formula-previews');
    if (await copyDirIfExists(sourceFormulaDir, targetFormulaDir)) {
      cachedFormulaPreviewDir = targetFormulaDir;
      cachedFormulaManifestPath = path.join(targetFormulaDir, 'formula-preview-manifest.json');
    }
  }
  const meta = compactExtractionForMetadata(extraction, {
    contentHash,
    extractedTextPath: artifacts.extractedTextPath,
    extractedTextFullPath: artifacts.extractedTextFullPath,
    extractedChunksPath: artifacts.extractedChunksPath,
    formulaPreviewDir: cachedFormulaPreviewDir || extraction.formulaPreviewDir || extraction.formulaAssets?.dir || '',
    formulaManifestPath: cachedFormulaManifestPath || extraction.formulaManifestPath || extraction.formulaAssets?.manifestPath || '',
  });
  await writeJsonFile(path.join(cacheDir, 'extraction.json'), meta);
  return { ...meta, cacheDir, text: extraction.text || '', fullText: extraction.fullText || extraction.text || '' };
}

function sanitizeAttachmentFileName(name = '') {
  const raw = String(name || 'attachment').trim() || 'attachment';
  const safe = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 140)
    .trim();
  return safe || 'attachment';
}

function decodeDataUrl(dataUrl = '') {
  const text = String(dataUrl || '');
  const match = text.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  const isBase64 = Boolean(match[2]);
  const body = match[3] || '';
  try {
    return isBase64 ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
  } catch {
    return null;
  }
}

async function saveLocalAttachment(payload = {}) {
  try {
    await fs.mkdir(getLearningAttachmentsDir(), { recursive: true });
    const attachmentId = sanitizeSessionId(payload.id || `att-${Date.now()}`);
    const fileName = sanitizeAttachmentFileName(payload.name || payload.filename || 'attachment');
    const dir = path.join(getLearningAttachmentsDir(), attachmentId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    const dataBuffer = decodeDataUrl(payload.dataUrl || '');
    const text = typeof payload.text === 'string' ? payload.text : '';
    if (dataBuffer) {
      await fs.writeFile(filePath, dataBuffer);
    } else if (text) {
      await fs.writeFile(filePath, text, 'utf8');
    } else {
      await fs.writeFile(filePath, Buffer.alloc(0));
    }

    const savedBuffer = dataBuffer || (text ? Buffer.from(text, 'utf8') : Buffer.alloc(0));
    const contentHash = sha256Buffer(savedBuffer);
    const metadataPath = path.join(dir, 'metadata.json');
    const metadata = {
      id: attachmentId,
      originalName: payload.name || payload.filename || fileName,
      fileName,
      type: payload.type || 'application/octet-stream',
      kind: payload.kind || 'file',
      size: Number(payload.size || savedBuffer.length || 0),
      savedAt: new Date().toISOString(),
      filePath,
      contentHash,
    };

    let extraction = null;
    let extractedTextPath = '';
    let extractedTextFullPath = '';
    let extractedChunksPath = '';
    let extractedText = '';
    let extractedTextPreview = '';
    const shouldExtract = metadata.kind !== 'image';
    if (!shouldExtract) {
      extraction = compactExtractionForMetadata({
        ok: false,
        status: 'unsupported',
        parser: 'image-no-ocr',
        text: '',
        message: '图片附件不走本地文本解析；当前工程不会对截图做 OCR。请使用支持视觉输入的模型/API，或把截图题目转成文字/PDF 后再提问。',
        warnings: ['图片附件已保存并可预览，但没有本地 OCR 文本结果。'],
        elapsedMs: 0,
        chunkCount: 0,
        headings: [],
      }, {
        cacheHit: false,
        contentHash,
        extractedAt: new Date().toISOString(),
      });
      metadata.extraction = extraction;
    }
    if (shouldExtract) {
      const cached = await readCachedExtraction(contentHash);
      if (cached) {
        const copiedTextPath = path.join(dir, 'extracted-text.txt');
        const copiedFullPath = path.join(dir, 'extracted-text-full.txt');
        const copiedChunksPath = path.join(dir, 'extracted-chunks.json');
        const cacheTextPath = path.join(cached.cacheDir, 'extracted-text.txt');
        const cacheFullPath = path.join(cached.cacheDir, 'extracted-text-full.txt');
        const cacheChunksPath = path.join(cached.cacheDir, 'extracted-chunks.json');
        if (await copyFileIfExists(cacheTextPath, copiedTextPath)) extractedTextPath = copiedTextPath;
        if (await copyFileIfExists(cacheFullPath, copiedFullPath)) extractedTextFullPath = copiedFullPath;
        if (await copyFileIfExists(cacheChunksPath, copiedChunksPath)) extractedChunksPath = copiedChunksPath;
        if (cached.formulaPreviewDir) {
          const copiedFormulaDir = path.join(dir, 'formula-previews');
          if (await copyDirIfExists(cached.formulaPreviewDir, copiedFormulaDir)) {
            cached.formulaPreviewDir = copiedFormulaDir;
            cached.formulaManifestPath = path.join(copiedFormulaDir, 'formula-preview-manifest.json');
          }
        }
        extractedText = cached.text || cached.fullText || '';
        extractedTextPreview = extractedText ? extractedText.slice(0, 1600) : '';
        extraction = compactExtractionForMetadata(cached, {
          cacheHit: true,
          contentHash,
          extractedTextPath,
          extractedTextFullPath,
          extractedChunksPath,
          extractedAt: new Date().toISOString(),
        });
      } else {
        extraction = await runExtractionWorker(filePath, metadata, { timeoutMs: 35000 });
        // If worker threads are unavailable in a special environment, fall back to the local parser.
        if (extraction?.parser === 'worker-error' && /Cannot find module|worker/i.test(extraction?.message || '')) {
          extraction = await extractAttachmentText(filePath, metadata);
        }
        extractedText = extraction?.text || '';
        extractedTextPreview = extractedText ? extractedText.slice(0, 1600) : '';
        if (extraction?.ok || extractedText) {
          const artifacts = await writeExtractionArtifacts(dir, extraction, contentHash);
          extractedTextPath = artifacts.extractedTextPath;
          extractedTextFullPath = artifacts.extractedTextFullPath;
          extractedChunksPath = artifacts.extractedChunksPath;
          await writeCachedExtraction(contentHash, extraction);
        }
        extraction = compactExtractionForMetadata(extraction, {
          cacheHit: false,
          contentHash,
          extractedTextPath,
          extractedTextFullPath,
          extractedChunksPath,
          extractedAt: new Date().toISOString(),
        });
      }
      metadata.extraction = extraction;
    }

    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}
`, 'utf8');
    return {
      ok: true,
      id: attachmentId,
      name: fileName,
      filePath,
      fileUrl: pathToFileURL(filePath).toString(),
      relativePath: path.relative(getLearningAttachmentsDir(), filePath),
      metadataPath,
      savedAt: metadata.savedAt,
      contentHash,
      extraction: metadata.extraction || null,
      extractionStatus: metadata.extraction?.status || '',
      extractionParser: metadata.extraction?.parser || '',
      extractionMessage: metadata.extraction?.message || '',
      extractionWarnings: metadata.extraction?.warnings || [],
      extractionHeadings: metadata.extraction?.headings || [],
      extractionChunkCount: metadata.extraction?.chunkCount || 0,
      extractedText,
      extractedTextPreview,
      extractedTextPath,
      extractedTextFullPath,
      extractedTextRelativePath: extractedTextPath ? path.relative(getLearningAttachmentsDir(), extractedTextPath) : '',
      extractedTextFullRelativePath: extractedTextFullPath ? path.relative(getLearningAttachmentsDir(), extractedTextFullPath) : '',
      extractedChunksPath,
      extractedChunksRelativePath: extractedChunksPath ? path.relative(getLearningAttachmentsDir(), extractedChunksPath) : '',
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function openLocalAttachment(payload = {}) {
  try {
    const filePath = String(payload.filePath || '').trim();
    if (!filePath) return { ok: false, error: '缺少附件路径' };
    const root = path.resolve(getLearningAttachmentsDir());
    const target = path.resolve(filePath);
    if (!isPathInside(root, target)) return { ok: false, error: '附件路径不在本地附件目录内' };
    const errorMessage = await shell.openPath(target);
    if (errorMessage) return { ok: false, error: errorMessage, filePath: target };
    return { ok: true, filePath: target };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}


function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function ensureLearningSessionsDir() {
  await fs.mkdir(getLearningSessionsDir(), { recursive: true });
  await fs.mkdir(getLearningSessionArchiveDir(), { recursive: true });
}

async function listLearningSessionSnapshotPaths() {
  const paths = [];
  const currentPath = getCurrentLearningSessionPath();
  const currentStat = await fs.stat(currentPath).catch(() => null);
  if (currentStat?.isFile()) paths.push(currentPath);
  const entries = await fs.readdir(getLearningSessionArchiveDir(), { withFileTypes: true }).catch(() => []);
  entries.forEach((entry) => {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      paths.push(path.join(getLearningSessionArchiveDir(), entry.name));
    }
  });
  return paths;
}

async function deleteLocalAttachments(payload = {}) {
  try {
    const sessionPaths = await listLearningSessionSnapshotPaths();
    const sessionAttachmentIds = await collectAttachmentIdsFromJsonFiles(sessionPaths);
    const preserveIds = normalizeAttachmentIds(payload.preserveAttachmentIds || []);
    sessionAttachmentIds.forEach((id) => preserveIds.add(id));
    return await deleteAttachmentDirectories({
      attachmentsRoot: getLearningAttachmentsDir(),
      candidateIds: payload.attachmentIds || [],
      preserveIds,
    });
  } catch (error) {
    return {
      ok: false,
      deletedIds: [],
      preservedIds: [],
      missingIds: [],
      deletedCacheHashes: [],
      errors: [{ error: error?.message || String(error) }],
    };
  }
}


async function readLearningSessionIndex() {
  const filePath = getLearningSessionIndexPath();
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const data = safeJsonParse(text, null);
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    return { ok: true, sessions, filePath };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, sessions: [], filePath };
    return { ok: false, error: error?.message || String(error), sessions: [], filePath };
  }
}

function buildLearningSessionIndexItem(payload = {}, filePath = '') {
  const metadata = payload.metadata || {};
  const learning = payload.learning || {};
  const nodes = Array.isArray(learning.nodes) ? learning.nodes : [];
  const root = nodes.find((node) => !node.parentId) || nodes[0] || null;
  const activeStack = Array.isArray(learning.questionStack) ? learning.questionStack.filter(Boolean) : [];
  const solved = Boolean(nodes.length && activeStack.length === 0 && nodes.every((node) => node.stackStatus === 'done'));
  const sessionId = sanitizeSessionId(metadata.sessionId || payload.sessionId || '');
  const title = String(metadata.title || root?.question || '未命名学习会话').replace(/\s+/g, ' ').trim() || '未命名学习会话';
  const updatedAt = metadata.updatedAt || metadata.savedAt || payload.savedAt || new Date().toISOString();
  return {
    sessionId,
    title,
    rootQuestion: String(root?.question || title),
    rootQuestionId: root?.id || 'Q0',
    status: solved ? 'done' : 'active',
    solved,
    activeQuestionId: learning.activeQuestionId || root?.id || null,
    nodeCount: Number(metadata.nodeCount ?? nodes.length ?? 0),
    messageCount: Number(metadata.messageCount ?? learning.messages?.length ?? 0),
    attachmentCount: Number(metadata.attachmentCount ?? 0),
    createdAt: metadata.createdAt || updatedAt,
    updatedAt,
    filePath,
  };
}

async function writeLearningSessionIndexItem(item = {}) {
  await ensureLearningSessionsDir();
  const indexPath = getLearningSessionIndexPath();
  const existing = await readLearningSessionIndex();
  const sessions = (existing.sessions || []).filter((entry) => entry.sessionId && entry.sessionId !== item.sessionId);
  sessions.unshift(item);
  sessions.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const data = {
    schemaVersion: learningSessionSchemaVersion,
    updatedAt: new Date().toISOString(),
    sessions,
  };
  await fs.writeFile(indexPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return { ok: true, filePath: indexPath, sessions };
}

async function listLearningSessions() {
  const result = await readLearningSessionIndex();
  if (!result.ok) return result;
  return {
    ok: true,
    sessions: (result.sessions || []).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))),
    filePath: result.filePath,
  };
}

async function readLearningSessionById(sessionId = '') {
  const safeId = sanitizeSessionId(sessionId);
  const filePath = getLearningSessionArchivePath(safeId);
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const data = safeJsonParse(text, null);
    if (!data || typeof data !== 'object') return { ok: false, error: '学习会话 JSON 格式无效', filePath };
    return { ok: true, data, filePath };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, error: '没有找到该历史学习会话', filePath };
    return { ok: false, error: error?.message || String(error), filePath };
  }
}

async function readCurrentLearningSession() {
  const filePath = getCurrentLearningSessionPath();
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const data = safeJsonParse(text, null);
    if (!data || typeof data !== 'object') {
      return { ok: false, error: '学习会话 JSON 格式无效', filePath };
    }
    return { ok: true, data, filePath };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, data: null, filePath };
    return { ok: false, error: error?.message || String(error), filePath };
  }
}

async function normalizeLearningSessionPayload(payload = {}, sessionId = '') {
  const now = new Date().toISOString();
  const metadata = {
    ...(payload.metadata || {}),
    sessionId: sanitizeSessionId(sessionId || payload.metadata?.sessionId || payload.sessionId || ''),
    savedAt: now,
    updatedAt: now,
  };
  return {
    schemaVersion: learningSessionSchemaVersion,
    savedAt: now,
    ...payload,
    metadata,
  };
}

async function writeLearningSessionArchive(payload = {}, explicitSessionId = '') {
  await ensureLearningSessionsDir();
  const data = await normalizeLearningSessionPayload(payload, explicitSessionId);
  const nodes = Array.isArray(data.learning?.nodes) ? data.learning.nodes : [];
  if (!data.metadata.sessionId) return { ok: false, error: '缺少学习会话 ID' };
  const archivePath = getLearningSessionArchivePath(data.metadata.sessionId);
  await fs.writeFile(archivePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  const item = nodes.length ? buildLearningSessionIndexItem(data, archivePath) : null;
  const indexResult = item ? await writeLearningSessionIndexItem(item) : null;
  return { ok: true, archivePath, indexItem: item, sessions: indexResult?.sessions || undefined, savedAt: data.metadata.savedAt };
}

async function writeCurrentLearningSession(payload = {}) {
  const filePath = getCurrentLearningSessionPath();
  try {
    await ensureLearningSessionsDir();
    const data = await normalizeLearningSessionPayload(payload);
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

    const nodes = Array.isArray(data.learning?.nodes) ? data.learning.nodes : [];
    if (data.metadata.sessionId && nodes.length) {
      const archiveResult = await writeLearningSessionArchive(data, data.metadata.sessionId);
      return { ok: true, filePath, archivePath: archiveResult.archivePath, indexItem: archiveResult.indexItem, savedAt: data.metadata.savedAt };
    }

    return { ok: true, filePath, savedAt: data.metadata.savedAt };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), filePath };
  }
}

async function writeLearningSessionById(sessionId = '', payload = {}) {
  try {
    return await writeLearningSessionArchive(payload, sessionId);
  } catch (error) {
    return { ok: false, error: error?.message || String(error), archivePath: getLearningSessionArchivePath(sessionId) };
  }
}

async function clearCurrentLearningSession() {
  const filePath = getCurrentLearningSessionPath();
  try {
    await fs.rm(filePath, { force: true });
    return { ok: true, filePath };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), filePath };
  }
}

async function clearAllLearningSessions(payload = {}) {
  const dirPath = getLearningSessionsDir();
  const currentPath = getCurrentLearningSessionPath();
  const indexPath = getLearningSessionIndexPath();
  const archiveDir = getLearningSessionArchiveDir();
  try {
    await ensureLearningSessionsDir();
    const sessionPaths = await listLearningSessionSnapshotPaths();
    const attachmentIds = await collectAttachmentIdsFromJsonFiles(sessionPaths);
    await fs.rm(currentPath, { force: true });
    await fs.rm(indexPath, { force: true });
    await fs.rm(archiveDir, { recursive: true, force: true });
    await fs.mkdir(archiveDir, { recursive: true });
    const attachmentCleanup = await deleteAttachmentDirectories({
      attachmentsRoot: getLearningAttachmentsDir(),
      candidateIds: attachmentIds,
      preserveIds: payload.preserveAttachmentIds || [],
    });
    return {
      ok: attachmentCleanup.ok,
      dirPath,
      currentPath,
      indexPath,
      archiveDir,
      sessions: [],
      attachmentCleanup,
      error: attachmentCleanup.ok ? '' : '历史会话已删除，但部分本地附件删除失败',
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), dirPath, currentPath, indexPath, archiveDir, sessions: [] };
  }
}


function emitWindowState(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('window:state-changed', {
    isMaximized: win.isMaximized(),
    isMinimized: win.isMinimized(),
    isFullScreen: win.isFullScreen(),
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1220,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    title: 'TreeTalk Desktop',
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'frontend', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  win.on('maximize', () => emitWindowState(win));
  win.on('unmaximize', () => emitWindowState(win));
  win.on('enter-full-screen', () => emitWindowState(win));
  win.on('leave-full-screen', () => emitWindowState(win));
  win.on('restore', () => emitWindowState(win));

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(parsed.toString());
      }
    } catch (_error) {
      // Ignore malformed or unsupported external URLs.
    }
    return { action: 'deny' };
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
  return win;
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady()) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  try {
    await prepareUnifiedUserData();
  } catch (error) {
    console.error('Failed to prepare unified user data directory:', error);
  }
  app.setAppUserModelId('com.treetalk.desktop');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false };
  win.minimize();
  return { ok: true, isMinimized: true, isMaximized: win.isMaximized() };
});

ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false };
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  const state = { ok: true, isMaximized: win.isMaximized(), isMinimized: win.isMinimized() };
  emitWindowState(win);
  return state;
});

ipcMain.handle('window:is-maximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, isMaximized: false };
  return { ok: true, isMaximized: win.isMaximized(), isMinimized: win.isMinimized() };
});

ipcMain.handle('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false };
  win.close();
  return { ok: true };
});

ipcMain.handle('app:meta', () => ({
  platform: process.platform,
  isWindows,
  version: app.getVersion(),
  dataRoot: app.getPath('userData'),
  legacyDataRoot: legacyUserDataPath,
}));


ipcMain.handle('learning-session:read-current', async () => readCurrentLearningSession());

ipcMain.handle('learning-session:write-current', async (_event, payload = {}) => writeCurrentLearningSession(payload));

ipcMain.handle('learning-session:clear-current', async () => clearCurrentLearningSession());

ipcMain.handle('learning-session:list', async () => listLearningSessions());

ipcMain.handle('learning-session:clear-all', async (_event, payload = {}) => clearAllLearningSessions(payload));

ipcMain.handle('learning-session:read-by-id', async (_event, sessionId = '') => readLearningSessionById(sessionId));

ipcMain.handle('learning-session:write-by-id', async (_event, sessionId = '', payload = {}) => writeLearningSessionById(sessionId, payload));

ipcMain.handle('attachment:save-local', async (_event, payload = {}) => saveLocalAttachment(payload));

ipcMain.handle('attachment:open-local', async (_event, payload = {}) => openLocalAttachment(payload));

ipcMain.handle('attachment:delete-local', async (_event, payload = {}) => deleteLocalAttachments(payload));

ipcMain.handle('ai:chat', async (_event, payload = {}) => {
  try {
    const apiKey = String(payload.apiKey || '').trim();
    const baseUrl = String(payload.baseUrl || '').trim();
    const model = String(payload.model || '').trim();
    const messages = Array.isArray(payload.messages) ? payload.messages : [];

    if (!apiKey) return { ok: false, error: '缺少 API Key' };
    if (!baseUrl) return { ok: false, error: '缺少 Base URL' };
    if (!model) return { ok: false, error: '缺少 Model' };
    if (!messages.length) return { ok: false, error: '缺少 messages' };

    const url = normalizeChatCompletionsUrl(baseUrl);
    const temperature = Number.isFinite(payload.temperature) ? payload.temperature : 0.35;
    let result = await postChatCompletion({ url, apiKey, model, messages, temperature });
    let retriedTextOnly = false;

    if (!result.response.ok && messagesHaveNonTextParts(messages)) {
      const message = extractApiErrorMessage(result);
      if (isImagePartUnsupportedError(message)) {
        const textOnlyMessages = convertMessagesToTextOnly(messages);
        result = await postChatCompletion({ url, apiKey, model, messages: textOnlyMessages, temperature });
        retriedTextOnly = true;
      }
    }

    if (!result.response.ok) {
      const message = extractApiErrorMessage(result);
      return { ok: false, status: result.response.status, error: message, retriedTextOnly };
    }

    const content = pickAssistantText(result.data);
    return { ok: true, content, raw: result.data, retriedTextOnly };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});
