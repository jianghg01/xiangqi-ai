// 界面外观模块：棋盘皮肤 / 界面主题 / 自定义棋盘底纹（均 localStorage 持久化）
import { BOARD_THEMES, BoardView } from './board-view';

export function initAppearance(view: BoardView, setStatus: (msg: string) => void) {
  // ---------- 棋盘皮肤 ----------
  const themeSel = document.getElementById('themeSel') as HTMLSelectElement;
  for (const [k, v] of Object.entries(BOARD_THEMES)) {
    themeSel.add(new Option(v.name, k));
  }
  let saved = 'classic';
  try {
    saved = localStorage.getItem('xz_theme') || 'classic';
  } catch {
    /* 忽略 */
  }
  if (BOARD_THEMES[saved]) {
    themeSel.value = saved;
    view.setThemeByName(saved);
  }
  themeSel.addEventListener('change', () => {
    view.setThemeByName(themeSel.value);
    try {
      localStorage.setItem('xz_theme', themeSel.value);
    } catch {
      /* 忽略 */
    }
  });

  // ---------- 界面主题（深色默认 / 浅色 / 跟随系统，localStorage 持久化） ----------
  const uiThemeSel = document.getElementById('uiTheme') as HTMLSelectElement;
  const UI_THEME_KEY = 'xz_ui_theme';
  function applyUiTheme(mode: string) {
    let actual: string;
    if (mode === 'light') actual = 'light';
    else if (mode === 'auto')
      actual = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    else actual = 'dark';
    document.documentElement.dataset.theme = actual;
  }
  let savedTheme = 'auto';
  try {
    savedTheme = localStorage.getItem(UI_THEME_KEY) || 'auto';
  } catch {
    /* 忽略 */
  }
  if (!['auto', 'dark', 'light'].includes(savedTheme)) savedTheme = 'auto';
  uiThemeSel.value = savedTheme;
  applyUiTheme(savedTheme);
  uiThemeSel.addEventListener('change', () => {
    applyUiTheme(uiThemeSel.value);
    try {
      localStorage.setItem(UI_THEME_KEY, uiThemeSel.value);
    } catch {
      /* 忽略 */
    }
  });
  // 跟随系统：系统主题变化时实时切换
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (uiThemeSel.value === 'auto') applyUiTheme('auto');
  });

  // ---------- 自定义棋盘底纹（本地图片 → dataURL，localStorage 持久化） ----------
  const BG_KEY = 'xz_board_bg';
  const bgFileInput = document.getElementById('bgFile') as HTMLInputElement;
  const btnBgPick = document.getElementById('btnBgPick') as HTMLButtonElement;
  const btnBgClear = document.getElementById('btnBgClear') as HTMLButtonElement;
  function applyBoardBg() {
    let url = '';
    try {
      url = localStorage.getItem(BG_KEY) || '';
    } catch {
      /* 忽略 */
    }
    view.setCustomBg(url || null);
    btnBgClear.style.display = url ? '' : 'none';
  }
  bgFileInput.addEventListener('change', () => {
    const f = bgFileInput.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const url = String(rd.result || '');
      try {
        localStorage.setItem(BG_KEY, url);
      } catch {
        setStatus('图片过大，无法保存底纹（建议 <2MB）');
        return;
      }
      applyBoardBg();
      setStatus('已应用自定义棋盘底纹');
    };
    rd.readAsDataURL(f);
    bgFileInput.value = '';
  });
  btnBgPick.addEventListener('click', () => bgFileInput.click());
  btnBgClear.addEventListener('click', () => {
    try {
      localStorage.removeItem(BG_KEY);
    } catch {
      /* 忽略 */
    }
    applyBoardBg();
    setStatus('已恢复默认棋盘');
  });
  applyBoardBg();
}
