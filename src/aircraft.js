// 飛機物理 + 簡單狀態機（M0）。
// 場景約定：停機線（lead-in line）沿 Z 軸、x=0；停止線在 z = STOP_LINE_Z。
// 飛機沿與停機線垂直(90°)的滑行道從側邊滑入，玩家須指揮它轉 90° 對齊到中心線。
import { GESTURES } from './gesture.js';

// 速度單位為 m/s。1 knot ≈ 0.514 m/s。
export const KNOT = 0.514;
export const STOP_LINE_Z = 8;
// 停機坪放大到可容納 747(長~76m/翼展~68m)：更寬、更深
export const TAXIWAY_Z = 118; // 垂直滑行道所在的 Z（飛機從這條線的左/右端、更遠處進場）
const ENTRY_X = 68; // 進場時距中心線的橫向距離（更寬）
// 轉彎/進入停機坪後的限速（真實作業約 5 knots 以下）
const STAND_SPEED = 5 * KNOT;     // ≈ 2.57 m/s
const STAND_ZONE_Z = TAXIWAY_Z - 8; // 越過此 Z 視為已進入導入弧/停機坪，須慢速
// 機鼻距機身參考點(中心)的距離（787 比例），用機鼻判定停止/距離
export const NOSE_OFFSET = 22;

// 機型參數（通用/虛構塗裝）。maxSpeed = 滑行道直線最高速（約 12~15 kt）。
// 轉向採「自行車模型」：航向變化率 = 地速 · tan(鼻輪角) / 軸距(wheelbase)。
//   → 路徑曲率完全由鼻輪打角決定(視覺=運動，不會看起來在飄移)；打到 steerDeg 即最小迴轉半徑。
// steerDeg = 鼻輪最大打角(度)；wheelbase = 鼻輪到主輪的軸距(遊戲單位)。
// wingspan 取真實翼展(m)：廣體~777 60。
export const AIRCRAFT_TYPES = {
  // B787-9：長 63m、翼展 60m。鼻輪最大 40°、軸距~24 → 迴轉半徑 R≈24/tan40°≈29m(平緩圓弧、有慣性)。
  B787: { label: '787', maxSpeed: 11 * KNOT, idle: 5 * KNOT, standSpeed: 4 * KNOT, accel: 1.2, brake: 1.8, steerDeg: 40, wheelbase: 24, wingspan: 60 },
  // B777-300ER：軸距~31 → 鼻輪最大 44°、R≈31/tan44°≈32m(原 46m 弧度太小/太直，加大轉彎曲率)。
  B777: { label: '777', maxSpeed: 10 * KNOT, idle: 4.5 * KNOT, standSpeed: 3.5 * KNOT, accel: 1.0, brake: 1.5, steerDeg: 44, wheelbase: 31, wingspan: 65 },
  // A350-1000：長 73.8m、翼展 64.8m，廣體 → 軸距~33、鼻輪 40°、R≈39m。
  A350: { label: 'A350', maxSpeed: 10 * KNOT, idle: 4.5 * KNOT, standSpeed: 3.5 * KNOT, accel: 1.0, brake: 1.5, steerDeg: 40, wheelbase: 33, wingspan: 65 },
  // B737 MAX 8：長 39.5m、翼展 35.9m，窄體 → 軸距~14、鼻輪 45°、R≈14m，較靈活。
  B737: { label: '737', maxSpeed: 11 * KNOT, idle: 5 * KNOT, standSpeed: 4 * KNOT, accel: 1.3, brake: 1.9, steerDeg: 45, wheelbase: 14, wingspan: 36 },
  // A320-200：長 37.6m、翼展 35.8m，窄體 → 軸距~13、鼻輪 45°、R≈13m。
  A320: { label: 'A320', maxSpeed: 11 * KNOT, idle: 5 * KNOT, standSpeed: 4 * KNOT, accel: 1.3, brake: 1.9, steerDeg: 45, wheelbase: 13, wingspan: 36 },
  // ATR72-600：長 27.2m、翼展 27m，區域渦槳 → 軸距~10、鼻輪 50°、R≈8m，最靈活、整體較慢。
  ATR72: { label: 'ATR72', maxSpeed: 8 * KNOT, idle: 4.5 * KNOT, standSpeed: 3.5 * KNOT, accel: 1.3, brake: 1.8, steerDeg: 50, wheelbase: 10, wingspan: 27 },
};

export class Aircraft {
  constructor(typeKey = 'NARROW') {
    this.setType(typeKey);
    this.reset();
  }

  setType(typeKey) {
    this.typeKey = typeKey;
    this.spec = AIRCRAFT_TYPES[typeKey];
  }

