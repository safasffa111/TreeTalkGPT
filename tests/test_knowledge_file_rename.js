const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(projectRoot, 'frontend/modules/knowledge-warehouse.js'), 'utf8');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.filter(Boolean).forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  toggle(name, force) {
    if (force === undefined) {
      if (this.values.has(name)) { this.values.delete(name); return false; }
      this.values.add(name); return true;
    }
    if (force) this.values.add(name); else this.values.delete(name);
    return Boolean(force);
  }
  contains(name) { return this.values.has(name); }
}

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.dataset = {};
    this.classList = new ClassList();
    this.listeners = {};
    this.attributes = {};
    this.style = {};
    this.value = '';
    this.textContent = '';
    this.title = '';
    this.hidden = false;
    this.disabled = false;
    this.tabIndex = 0;
    this.type = '';
    this.className = '';
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, reference) {
    const existingIndex = this.children.indexOf(child);
    if (existingIndex >= 0) this.children.splice(existingIndex, 1);
    const index = reference ? this.children.indexOf(reference) : -1;
    child.parentNode = this;
    if (index >= 0) this.children.splice(index, 0, child);
    else this.children.push(child);
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    child.parentNode = null;
    return child;
  }
  replaceChildren(...nodes) { this.children.splice(0).forEach((c) => { c.parentNode = null; }); nodes.forEach((n) => this.appendChild(n)); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  dispatch(type, extra = {}) {
    const event = {
      type,
      target: this,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...extra,
    };
    for (const fn of this.listeners[type] || []) fn(event);
    return event;
  }
  matchesSelector(selector) {
    const attrMatch = selector.match(/^\[data-knowledge-rename="([^"]+)"\]$/);
    if (attrMatch) return this.dataset.knowledgeRename === attrMatch[1];
    const itemMatch = selector.match(/^\[data-knowledge-item-id="([^"]+)"\]$/);
    if (itemMatch) return this.dataset.knowledgeItemId === itemMatch[1];
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1)) || this.classList.contains(selector.slice(1));
    return false;
  }
  querySelector(selector) {
    const stack = [...this.children];
    while (stack.length) {
      const node = stack.shift();
      if (node.matchesSelector?.(selector)) return node;
      stack.unshift(...(node.children || []));
    }
    return null;
  }
  closest(selector) { return this.matchesSelector(selector) ? this : null; }
  get childElementCount() { return this.children.length; }
}

const localStorageMap = new Map();
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  document: {
    createElement: (tag) => new Element(tag),
    addEventListener: () => {},
  },
  window: {
    localStorage: {
      getItem: (key) => localStorageMap.get(key) || null,
      setItem: (key, value) => localStorageMap.set(key, String(value)),
    },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => fn(),
    matchMedia: () => ({ matches: true }),
    KnowledgeMap: { createKnowledgeMapController: () => ({ syncStore() {}, requestRender() {}, hide() {} }) },
  },
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const list = new Element('div');
const shell = new Element('div');
shell.dataset.module = 'knowledge';
const controller = sandbox.window.KnowledgeWarehouse.createKnowledgeWarehouseController({
  shell,
  knowledgeList: list,
  knowledgeBreadcrumb: new Element('div'),
  knowledgeFolderBackButton: new Element('button'),
  knowledgeTitleText: new Element('span'),
  knowledgeNewFolderButton: new Element('button'),
  knowledgeDeleteModeButton: new Element('button'),
  knowledgeWideNewButton: new Element('button'),
  treeToggleButtons: [],
  appStore: { subscribe: () => null, select: () => ({}), getLearningNodes: () => [], getLearningNode: () => null },
});

const fileA = controller.debugCreateFile('原文件', '正文');
controller.debugCreateFile('新名字', '同名检查');
controller.renderList();

const fileButton = list.querySelector(`[data-knowledge-item-id="${fileA.id}"]`);
if (!fileButton) throw new Error('file item did not render');
controller.renderList();
if (list.querySelector(`[data-knowledge-item-id="${fileA.id}"]`) !== fileButton) {
  throw new Error('unchanged knowledge item DOM was rebuilt');
}
fileButton.dispatch('contextmenu');
let input = list.querySelector(`[data-knowledge-rename="${fileA.id}"]`);
if (!input) throw new Error('right-click did not start file rename');
input.value = '新名字';
input.dispatch('keydown', { key: 'Enter' });

const renamed = controller.debug().items.find((item) => item.id === fileA.id);
if (renamed.name !== '新名字 2') throw new Error(`file rename did not commit unique name: ${renamed.name}`);

const folder = controller.debugCreateFolder('文件夹');
controller.debugStartRenameFolder(folder.id);
input = list.querySelector(`[data-knowledge-rename="${folder.id}"]`);
if (!input) throw new Error('folder rename still works check failed');

console.log('KNOWLEDGE_FILE_RENAME_OK', renamed.name);

// Active file rename should update the displayed session title and Q0 label, not only the list item name.
const activeList = new Element('div');
const activeShell = new Element('div');
activeShell.dataset.module = 'knowledge';
let restoredSnapshot = null;
let learningData = null;
const activeAppStore = {
  subscribe: () => null,
  select: (key) => (key === 'learningData' ? (learningData || {}) : {}),
  getLearningNodes: () => learningData?.nodes || [],
  getLearningNode: (id) => (learningData?.nodes || []).find((node) => node.id === id) || null,
  restoreLearningSession: (snapshot) => {
    restoredSnapshot = snapshot;
    learningData = snapshot.learning;
  },
};
const activeController = sandbox.window.KnowledgeWarehouse.createKnowledgeWarehouseController({
  shell: activeShell,
  knowledgeList: activeList,
  knowledgeBreadcrumb: new Element('div'),
  knowledgeFolderBackButton: new Element('button'),
  knowledgeTitleText: new Element('span'),
  knowledgeNewFolderButton: new Element('button'),
  knowledgeDeleteModeButton: new Element('button'),
  knowledgeWideNewButton: new Element('button'),
  treeToggleButtons: [],
  appStore: activeAppStore,
  renderActiveNodePage: () => {},
  renderWorkbenchTree: () => {},
  renderWorkbenchGraph: () => {},
});
const activeFile = activeController.debugCreateFile('旧显示名', '正文');
Promise.resolve(activeController.openFile(activeFile.id)).then(() => {
  if (!restoredSnapshot) throw new Error('active file did not restore to workspace');
  activeController.debugStartRenameFile(activeFile.id);
  const activeInput = activeList.querySelector(`[data-knowledge-rename="${activeFile.id}"]`);
  if (!activeInput) throw new Error('active file rename input missing');
  activeInput.value = '新显示名';
  activeInput.dispatch('keydown', { key: 'Enter' });
  const updated = activeController.debug().items.find((item) => item.id === activeFile.id);
  const root = updated.session.learning.nodes.find((node) => !node.parentId) || updated.session.learning.nodes[0];
  if (updated.name !== '新显示名') throw new Error(`active file name not changed: ${updated.name}`);
  if (updated.session.metadata.title !== '新显示名') throw new Error(`metadata title not synced: ${updated.session.metadata.title}`);
  if (root.question !== '新显示名') throw new Error(`Q0 title not synced: ${root.question}`);
  if (!restoredSnapshot || restoredSnapshot.metadata.title !== '新显示名') throw new Error('mounted workspace was not restored with renamed title');
  console.log('KNOWLEDGE_ACTIVE_FILE_RENAME_DISPLAY_OK', root.question);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
