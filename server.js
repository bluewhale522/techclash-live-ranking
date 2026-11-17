/**
 * TECH CLASH 2026 — REAL-TIME MULTI-MACHINE SERVER (MÁY 1 PHÁT OBS <-> MÁY 2 ĐIỀN ĐIỂM)
 * Đồng bộ tức thì qua Server-Sent Events (SSE) + REST API cho nhiều máy tính / điện thoại khác nhau
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 8088;
const ROOT_DIR = __dirname;
const STATE_FILE = path.join(ROOT_DIR, 'live-state.json');

// Danh sách các kết nối SSE từ Máy OBS & Máy Trọng tài
const clients = new Set();

// Trạng thái đồng hồ đếm ngược chạy tập trung trên Server để mọi máy khớp nhau từng giây
let serverTimer = {
  mode: 'match', // 'prep' (30s) | 'match' (90s)
  totalSec: 90,
  remainingSec: 90,
  running: false,
  endTime: null,
  updatedAt: Date.now()
};
let timerInterval = null;

// Đọc hoặc khởi tạo State
let sharedState = null;
try {
  if (fs.existsSync(STATE_FILE)) {
    sharedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
} catch (e) {
  console.warn('Could not read live-state.json:', e.message);
}

function saveSharedState(newState) {
  sharedState = newState;
  sharedState.lastUpdated = new Date().toISOString();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(sharedState, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not save live-state.json:', e.message);
  }
}

function broadcastSSE(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch (e) {
      clients.delete(res);
    }
  }
}

function startServerTimer() {
  if (timerInterval) clearInterval(timerInterval);
  if (serverTimer.remainingSec <= 0) {
    serverTimer.remainingSec = serverTimer.totalSec;
  }
  serverTimer.running = true;
  serverTimer.endTime = Date.now() + serverTimer.remainingSec * 1000;
  serverTimer.updatedAt = Date.now();
  broadcastSSE({ type: 'TIMER_TICK', timerState: serverTimer, sound: 'start' });

  timerInterval = setInterval(() => {
    const left = Math.max(0, Math.ceil((serverTimer.endTime - Date.now()) / 1000));
    serverTimer.remainingSec = left;
    serverTimer.updatedAt = Date.now();
    if (left > 0) {
      const elapsed = serverTimer.totalSec - left;
      let sound = null;
      if (serverTimer.mode === 'match' && (elapsed === 40 || elapsed === 50)) {
        sound = 'tablet_swap';
      }
      broadcastSSE({ type: 'TIMER_TICK', timerState: serverTimer, sound });
    } else {
      serverTimer.running = false;
      serverTimer.endTime = null;
      clearInterval(timerInterval);
      timerInterval = null;
      broadcastSSE({ type: 'TIMER_TICK', timerState: serverTimer, sound: 'end' });
    }
  }, 500);
}

function stopServerTimer() {
  if (serverTimer.running && serverTimer.endTime) {
    serverTimer.remainingSec = Math.max(0, Math.ceil((serverTimer.endTime - Date.now()) / 1000));
  }
  serverTimer.running = false;
  serverTimer.endTime = null;
  serverTimer.updatedAt = Date.now();
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  broadcastSSE({ type: 'TIMER_TICK', timerState: serverTimer });
}

function setServerTimerMode(mode) {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  serverTimer.running = false;
  serverTimer.endTime = null;
  serverTimer.mode = mode === 'prep' ? 'prep' : 'match';
  serverTimer.totalSec = serverTimer.mode === 'prep' ? 30 : 90;
  serverTimer.remainingSec = serverTimer.totalSec;
  serverTimer.updatedAt = Date.now();
  broadcastSSE({ type: 'TIMER_TICK', timerState: serverTimer });
}

function endServerTimerEarly() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  serverTimer.running = false;
  serverTimer.endTime = null;
  serverTimer.remainingSec = 0;
  serverTimer.updatedAt = Date.now();
  broadcastSSE({ type: 'TIMER_TICK', timerState: serverTimer, sound: 'end' });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

const server = http.createServer((req, res) => {
  // CORS Headers cho phép mọi thiết bị / domain truy cập
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. SSE Real-time Stream cho cả Máy OBS và Máy Điền Điểm
  if (pathname === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`data: ${JSON.stringify({ type: 'INIT', state: sharedState, timerState: serverTimer })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // 2. Lấy hoặc cập nhật State toàn giải (/api/state) — Chống cache tuyệt đối trên OBS Browser Source & Cloudflare
  if (pathname === '/api/state') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    if (req.method === 'GET') {
      if (serverTimer.running && serverTimer.endTime) {
        serverTimer.remainingSec = Math.max(0, Math.ceil((serverTimer.endTime - Date.now()) / 1000));
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, state: sharedState, timerState: serverTimer, serverNow: Date.now() }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (payload && payload.state) {
            saveSharedState(payload.state);
            broadcastSSE({ type: 'STATE_UPDATED', state: sharedState, timerState: serverTimer });
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }
  }

  // 3. Điều khiển Đồng hồ đếm ngược tập trung (/api/timer)
  if (pathname === '/api/timer' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const cmd = JSON.parse(body || '{}');
        if (cmd.action === 'start') {
          startServerTimer();
        } else if (cmd.action === 'pause' || cmd.action === 'stop') {
          stopServerTimer();
        } else if (cmd.action === 'toggle') {
          if (serverTimer.running) stopServerTimer();
          else startServerTimer();
        } else if (cmd.action === 'mode') {
          setServerTimerMode(cmd.mode);
        } else if (cmd.action === 'end_early') {
          endServerTimerEarly();
        }
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, timerState: serverTimer, serverNow: Date.now() }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 3.5. API Cào trực tiếp dữ liệu Bảng A & Bảng B từ Google Sheet trên Server (/api/scrape-sheet) — Không bao giờ bị chặn CORS / JSONP
  if (pathname === '/api/scrape-sheet' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const rawUrl = String(payload.sheetUrl || 'https://docs.google.com/spreadsheets/d/16ylJXsvMpPIGgcY4ijdDSSiO514WjZXC4UheHG3aoak/edit?gid=107184150#gid=107184150').trim();
        const rawV1 = String(payload.vong1Url || 'https://docs.google.com/spreadsheets/d/1YtRc0-REE6o759bKkpJfp-XeZZP9nrGwPor6RyTRal0/edit').trim();

        const parseSheet = (u) => {
          const idM = u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
          const gidM = u.match(/[?#&]gid=([0-9]+)/);
          return { id: idM ? idM[1] : u, gid: gidM ? gidM[1] : null };
        };

        const fetchGvizTable = async (id, param) => {
          const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json` + (param ? `&${param}` : '');
          const r = await fetch(url);
          const txt = await r.text();
          const start = txt.indexOf('{');
          const end = txt.lastIndexOf('}');
          if (start === -1 || end === -1) throw new Error('Sheet chưa bật quyền Xem công khai');
          return JSON.parse(txt.slice(start, end + 1)).table;
        };

        const pMain = parseSheet(rawUrl);
        const pV1 = parseSheet(rawV1);

        const getTop2FromV1 = async (rawClassName) => {
          if (!pV1.id) return ['', ''];
          const cleanTab = String(rawClassName || '').trim().replace(/\s+[AB]$/i, '').replace(/-[AB]$/i, '');
          const offset = /(-B|\sB)$/i.test(String(rawClassName || '').trim()) ? 2 : 0;
          try {
            const tbl = await fetchGvizTable(pV1.id, 'sheet=' + encodeURIComponent(cleanTab));
            const rows = tbl.rows || [];
            const map = {};
            for (const row of rows) {
              const c = row.c || [];
              const name = c[1] && (c[1].f || c[1].v) ? String(c[1].f || c[1].v).trim() : '';
              const sc = c[2] && c[2].v != null ? parseFloat(c[2].v) : NaN;
              if (name && !/tên|học viên|ảnh/i.test(name)) {
                if (!map[name]) map[name] = [];
                if (!isNaN(sc)) map[name].push(sc);
              }
            }
            const list = Object.keys(map).map(n => ({
              name: n,
              score: map[n].length ? Math.max(...map[n]) : 0
            }));
            list.sort((a, b) => b.score - a.score);
            return [list[offset] ? list[offset].name : '', list[offset + 1] ? list[offset + 1].name : ''];
          } catch (e) {
            return ['', ''];
          }
        };

        const tblMain = await fetchGvizTable(pMain.id, pMain.gid ? `gid=${pMain.gid}` : '');
        const rows = tblMain.rows || [];
        const cell = (arr, i) => (arr && arr[i] && (arr[i].f !== undefined && arr[i].f !== null ? arr[i].f : arr[i].v) ? String(arr[i].f || arr[i].v).trim() : '');

        const teamsA = [];
        const teamsB = [];

        for (let r = 0; r < rows.length; r++) {
          const c = rows[r].c || [];
          const cn = (rows[r + 1] && rows[r + 1].c) ? rows[r + 1].c : [];

          const lA = cell(c, 0), clsA = cell(c, 1), lecA = cell(c, 5), s1A = cell(c, 6), s2A = cell(cn, 6);
          if ((lA.toLowerCase().startsWith('đội') || /^A\d+/i.test(lA)) && clsA) {
            const [v1s1, v1s2] = (!s1A || !s2A) ? await getTop2FromV1(clsA) : ['', ''];
            teamsA.push({
              code: lA,
              className: clsA.toUpperCase(),
              lec: lecA || '',
              student1: (s1A || v1s1 || 'Chờ cập nhật').replace(/^NNguyễn/, 'Nguyễn'),
              student2: s2A || v1s2 || 'Chờ cập nhật'
            });
          }

          const lB = cell(c, 11), clsB = cell(c, 12), lecB = cell(c, 16), s1B = cell(c, 17), s2B = cell(cn, 17);
          if ((lB.toLowerCase().startsWith('đội') || /^B\d+/i.test(lB)) && clsB) {
            const [v1s1, v1s2] = (!s1B || !s2B) ? await getTop2FromV1(clsB) : ['', ''];
            teamsB.push({
              code: lB,
              className: clsB.toUpperCase(),
              lec: lecB || '',
              student1: s1B || v1s1 || 'Chờ cập nhật',
              student2: s2B || v1s2 || 'Chờ cập nhật'
            });
          }

          // Hỗ trợ cả bảng phẳng 1 danh sách
          if (teamsA.length === 0 && teamsB.length === 0) {
            for (let col = 0; col < Math.min(c.length, 10); col++) {
              const val = cell(c, col);
              if (/^TN-(ROB|C4K)-/i.test(val)) {
                const clsUpper = val.toUpperCase();
                const isJunior = /-(PRE|ARM)/i.test(clsUpper) && !/SEMI/i.test(clsUpper);
                const p1 = cell(c, col + 1);
                const p2 = cell(c, col + 2) || cell(cn, col + 1);
                const [v1s1, v1s2] = (!p1 || !p2) ? await getTop2FromV1(clsUpper) : ['', ''];
                const item = {
                  code: '',
                  className: clsUpper,
                  lec: '',
                  student1: p1 || v1s1 || 'Chờ cập nhật',
                  student2: p2 || v1s2 || 'Chờ cập nhật'
                };
                if (isJunior) teamsA.push(item);
                else teamsB.push(item);
                break;
              }
            }
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, teamsA, teamsB }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 4. Phục vụ file tĩnh (obs.html, admin.html, index.html, app.js, ui.js, obs-bg.jpg...)
  let safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT_DIR, decodeURIComponent(safePath));

  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

// Giữ kết nối SSE không bị timeout qua các cổng Tunnel
setInterval(() => {
  for (const res of clients) {
    try { res.write(': keepalive\n\n'); } catch (e) { clients.delete(res); }
  }
}, 15000);

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lanIps = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        lanIps.push(net.address);
      }
    }
  }
  console.log('====================================================================');
  console.log('🚀 TECH CLASH 2026 LIVE SERVER ĐÃ CHẠY!');
  console.log(`👉 Trên máy này:`);
  console.log(`   - Màn hình Phát OBS (Máy 1): http://localhost:${PORT}/obs.html`);
  console.log(`   - Trang Điền Điểm (Máy 2):   http://localhost:${PORT}/admin.html`);
  lanIps.forEach(ip => {
    console.log(`👉 Cùng mạng Wi-Fi / LAN (${ip}):`);
    console.log(`   - Màn hình Phát OBS (Máy 1): http://${ip}:${PORT}/obs.html`);
    console.log(`   - Trang Điền Điểm (Máy 2):   http://${ip}:${PORT}/admin.html`);
  });
  console.log('====================================================================');
});
