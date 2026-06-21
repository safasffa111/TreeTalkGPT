const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const roots = ['backend', 'frontend'];
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.bak')) files.push(full);
  }
}
for (const root of roots) walk(path.join(__dirname, '..', root));
files.sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Checked ${files.length} JavaScript files.`);
