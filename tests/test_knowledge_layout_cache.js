const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'knowledge-map.js'), 'utf8');
const context = {
  console,
  performance: { now: () => 1000 },
  window: {
    matchMedia: () => ({ matches: true }),
    setTimeout,
    clearTimeout,
  },
  document: {},
};
vm.createContext(context);
vm.runInContext(source, context);

let propertyReads = 0;
const tracked = (item) => new Proxy(item, {
  get(target, property, receiver) {
    if (typeof property === 'string') propertyReads += 1;
    return Reflect.get(target, property, receiver);
  },
});
const items = [tracked({ id: 'root', type: 'folder', parentId: null, name: '知识仓库' })];
for (let index = 0; index < 24; index += 1) {
  items.push(tracked({
    id: `file-${index}`,
    type: 'file',
    parentId: 'root',
    name: `文件 ${index}`,
  }));
}
const store = { items };
const ensureLayout = context.window.KnowledgeMap.ensureLayout;

const firstLayout = ensureLayout(store, { settle: true });
const firstPassReads = propertyReads;
propertyReads = 0;
const cachedLayout = ensureLayout(store, { settle: false });
const cachedPassReads = propertyReads;

assert.strictEqual(cachedLayout, firstLayout);
assert.ok(cachedPassReads < firstPassReads * 0.25, `cached layout still did too much work: ${cachedPassReads}/${firstPassReads}`);

items.push(tracked({ id: 'file-new', type: 'file', parentId: 'root', name: '新增文件' }));
propertyReads = 0;
const updatedLayout = ensureLayout(store, { settle: false });
assert.ok(updatedLayout.files['file-new'], 'a structural change must invalidate the layout cache');

const makeLayer = () => ({
  children: [],
  appendChild(node) { this.children.push(node); return node; },
  replaceChildren() { this.children = []; },
  setAttribute() {},
  querySelector() { return null; },
});
const worldLayer = makeLayer();
const folderLayer = makeLayer();
const fileLayer = makeLayer();
const overlayLayer = makeLayer();
const svg = {
  querySelector(selector) {
    return ({
      '.knowledge-map-world': worldLayer,
      '.knowledge-map-folder-layer': folderLayer,
      '.knowledge-map-file-layer': fileLayer,
      '.knowledge-map-overlay-layer': overlayLayer,
    })[selector] || null;
  },
};
const viewport = {
  clientWidth: 900,
  clientHeight: 560,
  listeners: {},
  addEventListener(type, listener) { this.listeners[type] = listener; },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 560 }),
};
const mapView = {
  parentNode: { insertBefore() {}, appendChild() {} },
  nextSibling: null,
  dataset: {},
  hidden: false,
  classList: { add() {}, remove() {}, toggle() {} },
  getAttribute: () => 'false',
  setAttribute() {},
  querySelector(selector) {
    if (selector === '.knowledge-map-viewport') return viewport;
    if (selector === '.knowledge-map-svg') return svg;
    return null;
  },
};
context.document.createElementNS = () => makeLayer();
context.window.requestAnimationFrame = () => 1;
context.window.addEventListener = () => {};
let layoutSaveCount = 0;
const controllerStore = {
  items: [{ id: 'root', type: 'folder', parentId: null, name: 'root' }],
  currentFolderId: 'root',
};
const controller = context.window.KnowledgeMap.createKnowledgeMapController({
  mapView,
  getStore: () => controllerStore,
  saveStore: () => { layoutSaveCount += 1; },
});
controller.syncStore();
controller.syncStore();
assert.strictEqual(layoutSaveCount, 1, 'unchanged map sync must not serialize the whole knowledge store again');

for (let index = 0; index < 6; index += 1) {
  viewport.listeners.wheel({
    clientX: 450,
    clientY: 280,
    deltaY: index % 2 ? -1 : 1,
    preventDefault() {},
  });
}
assert.strictEqual(layoutSaveCount, 1, 'wheel burst must not synchronously save on every event');

setTimeout(() => {
  assert.strictEqual(layoutSaveCount, 2, 'wheel burst should persist once after it settles');
  console.log('KNOWLEDGE_LAYOUT_CACHE_OK', { firstPassReads, cachedPassReads, layoutSaveCount });
}, 190);
