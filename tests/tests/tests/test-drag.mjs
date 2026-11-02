// 测试4c：把最后一张图拖到第一位（jQuery UI Sortable 拖拽）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
const page = browser.contexts()[0].pages().find(p => p.url().includes('datacaciques'));
const frame = page.frames().find(f => f.name().includes('cloneListing'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 读取图片列表（src 顺序）
const getList = () => frame.evaluate(() => {
  const list = document.querySelector('.pgUploadModal .pl-photos');
  if (!list) return null;
  return [...list.children].map(li => {
    const img = li.querySelector('img');
    return img ? (img.src || '').slice(-40) : '(无图)';
  });
});

const before = await getList();
console.log('拖拽前数量:', before.length);
console.log('  第1张:', before[0]);
console.log('  最后张:', before[before.length - 1]);

// 取最后一张和第一张的中心坐标
const pos = await frame.evaluate(() => {
  const list = document.querySelector('.pgUploadModal .pl-photos');
  const items = [...list.children];
  const first = items[0].getBoundingClientRect();
  const last = items[items.length - 1].getBoundingClientRect();
  return {
    from: { x: last.x + last.width / 2, y: last.y + last.height / 2 },
    to: { x: first.x + first.width / 2, y: first.y + first.height / 2 },
  };
});
console.log('拖拽路径:', JSON.stringify(pos));

// 分步拖拽：按下 → 缓慢移动（jQuery sortable 需要感知移动）→ 停顿 → 松手
await page.mouse.move(pos.from.x, pos.from.y);
await sleep(300);
await page.mouse.down();
await sleep(300);

const steps = 15;
for (let i = 1; i <= steps; i++) {
  const x = pos.from.x + (pos.to.x - pos.from.x) * (i / steps);
  const y = pos.from.y + (pos.to.y - pos.from.y) * (i / steps);
  await page.mouse.move(x, y);
  await sleep(60);
}
await sleep(500); // 在目标位置悬停，让 sortable 稳定
await page.mouse.up();
await sleep(1200);

const after = await getList();
console.log('拖拽后数量:', after.length);
console.log('  第1张:', after[0]);
console.log('  最后张:', after[after.length - 1]);

const ok = after[0] === before[before.length - 1];
console.log(ok ? '\n✅✅ 拖拽排序成功！新图已到第一位' : '\n⚠️ 拖拽结果需人工确认（看上面的顺序对比）');
await browser.close();
