// 飛機物理 + 簡單狀態機（M0）。
// 場景約定：停機線（lead-in line）沿 Z 軸、x=0；停止線在 z = STOP_LINE_Z。
// 飛機沿與停機線垂直(90°)的滑行道從側邊滑入，玩家須指揮它轉 90° 對齊到中心線。
import { GESTURES } from './gesture.js';

// 速度單位為 m/s。1 knot ≈ 0.514 m/s。
export const KNOT = 0.514;
export const STOP_LINE_Z = 8;
export const TAXIWAY_Z = 80; // 垂直滑行道所在的 Z（飛機從這條線的左/右端、更遠處進場）
const ENTRY_X = 50; // 進場時距中心線的橫向距離（更遠）
// 轉彎/進入停機坪後的限速（真實作業約 5 knots 以下）
const STAND_SPEED = 5 * KNOT;     // ≈ 2.57 m/s
const STAND_ZONE_Z = TAXIWAY_Z - 8; // 越過此 Z 視為已進入導入弧/停機坪，須慢速
// 機鼻距機身參考點(中心)的距離（787 比例），用機鼻判定停止/距離
export const NOSE_OFFSET = 22;

// 機型參數（通用/虛構塗裝）。maxSpeed = 滑行道直線最高速（約 12~15 kt）。
// turnRate(rad/s) 取真實滑行轉彎半徑 R≈v/ω：窄體 ~21m、廣體 ~29m、區域機 ~17m。
// wingspan 取真實翼展(m)：窄體~A320 35.8、廣體~777 60、區域機~E-jet 26。
export const AIRCRAFT_TYPES = {
  NARROW: { label: '窄體', maxSpeed: 13 * KNOT, idle: 6 * KNOT, standSpeed: STAND_SPEED, accel: 1.8, brake: 2.6, turnRate: 0.12, wingspan: 36 },
  WIDE: { label: '廣體', maxSpeed: 11 * KNOT, idle: 5 * KNOT, standSpeed: 4 * KNOT, accel: 1.2, brake: 1.8, turnRate: 0.07, wingspan: 60 },
  REGIONAL: { label: '區域機', maxSpeed: 14 * KNOT, idle: 6 * KNOT, standSpeed: STAND_SPEED, accel: 2.0, brake: 3.0, turnRate: 0.15, wingspan: 26 },
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
    if (this.stopped) return;
    const s = this.spec;

    let targetSpeed = s.idle; // 預設自動滑行（一直在動）
    let turning = false;
    switch (this.command) {
      case GESTURES.GO:
        targetSpeed = s.maxSpeed;
        break;
      case GESTURES.TURN_LEFT:
        targetSpeed = s.maxSpeed;
        this.heading += s.turnRate * dt; // 飛機左轉
        turning = true;
        break;
      case GESTURES.TURN_RIGHT:
        targetSpeed = s.maxSpeed;
        this.heading -= s.turnRate * dt;
        turning = true;
        break;
      case GESTURES.SLOW:
        targetSpeed = s.standSpeed * 0.5; // 減速：便於精準停靠
        break;
      case GESTURES.STOP:
        targetSpeed = 0;
        break;
      default:
        targetSpeed = s.idle; // 無指令：維持低速滑行
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

    // 沿機頭方向前進：機頭世界方向 = (-sin heading, -cos heading)
    this.z -= Math.cos(this.heading) * this.speed * dt;
    this.x -= Math.sin(this.heading) * this.speed * dt;

    // 停止：下了停止指令且已幾乎靜止
    if (this.command === GESTURES.STOP && this.speed <= 0.03) {
      this.speed = 0;
      this.stopped = true;
    }
    // 越線（已對齊中心線卻讓機鼻衝過停止線）
    if (this.noseZ() < STOP_LINE_Z - 1.5 && Math.abs(this.x) < 4) {
      this.crossedLine = true;
    }
    // 開過頭/偏離場地 → 視為滑出，停住（容許進場橫距 ENTRY_X=50 再多一些）
    if (this.noseZ() < -6 || Math.abs(this.x) > 60 || this.z > TAXIWAY_Z + 12) {
      this.speed = 0;
      this.stopped = true;
      this.outOfBounds = true;
    }
  }

  // 機鼻的 Z（沿機頭方向自中心點外推 NOSE_OFFSET）
  noseZ() {
    return this.z - Math.cos(this.heading) * NOSE_OFFSET;
  }

  // 距停止線（以機鼻為準，正 = 還沒到，負 = 越線）
  distanceToStopLine() {
    return this.noseZ() - STOP_LINE_Z;
  }
}
