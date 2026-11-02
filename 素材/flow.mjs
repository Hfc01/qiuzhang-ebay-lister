// 核心自动化流程（从「复制」按钮开始接手，不点「开始刊登」）
// 四环节均已真机验证：整行填充/账号下拉/标题修改/图片上传+拖拽
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url); // 相对定位，工具放任何盘符/目录都能跑
const { chromium } = require('playwright-core');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const jobState = {
  running: false,
  stopRequested: false,
  waitConfirm: false,
  phase: 'idle',
  phaseText: '',
  currentRow: 0,
  rows: [],
  logs: [],
};

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`;
  jobState.logs.push(line);
  if (jobState.logs.length > 500) jobState.logs.shift();
  console.log(line);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function setPhase(phase, text) {
  jobState.phase = phase;
  jobState.phaseText = text;
  log(`▶ ${text}`);
}

async function confirmPoint(label) {
  jobState.waitConfirm = true;
  jobState.phaseText = `⏸ 等待确认: ${label}`;
  log(`⏸ 等待用户确认: ${label}`);
  while (jobState.waitConfirm) {
    if (jobState.stopRequested) throw new Error('用户停止');
    await sleep(500);
  }
}

function setRow(i, patch) {
  Object.assign(jobState.rows[i], patch);
}

// 素材根目录：一个产品一个子文件夹（<产品名>/标题.txt + <产品名>/图片/）
const MATERIALS_ROOT = path.join(__dirname, '素材');

// 列出所有素材文件夹（含每套的标题数/图片数）
export function listMaterialFolders() {
  const out = [];
  if (!fs.existsSync(MATERIALS_ROOT)) return out;
  for (const name of fs.readdirSync(MATERIALS_ROOT, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const dir = path.join(MATERIALS_ROOT, name.name);
    const titleFile = path.join(dir, '标题.txt');
    const imgDir = path.join(dir, '图片');
    const titles = fs.existsSync(titleFile)
      ? fs.readFileSync(titleFile, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter(s => !s.startsWith('（') && !s.startsWith('#')).length
      : 0;
    const images = fs.existsSync(imgDir)
      ? fs.readdirSync(imgDir).filter(f => /\.(png|jpe?g|webp|gif|bmp)$/i.test(f)).length
      : 0;
    out.push({ folder: name.name, titles, images });
  }
  return out;
}

// 读取素材：从指定产品文件夹（不传则用素材下唯一的文件夹，多个时报错）
function loadMaterials(folder) {
  let dir;
  if (folder) {
    dir = path.join(MATERIALS_ROOT, folder);
    if (!fs.existsSync(dir)) throw new Error(`素材文件夹不存在: ${folder}`);
  } else {
    const folders = listMaterialFolders();
    if (folders.length === 0) throw new Error('素材/ 下没有产品文件夹。请在 素材/ 下建立 <产品名>/标题.txt 和 <产品名>/图片/');
    if (folders.length > 1) throw new Error(`素材/ 下有 ${folders.length} 个产品文件夹，请在监控台选择一套：${folders.map(f => f.folder).join('、')}`);
    dir = path.join(MATERIALS_ROOT, folders[0].folder);
  }
  const titleFile = path.join(dir, '标题.txt');
  if (!fs.existsSync(titleFile)) throw new Error(`${folder || '素材'} 里缺少 标题.txt`);
  const titles = fs.readFileSync(titleFile, 'utf8')
    .split(/\r?\n/).map(s => s.trim())
    .filter(Boolean)
    .filter(s => !s.startsWith('（') && !s.startsWith('#'));
  if (titles.length !== 10 && titles.length !== 1) {
    throw new Error(`标题.txt 需要 10 行（每行不同）或 1 行（十行共用），当前 ${titles.length} 行`);
  }
  const imgDir = path.join(dir, '图片');
  if (!fs.existsSync(imgDir)) throw new Error(`${folder || '素材'} 里缺少 图片/ 子文件夹`);
  const images = fs.readdirSync(imgDir)
    .filter(f => /\.(png|jpe?g|webp|gif|bmp)$/i.test(f))
    .sort()
    .map(f => path.join(imgDir, f));
  if (images.length !== 10 && images.length !== 1) {
    throw new Error(`图片/ 需要 10 张（每行一张）或 1 张（十行共用），当前 ${images.length} 张（文件夹: ${folder || dir}）`);
  }
  return {
    folder: folder || path.basename(dir),
    titles: titles.length === 1 ? Array(10).fill(titles[0]) : titles,
    images: images.length === 1 ? Array(10).fill(images[0]) : images,
  };
}

// ---------- 通用工具 ----------

// 取得编辑器 iframe（克隆 Listing 弹窗）
function findEditorFrame(page) {
  return page.frames().find(f => f.name().includes('cloneListing'));
}

// 轮询等待编辑器 iframe 出现
async function waitEditorFrame(page, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const f = findEditorFrame(page);
    if (f) return f;
    await sleep(500);
  }
  return null;
}

// 等待 iframe 内 JExcel 表格实例真正就绪（可操作）
async function waitJexcelReady(f, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const ok = await f.evaluate(() => {
        const el = document.querySelector('div.jexcel_container');
        return !!(el && el.jexcel && typeof el.jexcel.getRowData === 'function');
      });
      if (ok) return true;
    } catch { /* iframe 内容还没加载，继续等 */ }
    await sleep(600);
  }
  return false;
}

// 在 iframe 里执行（带 jexcel 实例）
const J = sel => frame.evaluate(sel);
let frame; // 当前编辑器 iframe（runJob 内赋值）

async function jexcelEval(fn, arg) {
  return frame.evaluate((f, a) => {
    const el = document.querySelector('div.jexcel_container');
    if (!el || !el.jexcel) throw new Error('表格实例未就绪（编辑器可能未加载完成）');
    return eval('(' + f + ')')(el.jexcel, a);
  }, String(fn), arg);
}

// 单元格中心坐标（含 iframe 在页面中的偏移，保证 mouse 坐标准确）
async function cellCenter(x, y) {
  const pos = await frame.evaluate(([cx, cy]) => {
    const inst = document.querySelector('div.jexcel_container').jexcel;
    const el = inst.getCellFromCoords(cx, cy);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, [x, y]);
  // iframe 自身在父页面中的偏移
  const el = await frame.frameElement();
  const off = await el.evaluate(f => {
    const r = f.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  return { x: pos.x + off.x, y: pos.y + off.y };
}

async function dblclickCell(x, y) {
  const c = await cellCenter(x, y);
  await pageMouse.dblclick(c.x, c.y);
  await sleep(1200);
}

// pageMouse 由 runJob 赋值（page.mouse）
let pageMouse;
// page 引用（runJob 赋值，供 waitForEvent 等使用）
let pageRef;

// 轮询等待条件成立
async function waitFor(fn, timeoutMs = 10000, interval = 400) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(interval);
  }
  return null;
}

// 读单元格可见文本
function cellText(x, y) {
  return frame.evaluate(([cx, cy]) => {
    const inst = document.querySelector('div.jexcel_container').jexcel;
    return (inst.getCellFromCoords(cx, cy).innerText || '').trim();
  }, [x, y]);
}

// ---------- 环节1：整行填充 ----------

async function fillRows() {
  const r = await jexcelEval((inst) => {
    const row0 = inst.getRowData(0);
    const total = inst.getData().length;
    // 不够 10 行则插入
    if (total < 10) inst.insertRow(10 - total);
    for (let y = 1; y <= 9; y++) inst.setRowDataForce(y, row0);
    const d = inst.getData();
    return { filled: d.slice(0, 10).filter(row => (row[0] || '').length > 0).length };
  });
  if (r.filled !== 10) throw new Error(`行填充异常：只有 ${r.filled} 行有数据`);
  log('✅ 10 行数据填充完成');
}

// ---------- 环节2：账号分配（Select2 下拉） ----------

async function setAccount(rowIdx, account) {
  // 打开下拉
  await dblclickCell(2, rowIdx);
  const opened = await waitFor(async () => {
    return frame.evaluate(() => {
      const items = [...document.querySelectorAll('.select2-results li')]
        .filter(li => li.offsetParent !== null || li.getClientRects().length);
      return items.length > 1;
    });
  }, 8000);
  if (!opened) throw new Error('账号下拉没弹出来');

  // 点选目标账号（选未用过的第一个）
  const picked = await frame.evaluate((acc) => {
    const isVisible = el => el.offsetParent !== null || el.getClientRects().length;
    const items = [...document.querySelectorAll('.select2-results li')].filter(isVisible);
    const texts = [...new Set(items.map(li => (li.innerText || '').trim()))]
      .filter(t => t && !t.includes('请选择'));
    const target = acc || texts.find(t => t);
    const el = items.find(li => (li.innerText || '').trim() === target);
    if (!el) return { ok: false, error: `选项 ${target} 不在列表`, options: texts.slice(0, 20) };
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { ok: true, picked: target };
  }, account || null);

  if (!picked.ok) throw new Error('选账号失败: ' + (picked.error || JSON.stringify(picked.options)));
  await sleep(600);

  // 验证
  const text = await cellText(2, rowIdx);
  if (!text.includes(picked.picked)) throw new Error(`账号写入验证失败：期望 ${picked.picked}，实际 "${text.slice(0, 20)}"`);
  return picked.picked;
}

async function fillAccounts() {
  const used = new Set();
  for (let i = 0; i < 10; i++) {
    if (jobState.stopRequested) throw new Error('用户停止');
    jobState.currentRow = i + 1;
    setRow(i, { status: 'running' });
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const acc = await setAccountAuto(i, used);
        used.add(acc);
        setRow(i, { account: acc, status: 'running' });
        log(`  行${i + 1} 账号 ✅ ${acc}`);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e.message;
        log(`  行${i + 1} 账号第${attempt}次失败: ${e.message.slice(0, 60)}`);
        await sleep(1000);
      }
    }
    if (lastErr) {
      setRow(i, { status: 'error', error: '账号: ' + lastErr });
      jobState.phaseText = `❌ 行${i + 1} 账号失败`;
      throw new Error(`行${i + 1} 账号分配失败: ${lastErr}`);
    }
  }
  log('✅ 10 个账号分配完成（互不重复）');
}

// 上面 setAccount 传了3个参数会有问题，改用闭包处理"自动选号"
async function setAccountAuto(rowIdx, used) {
  await dblclickCell(2, rowIdx);
  const opened = await waitFor(() => frame.evaluate(() => {
    const items = [...document.querySelectorAll('.select2-results li')]
      .filter(li => li.offsetParent !== null || li.getClientRects().length);
    return items.length > 1;
  }), 8000);
  if (!opened) throw new Error('账号下拉没弹出来');

  const picked = await frame.evaluate((usedArr) => {
    const isVisible = el => el.offsetParent !== null || el.getClientRects().length;
    const items = [...document.querySelectorAll('.select2-results li')].filter(isVisible);
    const texts = [...new Set(items.map(li => (li.innerText || '').trim()))]
      .filter(t => t && !t.includes('请选择'));
    const target = texts.find(t => !usedArr.includes(t));
    if (!target) return { ok: false, error: '没有更多未使用的账号了' };
    const el = items.find(li => (li.innerText || '').trim() === target);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { ok: true, picked: target };
  }, [...used]);
  if (!picked.ok) throw new Error(picked.error);
  await sleep(600);

  const text = await cellText(2, rowIdx);
  if (!text.includes(picked.picked)) throw new Error(`验证失败：实际 "${text.slice(0, 20)}"`);
  return picked.picked;
}

// ---------- 环节3：标题修改 ----------

async function setTitle(rowIdx, title) {
  // 若编辑框已开着（异常残留），先按 Esc
  const open = await frame.evaluate(() => {
    return [...document.querySelectorAll('textarea.excelTextarea')]
      .some(t => t.offsetParent !== null || t.getClientRects().length);
  });
  if (open) { await pageMouse.click(10, 10).catch(() => {}); await sleep(400); }

  await dblclickCell(6, rowIdx);
  const ta = await waitFor(() => frame.evaluate(() => {
    const t = [...document.querySelectorAll('textarea.excelTextarea')]
      .find(x => x.offsetParent !== null || x.getClientRects().length);
    return t ? true : null;
  }), 8000);
  if (!ta) throw new Error('标题编辑框没弹出来');

  await frame.evaluate((val) => {
    const t = [...document.querySelectorAll('textarea.excelTextarea')]
      .find(x => x.offsetParent !== null || x.getClientRects().length);
    const proto = t instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(t, val);
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }, title);

  await pageKeyboard.press('Enter');
  await sleep(800);

  const text = await cellText(6, rowIdx);
  const head = title.slice(0, 20);
  if (!text.replace(/\n\d+$/, '').startsWith(head.slice(0, 10))) {
    // Enter 没保存则尝试失焦
    const c = await cellCenter(0, rowIdx);
    await pageMouse.click(c.x, c.y);
    await sleep(800);
    const text2 = await cellText(6, rowIdx);
    if (!text2.replace(/\n\d+$/, '').startsWith(head.slice(0, 10))) {
      throw new Error(`标题写入验证失败：实际 "${text2.slice(0, 25)}"`);
    }
  }
}

let pageKeyboard;

async function fillTitles(titles) {
  for (let i = 0; i < 10; i++) {
    if (jobState.stopRequested) throw new Error('用户停止');
    jobState.currentRow = i + 1;
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await setTitle(i, titles[i]);
        setRow(i, { title: titles[i].slice(0, 40) });
        log(`  行${i + 1} 标题 ✅ (${titles[i].length}字符)`);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e.message;
        log(`  行${i + 1} 标题第${attempt}次失败: ${e.message.slice(0, 60)}`);
        await sleep(1000);
      }
    }
    if (lastErr) {
      setRow(i, { status: 'error', error: '标题: ' + lastErr });
      throw new Error(`行${i + 1} 标题写入失败: ${lastErr}`);
    }
  }
  log('✅ 10 个标题全部覆盖完成');
}

// ---------- 环节4：图片上传 + 拖拽到第一位 ----------

async function uploadImageForRow(rowIdx, imgPath) {
  // 1. 关闭可能残留的上传弹窗
  const residual = await frame.evaluate(() => {
    const m = document.querySelector('.pgUploadModal');
    return m && m.classList.contains('in');
  });
  if (residual) await closeUploadModal();

  // 2. 双击图片单元格打开弹窗（失败则降级为程序化 openEditor）
  await dblclickCell(8, rowIdx);
  let opened = await waitFor(() => frame.evaluate(() => {
    const m = document.querySelector('.pgUploadModal');
    return m && m.classList.contains('in') ? true : null;
  }), 10000);
  if (!opened) {
    log(`  行${rowIdx + 1} 双击未打开弹窗，改用程序化 openEditor 兜底`);
    await pageKeyboard.press('Escape').catch(() => {}); // 清掉可能残留的编辑状态
    await frame.evaluate(([x, y]) => {
      const inst = document.querySelector('div.jexcel_container').jexcel;
      try { if (typeof inst.closeEditor === 'function') inst.closeEditor(true); } catch {}
      inst.openEditor(inst.getCellFromCoords(x, y), true);
    }, [8, rowIdx]).catch(() => {});
    opened = await waitFor(() => frame.evaluate(() => {
      const m = document.querySelector('.pgUploadModal');
      return m && m.classList.contains('in') ? true : null;
    }), 10000);
  }
  if (!opened) throw new Error('图片上传弹窗没弹出来（双击和 openEditor 都失败）');
  await sleep(800);

  // 3. 记录当前图片数
  const count0 = await frame.evaluate(() => {
    const mm = (document.querySelector('.pgUploadModal').innerText || '').match(/已选中文件\((\d+)\)/);
    return mm ? +mm[1] : 0;
  });

  // 4. 增加文件（捕获文件选择器）
  const btn = await frame.evaluate(() => {
    const els = [...document.querySelectorAll('.pgUploadModal button, .pgUploadModal a, .pgUploadModal [class*="add"]')];
    const b = els.find(x => (x.innerText || '').includes('增加文件'));
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const [chooser] = await Promise.all([
    pageRef.waitForEvent('filechooser', { timeout: 15000 }),
    pageMouse.click(btn.x, btn.y),
  ]);
  await chooser.setFiles(imgPath);
  await sleep(1200);

  // 5. 开始上传
  const up = await frame.evaluate(() => {
    const els = [...document.querySelectorAll('.pgUploadModal button, .pgUploadModal a')];
    const b = els.find(x => (x.innerText || '').includes('开始上传'));
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await pageMouse.click(up.x, up.y);

  // 6. 轮询等待数量 +1
  let count1 = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    count1 = await frame.evaluate(() => {
      const mm = (document.querySelector('.pgUploadModal').innerText || '').match(/已选中文件\((\d+)\)/);
      return mm ? +mm[1] : null;
    });
    if (count1 >= count0 + 1) break;
  }
  if (count1 === null || count1 < count0 + 1) throw new Error(`上传超时：数量仍为 ${count1}`);

  // 7. 拖拽最后一张到第一位
  const dragOk = await dragLastToFirst();
  if (!dragOk) throw new Error('拖拽排序未生效');

  // 8. 点「确定」提交图片列表到单元格（× 只会丢弃更改！）
  const confirmed = await frame.evaluate(() => {
    const b = [...document.querySelectorAll('.pgUploadModal .btnConfirm')]
      .find(e => e.offsetParent !== null || e.getClientRects().length);
    if (!b) return false;
    b.click();
    return true;
  });
  if (!confirmed) {
    // 找不到确定按钮，退回关闭逻辑（但不提交）
    await closeUploadModal();
    throw new Error('找不到「确定」按钮，图片更改未提交');
  }
  const modalGone = await waitFor(() => frame.evaluate(() => {
    const m = document.querySelector('.pgUploadModal');
    return (!m || !m.classList.contains('in')) ? true : null;
  }), 8000);
  if (!modalGone) {
    await closeUploadModal().catch(() => {});
    throw new Error('点确定后弹窗未关闭');
  }
  await sleep(1000);
  return { before: count0, after: count1 };
}

async function dragLastToFirst() {
  const list = await frame.evaluate(() => {
    const l = document.querySelector('.pgUploadModal .pl-photos');
    if (!l) return null;
    return [...l.children].map(li => {
      const img = li.querySelector('img');
      return img ? (img.src || '').slice(-40) : '(无图)';
    });
  });
  if (!list || list.length < 2) return false;
  const firstBefore = list[0], lastBefore = list[list.length - 1];

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

  await pageMouse.move(pos.from.x, pos.from.y);
  await sleep(300);
  await pageMouse.down();
  await sleep(300);
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    await pageMouse.move(
      pos.from.x + (pos.to.x - pos.from.x) * (i / steps),
      pos.from.y + (pos.to.y - pos.from.y) * (i / steps),
    );
    await sleep(60);
  }
  await sleep(500);
  await pageMouse.up();
  await sleep(1200);

  // 验证顺序
  const after = await frame.evaluate(() => {
    const l = document.querySelector('.pgUploadModal .pl-photos');
    return [...l.children].map(li => {
      const img = li.querySelector('img');
      return img ? (img.src || '').slice(-40) : '(无图)';
    });
  });
  return after[0] === lastBefore && after[0] !== firstBefore;
}

async function closeUploadModal() {
  const closed = await frame.evaluate(() => {
    const m = document.querySelector('.pgUploadModal');
    if (!m || !m.classList.contains('in')) return true;
    const x = m.querySelector('.close, [data-dismiss="modal"]');
    if (x) { x.click(); return true; }
    return false;
  });
  await sleep(1000);
  const gone = await frame.evaluate(() => {
    const m = document.querySelector('.pgUploadModal');
    return !m || !m.classList.contains('in');
  });
  if (!gone) {
    // 兜底：按 Esc
    await pageKeyboard.press('Escape');
    await sleep(800);
  }
}

async function fillImages(images) {
  for (let i = 0; i < 10; i++) {
    if (jobState.stopRequested) throw new Error('用户停止');
    jobState.currentRow = i + 1;
    setRow(i, { status: 'running', image: path.basename(images[i]) });
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await uploadImageForRow(i, images[i]);
        log(`  行${i + 1} 图片 ✅ ${path.basename(images[i])}（${r.before}→${r.after}张，已拖到首位）`);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e.message;
        log(`  行${i + 1} 图片第${attempt}次失败: ${e.message.slice(0, 60)}`);
        await closeUploadModal().catch(() => {});
        await sleep(1500);
      }
    }
    if (lastErr) {
      setRow(i, { status: 'error', error: '图片: ' + lastErr });
      jobState.phaseText = `❌ 行${i + 1} 图片失败（其余行已完成）`;
      throw new Error(`行${i + 1} 图片处理失败: ${lastErr}`);
    }
    setRow(i, { status: 'ok' });
  }
  log('✅ 10 行图片全部上传并置顶完成');
}

// ---------- 在线Listing列表（只读） ----------

// 读取「在线Listing」页的列表数据（只读，不点任何东西）
export async function listOnlineListings() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
  try {
    const page = browser.contexts()[0].pages().find(p => p.url().includes('datacaciques'));
    if (!page) throw new Error('调试浏览器里没有数字酋长页面');
    const rows = await page.evaluate(() => {
      const isVisible = e => e.offsetParent !== null || e.getClientRects().length > 0;
      const t = [...document.querySelectorAll('table')].find(t => isVisible(t) && t.querySelector('tbody .skuTd'));
      if (!t) return null;
      return [...t.querySelectorAll('tbody tr')].filter(isVisible).map(tr => ({
        id: (tr.className || '').match(/row(\d+)/)?.[1] || '',
        sku: (tr.querySelector('.skuTd')?.innerText || '').split('\n')[0].trim(),
        title: (tr.querySelector('.titleTd')?.innerText || '').trim().slice(0, 70),
        account: (tr.querySelector('.sellerNameTd')?.innerText || '').split('\n')[0].trim(),
        price: (tr.querySelector('.priceTd')?.innerText || '').trim(),
        checked: !!tr.querySelector('.cbTd input[type=checkbox]')?.checked,
      }));
    });
    if (rows === null) throw new Error('找不到在线Listing表格——请确认页面停留在「刊登→在线Listing」');
    return rows;
  } finally {
    await browser.close();
  }
}

// 在列表里勾选指定 listing（取消其他勾选），返回最终勾选的 id
export async function checkListingById(targetId) {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
  try {
    const page = browser.contexts()[0].pages().find(p => p.url().includes('datacaciques'));
    if (!page) throw new Error('调试浏览器里没有数字酋长页面');
    // 编辑器弹窗开着时父页被遮挡，无法点复选框
    if (page.frames().some(f => f.name().includes('cloneListing'))) {
      throw new Error('Copy Listing 编辑器还开着——请先点 × 关闭编辑器再选择 Listing');
    }
    // 先取消所有已勾选
    const unchecked = await page.evaluate(() => {
      let n = 0;
      for (const c of document.querySelectorAll('tbody .cbTd input[type=checkbox]')) {
        if (c.checked) { c.click(); n++; }
      }
      return n;
    });
    await sleep(600);
    // 勾选目标行
    const ok = await page.evaluate((id) => {
      const tr = [...document.querySelectorAll('tbody tr')].find(r => (r.className || '').includes('row' + id));
      if (!tr) return false;
      const c = tr.querySelector('.cbTd input[type=checkbox]');
      if (!c) return false;
      c.click();
      return c.checked;
    }, targetId);
    await sleep(600);
    // 验证
    const verify = await page.evaluate((id) => {
      const cbs = [...document.querySelectorAll('tbody .cbTd input[type=checkbox]')];
      const checked = cbs.filter(c => c.checked);
      const targetRow = [...document.querySelectorAll('tbody tr')].find(r => (r.className || '').includes('row' + id));
      return { count: checked.length, targetOk: targetRow ? !!targetRow.querySelector('.cbTd input:checked') : false };
    }, targetId);
    if (!ok || !verify.targetOk) throw new Error('勾选目标 Listing 失败（页面上找不到该行）');
    if (verify.count !== 1) throw new Error(`勾选后仍有 ${verify.count} 条被勾选（应为 1 条）`);
    return { unchecked, ok: true };
  } finally {
    await browser.close();
  }
}

// ---------- 主流程 ----------

export async function runJob(materialFolder) {
  if (jobState.running) return;
  jobState.running = true;
  jobState.stopRequested = false;
  jobState.currentRow = 0;
  jobState.rows = Array.from({ length: 10 }, (_, i) => ({
    row: i + 1, account: '', title: '', image: '', status: 'pending', error: '',
  }));
  jobState.logs = [];

  let browser = null;
  try {
    const { titles, images, folder } = loadMaterials(materialFolder);
    log(`素材加载完成（产品: ${folder}）: 标题${titles.length === 10 ? '10个' : '1个(共用)'} / 图片${images.length === 10 ? '10张' : '1张(共用)'}`);

    await setPhase('prepare', '连接调试浏览器');
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
    const ctx = browser.contexts()[0];
    const page = ctx.pages().find(p => p.url().includes('datacaciques'));
    if (!page) throw new Error('调试浏览器里没有数字酋长页面，请先打开「在线Listing」页并勾选 Listing');
    pageMouse = page.mouse;
    pageKeyboard = page.keyboard;
    pageRef = page;

    // 检查勾选（只读）
    const checkedCount = await page.evaluate(() =>
      [...document.querySelectorAll('input[type="checkbox"]:checked')]
        .filter(c => c.closest('tbody, tr')).length);
    if (checkedCount === 0) throw new Error('没有勾选任何 Listing，请先勾选要复制的那一条');
    log(`已勾选 ${checkedCount} 条 Listing`);
    if (checkedCount !== 1) await confirmPoint(`勾选了 ${checkedCount} 条（正常为 1 条），确认继续？`);

    // 若编辑器已开着（上次残留），直接复用；否则点「复制」
    frame = findEditorFrame(page);
    if (!frame) {
      await setPhase('copy', '点击「复制」按钮');
      const copyBtn = page.locator('button.copy-btn, button:has-text("复制")').first();
      if (await copyBtn.count() === 0) throw new Error('找不到「复制」按钮');
      await copyBtn.click();
      frame = await waitEditorFrame(page, 25000);
      if (!frame) throw new Error('点了复制但 25 秒内编辑器没弹出来');
    } else {
      log('检测到编辑器已打开，直接复用当前草稿');
    }

    // 统一等待表格实例就绪（iframe 弹出 ≠ 表格加载完成）
    await setPhase('rows', '等待编辑器表格加载…');
    if (!await waitJexcelReady(frame, 30000)) {
      throw new Error('编辑器弹出但表格 30 秒未加载完成，请检查页面后重试');
    }
    await sleep(800); // 就绪后再稳一下

    // 环节1：10 行填充
    await setPhase('rows', '填充 10 行数据');
    await fillRows();
    await confirmPoint('10 行已填充完成，继续分配账号和标题？');

    // 环节2+3：账号 + 标题
    await setPhase('accounts', '分配 eBay 账号（每行不同）');
    await fillAccounts();
    await setPhase('titles', '写入 AI 标题');
    await fillTitles(titles);
    await confirmPoint('账号和标题已完成，开始上传图片？（共 10 次上传+拖拽，耗时较长）');

    // 环节4：图片
    await setPhase('images', '逐行上传图片并置顶');
    await fillImages(images);

    jobState.phase = 'done';
    jobState.phaseText = '✅ 全部完成！请人工检查 10 行数据，确认无误后自己点「开始刊登」';
    log('🎉 流程结束（未点「开始刊登」，提交由人工完成）');

  } catch (e) {
    jobState.phase = 'error';
    jobState.phaseText = `❌ ${e.message}`;
    log(`❌ 出错: ${e.message}`);
  } finally {
    jobState.running = false;
    if (browser) await browser.close().catch(() => {});
  }
}
