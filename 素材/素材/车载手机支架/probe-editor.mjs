// 只读深挖 Copy Listing 编辑页内部结构（不点击不输入）
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
const ctx = browser.contexts()[0];
let page = null;
for (const p of ctx.pages()) {
  if (p.url().includes('CopyListing') || p.url().includes('copyListing')) { page = p; break; }
}
if (!page) {
  // 兜底：按标题找
  for (const p of ctx.pages()) {
    if ((await p.title()).includes('Copy Listing')) { page = p; break; }
  }
}
if (!page) {
  console.error('❌ 没找到 Copy Listing 编辑页。当前打开的页面：');
  for (const p of ctx.pages()) console.error('  -', await p.title(), '|', p.url());
  process.exit(1);
}

console.log('✅ 编辑页:', page.url());
const out = { url: page.url(), title: await page.title() };

// 1. 表格结构：表头 + 行数 + 第一行单元格内容
out.table = await page.evaluate(() => {
  const tables = [...document.querySelectorAll('table')];
  return tables.slice(0, 3).map(t => ({
    rows: t.querySelectorAll('tr').length,
    headers: [...t.querySelectorAll('th')].map(th => (th.innerText || '').trim().slice(0, 25)).filter(Boolean),
    firstRowCells: [...t.querySelectorAll('tbody tr')][0]
      ? [...t.querySelectorAll('tbody tr')[0].querySelectorAll('td')].map(td => ({
          text: (td.innerText || '').trim().slice(0, 30),
          cls: (td.className || '').toString().slice(0, 50),
          hasInput: !!td.querySelector('input, textarea'),
          contentEditable: td.getAttribute('contenteditable') || '',
        })).slice(0, 15)
      : [],
  }));
});

// 2. 第一行的行号单元格 / 选择行为特征
out.rowMeta = await page.evaluate(() => {
  const firstRow = document.querySelector('tbody tr, .data-row, tr[row-index]');
  return firstRow ? {
    tag: firstRow.tagName,
    cls: (firstRow.className || '').toString().slice(0, 100),
    attrs: [...firstRow.attributes].map(a => `${a.name}=${a.value.slice(0, 30)}`).slice(0, 10),
    cellCount: firstRow.querySelectorAll('td, [role="gridcell"]').length,
  } : null;
});

// 3. 网格组件特征（虚拟滚动表格类）
out.gridLib = await page.evaluate(() => {
  const hits = [];
  for (const [name, sel] of [
    ['react-window', '[class*="react-window"]'],
    ['ag-grid', '.ag-root'],
    ['ant-table', '.ant-table'],
    ['element-ui table', '.el-table'],
    ['handsontable', '.handsontable'],
    ['slickgrid', '.slick-viewport'],
    ['自研grid', '[class*="Grid"]'],
  ]) {
    if (document.querySelector(sel)) hits.push(name);
  }
  return hits;
});

// 4. 可见按钮
out.buttons = await page.$$eval('button, [role="button"]', els =>
  els.filter(e => e.offsetWidth || e.offsetHeight)
    .slice(0, 40).map(e => ({
      text: (e.innerText || e.title || '').trim().slice(0, 25),
      cls: (e.className || '').toString().slice(0, 50),
    })).filter(b => b.text));

// 5. 页面里出现的关键中文词（账号/标题/图片相关）
out.keywords = await page.evaluate(() => {
  const text = document.body.innerText.slice(0, 8000);
  const words = ['eBay账号', 'eBay帐号', '标题', '图片', '已选中文件', '增加文件', '开始上传', '图片库', '外部图片', '开始刊登', 'AI生成', '蓄存', '暂存'];
  return words.filter(w => text.includes(w));
});

// 6. iframe 情况
out.iframes = await page.$$eval('iframe', els => els.map(e => ({ src: (e.src || '').slice(0, 80), visible: !!(e.offsetWidth || e.offsetHeight) })));

const outFile = path.join(__dirname, 'out', `editor-probe-${Date.now()}.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');

console.log('\n===== 编辑页结构 =====');
console.log('网格组件:', out.gridLib.join(', ') || '未识别');
console.log('表格数:', out.table.length);
for (const t of out.table) {
  console.log(`  表格: ${t.rows} 行, 表头: ${t.headers.join(' | ')}`);
  if (t.firstRowCells.length) {
    console.log('  第一行单元格:');
    t.firstRowCells.forEach((c, i) => console.log(`    [${i}] "${c.text}" 输入框:${c.hasInput} 可编辑:${c.contentEditable || 'no'} cls=${c.cls}`));
  }
}
console.log('第一行元数据:', JSON.stringify(out.rowMeta, null, 2));
console.log('可见按钮:', out.buttons.map(b => b.text).join(' | '));
console.log('关键词命中:', out.keywords.join('、'));
console.log('iframe:', JSON.stringify(out.iframes));
console.log('\n📄 已保存:', outFile);
await browser.close();
