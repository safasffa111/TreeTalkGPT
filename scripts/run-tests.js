const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testsDir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(testsDir)
  .filter((name) => /^test_.*\.js$/i.test(name))
  .sort();

let failed = 0;
for (const file of files) {
  const fullPath = path.join(testsDir, file);
  console.log(`\n[TEST] ${file}`);
  const result = spawnSync(process.execPath, [fullPath], { stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}

if (failed) {
  console.error(`\n${failed} test file(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} test files passed.`);
