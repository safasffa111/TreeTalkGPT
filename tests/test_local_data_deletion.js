const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  collectAttachmentIdsFromJsonFiles,
  collectAttachmentIdsFromSession,
  deleteAttachmentDirectories,
  isPathInside,
} = require('../backend/local-data-deletion');

const HASH_SHARED = 'a'.repeat(64);
const HASH_ORPHAN = 'b'.repeat(64);

async function writeAttachment(root, id, hash) {
  const dir = path.join(root, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.txt`), id, 'utf8');
  await fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify({ id, contentHash: hash }), 'utf8');
}

(async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tree-talk-delete-'));
  const attachmentsRoot = path.join(tempRoot, 'learning-attachments');
  const cacheRoot = path.join(attachmentsRoot, '.extraction-cache');
  try {
    await writeAttachment(attachmentsRoot, 'att-delete-shared', HASH_SHARED);
    await writeAttachment(attachmentsRoot, 'att-keep-shared', HASH_SHARED);
    await writeAttachment(attachmentsRoot, 'att-delete-orphan', HASH_ORPHAN);
    await writeAttachment(attachmentsRoot, 'att-preserved', 'c'.repeat(64));
    await fs.mkdir(path.join(cacheRoot, HASH_SHARED), { recursive: true });
    await fs.mkdir(path.join(cacheRoot, HASH_ORPHAN), { recursive: true });
    await fs.writeFile(path.join(cacheRoot, HASH_SHARED, 'extraction.json'), '{}', 'utf8');
    await fs.writeFile(path.join(cacheRoot, HASH_ORPHAN, 'extraction.json'), '{}', 'utf8');

    const result = await deleteAttachmentDirectories({
      attachmentsRoot,
      candidateIds: ['att-delete-shared', 'att-delete-orphan', 'att-preserved', 'att-missing'],
      preserveIds: ['att-preserved'],
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.deletedIds.sort(), ['att-delete-orphan', 'att-delete-shared']);
    assert.deepStrictEqual(result.preservedIds, ['att-preserved']);
    assert.deepStrictEqual(result.missingIds, ['att-missing']);
    await assert.rejects(fs.stat(path.join(attachmentsRoot, 'att-delete-shared')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(attachmentsRoot, 'att-delete-orphan')), { code: 'ENOENT' });
    assert.ok((await fs.stat(path.join(attachmentsRoot, 'att-preserved'))).isDirectory());
    assert.ok((await fs.stat(path.join(cacheRoot, HASH_SHARED))).isDirectory(), 'shared extraction cache must remain');
    await assert.rejects(fs.stat(path.join(cacheRoot, HASH_ORPHAN)), { code: 'ENOENT' });

    const session = {
      learning: {
        selectedAttachments: [{ id: 'att-selected' }],
        nodes: [{ attachments: [{ id: 'att-node' }] }],
      },
      attachments: { selectedAttachments: [{ id: 'att-selected' }] },
    };
    assert.deepStrictEqual([...collectAttachmentIdsFromSession(session)].sort(), ['att-node', 'att-selected']);
    const sessionPath = path.join(tempRoot, 'session.json');
    await fs.writeFile(sessionPath, JSON.stringify(session), 'utf8');
    assert.deepStrictEqual([...await collectAttachmentIdsFromJsonFiles([sessionPath])].sort(), ['att-node', 'att-selected']);

    assert.strictEqual(isPathInside(attachmentsRoot, path.join(attachmentsRoot, 'att-safe')), true);
    assert.strictEqual(isPathInside(attachmentsRoot, attachmentsRoot), false);
    assert.strictEqual(isPathInside(attachmentsRoot, `${attachmentsRoot}-other${path.sep}att-unsafe`), false);

    console.log('LOCAL_DATA_DELETION_OK');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
