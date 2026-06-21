const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'attachment-references.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);

const refs = context.window.AttachmentReferences;
const session = {
  learning: {
    selectedAttachments: [{ id: 'att-selected' }],
    nodes: [
      { id: 'Q0', attachments: [{ id: 'att-node' }, { id: 'att-shared' }] },
      { id: 'Q1', attachments: [{ id: 'att-shared' }] },
    ],
  },
  attachments: { selectedAttachments: [{ id: 'att-selected' }] },
};

assert.deepStrictEqual(Array.from(refs.collectFromSession(session)).sort(), ['att-node', 'att-selected', 'att-shared']);
assert.deepStrictEqual(
  Array.from(refs.collectFromKnowledgeItems([{ type: 'file', session }, { type: 'folder' }])).sort(),
  ['att-node', 'att-selected', 'att-shared']
);
assert.strictEqual(refs.normalizeAttachmentId('../unsafe'), '---unsafe');

console.log('ATTACHMENT_REFERENCES_OK');
