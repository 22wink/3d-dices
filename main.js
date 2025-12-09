import * as THREE from "https://esm.sh/three";
import { RoundedBoxGeometry } from "https://esm.sh/three/addons/geometries/RoundedBoxGeometry.js";
import * as CANNON from "https://esm.sh/cannon-es";

// --- 全域變數設定 ---
let scene, camera, renderer, world;
let diceObjects = [];
let isHolding = false;       // 是否正在拖曳中
let needsResultCheck = false; // 是否需要檢查停止並結算
let mouse = new THREE.Vector2();
let raycaster = new THREE.Raycaster();

const FRUSTUM_SIZE = 23;     // 攝影機視角大小
// 拖曳平面：用來接收滑鼠射線，計算拖曳位置
let dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -15); 

// UI 元素
const uiResult = document.getElementById("result-board");
const uiTotal = document.getElementById("total-score");
const uiDetail = document.getElementById("detail-score");

// 顏色設定
const palette = [
  "#EAA14D", "#E05A47", "#4D9BEA", "#5FB376", 
  "#D869A8", "#F2C94C", "#9B51E0", "#FFFFFF" 
];

const commonColors = {
  dots: "#FFFFFF",
  outline: "#725349",
  shadow: "#F3BD2E"
};

// --- 程式入口 ---
init();
animate();

function init() {
  // 1. Three.js 場景設定
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#F6F3EB");

  const aspect = window.innerWidth / window.innerHeight;
  
  // 正交攝影機 (OrthographicCamera) 避免透視變形
  camera = new THREE.OrthographicCamera(
    (FRUSTUM_SIZE * aspect) / -2,
    (FRUSTUM_SIZE * aspect) / 2,
    FRUSTUM_SIZE / 2,
    FRUSTUM_SIZE / -2,
    1,
    1000
  );
  
  camera.position.set(50, 50, 50); 
  camera.lookAt(0, 0, 0); 

  // 渲染器設定
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.style.touchAction = 'none'; 
  renderer.domElement.style.userSelect = 'none';
  document.body.appendChild(renderer.domElement);

  // 2. Cannon.js 物理世界設定
  world = new CANNON.World();
  world.gravity.set(0, -40, 0); // 重力向下
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 20;
  world.allowSleep = true; 

  // 材質接觸設定 (定義彈性與摩擦力)
  const wallMat = new CANNON.Material();
  const diceMat = new CANNON.Material();
  world.addContactMaterial(
    new CANNON.ContactMaterial(wallMat, diceMat, {
      friction: 0.3,
      restitution: 0.6
    })
  );

  // 建立圍牆與初始骰子
  createPhysicsWalls(wallMat);
  updateDiceCount(3); // 預設 3 顆

  // 3. 事件監聽
  window.addEventListener("resize", onWindowResize);

  // 滑鼠/觸控輸入 (綁定在 window 以防拖出邊界)
  window.addEventListener("mousedown", onInputStart);
  window.addEventListener("mousemove", onInputMove);
  window.addEventListener("mouseup", onInputEnd);
  
  document.body.addEventListener("mouseleave", onInputEnd); 
  
  window.addEventListener("touchstart", onInputStart, { passive: false });
  window.addEventListener("touchmove", onInputMove, { passive: false });
  window.addEventListener("touchend", onInputEnd);

  // 骰子數量變更偵測
  const countSelect = document.getElementById("diceCount");
  if(countSelect) {
      countSelect.addEventListener("change", (e) => {
        updateDiceCount(parseInt(e.target.value));
      });
  }
}

// --- 輸入處理邏輯 ---

function updateMousePosition(e) {
  let x, y;
  if (e.changedTouches) {
    x = e.changedTouches[0].clientX;
    y = e.changedTouches[0].clientY;
  } else {
    x = e.clientX;
    y = e.clientY;
  }
  // 轉換為標準化設備座標 (NDC) -1 到 +1
  mouse.x = (x / window.innerWidth) * 2 - 1;
  mouse.y = -(y / window.innerHeight) * 2 + 1;
}

