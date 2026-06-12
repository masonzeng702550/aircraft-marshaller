// 手勢分類器 — 規則式，輸入 MediaPipe Pose 的 33 個 normalized landmarks
// 座標為影像空間：x,y ∈ [0,1]，y 向下為正、x 向右為正。
// 判定一律以「玩家身體」為基準（person-relative），與鏡像顯示無關。

// MediaPipe Pose landmark 索引
const L = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
};

export const GESTURES = {
  NONE: 'NONE',
  GO: 'GO',                 // 前進 Move ahead（雙手向上招手）
  TURN_LEFT: 'TURN_LEFT',   // 左轉（右臂平舉當軸、左手向上招手）
  TURN_RIGHT: 'TURN_RIGHT', // 右轉（左臂平舉當軸、右手向上招手）
  SLOW: 'SLOW',             // 減速 Slow down（雙臂下伸拍動）
  STOP: 'STOP',             // 停止（雙臂頭頂交叉）
};

function visible(lm, i, min = 0.5) {
  const p = lm[i];
  return p && (p.visibility === undefined || p.visibility > min);
}

// 回傳 { gesture, confidence }
// 註：landmark x 為影像座標（0=左、1=右）。面對鏡頭時，玩家左手(15)會落在影像右側(x 較大)。
// 「玩家左臂往側邊舉」= 左手腕的 x 明顯大於身體中線。判定用方向性比較，避免手臂橫越身體誤判。
export function classifyPose(lm) {
  const need = [L.NOSE, L.L_SHOULDER, L.R_SHOULDER, L.L_WRIST, L.R_WRIST];
  for (const i of need) {
    if (!visible(lm, i, 0.3)) return { gesture: GESTURES.NONE, confidence: 0 };
  }

  const nose = lm[L.NOSE];
  const ls = lm[L.L_SHOULDER], rs = lm[L.R_SHOULDER];
  const le = lm[L.L_ELBOW], re = lm[L.R_ELBOW];
  const lw = lm[L.L_WRIST], rw = lm[L.R_WRIST];

  const shoulderY = (ls.y + rs.y) / 2;
  const midX = (ls.x + rs.x) / 2;
  const shoulderW = Math.abs(ls.x - rs.x) || 0.18; // 防 0

  // image y 向下：值越小越「高」。依 ICAO 標準動作（單幀近似版）判定。
  const lwAboveHead = lw.y < nose.y;
  const rwAboveHead = rw.y < nose.y;

  // 各手腕狀態（person-relative；面對鏡頭時玩家左手 x 較大）
  const up = (w) => w.y < shoulderY - shoulderW * 0.1;            // 高舉過肩（招手側）
  const lOut = lw.x - midX;                                       // 玩家左臂外展量
  const rOut = midX - rw.x;                                       // 玩家右臂外展量
  const horiz = (w, out) => Math.abs(w.y - shoulderY) < shoulderW * 0.85 && out > shoulderW * 0.9;
  const downOut = (w, out) => w.y > shoulderY + shoulderW * 1.0 && out > shoulderW * 0.5;

  const lUp = up(lw), rUp = up(rw);
  const lHoriz = horiz(lw, lOut), rHoriz = horiz(rw, rOut);

  // ── STOP：雙臂上舉過頭（頭頂交叉的最終姿勢）──
  if (lwAboveHead && rwAboveHead) {
    return { gesture: GESTURES.STOP, confidence: 0.95 };
  }

  // ── TURN_LEFT：右臂平舉當軸 + 左手向上招手 ──
  if (lUp && rHoriz && !rwAboveHead) {
    return { gesture: GESTURES.TURN_LEFT, confidence: 0.88 };
  }
  // ── TURN_RIGHT：左臂平舉當軸 + 右手向上招手 ──
  if (rUp && lHoriz && !lwAboveHead) {
    return { gesture: GESTURES.TURN_RIGHT, confidence: 0.88 };
  }

  // ── GO：雙手向上招手（雙手都高於肩、都在頭以下、未往兩側張開）──
  const notWide = lOut < shoulderW * 1.1 && rOut < shoulderW * 1.1;
  if (lUp && rUp && !lwAboveHead && !rwAboveHead && notWide) {
    return { gesture: GESTURES.GO, confidence: 0.82 };
  }

  // ── SLOW：雙臂下伸並向外張（由腰到膝拍動的近似）──
  if (downOut(lw, lOut) && downOut(rw, rOut)) {
    return { gesture: GESTURES.SLOW, confidence: 0.8 };
  }

  return { gesture: GESTURES.NONE, confidence: 0.2 };
}

// 去抖動穩定門：同一手勢需連續穩定 holdMs 才視為有效指令
export class StableGate {
  constructor(holdMs = 280) {
    this.holdMs = holdMs;
    this.current = GESTURES.NONE;
    this.candidate = GESTURES.NONE;
    this.since = 0;
  }
  // 回傳目前「已確認」的手勢
  update(gesture, nowMs) {
    if (gesture !== this.candidate) {
      this.candidate = gesture;
      this.since = nowMs;
    }
    if (nowMs - this.since >= this.holdMs && this.candidate !== this.current) {
      this.current = this.candidate;
    }
    return this.current;
  }
}