  reset() {
    // 從左或右端沿垂直滑行道進場：機頭朝中心線方向（90°），自動滑行進場
    const side = Math.random() < 0.5 ? -1 : 1; // -1 左、+1 右
    this.startSide = side;
    this.x = side * ENTRY_X;
    this.z = TAXIWAY_Z;
    // 機頭世界方向 = (-sin heading, -cos heading)。heading=0 → 機頭朝 -Z（朝停機位/玩家）。
    // 從左端(x<0)機頭朝 +X(heading=-90°)、從右端朝 -X(heading=+90°)，即與中心線垂直、朝中心線。
    this.heading = side * (Math.PI / 2);
    this.steerAngle = 0; // 鼻輪當前打角(rad)，平滑趨近目標
    this.pitch = 0;      // 機身俯仰(剎車前傾)，負=機鼻向下
    this.pitchVel = 0;
    this._prevSpeed = 0;
    this.speed = 0;
    this.command = GESTURES.NONE;
    this.stopped = false;
    this.crossedLine = false;
    this.outOfBounds = false;
  }

  centerlineOffset() {
    return Math.abs(this.x);
  }
  // 航向偏差：0 = 正對停機位(-Z)，π/2 = 與中心線垂直
  headingError() {
    let h = this.heading % (Math.PI * 2);
    if (h > Math.PI) h -= Math.PI * 2;
    if (h < -Math.PI) h += Math.PI * 2;
    return Math.abs(h);
  }

  setCommand(cmd) {
    this.command = cmd;
  }

  // dt：秒
  update(dt) {
    const s = this.spec;
    const steerMax = (s.steerDeg || 34) * Math.PI / 180;
    if (!this.stopped) {
    let targetSpeed = s.idle; // 預設自動滑行（一直在動）
    let turning = false;
    let steerTarget = 0; // 鼻輪目標打角
    switch (this.command) {
      case GESTURES.GO:
        targetSpeed = s.maxSpeed;
        break;
      case GESTURES.TURN_LEFT:
        targetSpeed = s.maxSpeed;
        steerTarget = steerMax; // 鼻輪左打
        turning = true;
        break;
      case GESTURES.TURN_RIGHT:
        targetSpeed = s.maxSpeed;
        steerTarget = -steerMax; // 鼻輪右打
        turning = true;
        break;
      case GESTURES.SLOW:
        // 「減速到停」只在接近停止線 10m 內才生效(此動作是停止線前告訴機師準備踩全煞車)；太遠則維持滑行、不誤停。
        targetSpeed = this.distanceToStopLine() <= 10 ? s.standSpeed * 0.5 : s.idle;
        break;
      case GESTURES.STOP:
        targetSpeed = this.distanceToStopLine() <= 10 ? 0 : s.idle; // 雙手交叉=停；僅 10m 內生效
        break;
      default:
        targetSpeed = s.idle; // 無指令：維持低速滑行
    }

    // 對準中心線輔助轉向：主轉彎後航向大致對齊、仍偏離中線，且玩家正下達「朝中線」的轉向 →
    // 啟用加力自動瞄準(比例導引)：反應比手動更強更準，協助貼齊中線(玩家手勢=確認觸發)。
    const towardCenter = this.x > 0 ? GESTURES.TURN_LEFT : GESTURES.TURN_RIGHT; // 飛機左=-X
    if (this.headingError() < 0.45 && Math.abs(this.x) > 0.08 && this.command === towardCenter) {
      let h = this.heading % (Math.PI * 2);
      if (h > Math.PI) h -= Math.PI * 2; else if (h < -Math.PI) h += Math.PI * 2;
      // 朝中線的截獲航向(夾在 ±0.3 < 對齊門檻 0.45，避免自我關閉而衝過頭)，再高增益轉至該航向
      const captureHeading = Math.max(-0.3, Math.min(0.3, this.x * 0.2));
      steerTarget = Math.max(-steerMax, Math.min(steerMax, (captureHeading - h) * 3)); // 高增益=加大力道
      turning = true;
    }

    // 漸進限速：越接近轉彎線（中心線 x=0）越慢，離得遠才能滑快一點
    const distToTurnLine = Math.max(0, Math.abs(this.x) - 4);
    let cap = Math.min(s.maxSpeed, s.standSpeed + distToTurnLine * 0.16);
    // 轉彎或已進入導入弧/停機坪 → 直接限到 5 knots 以下（真實作業）
    if (turning || this.z < STAND_ZONE_Z) cap = s.standSpeed;
    targetSpeed = Math.min(targetSpeed, cap);

    // 加減速（朝 targetSpeed 逼近）
    if (this.speed < targetSpeed) {
      this.speed = Math.min(targetSpeed, this.speed + s.accel * dt);
    } else {
      const decel = this.command === GESTURES.STOP ? s.brake : s.accel;
      this.speed = Math.max(targetSpeed, this.speed - decel * dt);
    }

    // 鼻輪打角「緩慢」趨近目標(時間常數~0.4s)：轉向有慣性、緩緩切入/退出 → 平滑圓弧、不會瞬間反應
    this.steerAngle += (steerTarget - this.steerAngle) * Math.min(1, dt * 2.5);
    // 自行車模型：航向變化率 = 地速 · tan(鼻輪角) / 軸距。
    // 路徑曲率由鼻輪角決定 → 視覺鼻輪角與實際轉彎一致(不再像定速旋轉的「飄移」)。
    this.heading += this.speed * Math.tan(this.steerAngle) / s.wheelbase * dt;

    // 沿機頭方向前進：機頭世界方向 = (-sin heading, -cos heading)
    this.z -= Math.cos(this.heading) * this.speed * dt;
    this.x -= Math.sin(this.heading) * this.speed * dt;

    // 停止：在停止線 10m 內下了停止指令(雙手交叉)且已幾乎靜止 → 停妥
    if (this.command === GESTURES.STOP && this.distanceToStopLine() <= 10 && this.speed <= 0.03) {
      this.speed = 0;
      this.stopped = true;
    }
    // 越線（已對齊中心線卻讓機鼻衝過該機型停止線）
    if (this.noseZ() < this.stopLineZ() - 1.5 && Math.abs(this.x) < 4) {
      this.crossedLine = true;
    }
    // 開過頭/偏離場地 → 視為滑出，停住（容許進場橫距 ENTRY_X 再多一些）
    if (this.noseZ() < -6 || Math.abs(this.x) > 82 || this.z > TAXIWAY_Z + 14) {
      this.speed = 0;
      this.stopped = true;
      this.outOfBounds = true;
    }
    } // end if(!stopped)

    // 機身俯仰(剎車前傾慣性)：減速度驅動的彈簧-阻尼系統。
    // 放在 stopped 區塊外 → 即使剛停妥仍持續更新，讓機鼻「向前傾一下」後彈回水平。
    // 僅在「最後對準停止線、減速煞停」時才前傾；轉彎中與一般滑行不前傾。
    const decel = (this._prevSpeed - this.speed) / Math.max(dt, 1e-4); // 正=減速中
    this._prevSpeed = this.speed;
    const k = 40, c = 11, g0 = 0.27; // 彈簧勁度/阻尼/減速驅動增益(前傾幅度約 0.7 度)
    const brakingToStop = this.headingError() < 0.4 && Math.abs(this.x) < 6 &&
      this.distanceToStopLine() < 16 &&
      (this.command === GESTURES.STOP || this.command === GESTURES.SLOW);
    const drive = brakingToStop ? -g0 * Math.max(0, decel) : 0; // 只取減速分量、限定停止線前
    this.pitchVel += (-k * this.pitch - c * this.pitchVel + drive) * dt; // 減速→驅動機鼻向下(負)
    this.pitch += this.pitchVel * dt;
    this.pitch = Math.max(-0.07, Math.min(0.04, this.pitch));
  }

