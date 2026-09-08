// Electron 主进程：加载 Vite 页面 + 托管皮卡鱼引擎子进程（UCI stdin/stdout 桥）
const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let win = null;
let eng = null;

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
  win.loadURL(process.env.VITE_URL || 'http://localhost:5173');
  win.on('closed', () => { win = null; });
}

ipcMain.handle('engine:start', (_e, exePath) => {
  return new Promise((resolve, reject) => {
    if (eng) return resolve(true);
    if (!exePath) return reject(new Error('未指定引擎路径'));
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

ipcMain.handle('engine:alive', () => !!eng);

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (eng) { try { eng.stdin.write('quit\n'); eng.kill(); } catch (_) {} }
  app.quit();
});
