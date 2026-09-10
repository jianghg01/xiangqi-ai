// Electron 主进程：加载 Vite 页面 + 托管皮卡鱼引擎子进程（UCI stdin/stdout 桥）
const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let win = null;
let eng = null;

// 打包版：file:// 下 ES module 会被 CORS 拦截，改用自定义 app:// 协议加载 dist
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function distDir() {
  return path.join(__dirname, '..', 'dist');
}

function registerAppProtocol() {
  protocol.handle('app', req => {
    try {
      const u = new URL(req.url);
      let file = path.join(distDir(), decodeURIComponent(u.pathname));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(distDir(), 'index.html');
      }
      const ext = path.extname(file).toLowerCase();
      return new Response(fs.readFileSync(file), {
        headers: { 'content-type': MIME[ext] || 'application/octet-stream' },
      });
    } catch (_) {
      return new Response('not found', { status: 404 });
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    title: '象棋 AI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 打包版加载 app:// 自定义协议（ES module 兼容）；dev 由 VITE_URL 指向 Vite 开发服务器
  if (process.env.VITE_URL) {
    win.loadURL(process.env.VITE_URL);
  } else {
    win.loadURL('app://dist/index.html');
  }
  win.on('closed', () => { win = null; });
}

// 引擎 exe 路径解析：兼容 dev（gui 为 cwd，引擎在 ../engine）与打包版（resources/app/engine）
function resolveEnginePath(p) {
  if (!p) return null;
  const base = path.basename(p);
  const candidates = [
    p,
    path.join(process.cwd(), p),
    path.join(__dirname, '..', p),
    path.join(__dirname, '..', 'engine', base),
    path.join(__dirname, '..', '..', 'engine', base),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return path.resolve(c); } catch (_) { /* ignore */ }
  }
  return null;
}

ipcMain.handle('engine:start', (_e, exePath) => {
  return new Promise((resolve, reject) => {
    if (eng) return resolve(true);
    if (!exePath) return reject(new Error('未指定引擎路径'));
    const resolved = resolveEnginePath(exePath);
    if (!resolved) return reject(new Error('找不到引擎程序: ' + exePath));
    exePath = resolved;
    try {
      eng = spawn(exePath, [], { cwd: path.dirname(exePath) });
    } catch (err) {
      return reject(err);
    }
    let buf = '';
    eng.stdout.setEncoding('utf8');
    eng.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line && win) win.webContents.send('engine:line', line);
      }
    });
    eng.stderr.on('data', () => {});
    eng.on('error', err => { eng = null; if (win) win.webContents.send('engine:line', 'ENGINE_ERROR ' + err.message); });
    eng.on('exit', code => {
      eng = null;
      if (win) win.webContents.send('engine:line', 'ENGINE_EXIT ' + code);
    });
    resolve(true);
  });
});

ipcMain.on('engine:write', (_e, cmd) => {
  if (eng && eng.stdin && eng.stdin.writable) eng.stdin.write(cmd + '\n');
});

// 棋谱保存/打开（系统文件对话框）
const FILE_KINDS = {
  json: { name: '棋谱 JSON', extensions: ['json'] },
  pgn: { name: '象棋 PGN', extensions: ['pgn'] },
};

ipcMain.handle('file:save', async (_e, { defaultName, content, kind }) => {
  const filters = [FILE_KINDS[kind] || FILE_KINDS.json];
  const r = await dialog.showSaveDialog(win, {
    title: '保存棋谱',
    defaultPath: defaultName,
    filters,
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, content, 'utf8');
  return r.filePath;
});

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '打开棋谱',
    filters: [FILE_KINDS.json, FILE_KINDS.pgn],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return { path: r.filePaths[0], content: fs.readFileSync(r.filePaths[0], 'utf8') };
});

// 导出棋盘局面 PNG（dataUrl -> 二进制写入）
ipcMain.handle('file:save-image', async (_e, { defaultName, dataUrl }) => {
  const r = await dialog.showSaveDialog(win, {
    title: '导出局面图片',
    defaultPath: defaultName,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(r.filePath, Buffer.from(base64, 'base64'));
  return r.filePath;
});

ipcMain.handle('engine:alive', () => !!eng);

// ---------- 棋谱库（gui/games/ 目录：列表/读取/保存/删除） ----------
function libDir() { return path.join(__dirname, '..', 'games'); }

ipcMain.handle('lib:list', () => {
  try {
    const dir = libDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json') || f.endsWith('.pgn'))
      .map(f => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (e) { return { error: String(e) }; }
});

ipcMain.handle('lib:read', (_e, name) => {
  try {
    const file = path.join(libDir(), path.basename(String(name)));
    if (!fs.existsSync(file)) return { error: '文件不存在' };
    return { content: fs.readFileSync(file, 'utf8') };
  } catch (e) { return { error: String(e) }; }
});

ipcMain.handle('lib:save', (_e, { name, content }) => {
  try {
    const dir = libDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, path.basename(String(name))), String(content), 'utf8');
    return true;
  } catch (e) { return { error: String(e) }; }
});

ipcMain.handle('lib:delete', (_e, name) => {
  try { fs.unlinkSync(path.join(libDir(), path.basename(String(name)))); return true; }
  catch (e) { return { error: String(e) }; }
});

app.whenReady().then(() => {
  if (!process.env.VITE_URL) registerAppProtocol();
  createWindow();
});
app.on('window-all-closed', () => {
  if (eng) { try { eng.stdin.write('quit\n'); eng.kill(); } catch (_) {} }
  app.quit();
});