function onInputStart(e) {
  // 排除 UI 點擊
  if (
    e.target.tagName === "SELECT" ||
    e.target.tagName === "LABEL" ||
    e.target.closest(".top-bar")
  )
    return;

  if(e.preventDefault) e.preventDefault();

  isHolding = true;
  needsResultCheck = false;
  if(uiResult) uiResult.classList.remove("show");
  updateMousePosition(e);

  // 開始拖曳時，喚醒骰子並給予一點隨機旋轉參數
  diceObjects.forEach(obj => {
      obj.body.wakeUp(); 
      obj.spinOffset = Math.random() * 100; 
      obj.isReturning = false; // 重置狀態：只要被抓起來就不是「回歸中」
  });
}

function onInputMove(e) {
  if (!isHolding) return;
  if(e.preventDefault) e.preventDefault();
  updateMousePosition(e);
}

function onInputEnd(e) {
  if (!isHolding) return;
  isHolding = false;
  releaseDice(); // 放開滑鼠，執行擲骰邏輯
}

// --- 物理與物體建立 ---

function createPhysicsWalls(material) {
  // 地板
  const floorBody = new CANNON.Body({ mass: 0, material: material });
  floorBody.addShape(new CANNON.Plane());
  floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(floorBody);

  // 四周牆壁
  const wallDistance = 12;
  const createWall = (x, z, rot) => {
    const body = new CANNON.Body({ mass: 0, material: material });
    body.addShape(new CANNON.Plane());
    body.position.set(x, 0, z);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rot);
    world.addBody(body);
  };
  createWall(wallDistance, 0, -Math.PI / 2);
  createWall(-wallDistance, 0, Math.PI / 2);
  createWall(0, -wallDistance, 0);
  createWall(0, wallDistance, Math.PI);
}

