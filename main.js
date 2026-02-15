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

/* ---------- renderer sizing ---------- */
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

/* ---------- object-fit cover mapping ---------- */
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

/* ---------- screen to world ---------- */
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

/* ---------- Three scene ---------- */
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

scene.add(new THREE.AmbientLight(0xffffff, 0.32));
const key = new THREE.DirectionalLight(0xffffff, 1.0);
key.position.set(2, 3, 4);
scene.add(key);

/* 깊이감 */
scene.fog = new THREE.Fog(0x000000, 6.5, 14.0);

/* ---------- textures ---------- */
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

/* ---------- burst ---------- */
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
        depthTest: false,
        fog: false,
        color: tint || new THREE.Color(0xffffff)
      });
      const spr = new THREE.Sprite(mat);
      spr.position.copy(pos);
      const s = rand(0.10, 0.28) * scale;
      spr.scale.set(s, s, s);

      const vel = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-0.6, 0.8))
        .normalize()
        .multiplyScalar(rand(1.2, 3.0) * scale);

      this.group.add(spr);
      this.items.push({ spr, vel, life: rand(0.25, 0.60), age: 0 });
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

/* ---------- targets ---------- */
class Target {
  constructor(type) {
    this.type = type;
    this.alive = true;
    this.phase = rand(0, Math.PI * 2);

    if (type === "ufo") {
      const g = new THREE.Group();

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.12, 12, 36),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: new THREE.Color(0x7be3ff),
          emissiveIntensity: 0.85,
          roughness: 0.26,
          metalness: 0.25
        })
      );
      ring.rotation.x = Math.PI * 0.5;

      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 18, 18, 0, Math.PI * 2, 0, Math.PI * 0.55),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: new THREE.Color(0xaaffcc),
          emissiveIntensity: 0.55,
          roughness: 0.22,
          metalness: 0.2,
          transparent: true,
          opacity: 0.85
        })
      );
      dome.position.y = 0.12;

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, fog: false
      }));
      glow.scale.set(1.25, 1.25, 1.25);

      g.add(ring, dome, glow);

      this.obj = g;
      this.radius = 0.55;
      this.points = 18;
      this.tint = new THREE.Color(0x7be3ff);
    } else {
      const g = new THREE.Group();

      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.30, 20, 20),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: new THREE.Color(0xff5fd7),
          emissiveIntensity: 0.85,
          roughness: 0.35,
          metalness: 0.1
        })
      );

      const face = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, transparent: true, opacity: 0.35, depthWrite: false, depthTest: false, fog: false
      }));
      face.scale.set(0.95, 0.95, 0.95);
      face.position.z = 0.30;

      g.add(body, face);

      this.obj = g;
      this.radius = 0.50;
      this.points = 12;
      this.tint = new THREE.Color(0xff5fd7);
    }

    /* 멀리 배치 */
    this.obj.position.set(rand(-3.2, 3.2), rand(-2.0, 2.3), rand(-10.8, -6.4));
    this.v = new THREE.Vector3(rand(-0.75, 0.75), rand(-0.55, 0.55), rand(-0.35, 0.35));
    scene.add(this.obj);
  }

  update(dt) {
    this.phase += dt * 2.0;
    this.obj.rotation.y += dt * 1.3;
    this.obj.rotation.x += dt * 0.8;

    const wobX = Math.sin(this.phase) * 0.35;
    const wobY = Math.cos(this.phase * 0.9) * 0.30;

    this.obj.position.x += (this.v.x + wobX) * dt;
    this.obj.position.y += (this.v.y + wobY) * dt;
    this.obj.position.z += this.v.z * dt;

    if (this.obj.position.x < -3.6 || this.obj.position.x > 3.6) this.v.x *= -1;
    if (this.obj.position.y < -2.4 || this.obj.position.y > 2.7) this.v.y *= -1;
    if (this.obj.position.z < -12.2 || this.obj.position.z > -5.6) this.v.z *= -1;
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

/* ---------- bullets ---------- */
class PaintBullet {
  constructor(pos, vel, tint) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
      fog: false,
      color: tint
    }));
    spr.position.copy(pos);
    spr.scale.set(0.42, 0.42, 0.42);

    this.spr = spr;
    this.vel = vel.clone();
    this.life = 2.0;
    this.age = 0;

    scene.add(this.spr);
  }
  update(dt) {
    this.age += dt;
    this.vel.multiplyScalar(0.994);
    this.spr.position.addScaledVector(this.vel, dt);
    this.spr.material.opacity = Math.max(0, 0.95 * (1 - this.age / this.life));
  }
  dead() { return this.age >= this.life; }
  kill() {
    scene.remove(this.spr);
    this.spr.material.dispose();
  }
}
const bullets = [];

