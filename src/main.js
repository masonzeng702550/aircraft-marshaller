import { PoseTracker } from './pose.js';
import { classifyPose, StableGate, GESTURES } from './gesture.js';
import { Aircraft } from './aircraft.js';
import { GameScene } from './scene.js';
import { EngineAudio } from './engineAudio.js';

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
const aircraft = new Aircraft('B787'); // 預設 787
const gate = new StableGate(280);
const engineAudio = new EngineAudio();

// 分頁切到背景/離開頁面/視窗失焦時停止引擎聲，回到前景再恢復（避免背景持續嗡嗡發聲）。
const audioShouldPlay = () => document.hasFocus() && !document.hidden;
document.addEventListener('visibilitychange', () => engineAudio.setActive(audioShouldPlay()));
window.addEventListener('pagehide', () => engineAudio.setActive(false));
window.addEventListener('blur', () => engineAudio.setActive(false));
window.addEventListener('focus', () => engineAudio.setActive(audioShouldPlay()));
// 後備輪詢：blur/visibilitychange 在切到其他應用程式或內嵌情境不一定觸發，
// 而 rAF 在背景會暫停 → 用 setInterval(背景仍會觸發)每 0.5s 校正一次，確保失焦必靜音。
setInterval(() => engineAudio.setActive(audioShouldPlay()), 500);

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

// ── 機型選擇（787 / 777）──
function selectModel(key, btn) {
  aircraft.setType(key);
  scene.loadAircraft(key);
  engineAudio.setEngineType(key === 'B777' ? 'GE90' : 'GEnx'); // 777=GE90、787=GEnx
  aircraft.reset();
  document.querySelectorAll('#model-toggle button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
}
$('btn-787').addEventListener('click', (e) => selectModel('B787', e.currentTarget));
$('btn-777').addEventListener('click', (e) => selectModel('B777', e.currentTarget));

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
  engineAudio.start(); // 使用者手勢內啟用音訊
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
  let raw = GESTURES.NONE, conf = 0, tracked = false, lm = null;
  if (useKeyboard) {
    raw = keyboardGesture;
    conf = raw === GESTURES.NONE ? 0 : 1;
    tracked = true; // 鍵盤模式視為「有輸入」
  } else if (tracker) {
    lm = tracker.detect(now);
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
  // 有骨架時化身關節即時跟隨玩家手臂；無鏡頭(鍵盤)時退回離散姿勢
  if (lm) scene.setMarshallerFromLandmarks(lm);
  else scene.setMarshallerPose(raw);
  // 輪檔員依飛機位置示範「該做的手勢」，玩家照著做
  // 以鼻輪為基準判定停止（模型載入後場景會算出鼻輪相對機身中心的前向距離）
  if (scene.noseGearOffset != null) aircraft.noseRefOffset = scene.noseGearOffset;
  const advice = aircraft.recommendedCommand();
  scene.setChockmanPose(advice);
  engineAudio.setRPM(scene.engineRPM ?? 1, aircraft.speed); // 引擎聲隨轉速(關車 spool-down)
  scene.render();
  updateHUD(raw, conf, command, tracked, advice);

  requestAnimationFrame(loop);
}

function updateHUD(raw, conf, command, tracked, advice) {
  const adviceEl = $('hud-advice');
  if (adviceEl) {
    adviceEl.textContent = advice === GESTURES.NONE ? '—' : gestureLabel[advice];
    adviceEl.className = 'hud-val ' + (commandClass[advice] || '');
  }
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
