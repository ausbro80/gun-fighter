import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const video = document.getElementById("video");
const hud = document.getElementById("hud");
const hctx = hud.getContext("2d");

const scoreEl = document.getElementById("score");
const comboEl = document.getElementById("combo");
const targetsEl = document.getElementById("targets");

const btnStart = document.getElementById("start");
const btnReset = document.getElementById("reset");
const btnSpawn = document.getElementById("spawn");

let running = false;

function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function nowMs() { return performance.now(); }
function dist(ax, ay, bx, by) { const dx = ax - bx; const dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

function fit() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  hud.width = Math.floor(hud.clientWidth * dpr);
  hud.height = Math.floor(hud.clientHeight * dpr);
  hctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  renderer.setSize(hud.clientWidth, hud.clientHeight, false);
  camera.aspect = hud.clientWidth / hud.clientHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", fit);

/* object-fit cover 보정 */
function getCoverTransform() {
  const cw = hud.clientWidth;
  const ch = hud.clientHeight;

  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;

  const scale = Math.max(cw / vw, ch / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;

  const offX = (cw - drawW) / 2;
  const offY = (ch - drawH) / 2;

  return { vw, vh, scale, offX, offY };
}

function lmToScreen(lm) {
  const t = getCoverTransform();
  return {
    x: lm.x * t.vw * t.scale + t.offX,
    y: lm.y * t.vh * t.scale + t.offY
  };
}

/* 화면 좌표를 zPlane 평면으로 투영 */
function screenToWorldOnPlane(x, y, zPlane) {
  const w = hud.clientWidth;
  const h = hud.clientHeight;

  const nx = (x / w) * 2 - 1;
  const ny = -((y / h) * 2 - 1);

  const p = new THREE.Vector3(nx, ny, 0.5).unproject(camera);
  const dir = p.sub(camera.position).normalize();

  const t = (zPlane - camera.position.z) / dir.z;
  return camera.position.clone().addScaledVector(dir, t);
}

/* Three */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 0, 6);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(Math.max(1, window.devicePixelRatio || 1));
renderer.domElement.style.position = "absolute";
renderer.domElement.style.inset = "0";
renderer.domElement.style.width = "100%";
renderer.domElement.style.height = "100%";
renderer.domElement.style.pointerEvents = "none";
document.getElementById("app").appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const key = new THREE.DirectionalLight(0xffffff, 1.0);
key.position.set(2, 3, 4);
scene.add(key);

function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 60);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.25, "rgba(140,210,255,0.55)");
  g.addColorStop(0.6, "rgba(80,180,255,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const glowTex = makeGlowTexture();

class Burst {
  constructor() {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = [];
  }
  spawn(pos, count, scale, tint) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        color: tint || new THREE.Color(0xffffff)
      });
      const spr = new THREE.Sprite(mat);
      spr.position.copy(pos);
      const s = rand(0.10, 0.26) * scale;
      spr.scale.set(s, s, s);

      const vel = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-0.4, 0.6))
        .normalize()
        .multiplyScalar(rand(1.2, 3.0) * scale);

      this.group.add(spr);
      this.items.push({ spr, vel, life: rand(0.25, 0.55), age: 0 });
    }
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.age += dt;
      p.vel.multiplyScalar(0.985);
      p.spr.position.addScaledVector(p.vel, dt);
      p.spr.material.opacity = Math.max(0, 1 - p.age / p.life);
      if (p.age >= p.life) {
        this.group.remove(p.spr);
        p.spr.material.dispose();
        this.items.splice(i, 1);
      }
    }
  }
}
const burst = new Burst();

