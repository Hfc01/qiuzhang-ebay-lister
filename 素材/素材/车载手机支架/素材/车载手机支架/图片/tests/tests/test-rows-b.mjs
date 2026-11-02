// 测试1b：用 JExcel 实例 API 直接把行1数据写入行2（等效粘贴）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
const page = browser.contexts()[0].pages().find(p => p.url().includes('datacaciques'));
const frame = page.frames().find(f => f.name().includes('cloneListing'));
if (!frame) { console.error('❌ 编辑器 iframe 不在'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fmt(v) {
  const m = v.match(/<div class="u-v-content">([\s\S]*?)<\/div><div class="u-v-value"/);
  return (m ? m[1] : v).replace(/<[^>]+>/g, '').trim().slice(0, 15);
}

// 行1原始数据
const rowData = await frame.evaluate(() => {
  const inst = document.querySelector('div.jexcel_container').jexcel;
  return { row0: inst.getRowData(0), rowCount: inst.getData().length, colCount: inst.options.columns.length };
});
console.log(`行数:${rowData.rowCount} 列数:${rowData.colCount} 行1数据长度:${rowData.row0.length}`);
console.log('行1前3格:', rowData.row0.slice(0, 3).map(fmt));

// 写入行2
const r = await frame.evaluate((data) => {
  const inst = document.querySelector('div.jexcel_container').jexcel;
  try {
    if (typeof inst.setRowDataForce === 'function') {
      inst.setRowDataForce(1, data.row0);
      return { ok: true, method: 'setRowDataForce' };
    }
    return { ok: false, error: 'setRowDataForce 不存在' };
  } catch (e) { return { ok: false, error: e.message }; }
}, rowData);
console.log('\n写入结果:', JSON.stringify(r));

await sleep(1200);

// 验证
const check = await frame.evaluate(() => {
  const inst = document.querySelector('div.jexcel_container').jexcel;
  const d = inst.getData();
  return d.slice(0, 3).map(row => row.slice(0, 4).map(v => {
    const m = v.match(/<div class="u-v-content">([\s\S]*?)<\/div><div class="u-v-value"/);
    return (m ? m[1] : v).replace(/<[^>]+>/g, '').trim().slice(0, 15);
  }));
});
console.log('\n📊 写入后前3行×前4列:');
check.forEach((row, i) => console.log(`  行${i + 1}: ${JSON.stringify(row)}`));

const ok = check[1] && check[1].some(v => v.includes('WM-3111'));
console.log(ok ? '\n✅ 方案B(setRowDataForce) 成功！行2已填入行1数据' : '\n❌ 方案B 也失败了，需要看页面实际状态');
await browser.close();
