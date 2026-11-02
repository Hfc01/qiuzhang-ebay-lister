// 数字酋长批量刊登工具 - 监控服务
// 启动: node server.mjs  然后浏览器打开 http://127.0.0.1:8899
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runJob, jobState, listMaterialFolders, listOnlineListings, checkListingById } from './flow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8899;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, 'dashboard.html')));
    return;
  }

  if (url.pathname === '/api/status') {
    res.end(JSON.stringify({ ...jobState, materials: listMaterialFolders() }));
    return;
  }

  if (url.pathname === '/api/listings') {
    try {
      const rows = await listOnlineListings();
      res.end(JSON.stringify({ ok: true, rows }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (url.pathname === '/api/start' && req.method === 'POST') {
    if (jobState.running) {
      res.end(JSON.stringify({ ok: false, error: '任务已在运行中' }));
      return;
    }
    // 读取选中的产品文件夹与目标 Listing（POST body JSON {folder, target}）
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let folder = '', target = '';
      try { const j = JSON.parse(body || '{}'); folder = (j.folder || '').trim(); target = (j.target || '').trim(); } catch {}
      try {
        if (target) await checkListingById(target); // 在页面上自动勾选目标 Listing
      } catch (e) {
        jobState.logs.push(`[勾选失败] ${e.message}`);
        res.end(JSON.stringify({ ok: false, error: e.message }));
        return;
      }
      // 不等待完成，立即返回；进度通过 /api/status 轮询
      runJob(folder || undefined).catch(e => {
        jobState.running = false;
        jobState.phase = 'error';
        jobState.logs.push(`[致命] ${e.message}`);
      });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (url.pathname === '/api/confirm' && req.method === 'POST') {
    // 试跑模式：用户确认继续下一步
    jobState.waitConfirm = false;
    jobState.logs.push('[确认] 用户确认，继续执行');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/api/stop' && req.method === 'POST') {
    jobState.stopRequested = true;
    jobState.logs.push('[停止] 已请求停止，将在当前行完成后停下');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  // 记录 PID，供「停止运行.bat」精确停止本服务（不误杀其他 node 程序）
  try { fs.writeFileSync(path.join(__dirname, 'server.pid'), String(process.pid)); } catch {}
  console.log(`✅ 监控界面已启动: http://127.0.0.1:${PORT}`);
  console.log('   （请保持本窗口开着，关窗即停止服务；也可双击「停止运行.bat」一键停止）');
});

// 退出时清理 PID 文件（正常 Ctrl+C / 关窗口场景）
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { fs.unlinkSync(path.join(__dirname, 'server.pid')); } catch {} process.exit(0); });
}
