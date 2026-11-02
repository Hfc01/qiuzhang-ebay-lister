// 打开 Copy Listing 编辑页并深挖结构（用户已授权：勾选+点复制；其余只读）
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
const ctx = browser.contexts()[0];

// 1. 找列表页（可能已跳到 relistOrCopyListing 或 /ebay/post/listing/online）
let listPage = null;
for (const p of ctx.pages()) {
  const u = p.url();
  if (u.includes('datacaciques.com') && !u.includes('relistToCopyListing')) { listPage = p; }
}
if (!listPage) { console.error('❌ 找不到数字酋长页面'); process.exit(1); }
console.log('列表页:', listPage.url());

// 2. 检查勾选状态（只读）
const checked = await listPage.evaluate(() => {
  const boxes = [...document.querySelectorAll('input[type="checkbox"]')].filter(c => c.checked);
  return boxes.filter(c => c.closest('tbody, tr')).length;
});
console.log('当前勾选行数:', checked);

// 3. 没勾就勾 WM-3111 那一行
if (checked === 0) {
  const cb = listPage.locator('tr.selectedRow input[type="checkbox"], tr.row920096000222 input[type="checkbox"]').first();
  if (await cb.count() === 0) { console.error('❌ 找不到 WM-3111 行的复选框'); process.exit(1); }
  await cb.check();
  console.log('✅ 已勾选 WM-3111');
}

// 4. 点「复制」，等待新窗口/新页面
const before = new Set(ctx.pages().map(p => p._guid || p.url()));
const copyBtn = listPage.locator('button.copy-btn, button:has-text("复制")').first();
console.log('点击「复制」...');
await copyBtn.click();

let editor = null;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000));
  // 新标签页
  for (const p of ctx.pages()) {
    const u = p.url();
    if ((u.includes('relistToCopyListing') || u.includes('CopyListing')) && !before.has(p._guid || p.url())) {
      editor = p; break;
    }
    if (u.includes('relistToCopyListing')) { editor = p; break; }
  }
  // 或本页跳转
  if (!editor && (listPage.url().includes('relistToCopyListing'))) { editor = listPage; break; }
  if (editor) break;
}
if (!editor) {
  console.error('❌ 15秒内没有等到编辑页出现。当前页面列表:');
  for (const p of ctx.pages()) console.error('  -', (await p.title()).slice(0, 30), '|', p.url().slice(0, 80));
  process.exit(1);
}
console.log('✅ 编辑页已打开:', editor.url());
await new Promise(r => setTimeout(r, 3000)); // 等内部渲染

// 5. 深挖编辑页内部结构（全只读）
const dump = await editor.evaluate(() => {
  const isVisible = el => el.offsetParent !== null || el.getClientRects().length > 0;
  const out = { url: location.href, title: document.title, tables: [], rowContainers: [], buttons: [], keywords: [] };

  for (const t of document.querySelectorAll('table')) {
    if (!isVisible(t)) continue;
    const rows = [...t.querySelectorAll('tr')].filter(isVisible);
    const rec = {
      rows: rows.length,
      headerRow: rows[0] ? [...rows[0].querySelectorAll('th,td')].map(c => (c.innerText || '').trim().slice(0, 20)).filter(Boolean).slice(0, 25) : [],
      dataRows: [],
    };
    for (const r of rows.slice(1, 4)) {
      rec.dataRows.push([...r.querySelectorAll('td')].map(td => ({
        cls: (td.className || '').toString().slice(0, 40),
        text: (td.innerText || '').trim().slice(0, 25),
        hasInput: !!td.querySelector('input, textarea, select'),
        contentEditable: td.getAttribute('contenteditable') || undefined,
      })).slice(0, 20));
    }
    out.tables.push(rec);
    if (out.tables.length >= 4) break;
  }

  // 非table的行容器（自定义grid）
  const gutterNums = [];
  for (const el of document.querySelectorAll('div,span,td')) {
    if (!isVisible(el) || el.children.length > 0) continue;
    const t = (el.innerText || '').trim();
    if (/^([1-9]|1[0-5])$/.test(t)) {
      const anc = el.closest('[class*="row"],[class*="Row"],tr');
      gutterNums.push({ num: t, ancCls: anc ? (anc.className || '').toString().slice(0, 60) : '', ancTag: anc ? anc.tagName : '' });
      if (gutterNums.length >= 12) break;
    }
  }
  out.rowContainers = gutterNums;

  out.buttons = [...document.querySelectorAll('button,[role="button"],a,.btn')]
    .filter(isVisible).slice(0, 50)
    .map(e => (e.innerText || e.title || '').trim().slice(0, 20)).filter(Boolean);

  const txt = document.body.innerText;
  out.keywords = ['eBay账号', 'eBay帐号', '标题', '图片', '已选中文件', '增加文件', '开始上传', '图片库', '外部图片',
    '开始刊登', 'AI生成', '复制刊登', '蓄存', '暂存', '导航', '删除', '站点', '类型', '刊登模板'].filter(w => txt.includes(w));

  return out;
});

// 6. 保存
const outFile = path.join(__dirname, 'out', `editor-deep-${Date.now()}.json`);
fs.writeFileSync(outFile, JSON.stringify(dump, null, 2), 'utf8');
console.log('\n===== 编辑页结构摘要 =====');
console.log('标题:', dump.title);
for (const t of dump.tables) {
  console.log(`\n表格 ${t.rows} 行 (可见)`);
  console.log('  表头:', t.headerRow.join(' | '));
  t.dataRows.forEach((r, i) => {
    console.log(`  数据行${i + 1}:`);
    r.forEach(c => console.log(`    [${c.cls}] "${c.text}"${c.hasInput ? ' <有输入框>' : ''}${c.contentEditable ? ' <可编辑>' : ''}`));
  });
}
console.log('\n行号容器:', JSON.stringify(dump.rowContainers, null, 1).slice(0, 800));
console.log('\n按钮:', dump.buttons.join(' | '));
console.log('关键词:', dump.keywords.join('、'));
console.log('\n📄 完整数据:', outFile);
console.log('\n🔒 编辑页保持打开，未做任何修改');
await browser.close();
