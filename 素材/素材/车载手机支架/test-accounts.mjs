// 测试2b：给 10 行依次分配 10 个不同账号（双击 → Select2 下拉 → 点选项 → 验证）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ACCOUNTS = [
  'a-auto1', 'a-car-radio', 'a-carplay', 'a-carplay_6', 'auto-radio',
  'AutoDash-Tech', 'best_radio', 'car-auto_2', 'car-auto30', 'car-auto33',
];

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
const page = browser.contexts()[0].pages().find(p => p.url().includes('datacaciques'));
const frame = page.frames().find(f => f.name().includes('cloneListing'));
if (!frame) { console.error('❌ 编辑器 iframe 不在'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cellRect(x, y) {
  return frame.evaluate(([cx, cy]) => {
    const inst = document.querySelector('div.jexcel_container').jexcel;
    const el = inst.getCellFromCoords(cx, cy);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, [x, y]);
}

async function getCellText(x, y) {
  return frame.evaluate(([cx, cy]) => {
    const inst = document.querySelector('div.jexcel_container').jexcel;
    const el = inst.getCellFromCoords(cx, cy);
    return (el.innerText || '').trim().slice(0, 30);
  }, [x, y]);
}

const results = [];
for (let row = 0; row < 10; row++) {
  const account = ACCOUNTS[row];
  try {
    // 1. 双击打开下拉
    const r = await cellRect(2, row);
    await page.mouse.dblclick(r.x, r.y);
    await sleep(900);

    // 2. 在下拉选项里点目标账号（选可见的、非高亮副本里第一个匹配项）
    const clicked = await frame.evaluate((acc) => {
      const isVisible = el => el.offsetParent !== null || el.getClientRects().length > 0;
      const items = [...document.querySelectorAll('.select2-results li')].filter(isVisible);
      const target = items.find(li => (li.innerText || '').trim() === acc);
      if (!target) return { ok: false, error: '选项不存在' };
      // select2 会在 mousedown 上触发选择
      const ev = new MouseEvent('mouseup', { bubbles: true });
      target.dispatchEvent(ev);
      return { ok: true };
    }, account);
    if (!clicked.ok) { results.push(`行${row + 1}:❌ ${clicked.error}`); continue; }
    await sleep(700);

    // 3. 验证
    const text = await getCellText(2, row);
    const ok = text.includes(account);
    results.push(`行${row + 1}:${ok ? '✅' : '⚠️'}[${text}]`);
  } catch (e) {
    results.push(`行${row + 1}:❌ ${e.message.slice(0, 40)}`);
  }
}

console.log('===== 账号分配结果 =====');
results.forEach(r => console.log(' ', r));
await browser.close();