/* Targets */
class Target {
  constructor(type) {
    this.type = type;
    this.alive = true;
    this.phase = rand(0, Math.PI * 2);

    if (type === "ufo") {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.09, 12, 36),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: new THREE.Color(0x7be3ff),
          emissiveIntensity: 0.9,
          roughness: 0.28,
          metalness: 0.25
        })
      );
      ring.rotation.x = Math.PI * 0.5;

      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 18, 18, 0, Math.PI * 2, 0, Math.PI * 0.55),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: new THREE.Color(0xaaffcc),
          emissiveIntensity: 0.6,
          roughness: 0.22,
          metalness: 0.2,
          transparent: true,
          opacity: 0.85
        })
      );
      dome.position.y = 0.10;

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.55, depthWrite: false }));
      glow.scale.set(0.95, 0.95, 0.95);

      g.add(ring);
      g.add(dome);
      g.add(glow);

      this.obj = g;
      this.radius = 0.42;
      this.points = 15;
      this.tint = new THREE.Color(0x7be3ff);
    } else {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 20, 20),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: new THREE.Color(0xff5fd7),
          emissiveIntensity: 0.9,
          roughness: 0.35,
          metalness: 0.1
        })
      );
      const face = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.35, depthWrite: false }));
      face.scale.set(0.7, 0.7, 0.7);
      face.position.z = 0.25;

      g.add(body);
      g.add(face);

      this.obj = g;
      this.radius = 0.34;
      this.points = 10;
      this.tint = new THREE.Color(0xff5fd7);
    }

    this.obj.position.set(rand(-2.2, 2.2), rand(-1.3, 1.9), rand(-2.8, -1.2));
    this.v = new THREE.Vector3(rand(-0.6, 0.6), rand(-0.45, 0.45), rand(-0.22, 0.22));
    scene.add(this.obj);
  }

  update(dt) {
    this.phase += dt * 2.0;
    this.obj.rotation.y += dt * 1.3;
    this.obj.rotation.x += dt * 0.8;

    const wobX = Math.sin(this.phase) * 0.28;
    const wobY = Math.cos(this.phase * 0.9) * 0.24;

    this.obj.position.x += (this.v.x + wobX) * dt;
    this.obj.position.y += (this.v.y + wobY) * dt;
    this.obj.position.z += this.v.z * dt;

    if (this.obj.position.x < -2.6 || this.obj.position.x > 2.6) this.v.x *= -1;
    if (this.obj.position.y < -1.8 || this.obj.position.y > 2.2) this.v.y *= -1;
    if (this.obj.position.z < -3.2 || this.obj.position.z > -0.9) this.v.z *= -1;
  }

  kill() {
    this.alive = false;
    scene.remove(this.obj);
    this.obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material && child.material.dispose) child.material.dispose();
    });
  }
}

const targets = [];
function spawnTargets(n) {
  const count = n || 7;
  for (let i = 0; i < count; i++) {
    const type = Math.random() < 0.45 ? "ufo" : "char";
    targets.push(new Target(type));
  }
}

/* Bullets */
class PaintBullet {
  constructor(pos, vel, tint) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      color: tint
    }));
    spr.position.copy(pos);
    spr.scale.set(0.28, 0.28, 0.28);

    this.spr = spr;
    this.vel = vel.clone();
    this.life = 1.6;
    this.age = 0;

    scene.add(this.spr);
  }
  update(dt) {
    this.age += dt;
    this.vel.multiplyScalar(0.992);
    this.spr.position.addScaledVector(this.vel, dt);
    this.spr.material.opacity = Math.max(0, 0.9 * (1 - this.age / this.life));
    const s = 0.28 * (1 - this.age / this.life) + 0.12;
    this.spr.scale.set(s, s, s);
  }
  dead() { return this.age >= this.life; }
  kill() {
    scene.remove(this.spr);
    this.spr.material.dispose();
  }
}
const bullets = [];

/* Gun model */
function makeGun() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.22, 0.22),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0x7be3ff),
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.2
    })
  );
  body.position.set(0.18, 0, 0);

  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.34, 0.18),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0x4bbdff),
      emissiveIntensity: 0.25,
      roughness: 0.35,
      metalness: 0.1
    })
  );
  grip.position.set(0.06, -0.22, 0);

  const muzzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.20, 14),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.2,
      roughness: 0.2,
      metalness: 0.1
    })
  );
  muzzle.rotation.z = Math.PI * 0.5;
  muzzle.position.set(0.46, 0, 0);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.55, depthWrite: false }));
  glow.scale.set(0.75, 0.75, 0.75);
  glow.position.set(0.18, 0, 0);

  g.add(body);
  g.add(grip);
  g.add(muzzle);
  g.add(glow);

  return { group: g, muzzle };
}
const gun = makeGun();
scene.add(gun.group);
gun.group.visible = false;