/* ---------- gun model ---------- */
function makeGun() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.30, 0.30),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0x7be3ff),
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.2
    })
  );
  body.position.set(0.34, 0.02, 0);

  const slide = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.16, 0.26),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0x4bbdff),
      emissiveIntensity: 0.22,
      roughness: 0.28,
      metalness: 0.18
    })
  );
  slide.position.set(0.30, 0.14, 0);

  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.60, 0.26),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0x4bbdff),
      emissiveIntensity: 0.25,
      roughness: 0.35,
      metalness: 0.1
    })
  );
  grip.position.set(0.10, -0.34, 0);

  const triggerGuard = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.05, 10, 18, Math.PI * 1.25),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.08,
      roughness: 0.35,
      metalness: 0.05
    })
  );
  triggerGuard.rotation.z = Math.PI * 0.15;
  triggerGuard.position.set(0.18, -0.10, 0.12);

  const muzzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.26, 14),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.18,
      roughness: 0.2,
      metalness: 0.1
    })
  );
  muzzle.rotation.z = Math.PI * 0.5;
  muzzle.position.set(0.74, 0.10, 0);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, fog: false
  }));
  glow.scale.set(1.05, 1.05, 1.05);
  glow.position.set(0.28, 0.02, 0);

  g.add(body, slide, grip, triggerGuard, muzzle, glow);

  return { group: g, muzzle };
}
const gun = makeGun();
scene.add(gun.group);
gun.group.visible = false;

/* 총이 바라보는 로컬 전방 축 */
const GUN_FWD_LOCAL = new THREE.Vector3(1, 0, 0);

/* ---------- game state ---------- */
let score = 0;
let combo = 0;
let comboUntil = 0;

function setHUD() {
  scoreEl.textContent = String(score);
  comboEl.textContent = String(combo);
  targetsEl.textContent = String(targets.filter(t => t.alive).length);
}

/* ---------- hand tracking state ---------- */
let lastLandmarks = null;
let lastSeenAt = 0;

let hand = {
  has: false,
  gunPose: false,
  trigger: false,
  wristX: 0, wristY: 0,
  palmX: 0, palmY: 0,
  indexMcpX: 0, indexMcpY: 0,
  indexPipX: 0, indexPipY: 0,
  indexTipX: 0, indexTipY: 0,
  thumbTipX: 0, thumbTipY: 0
};

let smooth = {
  init: false,
  wristX: 0, wristY: 0,
  palmX: 0, palmY: 0,
  indexMcpX: 0, indexMcpY: 0,
  indexPipX: 0, indexPipY: 0,
  indexTipX: 0, indexTipY: 0,
  thumbTipX: 0, thumbTipY: 0,
  gunScore: 0,
  curlRatio: 1
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

  smooth.indexPipX = lerp(smooth.indexPipX, raw.indexPipX, a);
  smooth.indexPipY = lerp(smooth.indexPipY, raw.indexPipY, a);

  smooth.indexTipX = lerp(smooth.indexTipX, raw.indexTipX, a);
  smooth.indexTipY = lerp(smooth.indexTipY, raw.indexTipY, a);

  smooth.thumbTipX = lerp(smooth.thumbTipX, raw.thumbTipX, a);
  smooth.thumbTipY = lerp(smooth.thumbTipY, raw.thumbTipY, a);

  smooth.gunScore = lerp(smooth.gunScore, raw.gunScore, b);
  smooth.curlRatio = lerp(smooth.curlRatio, raw.curlRatio, b);
}

function fingerExtended(tip, pip, mcp) {
  return tip.y < pip.y && pip.y < mcp.y;
}
function fingerCurled(tip, pip) {
  return tip.y > pip.y;
}

