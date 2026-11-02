// 测试1：在 JExcel 里复制第1行 → 粘贴到第2行起（模拟手动 Ctrl+C/Ctrl+V）
// 只改草稿，不点「开始刊登」
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
const page = browser.contexts()[0].pages().find(p => p.url().includes('datacaciques'));
const frame = page.frames().find(f => f.name().includes('cloneListing'));
if (!frame) { console.error('❌ 编辑器 iframe 不在了（弹窗被关了？）'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 通过实例 API 取单元格元素真实坐标，再用鼠标点击（最接近真人操作）
async function clickCell(x, y) {
  const rect = await frame.evaluate(([cx, cy]) => {
    const inst = document.querySelector('div.jexcel_container').jexcel;
    const el = inst.getCellFromCoords(cx, cy);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.innerText || '').trim().slice(0, 20) };
  }, [x, y]);
  await page.mouse.click(rect.x, rect.y);
  return rect;
}

async function snapshot(label, rows = 3, cols = 5) {
  const data = await frame.evaluate(([r, c]) => {
    const inst = document.querySelector('div.jexcel_container').jexcel;
    return inst.getData().slice(0, r).map(row => row.slice(0, c).map(v => {
      const m = v.match(/<div class="u-v-content">([\s\S]*?)<\/div><div class="u-v-value"/);
      return (m ? m[1] : v).replace(/<[^>]+>/g, '').trim().slice(0, 15);
    }));
  }, [rows, cols]);
  console.log(`\n📊 ${label}`);
  data.forEach((row, i) => console.log(`  行${i + 1}: ${JSON.stringify(row)}`));
  return data;
}

console.log('=== 测试开始 ===');

// 0. 初始快照
await snapshot('初始状态（前3行×前5列）');

// 1. 点击第1行第1个数据单元格（SKU列, x=0, y=0）
const c1 = await clickCell(0, 0);
console.log('\n🖱 点击行1首格:', c1.text);
await sleep(300);

// 2. 选中整行：点击行号单元格（jexcel_row, y=0）
const rowBtn = await frame.evaluate(() => {
  const inst = document.querySelector('div.jexcel_container').jexcel;
  const el = inst.rows[0];
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(rowBtn.x, rowBtn.y);
console.log('🖱 点击行号1（选中整行）');
await sleep(300);

// 3. Ctrl+C 复制
await page.keyboard.press('Control+c');
console.log('⌨️  Ctrl+C 已发送');
await sleep(500);

// 4. 点击行2首格，Ctrl+V
await clickCell(0, 1);
console.log('🖱 点击行2首格');
await page.keyboard.press('Control+v');
console.log('⌨️  Ctrl+V 已发送');
await sleep(1500);

// 5. 验证行2
const after = await snapshot('粘贴后（验证行2是否=行1）');

// 简单比对：行2的SKU列应=WM-3111
const row2ok = after[1] && after[1].join('|').includes('WM-3111');
console.log(row2ok ? '\n✅ 测试1a 通过：整行复制粘贴可行' : '\n⚠️ 测试1a 结果不确定，看上方数据人工判断');

// 保持浏览器状态，断开（不关闭浏览器）
await browser.close();
console.log('（未关闭浏览器，编辑页保持现状）');
