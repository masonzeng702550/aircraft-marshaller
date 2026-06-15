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
  const shoulderW = Math.abs(ls.x - rs.x) || 0.18; // 防 0

  // image y 向下：值越小越「高」。指揮棒信號：大臂平舉、小臂在「平舉↔直舉」擺動。
  const up = (w) => w.y < shoulderY - shoulderW * 0.2;            // 小臂直舉→手腕明顯高於肩
  const down = (w) => w.y > shoulderY + shoulderW * 0.55;         // 雙手下伸（減速起手式）
  const lUp = up(lw), rUp = up(rw);

  // ── STOP：雙臂高舉過頭(雙腕明顯高於鼻) ──
  // 註：MediaPipe 只給「手腕」位置，不是指揮棒頂端。玩家把雙臂高舉、兩支指揮棒在頭頂交叉時，
  // 手腕本身常仍與肩同寬、不會交叉。故只要「雙腕都明顯過頭且未大字張開」即判停止(不強求手腕交叉)。
  const overhead = lw.y < nose.y - shoulderW * 0.35 && rw.y < nose.y - shoulderW * 0.35;
  const notSpread = Math.abs(lw.x - rw.x) < shoulderW * 1.3; // 收攏/交叉(X或V),排除大字平張
  if (overhead && notSpread) {
    return { gesture: GESTURES.STOP, confidence: 0.95 };
  }

  // ── GO(前進)：雙手小臂都直舉(都過肩)且左右對稱(高度接近) → 與「單手高/單手平」的轉彎區分 ──
  const symmetric = Math.abs(lw.y - rw.y) < shoulderW * 0.5;
  if (lUp && rUp && symmetric) {
    return { gesture: GESTURES.GO, confidence: 0.85 };
  }

  // ── TURN_LEFT：左手明顯比右手高且直舉(右手小臂保持平舉當軸) ──
  if (lUp && lw.y < rw.y - shoulderW * 0.5) {
    return { gesture: GESTURES.TURN_LEFT, confidence: 0.85 };
  }
  // ── TURN_RIGHT：右手明顯比左手高 ──
  if (rUp && rw.y < lw.y - shoulderW * 0.5) {
    return { gesture: GESTURES.TURN_RIGHT, confidence: 0.85 };
  }

  // ── SLOW(減速)：雙手都往下（減速到停的起手式）──
  if (down(lw) && down(rw)) {
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
