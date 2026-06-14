// 以 Web Audio 合成噴射引擎聲(以寬頻「轟鳴」為主，非電子蜂鳴)：
//   低頻隆隆 + 中頻轟鳴 + 高頻氣流嘶聲(皆為過濾後的雜訊) + 微弱風扇嘯聲(正弦)。
// 音量/濾波/音高隨引擎轉速(rpm 0..1)變化；關車 rpm→0 → 自然降頻降音(spool-down)到靜音。
// 採合成：可控的 spool-down、與扇葉視覺同步、無外部檔案/授權問題。
export class EngineAudio {
  constructor() { this.ctx = null; this.started = false; }

  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // 共用雜訊源(粉紅雜訊近似)，作為轟鳴/隆隆/嘶聲的來源
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    const makeNoise = () => { const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; n.start(); return n; };

    // 低頻隆隆
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 0.6;
    this.rumble = ctx.createGain(); this.rumble.gain.value = 0;
    makeNoise().connect(lp); lp.connect(this.rumble); this.rumble.connect(this.master);

    // 中頻轟鳴(主體)
    this.roarBP = ctx.createBiquadFilter(); this.roarBP.type = 'bandpass'; this.roarBP.frequency.value = 420; this.roarBP.Q.value = 0.8;
    this.roar = ctx.createGain(); this.roar.gain.value = 0;
    makeNoise().connect(this.roarBP); this.roarBP.connect(this.roar); this.roar.connect(this.master);

    // 高頻氣流嘶聲
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
    this.hiss = ctx.createGain(); this.hiss.gain.value = 0;
    makeNoise().connect(hp); hp.connect(this.hiss); this.hiss.connect(this.master);

    // 微弱風扇嘯聲(正弦，兩個略微失諧)
    this.whine = ctx.createGain(); this.whine.gain.value = 0; this.whine.connect(this.master);
    this.whineOscs = [];
    [1, 1.005].forEach((m) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 900 * m;
      o.connect(this.whine); o.start(); this.whineOscs.push(o);
    });

    this.started = true;
  }

  setRPM(rpm, spd = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.3;
    const r = Math.max(0, Math.min(1, rpm));
    const thrust = Math.min(1, spd / 6);
    this.master.gain.setTargetAtTime(0.45, t, 0.1);
    this.rumble.gain.setTargetAtTime((0.5 * r + 0.1) * (r > 0.01 ? 1 : 0), t, k);
    this.roar.gain.setTargetAtTime(0.55 * r * (0.7 + 0.3 * thrust), t, k);
    this.hiss.gain.setTargetAtTime(0.06 * r, t, k);
    this.whine.gain.setTargetAtTime(0.035 * r, t, k);
    this.roarBP.frequency.setTargetAtTime(300 + r * 320 + thrust * 120, t, k);
    const wf = 500 + r * 700; // 風扇音高隨轉速；關車降回低點
    this.whineOscs.forEach((o, i) => o.frequency.setTargetAtTime(wf * (i ? 1.005 : 1), t, k));
  }
}
