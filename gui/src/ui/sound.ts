// 音效模块（Web Audio 合成·天天象棋风格，无外部资源）
// 默认关闭，设置持久化到 localStorage（key: xz_sound）

let soundOn = localStorage.getItem('xz_sound') === '1';
let audioCtx: AudioContext | null = null;

// 木子敲击"嗒"：低频正弦快速下滑（模拟棋子撞击木质棋盘的闷响）
function knockAt(t: number, f0: number, vol: number, dur: number) {
  const osc = audioCtx!.createOscillator();
  const gain = audioCtx!.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(audioCtx!.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// 落子瞬间的"沙"声：极短噪声过带通（模拟棋子与盘面的摩擦质感）
function clickNoiseAt(t: number, vol: number, dur = 0.03) {
  const ctx = audioCtx!;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2200;
  bp.Q.value = 1.2;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(bp).connect(gain).connect(ctx.destination);
  src.start(t);
}

export function playSound(kind: 'move' | 'capture' | 'check') {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const t = audioCtx.currentTime + 0.01;
    if (kind === 'move') {
      // 落子：清脆一声"嗒"（噪声质感 + 木质闷响）
      clickNoiseAt(t, 0.8);
      knockAt(t, 210, 0.5, 0.09);
    } else if (kind === 'capture') {
      // 吃子：更重的"啪"（响亮噪声 + 低频重击 + 余震）
      clickNoiseAt(t, 1.0);
      knockAt(t, 170, 0.8, 0.12);
      knockAt(t + 0.06, 120, 0.5, 0.14);
    } else {
      // 将军：急促"哒哒—哒"三连警示
      knockAt(t, 320, 0.5, 0.1);
      knockAt(t + 0.12, 320, 0.5, 0.1);
      knockAt(t + 0.24, 430, 0.6, 0.14);
    }
  } catch {
    // 音频不可用时静默
  }
}

// 初始化音效按钮：显示当前开关状态并绑定点击切换
export function initSound() {
  const btn = document.getElementById('btnSound') as HTMLButtonElement | null;
  if (!btn) return;
  const refresh = () => {
    btn.textContent = soundOn ? '🔊音效:开' : '🔇音效:关';
  };
  refresh();
  btn.addEventListener('click', () => {
    soundOn = !soundOn;
    try {
      localStorage.setItem('xz_sound', soundOn ? '1' : '0');
    } catch {
      /* 忽略存储失败 */
    }
    refresh();
  });
}