/* Game state */
let score = 0;
let combo = 0;
let comboUntil = 0;

function setHUD() {
  scoreEl.textContent = String(score);
  comboEl.textContent = String(combo);
  targetsEl.textContent = String(targets.filter(t => t.alive).length);
}

/* Hand state */
let lastLandmarks = null;

let hand = {
  has: false,
  open: false,
  trigger: false,
  wristX: 0, wristY: 0,
  palmX: 0, palmY: 0,
  indexMcpX: 0, indexMcpY: 0,
  indexTipX: 0, indexTipY: 0
};

let smooth = {
  init: false,
  wristX: 0, wristY: 0,
  palmX: 0, palmY: 0,
  indexMcpX: 0, indexMcpY: 0,
  indexTipX: 0, indexTipY: 0,
  openScore: 0,
  curlDist: 999
};

function smoothStep(raw) {
  const a = 0.22;
  const b = 0.18;

  if (!smooth.init) {
    Object.assign(smooth, raw);
    smooth.init = true;
    return;
  }

  smooth.wristX = lerp(smooth.wristX, raw.wristX, a);
  smooth.wristY = lerp(smooth.wristY, raw.wristY, a);

  smooth.palmX = lerp(smooth.palmX, raw.palmX, a);
  smooth.palmY = lerp(smooth.palmY, raw.palmY, a);

  smooth.indexMcpX = lerp(smooth.indexMcpX, raw.indexMcpX, a);
  smooth.indexMcpY = lerp(smooth.indexMcpY, raw.indexMcpY, a);

  smooth.indexTipX = lerp(smooth.indexTipX, raw.indexTipX, a);
  smooth.indexTipY = lerp(smooth.indexTipY, raw.indexTipY, a);

  smooth.openScore = lerp(smooth.openScore, raw.openScore, b);
  smooth.curlDist = lerp(smooth.curlDist, raw.curlDist, b);
}

function parseHand(lm) {
  const wrist = lmToScreen(lm[0]);
  const palm = lmToScreen(lm[9]);
  const indexMcp = lmToScreen(lm[5]);
  const indexTip = lmToScreen(lm[8]);

  const middleTip = lmToScreen(lm[12]);
  const ringTip = lmToScreen(lm[16]);
  const pinkyTip = lmToScreen(lm[20]);
  const ringMcp = lmToScreen(lm[13]);
  const pinkyMcp = lmToScreen(lm[17]);

  const extIndex = indexTip.y < indexMcp.y ? 1 : 0;
  const extMiddle = middleTip.y < palm.y ? 1 : 0;
  const extRing = ringTip.y < ringMcp.y ? 1 : 0;
  const extPinky = pinkyTip.y < pinkyMcp.y ? 1 : 0;
  const openScore = (extIndex + extMiddle + extRing + extPinky) / 4;

  const curlDist = dist(indexTip.x, indexTip.y, palm.x, palm.y);

  return {
    wristX: wrist.x, wristY: wrist.y,
    palmX: palm.x, palmY: palm.y,
    indexMcpX: indexMcp.x, indexMcpY: indexMcp.y,
    indexTipX: indexTip.x, indexTipY: indexTip.y,
    openScore,
    curlDist
  };
}

/* MediaPipe */
const hands = new Hands({
  locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 0,
  minDetectionConfidence: 0.65,
  minTrackingConfidence: 0.7
});

hands.onResults((results) => {
  if (!running) return;

  if (results.multiHandLandmarks && results.multiHandLandmarks.length) {
    lastLandmarks = results.multiHandLandmarks[0];
    const raw = parseHand(lastLandmarks);
    smoothStep(raw);

    hand.has = true;
    hand.wristX = smooth.wristX;
    hand.wristY = smooth.wristY;
    hand.palmX = smooth.palmX;
    hand.palmY = smooth.palmY;
    hand.indexMcpX = smooth.indexMcpX;
    hand.indexMcpY = smooth.indexMcpY;
    hand.indexTipX = smooth.indexTipX;
    hand.indexTipY = smooth.indexTipY;

    hand.open = smooth.openScore > 0.55;

    // 손 크기 비율 기반 트리거
    const palmSpan = dist(smooth.wristX, smooth.wristY, smooth.palmX, smooth.palmY);
    const curl = smooth.curlDist / Math.max(1, palmSpan);

    const onRatio = 0.78;
    const offRatio = 0.88;
    if (!hand.trigger && curl < onRatio) hand.trigger = true;
    if (hand.trigger && curl > offRatio) hand.trigger = false;
  } else {
    lastLandmarks = null;
    hand.has = false;
    hand.open = false;
    hand.trigger = false;
    smooth.init = false;
  }
});

