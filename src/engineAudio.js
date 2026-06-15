// 以 Web Audio 合成噴射引擎聲(以寬頻「轟鳴」為主，非電子蜂鳴)：
//   低頻隆隆 + 中頻轟鳴 + 高頻氣流嘶聲(皆為過濾後的雜訊) + 微弱風扇嘯聲(正弦)。
// 音量/濾波/音高隨引擎轉速(rpm 0..1)變化；關車 rpm→0 → 自然降頻降音(spool-down)到靜音。
// 採合成：可控的 spool-down、與扇葉視覺同步、無外部檔案/授權問題。
// 不同引擎音色設定：GE90(777，超大風扇)更低沉雄厚；GEnx(787)較高的風扇嘯聲。
const ENGINE_PROFILES = {
  GEnx: { roarBase: 300, roarSpan: 320, whineBase: 520, whineSpan: 720, rumbleHz: 180, rumble: 0.5, roar: 0.55, whine: 0.035 }, // 787
  GE90: { roarBase: 210, roarSpan: 240, whineBase: 360, whineSpan: 520, rumbleHz: 130, rumble: 0.7, roar: 0.62, whine: 0.045 }, // 777
  TrentXWB: { roarBase: 240, roarSpan: 270, whineBase: 430, whineSpan: 600, rumbleHz: 150, rumble: 0.62, roar: 0.58, whine: 0.04 }, // A350(廣體渦扇)
  LEAP: { roarBase: 330, roarSpan: 350, whineBase: 600, whineSpan: 780, rumbleHz: 200, rumble: 0.42, roar: 0.5, whine: 0.045 }, // 737MAX/A320(窄體現代渦扇,較高嘯聲)
  // PW127(ATR72 渦輪螺旋槳)：低沉螺旋槳嗡鳴為主、幾乎無高頻嘶聲/風扇嘯聲，prop=true 額外加槳葉拍頻。
  PW127: { roarBase: 150, roarSpan: 130, whineBase: 200, whineSpan: 150, rumbleHz: 95, rumble: 0.8, roar: 0.5, whine: 0.02, prop: true },
};

export class EngineAudio {
  constructor() { this.ctx = null; this.started = false; this.profile = ENGINE_PROFILES.GEnx; }

  setEngineType(type) {
    this.profile = ENGINE_PROFILES[type] || ENGINE_PROFILES.GEnx;
    if (this.lpRumble) this.lpRumble.frequency.value = this.profile.rumbleHz;
  }

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
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = this.profile.rumbleHz; lp.Q.value = 0.6;
    this.lpRumble = lp;
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

    // 螺旋槳葉片拍頻嗡鳴(鋸齒波基頻+諧波經低通 → 溫暖的渦槳「嗡嗡嗡」聲)；僅 prop:true 機型(ATR72)啟用。
    const propLp = ctx.createBiquadFilter(); propLp.type = 'lowpass'; propLp.frequency.value = 720; propLp.Q.value = 0.7;
    this.prop = ctx.createGain(); this.prop.gain.value = 0;
    propLp.connect(this.prop); this.prop.connect(this.master);
    this.propOscs = [];
    [1, 2, 3].forEach((mult, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 88 * mult;
      const g = ctx.createGain(); g.gain.value = [1, 0.5, 0.28][i];
      o.connect(g); g.connect(propLp); o.start(); this.propOscs.push(o);
    });

    this.started = true;
  }

  // 視窗失焦/切到背景時靜音並暫停(否則 Web Audio 會在背景持續嗡嗡發聲)，回前景再恢復。
  // 關鍵：先把總音量歸零(保證立即靜音、不依賴 suspend 的時機)，再 suspend 省 CPU。
  setActive(on) {
    if (!this.ctx || !this.master) return;
    if (on) {
      if (this.ctx.state === 'suspended') this.ctx.resume(); // 音量由 setRPM 自動回升
    } else {
      try {
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setValueAtTime(0, this.ctx.currentTime);
      } catch (e) { /* ignore */ }
      if (this.ctx.state === 'running') this.ctx.suspend();
    }
  }

  setRPM(rpm, spd = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.3;
    const r = Math.max(0, Math.min(1, rpm));
    const thrust = Math.min(1, spd / 6);
    const p = this.profile;
    this.master.gain.setTargetAtTime(0.45, t, 0.1);
    this.rumble.gain.setTargetAtTime((p.rumble * r + 0.1) * (r > 0.01 ? 1 : 0), t, k);
    this.roar.gain.setTargetAtTime(p.roar * r * (0.7 + 0.3 * thrust), t, k);
    this.hiss.gain.setTargetAtTime(0.06 * r, t, k);
    this.whine.gain.setTargetAtTime(p.whine * r, t, k);
    this.roarBP.frequency.setTargetAtTime(p.roarBase + r * p.roarSpan + thrust * 120, t, k);
    const wf = p.whineBase + r * p.whineSpan; // 風扇音高隨轉速；關車降回低點
    this.whineOscs.forEach((o, i) => o.frequency.setTargetAtTime(wf * (i ? 1.005 : 1), t, k));
    // 螺旋槳嗡鳴：僅渦槳機型(p.prop)發聲，葉片拍頻基頻隨轉速；關車隨 r→0 變慢停。
    if (this.prop) {
      const propOn = p.prop ? 1 : 0;
      this.prop.gain.setTargetAtTime(0.34 * r * propOn, t, k);
      const pf = 85 + r * 55;
      this.propOscs.forEach((o, i) => o.frequency.setTargetAtTime(pf * (i + 1), t, k));
    }
  }
}
