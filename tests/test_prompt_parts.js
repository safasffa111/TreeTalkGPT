const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(projectRoot, 'frontend/modules/attachment-utils.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const U = sandbox.window.AttachmentUtils;

const imageAttachment = [{
  id: 'att1',
  name: 'question.png',
  type: 'image/png',
  size: 12345,
  kind: 'image',
  dataUrl: 'data:image/png;base64,AAAABBBB',
  localPath: 'C:/Users/me/AppData/Roaming/app/learning-attachments/att1/question.png',
}];
const textAttachment = [{
  id: 'att2',
  name: 'note.txt',
  type: 'text/plain',
  size: 20,
  kind: 'text',
  text: '附件正文：请解这个题。',
}];

for (const config of [
  { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-plus' },
]) {
  const content = U.buildMessageContentForApi('请看附件解题', imageAttachment, { config });
  console.log('\nCONFIG', config);
  console.log('contentIsArray=', Array.isArray(content));
  console.log(JSON.stringify(content, null, 2).slice(0, 1200));
}

console.log('\nTEXT_ATTACHMENT');
console.log(U.buildMessageContentForApi('请总结附件', textAttachment, {
  config: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
}));