let mpCamera = null;
async function startCamera() {
  mpCamera = new Camera(video, {
    onFrame: async () => {
      if (!running) return;
      await hands.send({ image: video });
    },
    width: 1280,
    height: 720,
    facingMode: "user"
  });
  await mpCamera.start();
}

/* Hand skeleton */
function drawHandDebug() {
  if (!lastLandmarks) return;

  const pts = lastLandmarks.map(lmToScreen);

  hctx.save();
  hctx.globalAlpha = 0.85;
  hctx.lineWidth = 2;
  hctx.strokeStyle = "rgba(159,231,255,0.95)";
  hctx.fillStyle = "rgba(255,255,255,0.92)";

  for (const [a, b] of HAND_CONNECTIONS) {
    const p1 = pts[a];
    const p2 = pts[b];
    hctx.beginPath();
    hctx.moveTo(p1.x, p1.y);
    hctx.lineTo(p2.x, p2.y);
    hctx.stroke();
  }

  for (const p of pts) {
    hctx.beginPath();
    hctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    hctx.fill();
  }

  hctx.restore();
}

/* Gun attach + shoot */
let shootCooldown = 0;

function updateGun(dt) {
  if (!hand.has || !hand.open) {
    gun.group.visible = false;
    return;
  }

  gun.group.visible = true;

  const zPlane = 0;

  const wristW = screenToWorldOnPlane(hand.wristX, hand.wristY, zPlane);
  const indexMcpW = screenToWorldOnPlane(hand.indexMcpX, hand.indexMcpY, zPlane);
  const palmW = screenToWorldOnPlane(hand.palmX, hand.palmY, zPlane);

  const forward = indexMcpW.clone().sub(wristW);
  if (forward.length() < 0.001) forward.set(1, 0, 0);
  forward.normalize();

  const upHint = palmW.clone().sub(wristW);
  if (upHint.length() < 0.001) upHint.set(0, 1, 0);
  upHint.normalize();

  const right = new THREE.Vector3().crossVectors(forward, upHint).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  // 손 크기 기반 스케일
  const palmPx = dist(hand.wristX, hand.wristY, hand.palmX, hand.palmY);
  const palmPxClamped = clamp(palmPx, 90, 220);

  const wA = screenToWorldOnPlane(hand.palmX, hand.palmY, zPlane);
  const wB = screenToWorldOnPlane(hand.palmX + 100, hand.palmY, zPlane);
  const unitsPerPx = wA.distanceTo(wB) / 100;

  const palmWorld = palmPxClamped * unitsPerPx;
  const base = 0.55;
  const s = clamp(palmWorld / base, 0.75, 1.35);
  gun.group.scale.lerp(new THREE.Vector3(s, s, s), clamp(dt * 16, 0, 1));

  // 손에 감기는 오프셋
  const anchor = wristW.clone()
    .addScaledVector(forward, 0.28 * s)
    .addScaledVector(right, 0.12 * s)
    .addScaledVector(up, 0.02 * s);

  const basis = new THREE.Matrix4().makeBasis(forward, up, right);
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);

  // 모델 누움 보정
  const fix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
  q.multiply(fix);

  gun.group.position.lerp(anchor, clamp(dt * 18, 0, 1));
  gun.group.quaternion.slerp(q, clamp(dt * 18, 0, 1));

  const t = nowMs();
  if (hand.trigger && t > shootCooldown) {
    shootCooldown = t + 90;

    const muzzleW = gun.muzzle.getWorldPosition(new THREE.Vector3());
    const vel = forward.clone().multiplyScalar(8.5);

    bullets.push(new PaintBullet(muzzleW, vel, new THREE.Color(0x7be3ff)));
    burst.spawn(muzzleW, 10, 0.8, new THREE.Color(0x7be3ff));
  }
}

