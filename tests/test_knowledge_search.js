const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'knowledge-search.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);

const { createKnowledgeSearchIndex, searchKnowledgeFiles } = context.window.KnowledgeSearch;
const store = {
  items: [
    { id: 'root', type: 'folder', name: '知识仓库' },
    {
      id: 'file-title',
      type: 'file',
      name: '多元微积分复习',
      text: '极限与连续',
      updatedAt: '2026-06-21T01:00:00.000Z',
    },
    {
      id: 'file-answer',
      type: 'file',
      name: '课堂笔记',
      session: {
        learning: {
          nodes: [{ question: '什么是梯度', answer: '梯度表示函数增长最快的方向。' }],
        },
      },
    },
    {
      id: 'file-attachment',
      type: 'file',
      name: '附件资料',
      session: {
        learning: {
          nodes: [{
            question: '附件题目',
            attachments: [{ name: '线性代数.docx', extractedText: '矩阵的特征值和特征向量。' }],
          }],
        },
      },
    },
  ],
};

assert.deepStrictEqual(Array.from(searchKnowledgeFiles(store, '多元微积分'), (item) => item.id), ['file-title']);
assert.deepStrictEqual(Array.from(searchKnowledgeFiles(store, '增长 最快'), (item) => item.id), ['file-answer']);
assert.deepStrictEqual(Array.from(searchKnowledgeFiles(store, '特征向量'), (item) => item.id), ['file-attachment']);
assert.strictEqual(searchKnowledgeFiles(store, '不存在的文本').length, 0);
assert.strictEqual(searchKnowledgeFiles(store, '   ').length, 0);

let longTextReads = 0;
const indexedFile = {
  id: 'indexed-file',
  type: 'file',
  name: 'Indexed notes',
  updatedAt: '2026-06-21T02:00:00.000Z',
};
Object.defineProperty(indexedFile, 'text', {
  enumerable: true,
  get() {
    longTextReads += 1;
    return 'alpha beta gamma delta';
  },
});
const indexedStore = { items: [indexedFile] };
const index = createKnowledgeSearchIndex(indexedStore);
searchKnowledgeFiles(indexedStore, 'alpha', index);
searchKnowledgeFiles(indexedStore, 'beta', index);
searchKnowledgeFiles(indexedStore, 'gamma', index);
assert.strictEqual(longTextReads, 1, 'cached index should read and normalize long file text only once');

console.log('KNOWLEDGE_SEARCH_OK');
