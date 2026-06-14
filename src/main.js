import { PoseTracker } from './pose.js';
import { classifyPose, StableGate, GESTURES } from './gesture.js';
import { Aircraft } from './aircraft.js';
import { GameScene } from './scene.js';

const $ = (id) => document.getElementById(id);

const gestureLabel = {
  [GESTURES.NONE]: '—',
  [GESTURES.GO]: '前進',
  [GESTURES.TURN_LEFT]: '左轉',
  [GESTURES.TURN_RIGHT]: '右轉',
  [GESTURES.SLOW]: '減速',
  [GESTURES.STOP]: '停止',
};
const commandClass = {
  [GESTURES.GO]: 'cmd-go',
  [GESTURES.TURN_LEFT]: 'cmd-turn',
  [GESTURES.TURN_RIGHT]: 'cmd-turn',
  [GESTURES.SLOW]: 'cmd-turn',
  [GESTURES.STOP]: 'cmd-stop',
};

const scene = new GameScene($('scene'));
const aircraft = new Aircraft('WIDE'); // 787 為廣體機
const gate = new StableGate(280);

let tracker = null;
let useKeyboard = false;
let keyboardGesture = GESTURES.NONE;
let running = false;
let lastT = performance.now();

// ── 視角切換 ──
$('btn-tpv').addEventListener('click', () => {
  scene.setView('TPV');
  $('btn-tpv').classList.add('active');
  $('btn-fpv').classList.remove('active');
});
$('btn-fpv').addEventListener('click', () => {
  scene.setView('FPV');
  $('btn-fpv').classList.add('active');
  $('btn-tpv').classList.remove('active');
});

// ── 鍵盤備援 ──
const keyMap = {
  w: GESTURES.GO, a: GESTURES.TURN_LEFT, d: GESTURES.TURN_RIGHT,
  s: GESTURES.STOP, q: GESTURES.SLOW,
};
window.addEventListener('keydown', (e) => {
  const g = keyMap[e.key.toLowerCase()];
  if (g) { keyboardGesture = g; useKeyboard = true; }
  if (e.key === 'r' || e.key === 'R') aircraft.reset();
});
window.addEventListener('keyup', (e) => {
  const g = keyMap[e.key.toLowerCase()];
  if (g && keyboardGesture === g) keyboardGesture = GESTURES.NONE;
});

// 逾時保護：避免 getUserMedia / 模型載入無限卡住
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' 逾時')), ms)),
  ]);
}

// ── 啟動 ──
$('btn-start').addEventListener('click', async () => {
  const btn = $('btn-start');
  $('start-error').textContent = '';
  btn.disabled = true;
  btn.textContent = '載入模型中…';
  try {
    tracker = new PoseTracker($('cam'), $('overlay'));
    await withTimeout(tracker.init(), 20000, '模型載入');
    btn.textContent = '等待鏡頭授權…';
    await withTimeout(tracker.startCamera(), 15000, '鏡頭開啟');
  } catch (err) {
    console.warn('鏡頭/模型初始化失敗，改用鍵盤模式：', err);
    tracker = null;
    useKeyboard = true;
    $('start-error').textContent =
      '無法開啟鏡頭（' + err.message + '），已切換為鍵盤模式（W/A/D/S）。';
  }
  $('start-overlay').style.display = 'none';
  running = true;
  lastT = performance.now();
  requestAnimationFrame(loop);
});

function loop(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  // 取得當前手勢
  let raw = GESTURES.NONE, conf = 0, tracked = false;
  if (useKeyboard) {
    raw = keyboardGesture;
    conf = raw === GESTURES.NONE ? 0 : 1;
    tracked = true; // 鍵盤模式視為「有輸入」
  } else if (tracker) {
    const lm = tracker.detect(now);
    if (lm) {
      tracked = true;
      const res = classifyPose(lm);
      raw = res.gesture;
      conf = res.confidence;
    }
  }

  const command = gate.update(raw, now);
  aircraft.setCommand(command);
  aircraft.update(dt);
  scene.syncAircraft(aircraft);
  scene.setMarshallerPose(raw); // 化身即時鏡像玩家動作
  scene.render();
  updateHUD(raw, conf, command, tracked);

  requestAnimationFrame(loop);
}

function updateHUD(raw, conf, command, tracked) {
  const trackEl = $('hud-track');
  if (useKeyboard) {
    trackEl.textContent = '鍵盤模式';
    trackEl.className = 'hud-val cmd-turn';
  } else if (tracked) {
    trackEl.textContent = '偵測中';
    trackEl.className = 'hud-val cmd-go';
  } else {
    trackEl.textContent = '未偵測到人';
    trackEl.className = 'hud-val cmd-stop';
  }

  $('hud-gesture').textContent = gestureLabel[raw] || '—';
  $('hud-conf').style.width = Math.round(conf * 100) + '%';

  const cmdEl = $('hud-command');
  cmdEl.textContent = command === GESTURES.NONE ? 'IDLE' : gestureLabel[command];
  cmdEl.className = 'hud-val ' + (commandClass[command] || '');

  const d = aircraft.distanceToStopLine();
  const distEl = $('hud-dist');
  if (aircraft.crossedLine) {
    distEl.textContent = '越線!';
    distEl.className = 'hud-val cmd-stop';
  } else if (aircraft.stopped) {
    distEl.textContent = d.toFixed(1) + ' m（已停）';
    distEl.className = 'hud-val cmd-go';
  } else {
    distEl.textContent = d.toFixed(1) + ' m';
    distEl.className = 'hud-val';
  }

  const off = aircraft.centerlineOffset();
  const offEl = $('hud-offset');
  offEl.textContent = off.toFixed(1) + ' m';
  offEl.className = 'hud-val ' + (off < 0.6 ? 'cmd-go' : off < 2 ? 'cmd-turn' : 'cmd-stop');

  $('hud-speed').textContent = aircraft.speed.toFixed(1);
}

// 初始渲染一幀（遮罩後面可見場景）
scene.render();
