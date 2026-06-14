# Aircraft Marshaller Simulator

用手勢指揮飛機進入停機位的網頁遊戲。玩家扮演 **Aircraft Marshaller（地面導引員）**，透過電腦鏡頭即時辨識手勢，引導 3D 飛機沿停機位導入線滑入、對齊中心線並停在停止點。

**🎮 線上試玩：** https://masonzeng702550.github.io/aircraft-marshaller/

> 需使用桌機瀏覽器（建議 Chrome / Edge）並允許鏡頭。影像僅在本機處理，不會上傳或儲存。

## 玩法

飛機沿與停機線垂直的滑行道，從左或右側自動滑行進場，並朝機頭方向前進。你要用**轉向**手勢沿彎曲導入線把它導上黃色中心線、沿長直中心線對齊，最後用**停止**停在紅色停止線前的機位（A9）。轉進停機坪後會自動限速到 5 節以下，方便慢慢對齊。

### 手勢（依 ICAO 標準機坪信號，單幀姿勢近似）
- **前進 Move ahead**：雙手舉到頭前、上下招手
- **左轉 Turn left**：右臂側平舉當軸、左手向上招手
- **右轉 Turn right**：左臂側平舉當軸、右手向上招手
- **減速 Slow down**：雙臂下伸、向外張開上下拍
- **停止 Stop**：雙臂上舉、於頭頂交叉

HUD 的「追蹤」顯示鏡頭是否抓到你；「中心線偏移」越小越好（綠色為對齊）。第三人稱可看到自己的化身依手勢動作。

### 鍵盤備援（無鏡頭或除錯）
`W` 前進 / `A` 左轉 / `D` 右轉 / `Q` 減速 / `S` 停止 / `R` 重置

## 本機開發

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 產出 dist/
```

部署：推送到 `main` 後，GitHub Actions 會自動建置並發佈到 GitHub Pages。

## 技術堆疊
- **動作辨識**：MediaPipe Tasks Vision（Pose Landmarker，本機推論）
- **3D**：Three.js
- **建置**：Vite
- **手勢分類**：規則式（關鍵點角度／相對位置），非訓練模型

## 結構
```
src/
  main.js      主迴圈、HUD、啟動流程、鍵盤備援
  pose.js      MediaPipe 封裝、鏡頭、骨架疊圖
  gesture.js   手勢分類器 + 去抖動穩定門
  aircraft.js  飛機物理 + 狀態機 + 機型參數
  scene.js     Three.js 場景、雙相機、NPC、停機位標線
  style.css    HUD / 啟動畫面樣式
```

## Credits（模型授權）
- 飛機模型："**Boeing 787-8**" by **rocket0314** — [Sketchfab](https://sketchfab.com/3d-models/boeing-787-8-22a06131abdf4158a81f9ad2ddfde5b9)，授權 [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/)。
