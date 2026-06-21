const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
for (const name of ['dist', 'out', 'release']) {
  const target = path.join(root, name);
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${target}`);
}
