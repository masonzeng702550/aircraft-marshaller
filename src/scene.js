// Three.js 場景：機坪、中心線、停止線、飛機（積木組合）、NPC 占位、空橋占位。
// 提供第三人稱(TPV)與第一人稱(FPV)兩種相機。
import * as THREE from 'three';
import { STOP_LINE_Z, TAXIWAY_Z } from './aircraft.js';
import { GESTURES } from './gesture.js';

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0f14);
    this.scene.fog = new THREE.Fog(0x0b0f14, 150, 340);

    this.view = 'TPV';
    this._buildCameras();
    this._buildLights();
    this._buildApron();
    this._buildBackground();
    this.aircraftGroup = this._buildAircraft();
    this.scene.add(this.aircraftGroup);
    this._buildNPCs();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _buildCameras() {
    const aspect = window.innerWidth / window.innerHeight;
    // 第三人稱：站在飛機正前方（marshaller 身後上方），看得到自己的化身指揮、
    // 也看得到飛機沿垂直滑行道從側邊滑入
    this.tpv = new THREE.PerspectiveCamera(72, aspect, 0.1, 600);
    this.tpv.position.set(0, 9, -20);
    this.tpv.lookAt(0, 2, 28);
    // 第一人稱：marshaller 視角（站位 z=-8），面向來機(+Z)
    this.fpv = new THREE.PerspectiveCamera(74, aspect, 0.1, 500);
    this.fpv.position.set(0, 3.2, -8);
    this.fpv.lookAt(0, 3, 50);
    this.camera = this.tpv;
  }

  setView(view) {
    this.view = view;
    this.camera = view === 'FPV' ? this.fpv : this.tpv;
  }

  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x9fc4e0, 0x223040, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(20, 40, 10);
    this.scene.add(dir);
  }

  _buildApron() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 240),
      new THREE.MeshStandardMaterial({ color: 0x1a232c, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = 30;
    this.scene.add(ground);

    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2d250 });

    // 中心引導線（lead-in line）：從停止線一路向上到導入弧銜接點。
    // 轉彎後留長距離可以慢慢對齊（參考標準停機位標線）。
    const JUNCTION_Z = TAXIWAY_Z - 14;          // 導入弧與直線中心線的銜接點
    const straightLen = JUNCTION_Z - STOP_LINE_Z;
    const centerline = new THREE.Mesh(new THREE.PlaneGeometry(0.5, straightLen + 4), lineMat);
    centerline.rotation.x = -Math.PI / 2;
    centerline.position.set(0, 0.02, STOP_LINE_Z + straightLen / 2);
    this.scene.add(centerline);

    // 彎曲導入線（轉彎輔助線）：自滑行道兩側平滑彎入中心線，左右各一條（漏斗狀）。
    this._addLeadInCurve(-1, JUNCTION_Z, lineMat); // 左側進場用
    this._addLeadInCurve(+1, JUNCTION_Z, lineMat); // 右側進場用

    // 垂直滑行道（橫向白虛線，飛機從這條線的左/右端進場）
    const taxiMat = new THREE.MeshBasicMaterial({ color: 0xbcd0e0 });
    for (let x = -56; x <= 56; x += 6) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.5), taxiMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.02, TAXIWAY_Z);
      this.scene.add(dash);
    }

    // Turn bar（轉彎橫桿）：標示開始轉彎處，垂直於導入線、位於導入弧銜接點
    const turnBar = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.7), lineMat);
    turnBar.rotation.x = -Math.PI / 2;
    turnBar.position.set(0, 0.025, JUNCTION_Z);
    this.scene.add(turnBar);

    // Alignment bar（對位桿）：與飛機停妥時的延伸中心線重合，停止前供駕駛對準
    const alignBar = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 6), lineMat);
    alignBar.rotation.x = -Math.PI / 2;
    alignBar.position.set(0, 0.025, STOP_LINE_Z - 4);
    this.scene.add(alignBar);

    // 停止線（橫向紅線，最醒目）
    const stopMat = new THREE.MeshBasicMaterial({ color: 0xff5468 });
    const stopBar = new THREE.Mesh(new THREE.PlaneGeometry(16, 0.7), stopMat);
    stopBar.rotation.x = -Math.PI / 2;
    stopBar.position.set(0, 0.03, STOP_LINE_Z);
    this.scene.add(stopBar);

    // 機位編號（停止點附近）
    this._addStandLabel('A9', STOP_LINE_Z - 9);
  }

  // 背景：航廈、空橋、燈柱、遠景天際線（夜間機坪）
  _buildBackground() {
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.3, metalness: 0.2, emissive: 0x14202c });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b333d, roughness: 0.9 });
    const litMat = new THREE.MeshStandardMaterial({ color: 0xffe39a, emissive: 0xffce6a, emissiveIntensity: 0.6 });

    // 航廈主體（在停止線後方，飛機機鼻朝向它）
    const terminal = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(120, 14, 16), wallMat);
    body.position.set(0, 7, -28);
    terminal.add(body);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(118, 8, 0.5), glassMat);
    glass.position.set(0, 7, -20);
    terminal.add(glass);
    // 航廈窗格亮點
    for (let x = -54; x <= 54; x += 6) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 0.6), litMat);
      w.position.set(x, 8.5, -19.7);
      terminal.add(w);
    }
    // 屋頂女兒牆
    const roof = new THREE.Mesh(new THREE.BoxGeometry(122, 1.5, 18), wallMat);
    roof.position.set(0, 14.5, -28);
    terminal.add(roof);
    this.scene.add(terminal);

    // 空橋：自航廈(後方)架高、斜向伸到飛機左側機門位置（位於 -X，畫面右側）
    this.jetbridge = new THREE.Group();
    const rotunda = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 5, 12), wallMat);
    rotunda.position.set(-22, 3.5, 0);
    this.jetbridge.add(rotunda);
    const tunnel = new THREE.Mesh(new THREE.BoxGeometry(15, 2.3, 2.3), glassMat);
    tunnel.position.set(-13, 4.2, 14);
    tunnel.rotation.y = -0.7;
    this.jetbridge.add(tunnel);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.6, 2.4), wallMat);
    cab.position.set(-6, 4.2, 22);
    this.jetbridge.add(cab);
    for (const [cx, cz] of [[-20, 4], [-12, 13]]) { // 支撐柱
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 4, 8), wallMat);
      col.position.set(cx, 2, cz);
      this.jetbridge.add(col);
    }
    this.scene.add(this.jetbridge);

    // 機坪照明燈柱
    for (const [px, pz] of [[-40, 5], [40, 5], [-40, 50], [40, 50]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 16, 8), wallMat);
      pole.position.set(px, 8, pz);
      this.scene.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 1.2), litMat);
      lamp.position.set(px + (px < 0 ? 1 : -1), 16, pz);
      this.scene.add(lamp);
    }

    // 遠景天際線（建築剪影 + 塔台）：位於滑行道後方遠處(+Z)，即遊玩視角看出去的地平線
    const farMat = new THREE.MeshStandardMaterial({ color: 0x161d26 });
    for (let i = 0; i < 26; i++) {
      const w = 9 + ((i * 37) % 11);
      const h = 14 + ((i * 53) % 26);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 7), farMat);
      b.position.set(-180 + i * 14, h / 2, 205 + ((i * 29) % 26));
      this.scene.add(b);
    }
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 36, 10), farMat);
    tower.position.set(-55, 18, 200);
    this.scene.add(tower);
    const towerTop = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.2, 4, 10), glassMat);
    towerTop.position.set(-55, 37, 200);
    this.scene.add(towerTop);

    // 夜空星點（散布在 +Z 遠方高空）
    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 240; i++) {
      pts.push(-200 + ((i * 53) % 400), 50 + ((i * 13) % 110), 120 + ((i * 7) % 160));
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fb6c8, size: 0.9 }));
    this.scene.add(stars);
  }

  // 彎曲導入線：自滑行道(side*18, TAXIWAY_Z) 平滑彎入中心線(0, junctionZ)
  _addLeadInCurve(side, junctionZ, mat) {
    const y = 0.06;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(side * 18, y, TAXIWAY_Z), // 起點：滑行道上
      new THREE.Vector3(0, y, TAXIWAY_Z),         // 控制點：使起點切線水平、終點切線垂直
      new THREE.Vector3(0, y, junctionZ)          // 終點：銜接中心線
    );
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 28, 0.25, 8, false),
      mat
    );
    this.scene.add(tube);
  }

  // 機位編號（畫在地面上的文字）
  _addStandLabel(text, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f2d250';
    ctx.font = 'bold 96px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 3),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.PI; // 讓文字正面朝向第三人稱(自後方看 +Z)
    mesh.position.set(0, 0.03, z);
    this.scene.add(mesh);
  }

  // Boeing 787-9 比例（長≈翼展、機身細長、斜削翼尖、鋸齒引擎噴口 chevron）。
  // 機鼻 tip 在 local z=-22(=NOSE_OFFSET)。鼻輪可轉向(this.noseGear)。
  _buildAircraft() {
    const g = new THREE.Group();
    this._mat = {
      white: new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.45 }),
      navy: new THREE.MeshStandardMaterial({ color: 0x1b3a6b, roughness: 0.5 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xb7c0c8, roughness: 0.4, metalness: 0.3 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x222a32, roughness: 0.6 }),
      wheel: new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.8 }),
    };
    const R = 2.0;   // 機身半徑
    const Y = 3.0;   // 機身中心高

    // 機身主體 + 機鼻 + 機尾（細長）
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 36, 28), this._mat.white);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.position.y = Y;
    g.add(fuselage);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(R, 4, 28), this._mat.white);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, Y, -20);
    g.add(nose);
    const tailCone = new THREE.Mesh(new THREE.ConeGeometry(R, 7, 28), this._mat.white);
    tailCone.rotation.x = Math.PI / 2;
    tailCone.position.set(0, Y + 0.6, 21.5); // 機尾略上翹
    g.add(tailCone);

    // 駕駛艙窗 + 側窗帶
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 2.2), this._mat.dark);
    cockpit.position.set(0, Y + 1.0, -16);
    g.add(cockpit);
    const windowStripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 30), this._mat.dark);
    windowStripe.position.set(R - 0.02, Y + 0.5, 2);
    g.add(windowStripe);
    const windowStripe2 = windowStripe.clone();
    windowStripe2.position.x = -(R - 0.02);
    g.add(windowStripe2);

    // 主翼（後掠 + 斜削翼尖）
    g.add(this._buildWing(-1, Y));
    g.add(this._buildWing(1, Y));

    // 引擎（翼下，含鋸齒 chevron 噴口）
    g.add(this._buildEngine(-1, Y));
    g.add(this._buildEngine(1, Y));

    // 尾翼：後掠垂直尾翼 + 水平安定面
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 5), this._mat.navy);
    fin.position.set(0, Y + 4.2, 18.5);
    fin.rotation.x = -0.32; // 後掠
    g.add(fin);
    for (const s of [-1, 1]) {
      const stab = new THREE.Mesh(new THREE.BoxGeometry(8, 0.35, 3), this._mat.navy);
      stab.position.set(s * 4.5, Y + 1.4, 18.5);
      stab.rotation.y = -s * 0.3;
      g.add(stab);
    }

    // 起落架：可轉向鼻輪 + 兩組主輪
    this.noseGear = this._buildGear(2, 0.6);
    this.noseGear.position.set(0, 0, -13);
    g.add(this.noseGear);
    for (const x of [-3.4, 3.4]) {
      const main = this._buildGear(4, 0.75);
      main.position.set(x, 0, 5);
      g.add(main);
    }

    return g;
  }

  // 一組起落架（n 個輪、輪半徑 r），含簡單支柱
  _buildGear(n, r) {
    const grp = new THREE.Group();
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.2, 8), this._mat.dark);
    strut.position.y = 1.4;
    grp.add(strut);
    const start = -((n - 1) / 2) * (r * 0.9);
    for (let i = 0; i < n; i++) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.45, 16), this._mat.wheel);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(0, r, start + i * (r * 0.9));
      grp.add(wheel);
    }
    return grp;
  }

  // 後掠主翼 + 斜削上揚翼尖（787 特徵）
  _buildWing(side, Y) {
    const grp = new THREE.Group();
    const span = 17;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(span, 0.4, 5.5), this._mat.white);
    panel.position.set((side * span) / 2, 0, 0);
    grp.add(panel);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 2.6), this._mat.navy);
    tip.position.set(side * (span + 1.8), 0.5, 1.4); // 斜削翼尖：外移、後掠、上揚
    tip.rotation.z = side * 0.5;
    grp.add(tip);
    grp.position.set(side * 1.9, Y - 0.4, 2);
    grp.rotation.y = -side * 0.4; // 後掠
    grp.rotation.z = side * 0.05; // 上反角
    return grp;
  }

  // 引擎短艙：進氣口 + 外殼 + 鋸齒 chevron 噴口
  _buildEngine(side, Y) {
    const grp = new THREE.Group();
    const cowl = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.25, 5.5, 20), this._mat.metal);
    cowl.rotation.x = Math.PI / 2;
    grp.add(cowl);
    const inlet = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.18, 10, 20), this._mat.dark);
    inlet.position.z = -2.7;
    grp.add(inlet);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(1.15, 20), this._mat.dark);
    fan.position.z = -2.6;
    grp.add(fan);
    // 鋸齒 chevron：噴口後緣一圈小三角齒
    const teeth = 12;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 4), this._mat.metal);
      tooth.position.set(Math.cos(a) * 1.2, Math.sin(a) * 1.2, 2.9);
      tooth.rotation.x = -Math.PI / 2; // 尖端朝後
      grp.add(tooth);
    }
    grp.position.set(side * 7, Y - 1.9, -1);
    return grp;
  }

  _personMarker(color) {
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36 });
    // 軀幹 + 頭 + 兩腿（讀起來像個人）
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 4, 8), mat);
    body.position.y = 1.15;
    grp.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 14), mat);
    head.position.y = 1.85;
    grp.add(head);
    for (const lx of [-0.16, 0.16]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.55, 4, 8), dark);
      leg.position.set(lx, 0.45, 0);
      grp.add(leg);
    }
    return grp;
  }

  // 有關節的手臂：肩 pivot → 上臂 → 肘 pivot → 前臂 + 指揮棒。
  // 回傳肩 pivot，肘 pivot 存於 userData.elbow。
  _makeArm() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xffcc33 });
    const wandMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0x3a1500 });
    const shoulder = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 4, 8), skin);
    upper.position.y = -0.28;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.54; // 上臂末端（肘）
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.38, 4, 8), skin);
    fore.position.y = -0.26;
    elbow.add(fore);
    const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), wandMat);
    wand.position.y = -0.62;
    elbow.add(wand);
    shoulder.add(elbow);
    shoulder.userData.elbow = elbow;
    return shoulder;
  }

  // 帶手臂的 marshaller 化身
  _buildMarshaller(color) {
    const grp = this._personMarker(color);
    this.armL = this._makeArm();
    this.armR = this._makeArm();
    this.armL.position.set(-0.38, 1.55, 0);
    this.armR.position.set(0.38, 1.55, 0);
    grp.add(this.armL, this.armR);
    return grp;
  }

  // 設定單手姿勢：肩(sx 繞X、sz 繞Z)、肘(ex 繞X 彎曲)
  _setArm(shoulder, sx, sz, ex) {
    shoulder.rotation.set(sx, 0, sz);
    shoulder.userData.elbow.rotation.set(ex, 0, 0);
  }

  // 由 MediaPipe 骨架即時驅動化身雙臂關節（連續鏡像玩家動作，非固定姿勢）。
  // 第三人稱看背面 → 鏡射：化身右臂(armR,+X) 跟玩家左臂、化身左臂(armL,-X) 跟玩家右臂。
  setMarshallerFromLandmarks(lm) {
    if (!this.armL || !this.armR || !lm) return;
    this._poseArmFromLm(this.armR, lm[11], lm[13], lm[15]); // 玩家左肩/肘/腕
    this._poseArmFromLm(this.armL, lm[12], lm[14], lm[16]); // 玩家右肩/肘/腕
  }

  _poseArmFromLm(arm, s, e, w) {
    if (!s || !e || !w) return;
    // image 座標 y 向下；atan2(dx, dy) → 手臂下垂=0、上舉=±π、外展=±π/2
    const angUp = Math.atan2(e.x - s.x, e.y - s.y);
    let angEl = Math.atan2(w.x - e.x, w.y - e.y) - angUp;
    while (angEl > Math.PI) angEl -= Math.PI * 2;
    while (angEl < -Math.PI) angEl += Math.PI * 2;
    const u = arm.userData;
    u.sz = this._approachAngle(u.sz ?? 0, angUp, 0.4);
    u.ez = this._approachAngle(u.ez ?? 0, angEl, 0.4);
    arm.rotation.set(0, 0, u.sz);
    arm.userData.elbow.rotation.set(0, 0, u.ez);
  }

  // 角度平滑逼近，處理 ±π 環繞避免抖動翻轉
  _approachAngle(cur, target, k) {
    let t = target;
    while (t - cur > Math.PI) t -= Math.PI * 2;
    while (t - cur < -Math.PI) t += Math.PI * 2;
    return cur + (t - cur) * k;
  }

  // 依手勢擺出化身手臂姿勢（含肘關節）。第三人稱看背面，左右已鏡射。
  setMarshallerPose(gesture) {
    const L = this.armL, R = this.armR;
    if (!L || !R) return;
    const UP = -2.3, BECKON = 1.5; // 上臂上舉前伸 + 前臂折起招手
    switch (gesture) {
      case GESTURES.GO: // 雙手舉到頭前招手
        this._setArm(L, UP, 0, BECKON);
        this._setArm(R, UP, 0, BECKON);
        break;
      case GESTURES.STOP: // 雙臂上舉於頭頂交叉（前臂打直）
        this._setArm(L, 2.95, -0.35, 0);
        this._setArm(R, 2.95, 0.35, 0);
        break;
      case GESTURES.TURN_LEFT: // 右手向上招手 + 左臂平舉當軸（鏡射）
        this._setArm(R, UP, 0, BECKON);
        this._setArm(L, 0, -1.5, 0);
        break;
      case GESTURES.TURN_RIGHT: // 左手向上招手 + 右臂平舉當軸（鏡射）
        this._setArm(L, UP, 0, BECKON);
        this._setArm(R, 0, 1.5, 0);
        break;
      case GESTURES.SLOW: // 雙臂下伸外張、前臂微彎（拍動近似）
        this._setArm(L, 0, -0.7, 0.5);
        this._setArm(R, 0, 0.7, 0.5);
        break;
      default: // NONE：雙臂自然垂下、前臂微彎
        this._setArm(L, 0, 0, 0.12);
        this._setArm(R, 0, 0, 0.12);
    }
  }

  _buildNPCs() {
    // Marshaller（玩家化身）站在停止線前方更遠處、面向來機(+Z)，讓駕駛清楚看見
    this.marshaller = this._buildMarshaller(0xffcc33);
    this.marshaller.position.set(0, 0, -8);
    this.scene.add(this.marshaller);

    // Chockman 在停止線旁
    this.chockman = this._personMarker(0x38d66b);
    this.chockman.position.set(4, 0, STOP_LINE_Z);
    this.scene.add(this.chockman);

    // 兩位 Wing Walker：固定站在翼尖旋轉半徑的左右淨空邊界（不隨飛機移動），
    // 守住機翼掃掠區，防止人車進入。CLEAR ≈ 787 半翼展 ~21 + 安全裕度。
    const CLEAR = 26;
    const guardZ = (TAXIWAY_Z - 14 + STOP_LINE_Z) / 2; // 停機坪中段
    this.wingL = this._personMarker(0xff8a3d);
    this.wingR = this._personMarker(0xff8a3d);
    this.wingL.position.set(-CLEAR, 0, guardZ);
    this.wingR.position.set(CLEAR, 0, guardZ);
    this.scene.add(this.wingL, this.wingR);

    // Apron safety line（紅色實線）：翼尖旋轉半徑的禁入邊界，標準為紅色實線
    const safetyMat = new THREE.MeshBasicMaterial({ color: 0xff5468 });
    for (const sx of [-CLEAR, CLEAR]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.5, TAXIWAY_Z - 10 - STOP_LINE_Z), safetyMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(sx, 0.015, (STOP_LINE_Z + TAXIWAY_Z - 10) / 2);
      this.scene.add(line);
    }
  }

  // 依飛機狀態更新可視物
  syncAircraft(ac) {
    this.aircraftGroup.position.set(ac.x, 0, ac.z);
    this.aircraftGroup.rotation.y = ac.heading;

    // 鼻輪轉向：依轉向指令偏轉，平滑過渡（轉向時前輪明顯打角）
    let steerTarget = 0;
    if (ac.command === GESTURES.TURN_LEFT) steerTarget = 0.6;
    else if (ac.command === GESTURES.TURN_RIGHT) steerTarget = -0.6;
    this._steer = (this._steer || 0) + (steerTarget - (this._steer || 0)) * 0.15;
    if (this.noseGear) this.noseGear.rotation.y = this._steer;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    for (const cam of [this.tpv, this.fpv]) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
