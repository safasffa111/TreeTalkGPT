const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';

function getAppPathSafe(name, fallback = '') {
  try {
    return app.getPath(name);
  } catch (_error) {
    return fallback;
  }
}

function ensureWritableDirectory(directoryPath = '') {
  const rawPath = String(directoryPath || '').trim();
  if (!rawPath) return '';
  const resolvedPath = path.resolve(rawPath);
  try {
    fs.mkdirSync(resolvedPath, { recursive: true });
    const probePath = path.join(
      resolvedPath,
      `.treetalk-write-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    fs.writeFileSync(probePath, 'ok', 'utf8');
    fs.rmSync(probePath, { force: true });
    return resolvedPath;
  } catch (_error) {
    return '';
  }
}

const homePath = String(process.env.USERPROFILE || process.env.HOME || process.cwd());
const defaultUserDataPath = getAppPathSafe(
  'userData',
  path.join(homePath, isWindows ? 'AppData/Roaming/TreeTalk Desktop' : '.tree-talk-desktop')
);
const documentsPath = getAppPathSafe('documents', path.join(homePath, 'Documents'));
const configuredPath = String(process.env.TREE_TALK_DATA_DIR || '').trim();
const candidates = [
  configuredPath,
  isWindows && fs.existsSync('D:\\') ? 'D:\\TreeTalkDesktopData' : '',
  path.join(documentsPath, 'TreeTalkDesktopData'),
  defaultUserDataPath,
].filter(Boolean);

let selectedPath = '';
for (const candidate of candidates) {
  selectedPath = ensureWritableDirectory(candidate);
  if (selectedPath) break;
}

if (!selectedPath) {
  throw new Error('TreeTalk Desktop could not create a writable data directory.');
}

// main.js calls app.setPath during module initialization. Electron requires the
// destination directory to exist first, so the bootstrap creates and validates
// it before loading the actual main process.
process.env.TREE_TALK_DATA_DIR = selectedPath;

require('./main');
