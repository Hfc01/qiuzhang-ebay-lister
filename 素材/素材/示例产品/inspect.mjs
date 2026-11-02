// 只读探查脚本：连接调试浏览器，读取数字酋长页面结构，不做任何点击/输入
// 用法: node inspect.mjs [out文件名前缀]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prefix = process.argv[2] || 'inspect';
const NO_PROXY = '127.0.0.1,localhost';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', {
  timeout: 10000,
});
const ctx = browser.contexts()[0];
if (!ctx) {
  console.error('❌ 没有找到浏览器上下文');
  process.exit(1);
}

// 找数字酋长页面
let target = null;
for (const page of ctx.pages()) {
  const url = page.url();
  if (url.includes('datacaciques.com')) { target = page; break; }
}
if (!target) {
  console.error('❌ 没有找到数字酋长页面。当前打开的页面：');
  for (const p of ctx.pages()) console.error('  -', p.url());
  process.exit(1);
}

console.log('✅ 找到页面:', target.url());
const info = {
  url: target.url(),
  title: await target.title(),
  capturedAt: new Date().toISOString(),
  buttons: [],
  links: [],
  tableHeaders: [],
  checkboxes: { total: 0, checked: 0 },
  inputs: [],
  dialogs: [],
  iframes: [],
};

try {
  // 按钮
  info.buttons = await target.$$eval('button, [role="button"], a.btn, .btn', els =>
    els.slice(0, 80).map(e => ({
      text: (e.innerText || e.value || '').trim().slice(0, 40),
      cls: (e.className || '').toString().slice(0, 60),
      disabled: e.disabled || false,
      visible: !!(e.offsetWidth || e.offsetHeight),
    })).filter(b => b.text)
  );
  // 表格表头
  info.tableHeaders = await target.$$eval('th, .ant-table-thead th, [class*="header"] th', els =>
    els.slice(0, 60).map(e => (e.innerText || '').trim().slice(0, 30)).filter(Boolean)
  );
  // 复选框
  info.checkboxes = await target.$$eval('input[type="checkbox"]', els => ({
    total: els.length,
    checked: els.filter(c => c.checked).length,
  }));
  // 输入框
  info.inputs = await target.$$eval('input, textarea, select', els =>
    els.slice(0, 60).map(e => ({
      tag: e.tagName.toLowerCase(),
      type: e.type || '',
      name: e.name || '',
      placeholder: e.placeholder || '',
      cls: (e.className || '').toString().slice(0, 50),
      visible: !!(e.offsetWidth || e.offsetHeight),
    }))
  );
  // 弹窗
  info.dialogs = await target.$$eval('.modal, .ant-modal, [class*="dialog"], [class*="Dialog"]', els =>
    els.slice(0, 20).map(e => ({
      cls: (e.className || '').toString().slice(0, 80),
      visible: !!(e.offsetWidth || e.offsetHeight),
      text: (e.innerText || '').trim().slice(0, 100),
    }))
  );
  // iframe
  info.iframes = await target.$$eval('iframe', els =>
    els.map(e => ({ src: e.src || '', cls: (e.className || '').toString().slice(0, 50) }))
  );
} catch (e) {
  console.error('⚠️ 部分探查失败:', e.message);
}

// 链接单独取（数量多，限制）
try {
  info.links = await target.$$eval('a', els =>
    els.slice(0, 100).map(e => ({
      text: (e.innerText || '').trim().slice(0, 40),
      href: (e.getAttribute('href') || '').slice(0, 80),
      visible: !!(e.offsetWidth || e.offsetHeight),
    })).filter(l => l.text && l.visible)
  );
} catch {}

const outFile = path.join(__dirname, 'out', `${prefix}-${Date.now()}.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(info, null, 2), 'utf8');

// 控制台摘要
console.log('\n===== 页面摘要 =====');
console.log('标题:', info.title);
console.log('按钮(%d):', info.buttons.filter(b => b.visible).length);
for (const b of info.buttons.filter(b => b.visible).slice(0, 30)) console.log('  [按钮]', b.text, b.disabled ? '(禁用)' : '');
console.log('表头(%d):', info.tableHeaders.length, info.tableHeaders.slice(0, 30).join(' | '));
console.log('复选框: 共%d个, 已勾选%d个', info.checkboxes.total, info.checkboxes.checked);
console.log('弹窗:', info.dialogs.filter(d => d.visible).length, '个可见');
console.log('iframe:', info.iframes.length, '个');
console.log('\n📄 完整结果已保存:', outFile);
await browser.close();