// 繪製向量骰子貼圖
function createVectorDiceTexture(number, colorHex) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // 背景色
  ctx.fillStyle = colorHex;
  ctx.fillRect(0, 0, size, size);

  const isTraditional = (colorHex === "#FFFFFF"); // 常見的紅白點骰子

  let dotColor = commonColors.dots;
  if (isTraditional) {
    if (number === 1) dotColor = "#E03E3E"; // 1點紅色
    else if (number === 4) dotColor = "#E03E3E"; 
    else dotColor = "#331e18"; 
  }

  ctx.fillStyle = dotColor;

  const dotSize = size / 5;
  const currentDotSize = (isTraditional && number === 1) ? dotSize * 1.5 : dotSize;

  const center = size / 2;
  const q1 = size / 4;
  const q3 = (size * 3) / 4;

  function drawDot(x, y) {
    ctx.beginPath();
    ctx.arc(x, y, currentDotSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 根據點數繪製圓點
  if (number === 1) drawDot(center, center);
  else if (number === 2) { drawDot(q1, q1); drawDot(q3, q3); }
  else if (number === 3) { drawDot(q1, q1); drawDot(center, center); drawDot(q3, q3); }
  else if (number === 4) { drawDot(q1, q1); drawDot(q3, q1); drawDot(q1, q3); drawDot(q3, q3); }
  else if (number === 5) { drawDot(q1, q1); drawDot(center, center); drawDot(q1, q3); drawDot(q3, q3); drawDot(q3, q1); }
  else if (number === 6) { drawDot(q1, q1); drawDot(q3, q1); drawDot(q1, center); drawDot(q3, center); drawDot(q1, q3); drawDot(q3, q3); }
  return new THREE.CanvasTexture(canvas);
}

function updateDiceCount(count) {
  // 清除舊骰子
  diceObjects.forEach((obj) => {
    scene.remove(obj.mesh);
    scene.remove(obj.outline);
    scene.remove(obj.shadow);
    world.removeBody(obj.body);
    if (obj.mesh.material) {
      obj.mesh.material.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
  diceObjects = [];
  if(uiResult) uiResult.classList.remove("show");

  // 建立新骰子幾何體
  const boxSize = 2.5;
  const geometry = new RoundedBoxGeometry(boxSize, boxSize, boxSize, 4, 0.4);
  const outlineGeo = geometry.clone();
  const shadowGeo = new THREE.CircleGeometry(boxSize * 0.6, 32);
  const shape = new CANNON.Box(new CANNON.Vec3(boxSize / 2, boxSize / 2, boxSize / 2));
  
  const outlineMat = new THREE.MeshBasicMaterial({ color: commonColors.outline, side: THREE.BackSide });
  const shadowMat = new THREE.MeshBasicMaterial({ color: commonColors.shadow, transparent: true, opacity: 0.2 });

  for (let i = 0; i < count; i++) {
    const randomColor = palette[Math.floor(Math.random() * palette.length)];
    const diceMaterials = [];
    for (let j = 1; j <= 6; j++) {
      diceMaterials.push(new THREE.MeshBasicMaterial({ map: createVectorDiceTexture(j, randomColor) }));
    }
    
    // 調整材質順序以匹配 Cube UV 對應
    const matArray = [
      diceMaterials[0], diceMaterials[5], diceMaterials[1], 
      diceMaterials[4], diceMaterials[2], diceMaterials[3]
    ];

    const mesh = new THREE.Mesh(geometry, matArray);
    scene.add(mesh);

    const outline = new THREE.Mesh(outlineGeo, outlineMat);
    outline.position.copy(mesh.position);
    outline.scale.setScalar(1.06);
    scene.add(outline);

    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    scene.add(shadow);

    const startX = (i - (count - 1) / 2) * 2.5;
    const body = new CANNON.Body({
      mass: 5,
      shape: shape,
      position: new CANNON.Vec3(startX, boxSize, 0),
      sleepSpeedLimit: 0.5
    });
    body.quaternion.setFromEuler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    world.addBody(body);

    // 加入 isReturning 屬性，預設為 false
    diceObjects.push({ mesh, outline, shadow, body, spinOffset: 0, isReturning: false });
  }
}

// --- 擲骰子邏輯 (關鍵修改處) ---

function releaseDice() {
  const SAFE_LIMIT = 9; // 牆壁內側的安全範圍 (牆壁在12, 骰子寬2.5, 9 是安全區)

  diceObjects.forEach((obj) => {
    const { body } = obj;
    
    // 檢查是否超出牆壁範圍
    const isOutside = 
      Math.abs(body.position.x) > SAFE_LIMIT || 
      Math.abs(body.position.z) > SAFE_LIMIT;

    if (isOutside) {
      // 如果在外面，標記為「正在飛回來」，暫時不喚醒物理
      // 這樣可以防止物理引擎因為穿牆而報錯
      obj.isReturning = true;
    } else {
      // 如果在裡面，直接開始物理模擬
      body.wakeUp();
      applyThrowForce(body);
    }
  });

  // 延遲開啟結果檢查
  setTimeout(() => {
    needsResultCheck = true;
  }, 500);
}

// 獨立出來的施力函式
function applyThrowForce(body) {
  const xDist = -body.position.x;
  const zDist = -body.position.z;
  
  // 根據距離施加反向力道，加上隨機擾動
  body.velocity.set(
    xDist * 1.5 + (Math.random() - 0.5) * 15, 
    -15 - Math.random() * 10, // 向下丟
    zDist * 1.5 + (Math.random() - 0.5) * 15  
  );

  // 隨機旋轉力道
  body.angularVelocity.set(
    (Math.random() - 0.5) * 35,
    (Math.random() - 0.5) * 35,
    (Math.random() - 0.5) * 35
  );
}

function calculateResult() {
  let total = 0;
  let details = [];
  
  // 定義骰子六個面的法向量與對應點數
  const faceNormals = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
  ];
  const faceValues = [1, 6, 2, 5, 3, 4];

  diceObjects.forEach(({ mesh }) => {
    let maxDot = -Infinity;
    let resultValue = 1;

    // 找出朝上的面 (Y 軸分量最大者)
    faceNormals.forEach((normal, index) => {
      const worldNormal = normal.clone().applyQuaternion(mesh.quaternion);
      if (worldNormal.y > maxDot) {
        maxDot = worldNormal.y;
        resultValue = faceValues[index];
      }
    });

    total += resultValue;
    details.push(resultValue);
  });

  if(uiTotal) uiTotal.innerText = total;
  if(uiDetail) uiDetail.innerText = details.length > 1 ? `(${details.join(" + ")})` : "";
  if(uiResult) uiResult.classList.add("show");
  needsResultCheck = false;
}

// --- 動畫迴圈 (關鍵修改處) ---

function animate() {
  requestAnimationFrame(animate);

  if (isHolding) {
    // --- 情況 1: 滑鼠拖曳中 ---
    raycaster.setFromCamera(mouse, camera);
    const targetPoint = new THREE.Vector3();
    const intersect = raycaster.ray.intersectPlane(dragPlane, targetPoint);

    if (intersect) {
        const time = performance.now() * 0.01;

        diceObjects.forEach((obj, i) => {
            const offsetX = Math.sin(time + i) * 1.0; 
            const offsetZ = Math.cos(time + i * 2) * 1.0;

            // 不限制範圍，讓使用者可以隨意拖曳
            obj.body.position.x += (targetPoint.x + offsetX - obj.body.position.x) * 0.25;
            obj.body.position.y += (15 - obj.body.position.y) * 0.25; 
            obj.body.position.z += (targetPoint.z + offsetZ - obj.body.position.z) * 0.25;

            // 拖曳時讓它旋轉展示
            obj.body.quaternion.setFromEuler(
                time * 2 + obj.spinOffset,
                time * 3 + obj.spinOffset,
                time * 1.5
            );

            // 歸零物理速度，完全由滑鼠控制
            obj.body.velocity.set(0, 0, 0);
            obj.body.angularVelocity.set(0, 0, 0);
            
            // 確保拖曳時不是「回歸」狀態
            obj.isReturning = false;
        });
    }
  } else {
    // --- 情況 2: 放開滑鼠後 ---

    const time = performance.now() * 0.01;
    
    // 檢查是否有骰子需要「飛回來」
    diceObjects.forEach((obj) => {
      if (obj.isReturning) {
        // 【手動動畫】讓骰子從場外飛向中心 (0, 0)
        // 0.15 是移動速度係數，數值越大飛越快
        obj.body.position.x += (0 - obj.body.position.x) * 0.15;
        obj.body.position.z += (0 - obj.body.position.z) * 0.15;
        
        // 保持高度，形成拋物線感覺
        obj.body.position.y += (12 - obj.body.position.y) * 0.1;

        // 飛行時旋轉
        obj.body.quaternion.setFromEuler(time * 5, time * 5, 0);

        // 鎖住物理速度
        obj.body.velocity.set(0, 0, 0);
        obj.body.angularVelocity.set(0, 0, 0);

        // 【關鍵判斷】如果已經飛進安全區域 (座標小於 9)
        if (Math.abs(obj.body.position.x) < 9 && Math.abs(obj.body.position.z) < 9) {
          obj.isReturning = false;   // 停止手動動畫
          obj.body.wakeUp();         // 喚醒物理引擎
          applyThrowForce(obj.body); // 施加最後的落地力道
        }
      }
    });

    // 執行物理步進
    world.step(1 / 60);
  }

  // --- 同步視覺模型 ---
  for (let i = 0; i < diceObjects.length; i++) {
    const { mesh, outline, shadow, body } = diceObjects[i];

    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);

    outline.position.copy(mesh.position);
    outline.quaternion.copy(mesh.quaternion);

    // 陰影跟隨 (Y軸固定在地板)
    shadow.position.x = body.position.x;
    shadow.position.z = body.position.z;

    // 根據高度調整陰影大小與透明度
    const height = Math.max(0, body.position.y - 1);
    const scale = Math.max(0.5, 1 - height * 0.04);
    const opacity = Math.max(0, 0.2 - height * 0.01);

    shadow.scale.setScalar(scale);
    shadow.material.opacity = opacity;
  }

  // --- 結果判定 ---
  if (needsResultCheck) {
    let allStopped = true;
    for (let o of diceObjects) {
      // 如果還有骰子在「飛回來」，不能結算
      if (o.isReturning) {
        allStopped = false;
        break;
      }
      // 檢查物理速度是否夠低
      if (
        o.body.velocity.lengthSquared() > 0.1 ||
        o.body.angularVelocity.lengthSquared() > 0.1
      ) {
        allStopped = false;
        break;
      }
    }
    if (allStopped) calculateResult();
  }

  renderer.render(scene, camera);
}

function onWindowResize() {
  const aspect = window.innerWidth / window.innerHeight;
  
  camera.left = (-FRUSTUM_SIZE * aspect) / 2;
  camera.right = (FRUSTUM_SIZE * aspect) / 2;
  camera.top = FRUSTUM_SIZE / 2;
  camera.bottom = -FRUSTUM_SIZE / 2;

  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}