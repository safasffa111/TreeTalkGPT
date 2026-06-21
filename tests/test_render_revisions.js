const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'app-store.js'), 'utf8');
const context = { window: {}, console, structuredClone };
vm.createContext(context);
vm.runInContext(source, context);

const stackState = {
  sessionId: 'session-performance',
  hasMainQuestion: false,
  activeQuestionId: null,
  nodes: [],
  questionStack: [],
  messages: [],
  activeSelection: null,
  selectedAttachments: [],
  richContextMode: false,
  isRequesting: false,
  nextQuestionIndex: 0,
  graph: { scale: 1, x: 18, y: 18, positions: {}, manualPositions: {} },
};
const store = context.window.AppStore.createAppStore({ stackState, observeShell: false });
const node = store.createLearningNode({ question: '性能测试问题' });
const keys = () => ({
  content: store.getLearningContentRenderKey(),
  tree: store.getLearningTreeRenderKey(),
  graph: store.getLearningGraphRenderKey(),
  prompt: store.getPromptUiRenderKey(),
});

const beforeTick = keys();
store.patchLearningNode(node.id, {
  isTyping: true,
  displayedAnswer: '很长回答'.repeat(5000),
}, { source: 'answer-typewriter:tick' });
assert.deepStrictEqual(keys(), beforeTick, 'typewriter ticks must not invalidate selector render keys');
assert.ok(keys().content.length < 100, 'content key must not embed the full answer text');

store.patchLearningNode(node.id, {
  status: 'answered',
  answer: '最终回答',
}, { source: 'test:answer-settled' });
const afterAnswer = keys();
assert.notStrictEqual(afterAnswer.content, beforeTick.content);
assert.notStrictEqual(afterAnswer.tree, beforeTick.tree);
assert.notStrictEqual(afterAnswer.graph, beforeTick.graph);

const beforeAttachment = keys();
store.setLearningAttachments([{ id: 'att-performance' }], { source: 'test:attachment' });
const afterAttachment = keys();
assert.strictEqual(afterAttachment.content, beforeAttachment.content);
assert.strictEqual(afterAttachment.tree, beforeAttachment.tree);
assert.strictEqual(afterAttachment.graph, beforeAttachment.graph);
assert.notStrictEqual(afterAttachment.prompt, beforeAttachment.prompt);

console.log('RENDER_REVISIONS_OK');
