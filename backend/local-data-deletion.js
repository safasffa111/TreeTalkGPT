const fs = require('fs/promises');
const path = require('path');

function normalizeAttachmentId(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96);
}

function normalizeAttachmentIds(values = []) {
  const source = values instanceof Set ? [...values] : (Array.isArray(values) ? values : [values]);
  return new Set(source.map(normalizeAttachmentId).filter(Boolean));
}

function addAttachmentList(list = [], target = new Set()) {
  (Array.isArray(list) ? list : []).forEach((attachment) => {
    const id = normalizeAttachmentId(attachment?.id);
    if (id) target.add(id);
  });
  return target;
}

function collectAttachmentIdsFromSession(snapshot = {}, target = new Set()) {
  if (!snapshot || typeof snapshot !== 'object') return target;
  const learning = snapshot.learning && typeof snapshot.learning === 'object' ? snapshot.learning : {};
  addAttachmentList(learning.selectedAttachments, target);
  addAttachmentList(snapshot.attachments?.selectedAttachments, target);
  (Array.isArray(learning.nodes) ? learning.nodes : []).forEach((node) => {
    addAttachmentList(node?.attachments, target);
  });
  return target;
}

function isPathInside(rootPath = '', targetPath = '') {
  if (!rootPath || !targetPath) return false;
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function collectAttachmentIdsFromJsonFiles(filePaths = []) {
  const ids = new Set();
  for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
    try {
      const snapshot = JSON.parse(await fs.readFile(filePath, 'utf8'));
      collectAttachmentIdsFromSession(snapshot, ids);
    } catch (_) {
      // A missing or malformed session must not make deletion fail. Other valid
      // snapshots and the renderer-provided preserve list still protect data.
    }
  }
  return ids;
}

async function getMetadataContentHash(attachmentDir = '') {
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(attachmentDir, 'metadata.json'), 'utf8'));
    const hash = String(metadata?.contentHash || '').trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
  } catch (_) {
    return '';
  }
}

async function collectRemainingContentHashes(attachmentsRoot = '') {
  const hashes = new Set();
  const entries = await fs.readdir(attachmentsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.extraction-cache') continue;
    const hash = await getMetadataContentHash(path.join(attachmentsRoot, entry.name));
    if (hash) hashes.add(hash);
  }
  return hashes;
}

async function removePathPermanently(targetPath = '') {
  await fs.rm(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 });
  const remaining = await fs.stat(targetPath).catch((error) => (error?.code === 'ENOENT' ? null : Promise.reject(error)));
  if (remaining) throw new Error(`删除后路径仍然存在：${targetPath}`);
}

async function deleteAttachmentDirectories({
  attachmentsRoot = '',
  candidateIds = [],
  preserveIds = [],
} = {}) {
  const root = path.resolve(String(attachmentsRoot || ''));
  const candidates = normalizeAttachmentIds(candidateIds);
  const preserved = normalizeAttachmentIds(preserveIds);
  const result = {
    ok: true,
    deletedIds: [],
    preservedIds: [],
    missingIds: [],
    deletedCacheHashes: [],
    errors: [],
  };

  if (!attachmentsRoot || !candidates.size) return result;
  const rootStat = await fs.stat(root).catch((error) => (error?.code === 'ENOENT' ? null : Promise.reject(error)));
  if (!rootStat) {
    result.missingIds.push(...candidates);
    return result;
  }
  if (!rootStat.isDirectory()) {
    result.ok = false;
    result.errors.push({ error: '本地附件根路径不是目录，已拒绝删除' });
    return result;
  }
  const removedHashes = new Set();

  for (const id of candidates) {
    if (preserved.has(id)) {
      result.preservedIds.push(id);
      continue;
    }
    const target = path.resolve(root, id);
    if (!isPathInside(root, target)) {
      result.errors.push({ id, error: '附件目录越界，已拒绝删除' });
      continue;
    }
    let stat = null;
    try {
      stat = await fs.stat(target);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        result.errors.push({ id, error: error?.message || String(error) });
        continue;
      }
    }
    if (!stat) {
      result.missingIds.push(id);
      continue;
    }
    if (!stat.isDirectory()) {
      result.errors.push({ id, error: '附件目标不是目录，已拒绝删除' });
      continue;
    }
    const contentHash = await getMetadataContentHash(target);
    try {
      await removePathPermanently(target);
      result.deletedIds.push(id);
      if (contentHash) removedHashes.add(contentHash);
    } catch (error) {
      result.errors.push({ id, error: error?.message || String(error) });
    }
  }

  if (removedHashes.size) {
    const remainingHashes = await collectRemainingContentHashes(root);
    const cacheRoot = path.join(root, '.extraction-cache');
    for (const hash of removedHashes) {
      if (remainingHashes.has(hash)) continue;
      const cachePath = path.resolve(cacheRoot, hash);
      if (!isPathInside(cacheRoot, cachePath)) continue;
      try {
        const cacheStat = await fs.stat(cachePath).catch((error) => (error?.code === 'ENOENT' ? null : Promise.reject(error)));
        if (!cacheStat) continue;
        await removePathPermanently(cachePath);
        result.deletedCacheHashes.push(hash);
      } catch (error) {
        result.errors.push({ id: `.extraction-cache/${hash}`, error: error?.message || String(error) });
      }
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

module.exports = {
  addAttachmentList,
  collectAttachmentIdsFromJsonFiles,
  collectAttachmentIdsFromSession,
  deleteAttachmentDirectories,
  isPathInside,
  normalizeAttachmentId,
  normalizeAttachmentIds,
};
