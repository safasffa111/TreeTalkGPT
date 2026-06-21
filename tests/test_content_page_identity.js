const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'workbench-renderer.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);

const { makeContentPageId } = context.window.WorkbenchRenderer;

assert.strictEqual(makeContentPageId('knowledge-file:a', 'Q0'), 'knowledge-file:a::Q0');
assert.notStrictEqual(
  makeContentPageId('knowledge-file:a', 'Q0'),
  makeContentPageId('knowledge-file:b', 'Q0'),
  '相同节点 ID 但不同知识文件必须被识别为不同内容页'
);
assert.notStrictEqual(
  makeContentPageId('knowledge-file:a', 'Q0'),
  makeContentPageId('knowledge-file:a', 'Q1'),
  '同一知识文件的不同问题节点必须被识别为不同内容页'
);

console.log('CONTENT_PAGE_IDENTITY_OK');
