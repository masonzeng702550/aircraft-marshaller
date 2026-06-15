// Three.js 場景：機坪、中心線、停止線、飛機（積木組合）、NPC 占位、空橋占位。
// 提供第三人稱(TPV)與第一人稱(FPV)兩種相機。
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { STOP_LINE_Z, TAXIWAY_Z } from './aircraft.js';
import { GESTURES } from './gesture.js';

// 真實 glTF 機型（放在 public/ 下）。yaw 使機鼻朝 -Z；len 為縮放後機身長(單位)。
// 模型授權 CC-BY-4.0："Boeing 787-8" by rocket0314、"Boeing 777-300ER" by hakai315 (Sketchfab)
export const AIRCRAFT_MODELS = {
  // sceneryRatio：移除 footprint 大於「整體×此比例」的網格(去除打包的跑道/地面)；0 = 不過濾。
  // steerDeg：鼻輪最大轉向角(度)。
  B787: { file: 'models/787/787.glb', yaw: Math.PI, len: 46, sceneryRatio: 0.45, steerDeg: 70, type: 'B787', label: '787' },
  B777: { file: 'models/777/777.glb', yaw: -Math.PI / 2, len: 52, sceneryRatio: 0, steerDeg: 75, type: 'B777', label: '777' },
  A350: { file: 'models/a350/a350.glb', yaw: -Math.PI / 2, len: 54, sceneryRatio: 0, steerDeg: 40, type: 'A350', label: 'A350' },
  B737: { file: 'models/b737/b737.glb', yaw: -Math.PI / 2, len: 29, sceneryRatio: 0, steerDeg: 45, type: 'B737', label: '737' },
  A320: { file: 'models/a320/a320.glb', yaw: -Math.PI / 2, len: 27, sceneryRatio: 0, steerDeg: 45, type: 'A320', label: 'A320' },
  ATR72: { file: 'models/atr72/atr72.glb', yaw: Math.PI / 2, len: 20, sceneryRatio: 0, steerDeg: 50, type: 'ATR72', label: 'ATR72' },
};
const DEFAULT_MODEL = 'B787';

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fc1e6); // 明亮白天天空
    this.scene.fog = new THREE.Fog(0xbcd9ee, 340, 720);
    // 環境貼圖：讓金屬材質(GLTF 機身)有反射，否則會渲染成全黑
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.view = 'TPV';
    this._buildCameras();
    this._buildLights();
    this._buildApron();
    this._buildBackground();
    this.aircraftGroup = this._buildAircraft();
    this.scene.add(this.aircraftGroup);
    this._buildNPCs();

    // 載入預設 glTF 機型
    this.loadAircraft(DEFAULT_MODEL);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _buildCameras() {
    const aspect = window.innerWidth / window.innerHeight;
    // 第三人稱：站在飛機正前方（marshaller 身後上方），看得到自己的化身指揮、
    // 也看得到飛機沿垂直滑行道從側邊滑入
    this.tpv = new THREE.PerspectiveCamera(74, aspect, 0.1, 900);
    this.tpv.position.set(0, 6.2, -17.5); // 站在化身後上方(過肩視角)，看得見自己的指揮員
    this.tpv.lookAt(0, 1.4, 19);
    // 第一人稱：marshaller 視角（站位 z=-8），面向來機(+Z)
    this.fpv = new THREE.PerspectiveCamera(76, aspect, 0.1, 900);
    this.fpv.position.set(0, 3.2, -8);
    this.fpv.lookAt(0, 3, 60);
    this.camera = this.tpv;
  }

  setView(view) {
    this.view = view;
    this.camera = view === 'FPV' ? this.fpv : this.tpv;
  }

  _buildLights() {
    // 白天：明亮天空光 + 太陽平行光
    this.scene.add(new THREE.HemisphereLight(0xdff0ff, 0x6b7a66, 1.1));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const sun = new THREE.DirectionalLight(0xfff6e6, 1.5);
    sun.position.set(40, 70, 30);
    this.scene.add(sun);
  }

  _buildApron() {
    // 草地（最底層，向四周延伸）
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshStandardMaterial({ color: 0x6f9a55, roughness: 1 })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, -0.05, 60);
    this.scene.add(grass);

    // 停機坪混凝土（淺灰）— 放大到可容納 747
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 360),
      new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = 45;
    this.scene.add(ground);

    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2d250 });

    // 中心引導線（lead-in line）：從停止線一路向上到導入弧銜接點。
    // 轉彎後留長距離可以慢慢對齊（參考標準停機位標線）。
    const JUNCTION_Z = TAXIWAY_Z - 14;          // 導入弧與直線中心線的銜接點
    const NEAR_Z = -1;                           // 中央線近端(延伸到最近一條停止線之前)
    const straightLen = JUNCTION_Z - NEAR_Z;
    const centerline = new THREE.Mesh(new THREE.PlaneGeometry(0.2, straightLen), lineMat); // 線寬≈0.28m(真實導入線 15cm 級)
    centerline.rotation.x = -Math.PI / 2;
    centerline.position.set(0, 0.02, (NEAR_Z + JUNCTION_Z) / 2);
    this.scene.add(centerline);

    // 彎曲導入線（轉彎輔助線）：自滑行道兩側平滑彎入中心線，左右各一條（漏斗狀）。
    this._addLeadInCurve(-1, JUNCTION_Z, lineMat); // 左側進場用
    this._addLeadInCurve(+1, JUNCTION_Z, lineMat); // 右側進場用

    // 垂直滑行道：瀝青帶 + 黃色實線中心線（飛機從這條滑行道的左/右端進場）
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 24),
      new THREE.MeshStandardMaterial({ color: 0x3c4147, roughness: 1 })
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.set(0, 0.005, TAXIWAY_Z);
    this.scene.add(asphalt);
    const taxiCenter = new THREE.Mesh(new THREE.PlaneGeometry(260, 0.2), lineMat);
    taxiCenter.rotation.x = -Math.PI / 2;
    taxiCenter.position.set(0, 0.02, TAXIWAY_Z);
    this.scene.add(taxiCenter);

    // Turn bar（轉彎橫桿）：標示開始轉彎處，垂直於導入線、位於導入弧銜接點
    const turnBar = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.5), lineMat);
    turnBar.rotation.x = -Math.PI / 2;
    turnBar.position.set(0, 0.025, JUNCTION_Z);
    this.scene.add(turnBar);

    // Alignment bar（對位桿）：與飛機停妥時的延伸中心線重合，停止前供駕駛對準
    const alignBar = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 4), lineMat);
    alignBar.rotation.x = -Math.PI / 2;
    alignBar.position.set(0, 0.025, -3); // 置於最近停止線之前供對準
    this.scene.add(alignBar);

    // 機型鼻輪停止線：分四條(由近到遠)，相近長度的機型共用一條。全部黃色(同滑行道/中央線粗細)+黑色細外框。
    // 機尾對齊共同後界(REAR_Z)，機身越長機鼻越往登機口(近端)靠 → 越長的飛機停止線越「近」、占用越長的停機位。
    // 每條線左右兩端各標一個機型代號。z = REAR_Z − 代表機身長 × 比例尺(0.72 單位/公尺)。
    const SCALE = 0.28;     // 依機身長按比例(壓縮間距，四條線靠近一點、不會相差太遠)
    const REAR_Z = 8 + 63.7 * 0.28; // 使 787/A330 那條落在 STOP_LINE_Z(=8)，其餘依比例靠攏
    const ACROSS = 8;       // 橫線跨距(供左右兩端標牌)
    this.typeStopZ = {};
    this.typeAcross = {};
    const ROWS = [          // 由近(長)到遠(短)
      { left: 'B777', right: 'A350', repLen: 73.9 },
      { left: 'B787', right: 'A330', repLen: 63.7 },
      { left: 'B737', right: 'A320', repLen: 39.5 },
      { right: 'ATR72', repLen: 27.2 },
    ];
    for (const r of ROWS) {
      const z = REAR_Z - r.repLen * SCALE;
      this._addStopLine(z, ACROSS);
      // 玩家視角(過肩望向 +z)：螢幕左 = +x、螢幕右 = -x
      if (r.left) { this.typeStopZ[r.left] = z; this.typeAcross[r.left] = ACROSS; this._addTypeLabel(r.left, ACROSS / 2 + 1.6, z); }
      if (r.right) { this.typeStopZ[r.right] = z; this.typeAcross[r.right] = ACROSS; this._addTypeLabel(r.right, -(ACROSS / 2 + 1.6), z); }
    }

    // 機位編號（置於最近一條停止線之前）
    this._addStandLabel('A9', (REAR_Z - 73.9 * SCALE) - 6);
  }

  // 單條鼻輪停止線：黃色橫線(同滑行道/中央線粗細 0.2) + 黑色細外框
  _addStopLine(z, across) {
    const outline = new THREE.Mesh(
      new THREE.PlaneGeometry(across + 0.16, 0.36),
      new THREE.MeshBasicMaterial({ color: 0x14160f })
    );
    outline.rotation.x = -Math.PI / 2;
    outline.position.set(0, 0.028, z);
    this.scene.add(outline);
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(across, 0.2), // 與滑行道線/中央線同粗細
      new THREE.MeshBasicMaterial({ color: 0xf2d250 })
    );
    bar.rotation.x = -Math.PI / 2;
    bar.position.set(0, 0.032, z);
    this.scene.add(bar);
  }

  // 機型代號標牌：黑底 + 黃字（ICAO 規定黃字黑底）
  _addTypeLabel(text, x, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#14160f';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#f2d250';
    ctx.font = 'bold 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 50);
    const tex = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.5, 0.95),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.PI; // 文字正面朝第三人稱(自後方看 +Z)
    mesh.position.set(x, 0.033, z);
    this.scene.add(mesh);
  }

  // 背景：白天機場（航廈、空橋、滑行道/跑道、機棚、塔台、雲）
  _buildBackground() {
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x7fa8c9, roughness: 0.2, metalness: 0.4 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9cfd6, roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.9 });

    // 航廈主體（停止線後方，飛機機鼻朝向它）
    const terminal = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(130, 15, 20), wallMat);
    body.position.set(0, 7.5, -30);
    terminal.add(body);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(128, 9, 0.5), glassMat);
    glass.position.set(0, 8, -20);
    terminal.add(glass);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(134, 1.6, 22), roofMat);
    roof.position.set(0, 15.5, -30);
    terminal.add(roof);
    this.scene.add(terminal);

    // 空橋：自航廈架高、斜向伸到飛機左側機門（位於 -X，畫面右側）
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
    for (const [cx, cz] of [[-20, 4], [-12, 13]]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 4, 8), roofMat);
      col.position.set(cx, 2, cz);
      this.jetbridge.add(col);
    }
    this.scene.add(this.jetbridge);

    // 跑道（遠方 +Z，沿 X 的長瀝青帶 + 白色中心虛線）
    const runway = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 40),
      new THREE.MeshStandardMaterial({ color: 0x44494f, roughness: 1 })
    );
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, -0.02, 200);
    this.scene.add(runway);
    const rwMark = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let x = -260; x <= 260; x += 24) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(12, 1), rwMark);
      d.rotation.x = -Math.PI / 2;
      d.position.set(x, 0.0, 200);
      this.scene.add(d);
    }

    // 遠景城市公寓群（像松山機場背後的市區）
    const cityMats = [0xb9b3ac, 0xa9a39c, 0xc4bdb4, 0x9fa6ad].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
    for (let i = 0; i < 48; i++) {
      const w = 8 + ((i * 17) % 12);
      const h = 14 + ((i * 53) % 30);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 9), cityMats[i % cityMats.length]);
      b.position.set(-280 + i * 12, h / 2, 270 + ((i * 29) % 22));
      this.scene.add(b);
    }

    // 遠山（綠色山脈，前後兩層，呈現照片中城市背後的山）
    const near = new THREE.MeshStandardMaterial({ color: 0x4f6b43, roughness: 1 });
    const far = new THREE.MeshStandardMaterial({ color: 0x7d92a6, roughness: 1, fog: true });
    for (let i = 0; i < 14; i++) {
      const r = 55 + ((i * 23) % 45);
      const hgt = 55 + ((i * 37) % 55);
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, hgt, 7), far);
      m.position.set(-330 + i * 52, hgt / 2 - 8, 400 + ((i * 31) % 30));
      this.scene.add(m);
    }
    for (let i = 0; i < 13; i++) {
      const r = 50 + ((i * 19) % 38);
      const hgt = 40 + ((i * 41) % 40);
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, hgt, 7), near);
      m.position.set(-300 + i * 50, hgt / 2 - 6, 340 + ((i * 17) % 22));
      this.scene.add(m);
    }

    // 機棚（遠方兩座）
    const hangarMat = new THREE.MeshStandardMaterial({ color: 0xb7bdc4, roughness: 0.85 });
    for (const hx of [-120, 130]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(70, 26, 50), hangarMat);
      h.position.set(hx, 13, 150);
      this.scene.add(h);
      const hr = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 70, 16, 1, false, 0, Math.PI), hangarMat);
      hr.rotation.z = Math.PI / 2;
      hr.position.set(hx, 26, 150);
      this.scene.add(hr);
    }

    // 塔台
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 40, 12), wallMat);
    tower.position.set(70, 20, 120);
    this.scene.add(tower);
    const towerCab = new THREE.Mesh(new THREE.CylinderGeometry(5, 4, 5, 12), glassMat);
    towerCab.position.set(70, 42, 120);
    this.scene.add(towerCab);

    // 機坪照明燈柱
    for (const [px, pz] of [[-44, 6], [44, 6], [-44, 52], [44, 52]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 16, 8), roofMat);
      pole.position.set(px, 8, pz);
      this.scene.add(pole);
    }

    // 白雲（每朵由數個半透明球體疊成蓬鬆狀，散布高空）
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.9 });
    for (const [cx, cy, cz, cs] of [[-90, 62, 240, 14], [70, 78, 300, 20], [-30, 92, 370, 26], [150, 66, 260, 16], [20, 104, 430, 30]]) {
      const cloud = new THREE.Group();
      for (const [ox, oy, or] of [[-cs, 0, cs * 0.8], [0, cs * 0.3, cs], [cs, 0, cs * 0.75], [cs * 0.4, -cs * 0.2, cs * 0.6]]) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(or, 10, 8), cloudMat);
        puff.position.set(ox, oy, 0);
        puff.scale.y = 0.6;
        cloud.add(puff);
      }
      cloud.position.set(cx, cy, cz);
      this.scene.add(cloud);
    }
  }

  // 彎曲導入線：自滑行道(side*18, TAXIWAY_Z) 平滑彎入中心線(0, junctionZ)
  _addLeadInCurve(side, junctionZ, mat) {
    const y = 0.06;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(side * 28, y, TAXIWAY_Z), // 起點：滑行道上
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

  // Boeing 787 程序化模型：平滑機身(LatheGeometry)、後掠錐削主翼+斜削翼尖、
  // 引擎(短艙+派龍+chevron)、後掠尾翼、塗裝。機鼻 tip 在 local z=-22(=NOSE_OFFSET)。
  _buildAircraft() {
    const g = new THREE.Group();
    this.aircraftBody = g; // 供 GLTF 載入時替換
    this._mat = {
      white: new THREE.MeshStandardMaterial({ color: 0xf3f6f9, roughness: 0.35, metalness: 0.05 }),
      blue: new THREE.MeshStandardMaterial({ color: 0x2b5c9e, roughness: 0.4 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xc4ccd2, roughness: 0.35, metalness: 0.4 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1c2228, roughness: 0.5 }),
      wheel: new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.85 }),
    };
    const Y = 3.0; // 機身中心高

    // 平滑機身（旋轉曲面）：半徑沿機身漸變，鼻尖 z=-22、機尾 z=+22
    const prof = [
      [0.05, -22], [0.55, -21], [1.05, -19.5], [1.5, -17.5], [1.85, -14],
      [2.0, -9], [2.0, 2], [1.95, 9], [1.7, 14], [1.25, 18], [0.75, 20.5], [0.15, 22],
    ].map(([r, p]) => new THREE.Vector2(r, p));
    const fuselage = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), this._mat.white);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.position.y = Y;
    g.add(fuselage);

    // 駕駛艙窗（機鼻上方深色弧塊）
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), this._mat.dark);
    cockpit.scale.set(1, 0.5, 1.3);
    cockpit.position.set(0, Y + 0.7, -16.5);
    g.add(cockpit);
    // 側窗帶 + 塗裝腰線（兩側）
    for (const sx of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 30), this._mat.dark);
      win.position.set(sx * 1.95, Y + 0.45, 1);
      g.add(win);
      const cheat = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 33), this._mat.blue);
      cheat.position.set(sx * 1.95, Y - 0.25, 1);
      g.add(cheat);
    }

    // 主翼 + 引擎
    g.add(this._buildWing(-1, Y));
    g.add(this._buildWing(1, Y));
    g.add(this._buildEngine(-1, Y));
    g.add(this._buildEngine(1, Y));

    // 尾翼：後掠垂直尾翼（藍，錐削）+ 水平安定面
    const fin = new THREE.Mesh(this._taperPlate(7, 5.5, 2.6), this._mat.blue);
    fin.rotation.x = Math.PI / 2;       // 立起
    fin.rotation.y = Math.PI / 2;
    fin.position.set(0, Y + 1.6, 18.5);
    g.add(fin);
    for (const s of [-1, 1]) {
      const stab = new THREE.Mesh(this._taperPlate(7.5, 3, 1.6), this._mat.white);
      stab.rotation.x = Math.PI / 2;
      stab.scale.x = s;
      stab.position.set(0, Y + 1.3, 18.5);
      g.add(stab);
    }

    // 起落架：可轉向鼻輪 + 兩組主輪
    this.noseGear = this._buildGear(2, 0.6);
    this.noseGear.position.set(0, 0, -13);
    g.add(this.noseGear);
    for (const x of [-3.4, 3.4]) {
      const main = this._buildGear(4, 0.78);
      main.position.set(x, 0, 5);
      g.add(main);
    }

    return g;
  }

  // 依機型 key 載入對應 glTF 模型
  loadAircraft(key) {
    const m = AIRCRAFT_MODELS[key];
    if (m) {
      this.noseSteerMax = (m.steerDeg || 34) * Math.PI / 180; // 鼻輪最大轉向角
      this.setAircraftModel(import.meta.env.BASE_URL + m.file, m.yaw, m.len, m.sceneryRatio);
    }
    // 該機型的鼻輪停止位置(主迴圈會寫入 aircraft.stopRefZ)：飛機停在自己的機型停止線上
    this.activeStopZ = (this.typeStopZ && this.typeStopZ[key] != null) ? this.typeStopZ[key] : STOP_LINE_Z;
    // 輪檔員站在「該機型停止線」的右方(玩家視角的右側=螢幕右側=-x；隨機型移動)
    if (this.chockman) {
      const ax = (this.typeAcross && this.typeAcross[key]) ? this.typeAcross[key] : 6;
      this.chockman.position.set(-(ax / 2 + 1.6), 0, this.activeStopZ);
    }
  }

  // 載入 glTF 飛機模型，替換現有機體（去場景、旋轉定向、置中、貼地、縮放）。
  setAircraftModel(url, yaw = 0, targetLen = 46, sceneryRatio = 0) {
    const loader = new GLTFLoader();
    if (!GameScene._draco) {
      GameScene._draco = new DRACOLoader();
      GameScene._draco.setDecoderPath(import.meta.env.BASE_URL + 'draco/'); // 自架解碼器(免 CDN)
    }
    loader.setDRACOLoader(GameScene._draco); // 解碼 Draco 壓縮的幾何
    loader.load(
      url,
      (gltf) => {
        const holder = new THREE.Group();
        holder.add(gltf.scene);
        holder.rotation.y = yaw;
        holder.updateMatrixWorld(true);
        // 部分 Sketchfab 模型把跑道/地面一起打包 → 移除 footprint 遠大於飛機的網格。
        // 各機型以 sceneryRatio 控制(0=不過濾)，因為 787 含大型場景、777 幾乎只有飛機本體。
        if (sceneryRatio > 0) {
          const full = new THREE.Vector3();
          new THREE.Box3().setFromObject(holder).getSize(full);
          const limit = sceneryRatio * Math.max(full.x, full.z);
          const remove = [];
          holder.traverse((o) => {
            if (o.isMesh) {
              const s = new THREE.Vector3();
              new THREE.Box3().setFromObject(o).getSize(s);
              if (Math.max(s.x, s.y, s.z) > limit) remove.push(o);
            }
          });
          remove.forEach((o) => o.parent && o.parent.remove(o));
          holder.updateMatrixWorld(true);
        }
        // 移除「空間離群」網格(被大空隙隔開的少數零件，如分離的標記/曲線)，避免它們撐大包圍盒導致縮放/置中錯誤。
        this._trimOutliers(holder, 'x'); this._trimOutliers(holder, 'z');
        this._trimOutliers(holder, 'x'); this._trimOutliers(holder, 'z'); // 再跑一輪清多個離群
        holder.updateMatrixWorld(true);
        // 量測 → 縮放到指定機身長，並置中(x,z)+概略貼地(y)
        const size = new THREE.Vector3();
        new THREE.Box3().setFromObject(holder).getSize(size);
        holder.scale.setScalar(targetLen / (Math.max(size.x, size.z) || 1));
        holder.updateMatrixWorld(true);
        const box2 = new THREE.Box3().setFromObject(holder);
        const c = box2.getCenter(new THREE.Vector3());
        holder.position.set(-c.x, -box2.min.y, -c.z);

        // 先把模型掛上場景(確保一定顯示)，再做後處理；任何後處理失敗都不影響模型顯示。
        while (this.aircraftGroup.children.length) {
          this.aircraftGroup.remove(this.aircraftGroup.children[0]);
        }
        this.aircraftGroup.add(holder);
        // 偵測期間把機身座標歸零(= 世界座標)，讓輪軸/前後/左右判定不受當前航向影響；syncAircraft 下一幀恢復。
        this.aircraftGroup.rotation.set(0, 0, 0);
        this.aircraftGroup.updateMatrixWorld(true);

        // 先偵測起落架/螺旋槳(這時已概略貼地)，再依「驗證過的輪+鼻輪」最終貼地。
        this._setupNoseSteer(holder, targetLen);
        this._setupWheels(holder, targetLen);
        this._setupProps(holder, targetLen);

        // 最終貼地：以「驗證過的主輪底」為著地點降到 y=0(主輪確實著地，不再浮空)。主輪是主要視覺著地點，
        // 不混入鼻輪(部分模型鼻輪比主輪低，會讓主輪浮空)。沒有有效主輪(如 ATR72) → 退回「穩健最低面」。
        try {
          const contacts = [];
          for (const w of this.wheels) { const p = new THREE.Vector3(); w.pivot.getWorldPosition(p); contacts.push(p.y - w.radius); }
          let ref = null;
          if (contacts.length) {
            ref = Math.min(...contacts);
          } else {
            const bottoms = [];
            holder.traverse((o) => { if (o.isMesh && o.geometry) bottoms.push(new THREE.Box3().setFromObject(o).min.y); });
            if (bottoms.length) {
              bottoms.sort((a, b) => a - b);
              const span = (bottoms[bottoms.length - 1] - bottoms[0]) || 1;
              ref = bottoms[0];
              for (let i = 1; i < Math.min(4, bottoms.length); i++) {
                if (bottoms[i] - bottoms[i - 1] > 0.12 * span) ref = bottoms[i]; else break; // 跨過低離群面
              }
            }
          }
          if (ref != null && isFinite(ref) && Math.abs(ref) > 1e-4) {
            holder.position.y -= ref;
            this.aircraftGroup.updateMatrixWorld(true);
          }
        } catch (e) { console.warn('貼地失敗：', e); }
      },
      undefined,
      (err) => console.warn('飛機模型載入失敗：', err)
    );
  }

  // 移除沿某軸被「大空隙」隔開的少數離群網格(分離標記/曲線/錯置零件)，避免撐大包圍盒導致縮放/置中錯誤。
  _trimOutliers(holder, axis) {
    const meshes = [];
    holder.traverse((o) => { if (o.isMesh && o.geometry) meshes.push(o); });
    if (meshes.length < 12) return;
    const arr = meshes.map((o) => {
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      return { o, v: c[axis] };
    }).sort((a, b) => a.v - b.v);
    const range = arr[arr.length - 1].v - arr[0].v;
    if (range <= 0) return;
    let gi = -1, gmax = 0;
    for (let i = 1; i < arr.length; i++) { const g = arr[i].v - arr[i - 1].v; if (g > gmax) { gmax = g; gi = i; } }
    if (gmax < 0.18 * range) return; // 無顯著空隙 → 不動
    const victims = gi <= arr.length - gi ? arr.slice(0, gi) : arr.slice(gi);
    if (victims.length > 0.12 * arr.length) return; // 只清少數離群(避免誤砍機體大塊)
    // 離群群中若含「大塊」(如垂直尾翼/水平安定面)，整批不裁；只清細小雜散件(分離標記/曲線)。
    const hasBig = victims.some((x) => {
      const sz = new THREE.Vector3(); new THREE.Box3().setFromObject(x.o).getSize(sz);
      return Math.max(sz.x, sz.y, sz.z) > 0.1 * range;
    });
    if (hasBig) return;
    victims.forEach((x) => x.o.parent && x.o.parent.remove(x.o));
  }

  // 建立鼻輪轉向 pivot：轉向軸必須通過「鼻輪本身」的 (x,z)，否則轉動時會沿弧線飄離。
  // (A) 有具名齒輪節點(787)：以輪/胎節點的 x,z 為軸；(B) 無具名(777)：幾何抓最前端低矮小輪。
  _setupNoseSteer(holder, targetLen) {
    this.noseGear = null;
    this.noseGearOffset = null; // 重置，避免切換到無鼻輪機型時沿用上一台的值
    try {
      holder.updateMatrixWorld(true); // 確保 setFromObject/worldToLocal 使用最新矩陣
      const isAncestor = (a, o) => { for (let p = o.parent; p; p = p.parent) if (p === a) return true; return false; };
      let tops = [];
      let axisSrc = null;
      // (A) 名稱比對
      const matched = [];
      holder.traverse((o) => {
        if (o.name && /front|nose|nlg/i.test(o.name) &&
            /wheel|tire|strut|gear/i.test(o.name) && !/door|light/i.test(o.name)) matched.push(o);
      });
      tops = matched.filter((o) => !matched.some((a) => a !== o && isAncestor(a, o)));
      axisSrc = tops.find((o) => /wheel|tire/i.test(o.name)) || null;
      // (B) 幾何偵測（無具名齒輪，如 777）：只取「輪胎形狀」(圓+薄+軸水平)的最前端群，
      //     不要把支柱/連桿/艙門也抓進來(否則整組亂轉)。
      if (!tops.length) {
        // 幾何偵測：底層輪胎中、靠近中心線(鼻輪在 x≈0)、機身座標 z 最小(最前端)那群 = 鼻輪。
        const cand = this._wheelCandidates(holder, targetLen);
        if (!cand.length) return;
        const local = cand.map((r) => { const p = this.aircraftGroup.worldToLocal(r.c.clone()); return { o: r.mesh, x: p.x, z: p.z }; });
        // 鼻輪必在中心線(x≈0)且位於前段(z<0=機鼻側)。找不到合格中心鼻輪就不設轉向(避免亂轉翼上雜散圓盤)。
        const central = local.filter((w) => Math.abs(w.x) < 0.08 * targetLen && w.z < 0);
        if (!central.length) return;
        const minZ = Math.min(...central.map((w) => w.z));
        tops = central.filter((w) => w.z < minZ + 0.06 * targetLen).map((w) => w.o);
        axisSrc = tops[0];
      }
      if (!tops.length) return;
      // 轉向軸 (x,z) = 鼻輪本身
      const aCtr = new THREE.Box3().setFromObject(axisSrc || tops[0]).getCenter(new THREE.Vector3());
      // 旋轉整條鼻輪腿(輪+支柱)：取位於鼻輪垂直軸附近的零件(在 x,z 接近輪軸者一起原地轉)，
      // 排除接到機身、位置偏移的連桿/鉸鏈(否則會沿弧線甩)。
      let steerParts = tops.filter((o) => {
        const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
        return Math.abs(c.x - aCtr.x) < 0.045 * targetLen && Math.abs(c.z - aCtr.z) < 0.07 * targetLen;
      });
      if (!steerParts.length) steerParts = [axisSrc || tops[0]];
      const gBox = new THREE.Box3(); steerParts.forEach((p) => gBox.expandByObject(p));
      const gCtr = gBox.getCenter(new THREE.Vector3());
      const pivot = new THREE.Group();
      pivot.position.copy(holder.worldToLocal(new THREE.Vector3(aCtr.x, gCtr.y, aCtr.z)));
      holder.add(pivot);
      pivot.updateMatrixWorld(true); // attach 依賴 pivot 的世界矩陣
      steerParts.forEach((p) => pivot.attach(p)); // 只把輪子掛進 pivot → 繞鼻輪垂直軸原地轉
      this.noseGear = pivot;
      // 記錄鼻輪相對機身中心的前向距離(機身座標系，機鼻 -Z)，供以鼻輪為基準判定停止
      const ww = new THREE.Vector3(); pivot.getWorldPosition(ww);
      this.noseGearOffset = -this.aircraftGroup.worldToLocal(ww.clone()).z;
    } catch (e) {
      console.warn('鼻輪轉向設定失敗：', e);
    }
  }

  // 輪胎/圓盤形狀判定：兩大維接近(圓) + 一維薄(軸) + 軸為水平(排除平放圓盤/標線)
  _isWheelShape(o) {
    if (!o.isMesh || !o.geometry) return false;
    o.geometry.computeBoundingBox();
    if (!o.geometry.boundingBox) return false;
    const ld = new THREE.Vector3(); o.geometry.boundingBox.getSize(ld);
    const dims = [['x', ld.x], ['y', ld.y], ['z', ld.z]].sort((a, b) => a[1] - b[1]);
    const maxD = dims[2][1];
    return maxD > 0 && dims[1][1] > 0.8 * maxD && dims[0][1] < 0.5 * maxD && dims[0][0] !== 'y';
  }

  // 找出「起落架輪胎」候選：以世界包圍盒判形(兩大維接近=圓 + 一薄維=輪軸 + 薄軸水平) + 小尺寸，
  // 再取所有候選中「最底層」那一帶(以候選自身最低 y 為基準，避免被輔助曲線/離散網格污染整機包圍盒)。
  // 回傳 [{ mesh, c(世界輪心), maxD }]。各模型輪子帶節點旋轉/縮放也抓得到，且不要求成群(左右各一也算)。
  _wheelCandidates(holder, targetLen) {
    holder.updateMatrixWorld(true);
    // 整機(已裁離群、已貼地)包圍盒 → 用「絕對底部高度帶」判起落架(只在最底 ~28% 機高內)，
    // 穩定排除離地的引擎扇/螺旋槳/尾翼圓盤(它們在中高處)。圓度排除矩形貨艙門/面板。
    const cand = [];
    holder.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const b = new THREE.Box3().setFromObject(o);
      const ws = new THREE.Vector3(); b.getSize(ws);
      const dims = [['x', ws.x], ['y', ws.y], ['z', ws.z]].sort((a, c) => a[1] - c[1]);
      const maxD = dims[2][1];
      // 圓盤(兩大維接近 0.78，排除矩形貨艙門/面板) + 一薄維(軸)且軸水平(非 y)
      if (!(maxD > 0 && dims[1][1] > 0.78 * maxD && dims[0][1] < 0.55 * maxD && dims[0][0] !== 'y')) return;
      // 尺寸上限縮到 0.04×機身長：輪胎小，引擎扇(如 GE90 直徑~2.3)大很多 → 大圓盤(引擎/螺旋槳)被排除。
      if (maxD > 0.04 * targetLen || maxD < 0.004 * targetLen) return;
      const c = new THREE.Vector3(); b.getCenter(c);
      // 起落架在機腹下方(機身座標 |x| 小)，排除翼上引擎/螺旋槳/雜散圓盤
      if (Math.abs(this.aircraftGroup.worldToLocal(c.clone()).x) > 0.14 * targetLen) return;
      cand.push({ mesh: o, c, maxD });
    });
    if (!cand.length) return [];
    // 以「最低輪」為基準的高度帶(可容納高主輪如 787)，排除更高的引擎扇/螺旋槳/尾翼圓盤。
    const minY = Math.min(...cand.map((r) => r.c.y));
    const band = Math.min(2.5, Math.max(0.8, 0.05 * targetLen));
    return cand.filter((r) => r.c.y < minY + band);
  }

  // 偵測可滾動的輪胎並各自包進「以輪心為樞軸」的 pivot → 原地滾動。
  _setupWheels(holder, targetLen) {
    this.wheels = [];
    try {
      const underNose = (o) => { for (let p = o.parent; p; p = p.parent) if (p === this.noseGear) return true; return false; };
      const cand = this._wheelCandidates(holder, targetLen).filter((r) => !(this.noseGear && underNose(r.mesh)));
      // 滾動輪應「貼地」(機體已貼地，真輪 y≈0)。若扣掉鼻輪後只剩極少數(≤2)且都離地偏高，
      // 多半是尾椎/APU 等離地雜散圓盤(非真主輪) → 不滾，避免單一高處零件原地亂轉(如 ATR72 尾部圓盤)。
      if (cand.length && cand.length <= 2 && Math.min(...cand.map((r) => r.c.y)) > 1.3) return;
      // 機身橫向(輪軸)在世界座標的方向 = aircraftGroup 局部 +X。
      this.aircraftGroup.updateMatrixWorld(true);
      const aq = new THREE.Quaternion(); this.aircraftGroup.getWorldQuaternion(aq);
      const latWorld = new THREE.Vector3(1, 0, 0).applyQuaternion(aq);
      // 為每顆輪胎在「輪心」建立 pivot，反父化後繞「自身局部輪軸」自轉 → 原地正確滾動。
      // 注意：不能用 rotateOnWorldAxis(three.js 假設無旋轉父層)，pivot 在 holder(機型 yaw)+航向下
      // 父層有旋轉，會把自轉軸算錯(777 yaw -90° → 變成繞垂直軸亂轉/橫的)。改存「局部輪軸」用 rotateOnAxis。
      for (const r of cand) {
        const pivot = new THREE.Group();
        pivot.position.copy(holder.worldToLocal(r.c.clone()));
        holder.add(pivot);
        pivot.updateMatrixWorld(true);
        pivot.attach(r.mesh);
        const pq = new THREE.Quaternion(); pivot.getWorldQuaternion(pq);
        const axle = latWorld.clone().applyQuaternion(pq.invert()).normalize(); // 機身橫向→pivot 局部(常數)
        this.wheels.push({ pivot, radius: r.maxD / 2 || 0.5, axle });
      }
    } catch (e) {
      console.warn('輪子偵測失敗：', e);
    }
  }

  // 偵測螺旋槳/引擎風扇並繞「機身縱向軸(面朝前)」自轉：圓盤 + 薄維=縱向 Z + 中大尺寸 + 離地(非起落架)。
  // ATR72 螺旋槳、噴射引擎風扇都吃這條;與輪子(橫向軸、貼地)互斥,故不會亂轉錯零件。
  _setupProps(holder, targetLen) {
    this.props = [];
    try {
      holder.updateMatrixWorld(true);
      const full = new THREE.Box3().setFromObject(holder);
      const bottomY = full.min.y, height = (full.max.y - full.min.y) || 1;
      const cand = [];
      holder.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const b = new THREE.Box3().setFromObject(o);
        const ws = new THREE.Vector3(); b.getSize(ws);
        const dims = [['x', ws.x], ['y', ws.y], ['z', ws.z]].sort((a, c) => a[1] - c[1]);
        const maxD = dims[2][1];
        // 圓盤 + 薄維=縱向 Z(面朝前;機身座標已對齊世界)
        if (!(maxD > 0 && dims[1][1] > 0.72 * maxD && dims[0][1] < 0.5 * maxD && dims[0][0] === 'z')) return;
        if (maxD < 0.07 * targetLen || maxD > 0.26 * targetLen) return; // 風扇/槳葉尺寸(比輪子大)
        const c = new THREE.Vector3(); b.getCenter(c);
        if (c.y < bottomY + 0.15 * height) return; // 離地(排除輪子)
        // 螺旋槳/引擎在機翼上(離中心線)，排除中線上的雷達罩/APU/機身圓盤等假陽性
        if (Math.abs(this.aircraftGroup.worldToLocal(c.clone()).x) < 0.08 * targetLen) return;
        cand.push({ mesh: o, c });
      });
      this.aircraftGroup.updateMatrixWorld(true);
      const aq = new THREE.Quaternion(); this.aircraftGroup.getWorldQuaternion(aq);
      const lonWorld = new THREE.Vector3(0, 0, 1).applyQuaternion(aq); // 機身縱向(前後)
      for (const r of cand) {
        const pivot = new THREE.Group();
        pivot.position.copy(holder.worldToLocal(r.c.clone()));
        holder.add(pivot);
        pivot.updateMatrixWorld(true);
        pivot.attach(r.mesh);
        const pq = new THREE.Quaternion(); pivot.getWorldQuaternion(pq);
        const axis = lonWorld.clone().applyQuaternion(pq.invert()).normalize(); // 縱向→pivot 局部(常數)
        this.props.push({ pivot, axis });
      }
    } catch (e) {
      console.warn('螺旋槳/風扇偵測失敗：', e);
    }
  }

  // 錐削板（root 弦長→tip 弦長、半展長 span），用於尾翼/安定面，回傳幾何(在 XY 平面)
  _taperPlate(span, rootChord, tipChord) {
    const s = new THREE.Shape();
    s.moveTo(0, -rootChord / 2);
    s.lineTo(span, -tipChord / 2 + span * 0.18); // 後掠
    s.lineTo(span, tipChord / 2 + span * 0.18);
    s.lineTo(0, rootChord / 2);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.4, bevelEnabled: false });
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

  // 後掠錐削主翼 + 斜削翼尖（787 特徵），用 ExtrudeGeometry 做出梯形平面
  _buildWing(side, Y) {
    const grp = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, -3.0);            // 翼根前緣
    shape.lineTo(side * 21, 5.8);     // 翼尖前緣（後掠、斜削）
    shape.lineTo(side * 21, 7.4);     // 翼尖後緣（弦長變窄）
    shape.lineTo(0, 3.2);             // 翼根後緣
    shape.closePath();
    const wing = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.45, bevelEnabled: false }),
      this._mat.white
    );
    wing.rotation.x = Math.PI / 2;    // 平放：shapeY → worldZ
    grp.add(wing);
    grp.position.set(side * 1.7, Y - 0.5, 1);
    grp.rotation.z = side * 0.05;     // 上反角
    return grp;
  }

  // 引擎：短艙 + 進氣唇口 + 風扇 + 鋸齒 chevron 噴口 + 派龍
  _buildEngine(side, Y) {
    const grp = new THREE.Group();
    const cowl = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.3, 6, 24), this._mat.metal);
    cowl.rotation.x = Math.PI / 2;
    grp.add(cowl);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.16, 12, 24), this._mat.white);
    lip.position.z = -3;
    grp.add(lip);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(1.28, 24), this._mat.dark);
    fan.position.z = -2.9;
    grp.add(fan);
    const teeth = 14;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.8, 4), this._mat.metal);
      tooth.position.set(Math.cos(a) * 1.25, Math.sin(a) * 1.25, 3.1);
      tooth.rotation.x = -Math.PI / 2;
      grp.add(tooth);
    }
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 2.6), this._mat.metal);
    pylon.position.set(0, 1.5, 0.6);
    grp.add(pylon);
    grp.position.set(side * 7.5, Y - 1.7, -1.5);
    return grp;
  }

  // 擬真地勤人形：膚色有肉的四肢 + 衣褲 + 反光背心 + 安全帽 + 抗噪耳機。
  // color = 反光背心/帽顏色(高 emissive → 反光感)，用來區分角色。
  _personMarker(color) {
    const grp = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0a878, roughness: 0.75 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x42525f, roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2b2f37, roughness: 0.85 });
    const ear = new THREE.MeshStandardMaterial({ color: 0x1d2128, roughness: 0.5 });
    const vestMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.45 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xeef3f8, emissive: 0xc8d6e4, emissiveIntensity: 0.85, roughness: 0.25, metalness: 0.4 });
    // 腿(膚色有肉的大腿/小腿 + 鞋) + 短褲
    for (const lx of [-0.13, 0.13]) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.38, 5, 10), skin);
      thigh.position.set(lx, 0.6, 0); grp.add(thigh);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.4, 5, 10), skin);
      shin.position.set(lx, 0.2, 0); grp.add(shin);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.3), pants);
      shoe.position.set(lx, 0.02, 0.06); grp.add(shoe);
    }
    const shorts = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.34, 12), pants);
    shorts.position.y = 0.86; grp.add(shorts);
    // 軀幹襯衫
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.46, 6, 12), shirt);
    torso.position.y = 1.28; grp.add(torso);
    // 反光背心(套在襯衫外) + 兩道水平 + 兩道垂直反光條
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.26, 0.56, 14, 1, true), vestMat);
    vest.position.y = 1.3; grp.add(vest);
    for (const sy of [1.18, 1.42]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.06, 14, 1, true), stripe);
      st.position.y = sy; grp.add(st);
    }
    for (const sx of [-0.1, 0.1]) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.5, 0.02), stripe);
      v.position.set(sx, 1.3, 0.255); grp.add(v);
    }
    // 脖子 + 橢圓頭(非球) + 安全帽 + 抗噪耳機(兩側耳罩 + 頭帶)
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 8), skin);
    neck.position.y = 1.62; grp.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 16), skin);
    head.scale.set(0.92, 1.14, 1.0); head.position.y = 1.83; grp.add(head); // 拉長成頭型
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 8), skin);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.82, 0.2); grp.add(nose);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.21, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), vestMat);
    cap.position.y = 1.9; grp.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 12, 1, false, -Math.PI / 2, Math.PI), vestMat);
    brim.position.set(0, 1.9, 0.18); grp.add(brim);
    for (const ex of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 14), ear);
      cup.rotation.z = Math.PI / 2; cup.position.set(ex * 0.21, 1.82, 0); grp.add(cup);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.028, 8, 22, Math.PI), ear);
    band.position.y = 1.82; grp.add(band); // 半圈頭帶,自左耳罩跨頂到右耳罩
    return grp;
  }

  // 有關節的手臂：肩 pivot → 上臂 → 肘 pivot → 前臂 + 指揮棒。
  // 回傳肩 pivot，肘 pivot 存於 userData.elbow。
  _makeArm() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0a878, roughness: 0.75 }); // 膚色
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x42525f, roughness: 0.85 }); // 短袖
    const wandMat = new THREE.MeshStandardMaterial({ color: 0xff2a1e, emissive: 0xff1500, emissiveIntensity: 0.85 }); // 紅色發光指揮棒
    const shoulder = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.36, 4, 10), skin); // 有肉的上臂
    upper.position.y = -0.26;
    shoulder.add(upper);
    const slv = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.08, 0.18, 12), sleeve); // 短袖蓋住上臂頂
    slv.position.y = -0.12;
    shoulder.add(slv);
    const elbow = new THREE.Group();
    elbow.position.y = -0.5; // 上臂末端（肘）
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.34, 4, 10), skin); // 有肉的前臂
    fore.position.y = -0.22;
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), skin); // 手
    hand.position.y = -0.44;
    elbow.add(hand);
    const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.44, 8), wandMat);
    wand.position.y = -0.64;
    elbow.add(wand);
    shoulder.add(elbow);
    shoulder.userData.elbow = elbow;
    return shoulder;
  }

  // 帶關節手臂的人形：回傳 { grp, armL, armR }
  _buildArmsFigure(color) {
    const grp = this._personMarker(color);
    const armL = this._makeArm();
    const armR = this._makeArm();
    armL.position.set(-0.38, 1.55, 0);
    armR.position.set(0.38, 1.55, 0);
    grp.add(armL, armR);
    return { grp, armL, armR };
  }

  // 設定單手姿勢：肩(sx 繞X、sz 繞Z)、肘(ex 繞X 前後彎、ez 繞Z 上下擺)。
  // 大臂平舉(sz=±π/2 指向 ±X)時，肘 ez 可把小臂從「順著大臂(平舉)」擺到「向上(直舉)」。
  _setArm(shoulder, sx, sz, ex, ez = 0) {
    shoulder.rotation.set(sx, 0, sz);
    shoulder.userData.elbow.rotation.set(ex, 0, ez);
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

  // 依手勢擺一對手臂姿勢（紅色指揮棒信號，動畫式）。第三人稱看背面，左右已鏡射。
  // 大臂一律平舉(指向 ±X)；小臂+指揮棒以肘 ez 在「平舉(0)↔直舉(±π/2)」間擺動。
  // R 臂(+X)向上 ez=+π/2；L 臂(-X)向上 ez=-π/2。
  _poseArms(L, R, gesture) {
    if (!L || !R) return;
    const HR = Math.PI / 2, HL = -Math.PI / 2;       // 大臂平舉
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const osc = (Math.sin(t * 6) + 1) / 2;            // 0..1 來回擺動(~1Hz)
    const up = (side, frac) => side * (Math.PI / 2) * frac; // 小臂上抬比例 → 肘 ez
    switch (gesture) {
      case GESTURES.TURN_LEFT: // 一手小臂平舉↔直舉來回；另一手小臂保持平舉；大臂都平舉
        this._setArm(R, 0, HR, 0, up(1, osc));         // 右臂小臂擺動
        this._setArm(L, 0, HL, 0, 0);                  // 左臂小臂保持平舉
        break;
      case GESTURES.TURN_RIGHT:
        this._setArm(L, 0, HL, 0, up(-1, osc));        // 左臂小臂擺動
        this._setArm(R, 0, HR, 0, 0);                  // 右臂小臂保持平舉
        break;
      case GESTURES.GO: // 兩手小臂同時扇形擺動(平舉↔直舉)
        this._setArm(R, 0, HR, 0, up(1, osc));
        this._setArm(L, 0, HL, 0, up(-1, osc));
        break;
      case GESTURES.SLOW:
      case GESTURES.STOP: {
        // 整條手臂打直(大臂+小臂+指揮棒一直線，肘=0)，從 Y-(下)畫半圓經 X(平舉)掃到 Y+(上)。
        // 掃到頂時整條手臂「越過垂直向內傾」→ 兩支指揮棒交叉(手臂本身不交叉)。SLOW 來回掃、STOP 定在頂。
        const sweep = gesture === GESTURES.STOP ? 1 : (Math.sin(t * 3) + 1) / 2;
        const ang = sweep * (Math.PI + 0.5);           // 0(下)→π+0.5(上且向內傾)
        this._setArm(R, 0, ang, 0, 0);
        this._setArm(L, 0, -ang, 0, 0);
        break;
      }
      default: // NONE：雙臂自然垂下、前臂微彎
        this._setArm(L, 0, 0, 0.12, 0);
        this._setArm(R, 0, 0, 0.12, 0);
    }
  }

  // 玩家化身依手勢擺姿（鍵盤備援用）
  setMarshallerPose(gesture) {
    this._poseArms(this.armL, this.armR, gesture);
  }

  // 輪檔員（前方輔助指揮）依「建議手勢」擺姿，讓玩家照著做
  setChockmanPose(gesture) {
    this._poseArms(this.chArmL, this.chArmR, gesture);
  }

  _buildNPCs() {
    // Marshaller（玩家化身）站在停止線前方更遠處、面向來機(+Z)，讓駕駛清楚看見
    const ma = this._buildArmsFigure(0xffcc33);
    this.marshaller = ma.grp;
    this.armL = ma.armL;
    this.armR = ma.armR;
    this.marshaller.position.set(0, 0, -8);
    this.scene.add(this.marshaller);

    // Chockman（前方輔助指揮）：有關節手臂、站在中心線上面向來機，依飛機位置示範該做的手勢
    const ch = this._buildArmsFigure(0x38d66b);
    this.chockman = ch.grp;
    this.chArmL = ch.armL;
    this.chArmR = ch.armR;
    // 初始置於 787 停止線右方(loadAircraft 會依作用機型重新定位)
    const ax0 = (this.typeAcross && this.typeAcross.B787) ? this.typeAcross.B787 : 6;
    const z0 = (this.typeStopZ && this.typeStopZ.B787 != null) ? this.typeStopZ.B787 : STOP_LINE_Z;
    this.chockman.position.set(-(ax0 / 2 + 1.6), 0, z0);
    this.scene.add(this.chockman);

    // 兩位 Wing Walker：固定站在翼尖旋轉半徑的左右淨空邊界（不隨飛機移動）。
    // CLEAR 放大到可容納 747 半翼展(~34 單位) + 安全裕度。
    const CLEAR = 42;
    const guardZ = (TAXIWAY_Z - 14 + STOP_LINE_Z) / 2; // 停機坪中段
    this.wingL = this._personMarker(0xff8a3d);
    this.wingR = this._personMarker(0xff8a3d);
    this.wingL.position.set(-CLEAR, 0, guardZ);
    this.wingR.position.set(CLEAR, 0, guardZ);
    this.scene.add(this.wingL, this.wingR);

    // Apron safety line（紅色實線）：翼尖旋轉半徑的禁入邊界，標準為紅色實線
    const safetyMat = new THREE.MeshBasicMaterial({ color: 0xff5468 });
    for (const sx of [-CLEAR, CLEAR]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.25, TAXIWAY_Z - 10 - STOP_LINE_Z), safetyMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(sx, 0.015, (STOP_LINE_Z + TAXIWAY_Z - 10) / 2);
      this.scene.add(line);
    }
  }

  // 依飛機狀態更新可視物
  syncAircraft(ac) {
    this.aircraftGroup.position.set(ac.x, 0, ac.z);
    // YXZ：先航向(yaw)再俯仰(pitch) → pitch 繞「機身橫向軸」傾(剎車前傾不會歪掉航向)
    this.aircraftGroup.rotation.order = 'YXZ';
    this.aircraftGroup.rotation.y = ac.heading;
    this.aircraftGroup.rotation.x = ac.pitch ?? 0; // 機身俯仰(負=機鼻向下)

    // 鼻輪視覺打角 = 物理轉向角(飛機航向已依此角度用自行車模型轉向)。
    // 視覺與運動同源 → 鼻輪打多少、飛機就照那個弧度轉,不再像在飄移。
    if (this.noseGear) this.noseGear.rotation.y = ac.steerAngle ?? 0;

    // 輪子滾動：每顆輪的 pivot(位於輪心)繞「自身局部輪軸」自轉 → 原地正確滾動。
    // 用 rotateOnAxis(局部軸)而非 rotateOnWorldAxis：後者假設父層無旋轉，會把 777(yaw-90°)輪軸算成橫的。
    if (this.wheels && this.wheels.length && ac.speed > 0.001) {
      for (const w of this.wheels) w.pivot.rotateOnAxis(w.axle, -(ac.speed / 60) / w.radius);
    }

    // 螺旋槳/引擎風扇：繞機身縱向軸持續快速自轉(隨引擎轉速;關車 spool-down 變慢停)
    if (this.props && this.props.length) {
      const spin = (this.engineRPM ?? 0) * 0.85;
      if (spin > 0.0005) for (const p of this.props) p.pivot.rotateOnAxis(p.axis, spin);
    }

    // 引擎轉速比例(供引擎聲)：運轉中=1，停妥關車後慢慢衰減到 0(spool-down)。
    const rpmTarget = ac.stopped ? 0 : 1;
    this.engineRPM = (this.engineRPM ?? 1) + (rpmTarget - (this.engineRPM ?? 1)) * 0.012;
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
