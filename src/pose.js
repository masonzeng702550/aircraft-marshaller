// MediaPipe Pose 封裝：開鏡頭、初始化推論、每幀輸出 landmarks，並把骨架畫到 overlay。
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// 要畫的骨架連線（部分上半身為主）
const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [0, 11], [0, 12],
];

export class PoseTracker {
  constructor(video, overlay) {
    this.video = video;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d');
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.landmarks = null;
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    this.landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  }

  async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    await new Promise((res) => {
      this.video.onloadedmetadata = () => {
        this.video.play();
        res();
      };
    });
    this.overlay.width = this.video.videoWidth;
    this.overlay.height = this.video.videoHeight;
  }

  // 每幀呼叫；回傳 landmarks（或 null）
  detect(nowMs) {
    if (!this.landmarker || this.video.readyState < 2) return null;
    if (this.video.currentTime === this.lastVideoTime) return this.landmarks;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, nowMs);
    this.landmarks =
      result.landmarks && result.landmarks.length ? result.landmarks[0] : null;
    this.drawOverlay();
    return this.landmarks;
  }

  drawOverlay() {
    const ctx = this.octx;
    const w = this.overlay.width, h = this.overlay.height;
    ctx.clearRect(0, 0, w, h);
    if (!this.landmarks) return;

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(54,194,255,0.9)';
    for (const [a, b] of CONNECTIONS) {
      const pa = this.landmarks[a], pb = this.landmarks[b];
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * w, pa.y * h);
      ctx.lineTo(pb.x * w, pb.y * h);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    for (const p of this.landmarks) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
