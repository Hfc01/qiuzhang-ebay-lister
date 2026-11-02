// 测试4b：增加文件 → 开始上传 → 验证数量 15→16
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IMG = path.join(__dirname, '素材', '图片', 'test.png');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
const page = browser.contexts()[0].pages().find(p => p.url().includes('datacaciques'));
const frame = page.frames().find(f => f.name().includes('cloneListing'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 弹窗开着吗？
const open = await frame.evaluate(() => {
  const m = document.querySelector('.pgUploadModal');
  return m && m.classList.contains('in');
});
if (!open) { console.error('❌ 上传弹窗没开'); process.exit(1); }
console.log('✅ 上传弹窗开着');

// 1. 点「增加文件」，捕获文件选择器
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 10000 }),
  (async () => {
    const r = await frame.evaluate(() => {
      const btns = [...document.querySelectorAll('.pgUploadModal button, .pgUploadModal a, .pgUploadModal [class*="add"]')];
      const b = btns.find(x => (x.innerText || '').includes('增加文件'));
      const r2 = b.getBoundingClientRect();
      return { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 };
    });
    await page.mouse.click(r.x, r.y);
  })(),
]);
await chooser.setFiles(IMG);
console.log('✅ 已选入测试图片:', path.basename(IMG));
await sleep(1500);

// 2. 队列状态
const queue = await frame.evaluate(() => {
  const m = document.querySelector('.pgUploadModal');
  return (m.innerText || '').match(/(\d+%)/g) || [];
});
console.log('上传队列进度:', JSON.stringify(queue));

// 3. 点「开始上传」
const up = await frame.evaluate(() => {
  const btns = [...document.querySelectorAll('.pgUploadModal button, .pgUploadModal a')];
  const b = btns.find(x => (x.innerText || '').includes('开始上传'));
  const r2 = b.getBoundingClientRect();
  return { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 };
});
await page.mouse.click(up.x, up.y);
console.log('⬆️ 已点「开始上传」，等待上传完成...');

// 4. 轮询等待：已选中文件(15) → (16)
let count = null;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  count = await frame.evaluate(() => {
    const m = document.querySelector('.pgUploadModal');
    const mm = (m.innerText || '').match(/已选中文件\((\d+)\)/);
    return mm ? +mm[1] : null;
  });
  if (count >= 16) break;
}
console.log('上传后 已选中文件数:', count);
console.log(count >= 16 ? '✅ 上传成功！' : '⚠️ 数量未增加，需检查');
await browser.close();
