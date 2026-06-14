// 以 Web Audio 合成 787(GEnx) 風格引擎聲：高旁通比 → 以「風扇高頻嘯聲 + 低頻隆隆」為主。
// 音高/音量隨引擎轉速(rpm 0..1)變化；關車時 rpm→0，自然 spool-down 到靜音。
// 採合成而非錄音檔：可控的 spool-down、零外部相依/授權問題，且與扇葉視覺同步。
export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.whineOscs = [];
  }

  // 需在使用者手勢(按開始)後呼叫，否則瀏覽器會擋自動播放
  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    // 低頻隆隆：白雜訊 → 低通
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = buf; noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    noise.connect(lp); lp.connect(this.rumbleGain); this.rumbleGain.connect(this.master);
    noise.start();

    // 風扇嘯聲：數個諧波鋸齒波 → 帶通
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 1.6;
    bp.connect(this.whineGain); this.whineGain.connect(this.master);
    this.harmonics = [1, 1.5, 2.01, 3.0];
    this.harmonics.forEach((mult, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 200 * mult;
      const g = ctx.createGain(); g.gain.value = 0.35 / (i + 1);
      o.connect(g); g.connect(bp); o.start();
      this.whineOscs.push(o);
    });

    this.started = true;
  }

  // rpm: 0..1（引擎轉速比例）；spd：地速(可選，讓推力時音量略增)
  setRPM(rpm, spd = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const r = Math.max(0, Math.min(1, rpm));
    this.master.gain.setTargetAtTime(0.38, t, 0.1);
    this.rumbleGain.gain.setTargetAtTime(0.30 * r + 0.02 * Math.min(1, spd / 6), t, 0.25);
    this.whineGain.gain.setTargetAtTime(0.11 * r, t, 0.25);
    const base = 150 + r * 470; // 風扇嘯聲音高隨轉速升高；關車時降回低點
    this.whineOscs.forEach((o, i) => o.frequency.setTargetAtTime(base * this.harmonics[i], t, 0.25));
  }
}
