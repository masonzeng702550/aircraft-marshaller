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
    this.scene.fog = new THREE.Fog(0x0b0f14, 110, 240);

    this.view = 'TPV';
    this._buildCameras();
    this._buildLights();
    this._buildApron();
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
    this.tpv = new THREE.PerspectiveCamera(70, aspect, 0.1, 500);
    this.tpv.position.set(0, 20, -18);
    this.tpv.lookAt(0, 0, 30);
    // 第一人稱：marshaller 視角，面向來機(+Z)
    this.fpv = new THREE.PerspectiveCamera(72, aspect, 0.1, 500);
    this.fpv.position.set(0, 2.4, 1.4);
    this.fpv.lookAt(0, 2, 60);
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
    for (let x = -48; x <= 48; x += 6) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.5), taxiMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.02, TAXIWAY_Z);
      this.scene.add(dash);
    }

    // 停止線（橫向紅線）
    const stopMat = new THREE.MeshBasicMaterial({ color: 0xff5468 });
    const stopBar = new THREE.Mesh(new THREE.PlaneGeometry(16, 0.6), stopMat);
    stopBar.rotation.x = -Math.PI / 2;
    stopBar.position.set(0, 0.03, STOP_LINE_Z);
    this.scene.add(stopBar);

    // 機位編號（停止點附近）
    this._addStandLabel('A9', STOP_LINE_Z - 3);

    // 空橋占位（停止線旁，往飛機門靠）
    this.jetbridge = new THREE.Mesh(
      new THREE.BoxGeometry(8, 3, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x3a4754, roughness: 0.8 })
    );
    this.jetbridge.position.set(-11, 2.2, STOP_LINE_Z + 1);
    this.scene.add(this.jetbridge);
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

  // 真實民航機比例（窄體 A320 級，單位 m）：機身長≈翼展、機鼻在 local z=-17.5(=NOSE_OFFSET)
  _buildAircraft() {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xdfe7ee, roughness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x36c2ff, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a3440, roughness: 0.7 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111418 });
    const R = 1.95;       // 機身半徑（直徑≈3.9m）
    const Y = 2.6;        // 機身中心高

    // 機身（z -15..+15）
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 30, 24), white);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.position.y = Y;
    g.add(fuselage);

    // 機鼻（base z=-15、tip z=-17.5）
    const nose = new THREE.Mesh(new THREE.ConeGeometry(R, 2.5, 24), white);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, Y, -16.25);
    g.add(nose);

    // 主翼（翼展 34）
    const wing = new THREE.Mesh(new THREE.BoxGeometry(34, 0.5, 5), accent);
    wing.position.set(0, Y - 0.6, 1);
    g.add(wing);

    // 引擎短艙（翼下兩具）
    for (const x of [-6, 6]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 4, 16), dark);
      eng.rotation.x = Math.PI / 2;
      eng.position.set(x, Y - 1.5, 0.5);
      g.add(eng);
    }

    // 水平尾翼 + 垂直尾翼
    const tailWing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 3), accent);
    tailWing.position.set(0, Y + 1.6, 13.5);
    g.add(tailWing);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.5, 4), accent);
    fin.position.set(0, Y + 3.6, 13.8);
    g.add(fin);

    // 起落架（機鼻 + 主輪）
    const noseWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.4, 14), wheelMat);
    noseWheel.rotation.z = Math.PI / 2;
    noseWheel.position.set(0, 0.7, -12);
    g.add(noseWheel);
    for (const x of [-2.6, 2.6]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.5, 14), wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.85, 3);
      g.add(wheel);
    }

    return g;
  }

  _personMarker(color) {
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 8), mat);
    body.position.y = 0.9;
    grp.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), mat);
    head.position.y = 1.7;
    grp.add(head);
    return grp;
  }

  // 可動手臂：pivot 在肩膀，預設自然垂下；末端有橘色指揮棒提高辨識度
  _makeArm() {
    const pivot = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xffcc33 });
    const wand = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0x3a1500 });
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.62, 4, 8), skin);
    upper.position.y = -0.4;
    pivot.add(upper);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), wand);
    tip.position.y = -0.92;
    pivot.add(tip);
    return pivot;
  }

  // 帶手臂的 marshaller 化身
  _buildMarshaller(color) {
    const grp = this._personMarker(color);
    this.armL = this._makeArm();
    this.armR = this._makeArm();
    this.armL.position.set(-0.42, 1.42, 0);
    this.armR.position.set(0.42, 1.42, 0);
    grp.add(this.armL, this.armR);
    return grp;
  }

  // 依手勢擺出化身手臂姿勢（讓玩家在第三人稱看到「自己」的動作）
  setMarshallerPose(gesture) {
    const L = this.armL, R = this.armR;
    if (!L || !R) return;
    L.rotation.set(0, 0, 0);
    R.rotation.set(0, 0, 0);
    switch (gesture) {
      case GESTURES.GO: // 雙手向上招手
        L.rotation.x = Math.PI * 0.82;
        R.rotation.x = Math.PI * 0.82;
        break;
      case GESTURES.STOP: // 雙臂上舉於頭頂交叉
        L.rotation.x = Math.PI * 0.96;
        R.rotation.x = Math.PI * 0.96;
        L.rotation.z = -0.45;
        R.rotation.z = 0.45;
        break;
      // 第三人稱看到的是化身背面，左右需鏡射才符合「照鏡子」直覺：
      // 玩家舉左手(TURN_LEFT) → 化身舉「畫面上同側」的手（化身的右手 armR）
      case GESTURES.TURN_LEFT: // 左手向上招手 + 右臂平舉當軸（鏡射）
        R.rotation.x = Math.PI * 0.85;
        L.rotation.z = -1.45;
        break;
      case GESTURES.TURN_RIGHT: // 右手向上招手 + 左臂平舉當軸（鏡射）
        L.rotation.x = Math.PI * 0.85;
        R.rotation.z = 1.45;
        break;
      case GESTURES.SLOW: // 雙臂下伸並向外張（拍動的近似）
        L.rotation.z = -0.7;
        R.rotation.z = 0.7;
        break;
      default:
        break; // NONE：雙臂自然垂下
    }
  }

  _buildNPCs() {
    // Marshaller（玩家化身）站原點前方一點，面向來機(+Z)
    this.marshaller = this._buildMarshaller(0xffcc33);
    this.marshaller.position.set(0, 0, 2);
    this.scene.add(this.marshaller);

    // Chockman 在停止線旁
    this.chockman = this._personMarker(0x38d66b);
    this.chockman.position.set(3, 0, STOP_LINE_Z);
    this.scene.add(this.chockman);

    // 兩位 Wing Walker：固定站在翼尖旋轉半徑的左右淨空邊界（不隨飛機移動），
    // 守住機翼掃掠區，防止人車進入。CLEAR ≈ 窄體半翼展 18 + 安全裕度。
    const CLEAR = 21;
    const guardZ = (TAXIWAY_Z - 14 + STOP_LINE_Z) / 2; // 停機坪中段
    this.wingL = this._personMarker(0xff8a3d);
    this.wingR = this._personMarker(0xff8a3d);
    this.wingL.position.set(-CLEAR, 0, guardZ);
    this.wingR.position.set(CLEAR, 0, guardZ);
    this.scene.add(this.wingL, this.wingR);

    // 翼尖淨空邊界（左右虛線，標示禁入區）
    const clearMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d });
    for (const sx of [-CLEAR, CLEAR]) {
      for (let z = STOP_LINE_Z; z <= TAXIWAY_Z - 10; z += 5) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 2), clearMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(sx, 0.015, z);
        this.scene.add(dash);
      }
    }
  }

  // 依飛機狀態更新可視物
  syncAircraft(ac) {
    this.aircraftGroup.position.set(ac.x, 0, ac.z);
    this.aircraftGroup.rotation.y = ac.heading;
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