function parseHand(lm) {
  const wrist = lmToScreen(lm[0]);
  const palm = lmToScreen(lm[9]);

  const indexMcp = lmToScreen(lm[5]);
  const indexPip = lmToScreen(lm[6]);
  const indexTip = lmToScreen(lm[8]);

  const middlePip = lmToScreen(lm[10]);
  const middleTip = lmToScreen(lm[12]);

  const ringPip = lmToScreen(lm[14]);
  const ringTip = lmToScreen(lm[16]);

  const pinkyPip = lmToScreen(lm[18]);
  const pinkyTip = lmToScreen(lm[20]);

  const thumbTip = lmToScreen(lm[4]);

  const idxExt = fingerExtended(indexTip, indexPip, indexMcp) ? 1 : 0;
  const midCurl = fingerCurled(middleTip, middlePip) ? 1 : 0;
  const ringCurl = fingerCurled(ringTip, ringPip) ? 1 : 0;
  const pinkCurl = fingerCurled(pinkyTip, pinkyPip) ? 1 : 0;

  const gunScore = (idxExt + midCurl + ringCurl + pinkCurl) / 4;

  const palmSpan = dist(wrist.x, wrist.y, palm.x, palm.y);
  const idxCurlDist = dist(indexTip.x, indexTip.y, palm.x, palm.y);
  const curlRatio = idxCurlDist / Math.max(1, palmSpan);

  return {
    wristX: wrist.x, wristY: wrist.y,
    palmX: palm.x, palmY: palm.y,

    indexMcpX: indexMcp.x, indexMcpY: indexMcp.y,
    indexPipX: indexPip.x, indexPipY: indexPip.y,
    indexTipX: indexTip.x, indexTipY: indexTip.y,

    thumbTipX: thumbTip.x, thumbTipY: thumbTip.y,

    gunScore,
    curlRatio
  };
}

/* ---------- MediaPipe Hands ---------- */
const hands = new Hands({
  locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.45,
  minTrackingConfidence: 0.55
});