  // 停止基準點的 Z：以「鼻輪」為準(noseRefOffset，載入模型後由場景設定)，
  // 未取得時退回機鼻尖(NOSE_OFFSET)。沿機頭方向自中心點外推。
  noseZ() {
    const off = this.noseRefOffset ?? NOSE_OFFSET;
    return this.z - Math.cos(this.heading) * off;
  }

  // 該機型的鼻輪停止線 Z（stopRefZ 由場景依機型設定；未取得時退回 STOP_LINE_Z）
  stopLineZ() {
    return this.stopRefZ ?? STOP_LINE_Z;
  }

  // 距停止線（以鼻輪為準，正 = 還沒到，負 = 越線）
  distanceToStopLine() {
    return this.noseZ() - this.stopLineZ();
  }

  // 輪檔員的「建議指揮」：依飛機目前位置/航向推算玩家此刻該做的手勢。
  recommendedCommand() {
    if (this.stopped) return GESTURES.NONE;
    const d = this.distanceToStopLine();        // 機鼻距停止線
    const off = this.centerlineOffset();        // |x|
    const hErr = this.headingError();           // |heading|，0 = 對齊中心線(-Z)
    const steerMax = (this.spec.steerDeg || 34) * Math.PI / 180;
    const turnRadius = this.spec.wheelbase / Math.tan(steerMax); // 最小迴轉半徑

    // 1) 航向仍未對齊（剛從側邊進場）→ 接近到約一個轉彎半徑才開始轉，否則先前進
    if (hErr > 0.2) {
      if (off > turnRadius * 0.9) return GESTURES.GO;
      return this.heading > 0 ? GESTURES.TURN_RIGHT : GESTURES.TURN_LEFT;
    }
    // 2) 已大致對齊但仍偏離中心線 → 往中心線修正（飛機左=-X）
    if (off > 1.2) return this.x > 0 ? GESTURES.TURN_LEFT : GESTURES.TURN_RIGHT;
    // 3) 對齊且置中 → 依距停止線：遠則前進、近則減速、到線停止
    if (d <= 1.5) return GESTURES.STOP;
    if (d <= 10) return GESTURES.SLOW; // 停止線前 10m 開始示範「減速到停」
    return GESTURES.GO;
  }
}
