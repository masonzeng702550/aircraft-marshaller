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
    this.tpv.position.set(0, 10, -15);
    this.tpv.lookAt(0, 2.5, 40);
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
    const centerline = new THREE.Mesh(new THREE.PlaneGeometry(0.5, straightLen + 4), lineMat);
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
    const taxiCenter = new THREE.Mesh(new THREE.PlaneGeometry(260, 0.5), lineMat);
    taxiCenter.rotation.x = -Math.PI / 2;
    taxiCenter.position.set(0, 0.02, TAXIWAY_Z);
    this.scene.add(taxiCenter);

    // Turn bar（轉彎橫桿）：標示開始轉彎處，垂直於導入線、位於導入弧銜接點
    const turnBar = new THREE.Mesh(new THREE.PlaneGeometry(12, 0.8), lineMat);
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
    const stopBar = new THREE.Mesh(new THREE.PlaneGeometry(28, 0.9), stopMat);
    stopBar.rotation.x = -Math.PI / 2;
    stopBar.position.set(0, 0.03, STOP_LINE_Z);
    this.scene.add(stopBar);

    // 機位編號（停止點附近）
    this._addStandLabel('A9', STOP_LINE_Z - 9);
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

  // 偵測可滾動的輪胎：圓形 + 貼地 + 非極小 + 成群且取起落架最底層(=真正輪胎)
  _setupWheels(holder, targetLen) {
    this.wheels = [];
    try {
      holder.updateMatrixWorld(true);
      const round = [];
      holder.traverse((o) => {
        if (!this._isWheelShape(o)) return;
        o.geometry.computeBoundingBox();
        const ld = new THREE.Vector3(); o.geometry.boundingBox.getSize(ld);
        const dims = [['x', ld.x], ['y', ld.y], ['z', ld.z]].sort((a, b) => a[1] - b[1]);
        const wb = new THREE.Box3().setFromObject(o);
        const ws = new THREE.Vector3(); wb.getSize(ws);
        const wc = new THREE.Vector3(); wb.getCenter(wc);
        const maxW = Math.max(ws.x, ws.y, ws.z);
        round.push({ mesh: o, axis: dims[0][0], radius: maxW / 2 || 0.5, maxW, x: wc.x, y: wc.y, z: wc.z });
      });
      const small = round.filter((r) =>
        r.maxW <= 0.06 * targetLen && r.maxW > 0.005 * targetLen && r.y < 0.12 * targetLen);
      const grouped = small.filter((r) =>
        small.filter((s) => Math.abs(s.x - r.x) < 3.5 && Math.abs(s.z - r.z) < 3.5).length >= 2);
      if (grouped.length) {
        const minY = Math.min(...grouped.map((r) => r.y));
        this.wheels = grouped.filter((r) => r.y < minY + 0.7);
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
    this.chockman.position.set(0, 0, STOP_LINE_Z + 3);
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

    // 鼻輪轉向：依轉向指令偏轉到最大轉向角(各機型不同)，平滑過渡、原地打角
    const maxSteer = this.noseSteerMax ?? 0.6;
    let steerTarget = 0;
    if (ac.command === GESTURES.TURN_LEFT) steerTarget = maxSteer;
    else if (ac.command === GESTURES.TURN_RIGHT) steerTarget = -maxSteer;
    this._steer = (this._steer || 0) + (steerTarget - (this._steer || 0)) * 0.15;
    if (this.noseGear) this.noseGear.rotation.y = this._steer;

    // 輪子滾動：全部繞「機身橫向(輪軸)世界軸」統一滾動。
    // 不用各輪自己的局部薄軸(不同輪局部座標不一致 → 會各轉各的、看起來亂轉)。
    // 機身橫向世界向量 = 機身局部 +X 經 heading 旋轉 = (cos h, 0, -sin h)；
    // 由滾動無滑動 ω = -(v/r)·lateral 推得方向(機頭朝 -Z 前進時輪子正向滾)。
    if (this.wheels && this.wheels.length && ac.speed > 0.001) {
      const lateral = new THREE.Vector3(Math.cos(ac.heading), 0, -Math.sin(ac.heading));
      for (const w of this.wheels) w.mesh.rotateOnWorldAxis(lateral, -(ac.speed / 60) / w.radius);
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
