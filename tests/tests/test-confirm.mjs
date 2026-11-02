// 完整模拟 flow 的图片尾部步骤：开弹窗 → 拖最后一张到第一位 → 点确定 → 验证单元格
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
const page = browser.contexts()[0].pages().find(p => p.url().includes('datacaciques'));
const frame = page.frames().find(f => f.name().includes('cloneListing'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// iframe 偏移（页面坐标换算用）
const el = await frame.frameElement();
const off = await el.evaluate(f => { const r = f.getBoundingClientRect(); return { x: r.x, y: r.y }; });

// 1. 打开行1图片弹窗
await frame.evaluate(() => {
  const inst = document.querySelector('div.jexcel_container').jexcel;
  inst.openEditor(inst.getCellFromCoords(8, 0), true);
});
await sleep(3000);

const state = async () => frame.evaluate(() => {
  const m = document.querySelector('.pgUploadModal');
  const open = m && m.classList.contains('in');
  if (!open) return { open: false };
  const items = [...m.querySelectorAll('.pl-photos > *')];
  const srcs = items.map(li => (li.querySelector('img')?.src || '').slice(-40));
  const inst = document.querySelector('div.jexcel_container').jexcel;
  const cellImg = (inst.getCellFromCoords(8, 0).innerHTML || '').match(/src="([^"]+)"/)?.[1]?.slice(-40) || '(无图)';
  return { open, count: srcs.length, first: srcs[0], last: srcs[srcs.length - 1], cellImg };
});

const before = await state();
console.log('拖拽前: 弹窗', before.count, '张, 首:', before.first, '| 单元格首图:', before.cellImg);

// 2. 真实鼠标拖拽：最后一张 → 第一位
const pos = await frame.evaluate(() => {
  const l = document.querySelector('.pgUploadModal .pl-photos');
  const items = [...l.children];
  const f = items[0].getBoundingClientRect();
  const la = items[items.length - 1].getBoundingClientRect();
  return {
    from: { x: la.x + la.width / 2, y: la.y + la.height / 2 },
    to: { x: f.x + f.width / 2, y: f.y + f.height / 2 },
  };
});
await page.mouse.move(pos.from.x + off.x, pos.from.y + off.y);
await sleep(300);
await page.mouse.down();
await sleep(300);
for (let i = 1; i <= 15; i++) {
  await page.mouse.move(
    pos.from.x + (pos.to.x - pos.from.x) * (i / 15) + off.x,
    pos.from.y + (pos.to.y - pos.from.y) * (i / 15) + off.y,
  );
  await sleep(60);
}
await sleep(500);
await page.mouse.up();
await sleep(1500);

const mid = await state();
console.log('拖拽后: 弹窗首:', mid.first, mid.first === before.last ? '✅ 拖拽生效' : '❌ 拖拽未生效');

// 3. 点「确定」
await frame.evaluate(() => {
  const b = [...document.querySelectorAll('.pgUploadModal .btnConfirm')].find(e => e.offsetParent !== null || e.getClientRects().length);
  b.click();
});
await sleep(3000);

// 4. 验证
const after = await state();
console.log('确定后: 弹窗关闭=', !after.open, '| 单元格首图:', after.cellImg);
console.log(after.cellImg === before.last ? '🎉 完整链路验证通过：拖拽 + 确定 = 提交到单元格' : '❌ 单元格首图与预期不符');

await browser.close();
