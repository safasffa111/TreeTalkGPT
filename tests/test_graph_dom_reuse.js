const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  toggle(name, force) {
    if (force) this.values.add(name); else this.values.delete(name);
    return Boolean(force);
  }
}

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.classList = new ClassList();
    this.style = {
      values: {},
      setProperty: (key, value) => { this.style.values[key] = value; },
    };
    this.className = '';
    this.textContent = '';
  }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, anchor) {
    if (child.parentNode) {
      const previousIndex = child.parentNode.children.indexOf(child);
      if (previousIndex >= 0) child.parentNode.children.splice(previousIndex, 1);
    }
    const index = anchor ? this.children.indexOf(anchor) : -1;
    if (index >= 0) this.children.splice(index, 0, child); else this.children.push(child);
    child.parentNode = this;
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  closest() { return null; }
  setPointerCapture() {}
  releasePointerCapture() {}
}

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'graph-renderer.js'), 'utf8');
const workbenchSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'workbench-renderer.js'), 'utf8');
const document = {
  createElement: (tag) => new Element(tag),
  createElementNS: (_namespace, tag) => new Element(tag),
};
const context = {
  console,
  document,
  window: {
    StackStateUtils: { createGraphState: () => ({ scale: 1, x: 18, y: 18, positions: {}, manualPositions: {} }) },
    matchMedia: () => ({ matches: true }),
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => fn(),
  },
};
vm.createContext(context);
vm.runInContext(source, context);
vm.runInContext(workbenchSource, context);

const root = { id: 'Q0', parentId: null, question: '主问题', stackStatus: 'active', children: [] };
const state = {
  nodes: [root],
  activeQuestionId: 'Q0',
  questionStack: ['Q0'],
  graph: { scale: 1, x: 18, y: 18, positions: {}, manualPositions: {} },
};
const graphViewport = new Element('div');
const graphCanvas = new Element('div');
const graphEdges = new Element('svg');
const graphNodes = new Element('div');
const renderer = context.window.GraphRenderer.createWorkbenchGraphRenderer({
  graphViewport,
  graphCanvas,
  graphEdges,
  graphNodes,
  state,
  findNode: (id) => state.nodes.find((node) => node.id === id) || null,
  getStackTopId: () => state.questionStack[state.questionStack.length - 1] || null,
  compactQuestionTitle: (text) => text,
});

renderer.render();
const rootElement = graphNodes.children[0];
const listenerCount = Object.values(rootElement.listeners).reduce((sum, list) => sum + list.length, 0);
renderer.render();
assert.strictEqual(graphNodes.children[0], rootElement, 'unchanged graph node DOM must be reused');
assert.strictEqual(Object.values(rootElement.listeners).reduce((sum, list) => sum + list.length, 0), listenerCount);

const child = { id: 'Q1', parentId: 'Q0', question: '追问', stackStatus: 'active', children: [] };
root.children.push('Q1');
state.nodes.push(child);
state.activeQuestionId = 'Q1';
state.questionStack.push('Q1');
renderer.render();
assert.strictEqual(graphNodes.children.find((element) => element.dataset.nodeId === 'Q0'), rootElement);
assert.ok(graphNodes.children.find((element) => element.dataset.nodeId === 'Q1'));
assert.strictEqual(graphEdges.children.length, 1);

const treeList = new Element('div');
const workbenchRenderer = context.window.WorkbenchRenderer.createWorkbenchRenderer({
  workbenchTreeList: treeList,
  state: { ...state, recentNodeEnterIds: new Set() },
  findNode: (id) => state.nodes.find((node) => node.id === id) || null,
  getStackTopId: () => state.questionStack[state.questionStack.length - 1] || null,
  renderRichText: (text) => text,
});
workbenchRenderer.renderWorkbenchTree();
const rootRow = treeList.children.find((element) => element.dataset.nodeId === 'Q0');
const rootTreeListenerCount = Object.values(rootRow.children[0].listeners).reduce((sum, list) => sum + list.length, 0);
workbenchRenderer.renderWorkbenchTree();
assert.strictEqual(treeList.children.find((element) => element.dataset.nodeId === 'Q0'), rootRow, 'unchanged tree row DOM must be reused');
assert.strictEqual(Object.values(rootRow.children[0].listeners).reduce((sum, list) => sum + list.length, 0), rootTreeListenerCount);
assert.ok(treeList.children.find((element) => element.dataset.nodeId === 'Q1'));

console.log('TREE_GRAPH_DOM_REUSE_OK');
