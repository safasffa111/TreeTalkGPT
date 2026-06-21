const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'answer-typewriter.js'), 'utf8');
let clock = 0;
let nextTimerId = 1;
const timers = [];
const classNames = new Set();
let richRenderCount = 0;
let lastRenderedText = '';

const body = {
  dataset: { nodeId: 'Q0', sourceKind: 'answer' },
  isConnected: true,
  classList: {
    add: (name) => classNames.add(name),
    remove: (name) => classNames.delete(name),
    toggle: (name, force) => (force ? classNames.add(name) : classNames.delete(name)),
  },
  set innerHTML(value) { this._innerHTML = value; },
  get innerHTML() { return this._innerHTML || ''; },
};
const contentStream = {
  querySelectorAll: () => [body],
  contains: (candidate) => candidate === body,
};
const node = {
  id: 'Q0',
  answer: '长回答'.repeat(1000),
  displayedAnswer: '',
  isTyping: false,
  annotations: [],
};
const state = { sessionId: 'session-typewriter', activeQuestionId: 'Q0' };
const appStore = {
  select: (key) => (key === 'learningData' ? { sessionId: state.sessionId } : null),
  getActiveQuestionId: () => state.activeQuestionId,
  patchLearningNode: (_id, patch) => Object.assign(node, patch),
};
const context = {
  console,
  performance: { now: () => clock },
  window: {
    setTimeout(fn, delay) {
      const record = { id: nextTimerId++, fn, delay, cancelled: false };
      timers.push(record);
      return record.id;
    },
    clearTimeout(id) {
      const record = timers.find((item) => item.id === id);
      if (record) record.cancelled = true;
    },
  },
};
vm.createContext(context);
vm.runInContext(source, context);

const controller = context.window.AnswerTypewriter.createAnswerTypewriter({
  contentStream,
  state,
  findNode: () => node,
  renderRichText(text) {
    richRenderCount += 1;
    lastRenderedText = text;
    return `<p>${text.length}</p>`;
  },
  appStore,
});
controller.start('Q0');

let timerTickCount = 0;
while (timers.length) {
  const timer = timers.shift();
  if (timer.cancelled) continue;
  clock += timer.delay;
  timerTickCount += 1;
  timer.fn();
  if (timerTickCount > 5000) throw new Error('typewriter timer did not settle');
}

assert.strictEqual(node.isTyping, false);
assert.strictEqual(node.displayedAnswer, node.answer);
assert.strictEqual(lastRenderedText, node.answer);
assert.ok(richRenderCount < timerTickCount * 0.55, `rich renders were not sufficiently throttled: ${richRenderCount}/${timerTickCount}`);
assert.strictEqual(classNames.has('is-answer-typing'), false);
assert.strictEqual(context.window.AnswerTypewriter.getRichRenderInterval(13000), 64);

console.log('TYPEWRITER_RENDER_BUDGET_OK', { timerTickCount, richRenderCount });
