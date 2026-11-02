// 测试3f：标题修改（带编辑框状态自适应）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const NEW_TITLE = 'text title';
const COL = 6, ROW = 0;

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
const page = browser.contexts()[0].pages().find(p => p.url().includes('datacaciques'));
const frame = page.frames().find(f => f.name().includes('cloneListing'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const findTA = () => frame.evaluate(() => {
  const ta = [...document.querySelectorAll('textarea.excelTextarea')].find(t => t.offsetParent !== null || t.getClientRects().length);
  return ta ? { focused: document.activeElement === ta, len: ta.value.length } : null;
});

// 1. 如果编辑框没开就双击打开，然后轮询等待
if (!(await findTA())) {
  console.log('编辑框未开 → 双击...');
  const r = await frame.evaluate(([cx, cy]) => {
    const inst = document.querySelector('div.jexcel_container').jexcel;
    const el = inst.getCellFromCoords(cx, cy);
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, [COL, ROW]);
  await page.mouse.dblclick(r.x, r.y);
}
let taState = null;
for (let i = 0; i < 12; i++) {
  taState = await findTA();
  if (taState) break;
  await sleep(500);
}
if (!taState) { console.error('❌ 等了6秒编辑框都没出现'); process.exit(1); }
console.log('编辑框已开:', JSON.stringify(taState));

// 2. 聚焦确认 → 全选 → 打字
await frame.evaluate(() => {
  const ta = [...document.querySelectorAll('textarea.excelTextarea')].find(t => t.offsetParent !== null || t.getClientRects().length);
  ta.focus();
});
await page.keyboard.press('Control+a');
await page.keyboard.type(NEW_TITLE);
await sleep(400);
let taVal = await frame.evaluate(() => {
  const ta = [...document.querySelectorAll('textarea.excelTextarea')].find(t => t.offsetParent !== null || t.getClientRects().length);
  return ta ? ta.value : null;
});
console.log('打字后值:', JSON.stringify((taVal || '').slice(0, 25)));

// 3. 程序化设值兜底（带类型保护）
if (taVal !== NEW_TITLE) {
  console.log('→ 打字未生效，程序化设值...');
  taVal = await frame.evaluate((t) => {
    const ta = [...document.querySelectorAll('textarea.excelTextarea')].find(x => x.offsetParent !== null || x.getClientRects().length);
    if (!ta) return null;
    const proto = ta instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(ta, t);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return ta.value;
  }, NEW_TITLE);
  console.log('设值后值:', JSON.stringify((taVal || '').slice(0, 25)));
}

// 4. 提交：Enter → 失焦
await page.keyboard.press('Enter');
await sleep(800);
const readCell = () => frame.evaluate(([cx, cy]) => {
  const inst = document.querySelector('div.jexcel_container').jexcel;
  return (inst.getCellFromCoords(cx, cy).innerText || '').trim().slice(0, 30);
}, [COL, ROW]);
let cell = await readCell();
console.log('Enter 后单元格:', JSON.stringify(cell));

if (!cell.includes(NEW_TITLE) && taVal === NEW_TITLE) {
  // 编辑框可能还开着（Enter 被吞了），点空白处失焦
  console.log('→ 尝试失焦提交...');
  const r2 = await frame.evaluate(() => {
    const inst = document.querySelector('div.jexcel_container').jexcel;
    const el = inst.getCellFromCoords(0, 0);
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(r2.x, r2.y);
  await sleep(1000);
  cell = await readCell();
  console.log('失焦后单元格:', JSON.stringify(cell));
}

console.log(cell.includes(NEW_TITLE) ? '\n✅✅ 标题修改链路打通！' : '\n❌ 仍未保存');
await browser.close();
