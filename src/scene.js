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
    const straightLen = JUNCTION_Z - STOP_LINE_Z;
    const centerline = new THREE.Mesh(new THREE.PlaneGeometry(0.2, straightLen + 4), lineMat); // 線寬≈0.28m(真實導入線 15cm 級)
    centerline.rotation.x = -Math.PI / 2;
    centerline.position.set(0, 0.02, STOP_LINE_Z + straightLen / 2);
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
    alignBar.position.set(0, 0.025, STOP_LINE_Z - 5);
    this.scene.add(alignBar);

    // 機型鼻輪停止線（依 ICAO Doc 9157 Pt4 機坪標線）：每個機型一條「黃色橫桿+黑邊」垂直於導入線，
    // 旁邊標機型代號(黑底黃字)。各機型停止距離不同：機身越長、鼻輪停得越外側(距登機口越遠)，
    // 依機身長度按比例排布；橫桿寬度也隨翼展略微比例化。787 對齊功能停止線(STOP_LINE_Z)。
    // len=機身長(m)、span=翼展(m)。距離 z = STOP_LINE_Z + (len - 62.8)*0.16。
    // 機型鼻輪停止橫桿：依「真實機身長度 × 場景比例尺(≈0.72 單位/公尺)」按比例排距。
    // 機身越長、鼻輪停得越外側(+z，機身才放得進機坪)；787 對齊功能停止線(STOP_LINE_Z)。
    // len=機身長(m)、span=翼展(m)、track=主輪距(m，決定橫桿寬度)。
    const SCALE = 0.72; // 場景公尺→單位(787 模型 46 單位 / 62.8m)
    const REF_LEN = 62.8; // 787 為基準
    this.typeMarks = {};
    this.typeStopZ = {};
    this.typeAcross = {};
    const TYPES = [
      { key: 'ATR72', len: 27.2, track: 4.1 },
      { key: 'A320', len: 37.6, track: 7.6 },
      { key: 'B737', len: 39.5, track: 5.7 },
      { key: 'B787', len: 62.8, track: 11.0 },
      { key: 'A330', len: 63.7, track: 10.7 },
      { key: 'A350', len: 66.8, track: 10.7 },
      { key: 'B777', len: 73.9, track: 12.9 },
    ];
    TYPES.forEach((t, i) => {
      const z = STOP_LINE_Z + (t.len - REF_LEN) * SCALE; // 依真實長度按比例
      const across = t.track * SCALE + 1.2;              // 橫桿寬度依主輪距按比例
      this.typeStopZ[t.key] = z;
      this.typeAcross[t.key] = across;
      this._addTypeStopBar(t.key, z, across, i % 2 === 0 ? 1 : -1);
    });
    this._highlightTypeMark('B787'); // 預設機型的停止線標紅(目前作用中)

    // 機位編號（停止點附近，置於最內側機型停止線之前）
    this._addStandLabel('A9', STOP_LINE_Z + (27.2 - REF_LEN) * 0.72 - 5);
  }

  // 單條機型鼻輪停止橫桿：黑邊黃桿(垂直導入線) + 側邊機型代號標牌(黑底黃字)。
  // side=+1/-1：標牌交錯置於左右兩端，避免相鄰標牌重疊。
  _addTypeStopBar(key, z, across, side = 1) {
    const outline = new THREE.Mesh(
      new THREE.PlaneGeometry(across + 0.32, 0.95),
      new THREE.MeshBasicMaterial({ color: 0x14160f })
    );
    outline.rotation.x = -Math.PI / 2;
    outline.position.set(0, 0.028, z);
    this.scene.add(outline);
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(across, 0.62), // 寬度≈0.9m(真實鼻輪停止橫桿)
      new THREE.MeshBasicMaterial({ color: 0xf2d250 })
    );
    bar.rotation.x = -Math.PI / 2;
    bar.position.set(0, 0.032, z);
    this.scene.add(bar);
    this.typeMarks[key] = bar;
    // 機型代號標牌(黑底黃字)，交錯置於橫桿左右端外側
    this._addTypeLabel(key, side * (across / 2 + 1.6), z);
  }

  // 機型代號標牌：黑底圓角 + 黃字（ICAO 規定黃字黑底）
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
      new THREE.PlaneGeometry(2.5, 0.95), // 縮到接近真實標牌尺寸
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.PI; // 文字正面朝第三人稱(自後方看 +Z)
    mesh.position.set(x, 0.033, z);
    this.scene.add(mesh);
  }

  // 標示目前作用中機型的停止橫桿(紅)、其餘回黃
  _highlightTypeMark(key) {
    if (!this.typeMarks) return;
    for (const [k, bar] of Object.entries(this.typeMarks)) {
      bar.material.color.set(k === key ? 0xff5468 : 0xf2d250);
    }
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
    this._highlightTypeMark(key); // 對應機型停止橫桿標紅
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
        this.aircraftGroup.updateMatrixWorld(true);

        // 精修貼地：以輪子最低點為準(失敗則沿用概略貼地)
        try {
          let wheelBottom = Infinity;
          holder.traverse((o) => {
            if (!o.isMesh || !o.geometry) return;
            o.geometry.computeBoundingBox();
            const ld = new THREE.Vector3(); o.geometry.boundingBox.getSize(ld);
            const d = [ld.x, ld.y, ld.z].sort((a, b) => a - b);
            if (!(d[1] > 0.65 * d[2] && d[0] < 0.6 * d[2])) return;
            const b = new THREE.Box3().setFromObject(o);
            const s = new THREE.Vector3(); b.getSize(s);
            const ctr = new THREE.Vector3(); b.getCenter(ctr);
            if (ctr.y < 0.3 * targetLen && Math.max(s.x, s.y, s.z) < 0.16 * targetLen) {
              wheelBottom = Math.min(wheelBottom, b.min.y);
            }
          });
          if (isFinite(wheelBottom)) {
            holder.position.y += -wheelBottom; // 將輪子降到 y=0
            this.aircraftGroup.updateMatrixWorld(true);
          }
        } catch (e) { console.warn('貼地精修失敗：', e); }

        this._setupNoseSteer(holder, targetLen);
        this._setupWheels(holder, targetLen);
      },
      undefined,
      (err) => console.warn('飛機模型載入失敗：', err)
    );
  }

  // 建立鼻輪轉向 pivot：轉向軸必須通過「鼻輪本身」的 (x,z)，否則轉動時會沿弧線飄離。
  // (A) 有具名齒輪節點(787)：以輪/胎節點的 x,z 為軸；(B) 無具名(777)：幾何抓最前端低矮小輪。
  _setupNoseSteer(holder, targetLen) {
    this.noseGear = null;
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
        const cand = [];
        holder.traverse((o) => {
          if (!this._isWheelShape(o)) return;
          const b = new THREE.Box3().setFromObject(o);
          const s = new THREE.Vector3(); b.getSize(s);
          const c = new THREE.Vector3(); b.getCenter(c);
          // 用「機身座標系」的 z(機鼻恆為 -Z)判定前後，避免載入時 spawn 轉向造成抓錯邊
          const bodyZ = this.aircraftGroup.worldToLocal(c.clone()).z;
          if (Math.max(s.x, s.y, s.z) < 0.08 * targetLen && c.y < 0.15 * targetLen) cand.push({ o, z: bodyZ });
        });
        if (!cand.length) return;
        const minZ = Math.min(...cand.map((w) => w.z));
        tops = cand.filter((w) => w.z < minZ + 0.06 * targetLen).map((w) => w.o);
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

  // 偵測可滾動的輪胎：圓形 + 貼地 + 非極小 + 成群且取起落架最底層(=真正輪胎)。
  // 每顆輪胎包進「以輪心為樞軸」的 pivot 再自轉 → 保證原地滾動(不繞偏心原點亂甩，修 777 主輪)。
  _setupWheels(holder, targetLen) {
    this.wheels = [];
    try {
      holder.updateMatrixWorld(true);
      const underNose = (o) => { for (let p = o.parent; p; p = p.parent) if (p === this.noseGear) return true; return false; };
      const round = [];
      holder.traverse((o) => {
        if (!this._isWheelShape(o)) return;
        if (this.noseGear && underNose(o)) return; // 鼻輪由轉向 pivot 處理，避免重複/反父化衝突
        const wb = new THREE.Box3().setFromObject(o);
        const ws = new THREE.Vector3(); wb.getSize(ws);
        const wc = new THREE.Vector3(); wb.getCenter(wc);
        const maxW = Math.max(ws.x, ws.y, ws.z);
        round.push({ mesh: o, radius: maxW / 2 || 0.5, maxW, x: wc.x, y: wc.y, z: wc.z, c: wc });
      });
      const small = round.filter((r) =>
        r.maxW <= 0.06 * targetLen && r.maxW > 0.005 * targetLen && r.y < 0.12 * targetLen);
      const grouped = small.filter((r) =>
        small.filter((s) => Math.abs(s.x - r.x) < 3.5 && Math.abs(s.z - r.z) < 3.5).length >= 2);
      let selected = [];
      if (grouped.length) {
        const minY = Math.min(...grouped.map((r) => r.y));
        selected = grouped.filter((r) => r.y < minY + 0.7);
      }
      // 為每顆輪胎在「輪心」建立 pivot，反父化後繞樞軸自轉 → 純粹原地滾動
      for (const r of selected) {
        const pivot = new THREE.Group();
        pivot.position.copy(holder.worldToLocal(r.c.clone()));
        holder.add(pivot);
        pivot.updateMatrixWorld(true);
        pivot.attach(r.mesh);
        this.wheels.push({ pivot, radius: r.radius });
      }
    } catch (e) {
      console.warn('輪子偵測失敗：', e);
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
    const wandMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 0.75 }); // 發光指揮棒
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

  // 依手勢擺一對手臂姿勢（含肘關節）。第三人稱看背面，左右已鏡射。
  _poseArms(L, R, gesture) {
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

    // 輪子滾動：每顆輪的 pivot(位於輪心)繞「機身橫向(輪軸)世界軸」自轉 → 原地滾動。
    // 機身橫向世界向量 = 機身局部 +X 經 heading 旋轉 = (cos h, 0, -sin h)；
    // 由滾動無滑動 ω = -(v/r)·lateral 推得方向(機頭朝 -Z 前進時輪子正向滾)。
    if (this.wheels && this.wheels.length && ac.speed > 0.001) {
      const lateral = new THREE.Vector3(Math.cos(ac.heading), 0, -Math.sin(ac.heading));
      for (const w of this.wheels) w.pivot.rotateOnWorldAxis(lateral, -(ac.speed / 60) / w.radius);
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