hands.onResults((results) => {
  if (!running) return;

  if (results.multiHandLandmarks && results.multiHandLandmarks.length) {
    lastLandmarks = results.multiHandLandmarks[0];
    lastSeenAt = nowMs();

    const raw = parseHand(lastLandmarks);
    smoothStep(raw);

    hand.has = true;

    hand.wristX = smooth.wristX;
    hand.wristY = smooth.wristY;
    hand.palmX = smooth.palmX;
    hand.palmY = smooth.palmY;

    hand.indexMcpX = smooth.indexMcpX;
    hand.indexMcpY = smooth.indexMcpY;
    hand.indexPipX = smooth.indexPipX;
    hand.indexPipY = smooth.indexPipY;
    hand.indexTipX = smooth.indexTipX;
    hand.indexTipY = smooth.indexTipY;

    hand.thumbTipX = smooth.thumbTipX;
    hand.thumbTipY = smooth.thumbTipY;

    /* 건 포즈 히스테리시스, 관대하게 */
    const onScore = 0.45;
    const offScore = 0.35;
    if (!hand.gunPose && smooth.gunScore > onScore) hand.gunPose = true;
    if (hand.gunPose && smooth.gunScore < offScore) hand.gunPose = false;

    /* 트리거는 검지 살짝 굽힘 */
    const onCurl = 0.78;
    const offCurl = 0.86;
    if (!hand.trigger && smooth.curlRatio < onCurl) hand.trigger = true;
    if (hand.trigger && smooth.curlRatio > offCurl) hand.trigger = false;

  } else {
    const dt = nowMs() - lastSeenAt;

    if (dt < 350 && smooth.init) {
      hand.has = true;
      return;
    }

    lastLandmarks = null;
    hand.has = false;
    hand.gunPose = false;
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

/* ---------- hand debug overlay ---------- */
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

/* ---------- gun attach and shooting ---------- */
let shootCooldown = 0;
let prevTrigger = false;

/* 총의 모델 축이 다른 경우, 아래 fix를 바꾸면 됩니다 */
function gunFixQuaternion() {
  /* 기본 보정 */
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
}

function updateGun(dt) {
  if (!hand.has || !hand.gunPose) {
    gun.group.visible = false;
    prevTrigger = false;
    return;
  }

  gun.group.visible = true;

  const zPlane = -1.2;

  const wristW = screenToWorldOnPlane(hand.wristX, hand.wristY, zPlane);
  const indexMcpW = screenToWorldOnPlane(hand.indexMcpX, hand.indexMcpY, zPlane);
  const indexTipW = screenToWorldOnPlane(hand.indexTipX, hand.indexTipY, zPlane);
  const palmW = screenToWorldOnPlane(hand.palmX, hand.palmY, zPlane);

  const forward = indexTipW.clone().sub(indexMcpW);
  if (forward.length() < 0.001) forward.set(1, 0, 0);
  forward.normalize();

  const upHint = palmW.clone().sub(wristW);
  if (upHint.length() < 0.001) upHint.set(0, 1, 0);
  upHint.normalize();

  const right = new THREE.Vector3().crossVectors(forward, upHint).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const palmPx = dist(hand.wristX, hand.wristY, hand.palmX, hand.palmY);
  const palmPxClamped = clamp(palmPx, 90, 240);

  const wA = screenToWorldOnPlane(hand.palmX, hand.palmY, zPlane);
  const wB = screenToWorldOnPlane(hand.palmX + 100, hand.palmY, zPlane);
  const unitsPerPx = wA.distanceTo(wB) / 100;

  const palmWorld = palmPxClamped * unitsPerPx;
  const base = 0.60;
  const s = clamp((palmWorld / base) * 1.35, 0.95, 1.85);

  gun.group.scale.lerp(new THREE.Vector3(s, s, s), clamp(dt * 18, 0, 1));

  const anchor = indexMcpW.clone()
    .addScaledVector(forward, 0.20 * s)
    .addScaledVector(right, 0.10 * s)
    .addScaledVector(up, -0.04 * s);

  const basis = new THREE.Matrix4().makeBasis(forward, up, right);
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);

  q.multiply(gunFixQuaternion());

  gun.group.position.lerp(anchor, clamp(dt * 20, 0, 1));
  gun.group.quaternion.slerp(q, clamp(dt * 20, 0, 1));

  const t = nowMs();

  const pressed = hand.trigger && !prevTrigger;
  prevTrigger = hand.trigger;

  if (pressed && t > shootCooldown) {
    shootCooldown = t + 70;

    const muzzleW = gun.muzzle.getWorldPosition(new THREE.Vector3());

    /* 총이 실제로 바라보는 방향으로 발사 */
    const gunFwdW = GUN_FWD_LOCAL.clone().applyQuaternion(gun.group.quaternion).normalize();
    const vel = gunFwdW.clone().multiplyScalar(18.0);

    const tint = new THREE.Color(0x7be3ff);
    bullets.push(new PaintBullet(muzzleW, vel, tint));
    burst.spawn(muzzleW, 14, 1.05, tint);
  }
}

/* ---------- hit check ---------- */
function checkHits() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    for (let j = targets.length - 1; j >= 0; j--) {
      const tg = targets[j];
      if (!tg.alive) continue;

      const d = b.spr.position.distanceTo(tg.obj.position);
      if (d < tg.radius) {
        const hitPos = tg.obj.position.clone();
        burst.spawn(hitPos, 34, 1.9, tg.tint);
        tg.kill();

        score += tg.points + combo * 2;

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

/* ---------- HUD draw ---------- */
function drawHud() {
  const w = hud.clientWidth;
  const h = hud.clientHeight;
  hctx.clearRect(0, 0, w, h);

  if (hand.has) {
    hctx.beginPath();
    hctx.arc(hand.indexTipX, hand.indexTipY, 8, 0, Math.PI * 2);
    hctx.fillStyle = hand.trigger ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)";
    hctx.fill();

    hctx.font = "700 16px -apple-system, system-ui, sans-serif";
    hctx.fillStyle = "rgba(255,255,255,0.9)";
    hctx.fillText(hand.gunPose ? "GUN ON" : "GUN OFF", 16, 92);
    hctx.fillText(hand.trigger ? "TRIGGER" : "READY", 16, 114);
  }

  drawHandDebug();
}

/* ---------- loop ---------- */
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
  if (spawnTimer > 0.9 && targets.length < desired) {
    spawnTimer = 0;
    spawnTargets(1);
  }

  checkHits();
  burst.update(dt);

  setHUD();
  drawHud();
  renderer.render(scene, camera);
}

/* ---------- controls ---------- */
function resetAll() {
  score = 0;
  combo = 0;
  comboUntil = 0;
  shootCooldown = 0;
  prevTrigger = false;

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

/* ---------- boot ---------- */
fit();
spawnTargets(7);
setHUD();
tick();