/* Hits */
function checkHits() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    for (let j = targets.length - 1; j >= 0; j--) {
      const t = targets[j];
      if (!t.alive) continue;

      const d = b.spr.position.distanceTo(t.obj.position);
      if (d < t.radius) {
        const hitPos = t.obj.position.clone();
        burst.spawn(hitPos, 26, 1.5, t.tint);
        t.kill();

        score += t.points + combo * 2;
        const n = nowMs();
        if (n <= comboUntil) combo += 1;
        else combo = 1;
        comboUntil = n + 900;

        b.kill();
        bullets.splice(i, 1);
        break;
      }
    }
  }

  for (let i = targets.length - 1; i >= 0; i--) {
    if (!targets[i].alive) targets.splice(i, 1);
  }
}

/* HUD draw */
function drawHud() {
  const w = hud.clientWidth;
  const h = hud.clientHeight;
  hctx.clearRect(0, 0, w, h);

  if (hand.has) {
    hctx.beginPath();
    hctx.arc(hand.indexTipX, hand.indexTipY, 8, 0, Math.PI * 2);
    hctx.fillStyle = hand.trigger ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)";
    hctx.fill();

    hctx.beginPath();
    hctx.arc(hand.palmX, hand.palmY, 15, 0, Math.PI * 2);
    hctx.strokeStyle = "rgba(255,255,255,0.55)";
    hctx.lineWidth = 2;
    hctx.stroke();

    hctx.font = "700 16px -apple-system, system-ui, sans-serif";
    hctx.fillStyle = "rgba(255,255,255,0.9)";
    hctx.fillText(hand.open ? "GUN ON" : "GUN OFF", 16, 92);
    hctx.fillText(hand.trigger ? "TRIGGER" : "READY", 16, 114);
  }

  if (combo >= 5) {
    hctx.font = "700 20px -apple-system, system-ui, sans-serif";
    hctx.fillStyle = "rgba(255,255,255,0.92)";
    hctx.fillText(`COMBO ${combo}`, 16, 80);
  }

  drawHandDebug();
}

/* Loop */
let last = performance.now();
let spawnTimer = 0;

function tick() {
  requestAnimationFrame(tick);

  if (!running) {
    renderer.render(scene, camera);
    return;
  }

  const t = performance.now();
  const dt = (t - last) / 1000;
  last = t;

  if (combo > 0 && nowMs() > comboUntil) combo = 0;

  updateGun(dt);

  for (const b of bullets) b.update(dt);
  for (let i = bullets.length - 1; i >= 0; i--) {
    if (bullets[i].dead()) {
      bullets[i].kill();
      bullets.splice(i, 1);
    }
  }

  for (const tg of targets) tg.update(dt);

  spawnTimer += dt;
  const desired = clamp(7 + Math.floor(combo / 3), 7, 12);
  if (spawnTimer > 1.0 && targets.length < desired) {
    spawnTimer = 0;
    spawnTargets(1);
  }

  checkHits();
  burst.update(dt);

  setHUD();
  drawHud();
  renderer.render(scene, camera);
}

/* Controls */
function resetAll() {
  score = 0;
  combo = 0;
  comboUntil = 0;
  shootCooldown = 0;

  for (const t of targets) t.kill();
  targets.length = 0;

  for (const b of bullets) b.kill();
  bullets.length = 0;

  gun.group.visible = false;

  spawnTargets(7);
  setHUD();
}

btnStart.addEventListener("click", async () => {
  if (running) return;
  try {
    await startCamera();
    running = true;
    fit();
    resetAll();
    last = performance.now();
  } catch (e) {
    alert("카메라 권한이 필요합니다. 브라우저에서 카메라 허용 후 다시 시도해주세요.");
    console.error(e);
  }
});

btnReset.addEventListener("click", () => { resetAll(); });
btnSpawn.addEventListener("click", () => { spawnTargets(3); });

/* Boot */
fit();
spawnTargets(7);
setHUD();
tick();
