const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const pkg = JSON.parse(read('package.json'));

const requiredFiles = [
  'backend/main.js',
  'backend/preload.js',
  'backend/attachment-extraction-worker.js',
  'frontend/index.html',
  'frontend/renderer.js',
  'frontend/styles.css',
  'build/icon.png',
  'build/icon.ico',
  'build/icon.icns',
  '.github/workflows/build.yml',
];
for (const file of requiredFiles) assert(exists(file), `Missing required package file: ${file}`);

assert.strictEqual(pkg.name, 'tree-talk-desktop');
assert.strictEqual(pkg.productName, 'TreeTalk Desktop');
assert.strictEqual(pkg.main, 'backend/main.js');
assert.strictEqual(pkg.build?.appId, 'com.treetalk.desktop');
assert.strictEqual(pkg.build?.win?.icon, 'build/icon.ico');
assert.strictEqual(pkg.build?.mac?.icon, 'build/icon.icns');
assert(Array.isArray(pkg.build?.asarUnpack), 'asarUnpack must be configured');
assert(pkg.build.asarUnpack.includes('backend/attachment-extraction-worker.js'), 'Worker must be unpacked from asar');

const html = read('frontend/index.html');
assert(html.includes('<title>TreeTalk Desktop</title>'), 'Window title is not branded');

const localReferences = [];
for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const value = match[1];
  if (!value || /^(?:https?:|data:|#)/i.test(value)) continue;
  localReferences.push(value.split(/[?#]/)[0]);
}
for (const reference of localReferences) {
  const resolved = path.normalize(path.join(root, 'frontend', reference));
  assert(fs.existsSync(resolved), `Missing local frontend resource: ${reference}`);
}

const forbiddenPackagedFiles = ['frontend/styles.css.bak', 'frontend/modules/knowledge-map.js.bak'];
for (const file of forbiddenPackagedFiles) {
  if (!exists(file)) continue;
  assert(pkg.build.files.some((rule) => rule.includes('!frontend/**/*.bak')), 'Backup files are not excluded from package');
}

console.log(`Package verification passed (${requiredFiles.length} required files, ${localReferences.length} local frontend references).`);
