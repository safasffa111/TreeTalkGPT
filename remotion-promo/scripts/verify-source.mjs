import fs from 'node:fs';

const root = fs.readFileSync(new URL('../src/Root.tsx', import.meta.url), 'utf8');
const promo = fs.readFileSync(new URL('../src/TreeTalkFullPromo.tsx', import.meta.url), 'utf8');

const checks = [
  ['composition id', root.includes('id="TreeTalkFullPromo"')],
  ['1920 width', promo.includes('export const WIDTH = 1920')],
  ['1080 height', promo.includes('export const HEIGHT = 1080')],
  ['60 fps', promo.includes('export const FPS = 60')],
  ['7440 frames', promo.includes('export const DURATION_FRAMES = 7440')],
  ['tabs copy', promo.includes('一个标签页，一个独立的对话空间。')],
  ['tree copy', promo.includes('让对话从一条线，变成一棵树。')],
  ['selection copy', promo.includes('看到哪里，就从哪里继续问。')],
  ['trace copy', promo.includes('每一次追问，都有来源。')],
  ['context copy', promo.includes('AI 记住什么，应该由你决定。')],
  ['final headline', promo.includes('我重新定义了 AI 对话界面')],
  ['no Audio component', !promo.includes('<Audio') && !promo.includes("from '@remotion/media'")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) process.exit(1);
