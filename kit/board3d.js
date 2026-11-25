// SPDX-License-Identifier: MIT
/* A square board in 3D: light, camera, pointer, effects. One cell is one unit; row 0 is at the back.

     const board = createBoard(element, { onPick });
     board.setSize(6);
     board.add(board.slab({ r0: 0, c0: 0, r1: 1, c1: 2 }, { color: '#ff9d00' }));
     const cell = board.cellAt(pointerEvent);

   The element keeps its own keyboard handling and its words for screen readers; this only draws. */
import * as T from './three.js';

export { T as THREE };
export const isCalm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const FOV = 30, TILT = 0.5, FRAME = 0.62, SLOW_MS = 30, MAX_PARTICLES = 400;
const NARROW = 640, FROM_ABOVE = 0.1, FRAME_ABOVE = 0.55;   // pixels, radians, cells
const BACK = ['#2a1650', '#100a20'];
const ease = (t) => 1 - (1 - t) ** 3;
export const bounce = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

function backdrop() {
  const c = Object.assign(document.createElement('canvas'), { width: 512, height: 512 }), g = c.getContext('2d');
  const fill = g.createRadialGradient(256, 190, 20, 256, 256, 360);
  fill.addColorStop(0, BACK[0]); fill.addColorStop(1, BACK[1]);
  g.fillStyle = fill; g.fillRect(0, 0, 512, 512);
  const texture = new T.CanvasTexture(c);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}
function dotTexture() {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), g = c.getContext('2d');
  const fill = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  fill.addColorStop(0, '#fff'); fill.addColorStop(0.4, '#ffffffaa'); fill.addColorStop(1, '#fff0');
  g.fillStyle = fill; g.fillRect(0, 0, 64, 64);
  return new T.CanvasTexture(c);
}
/* A rounded square ring, for the frame. */
function ringShape(half, radius, hole, holeRadius) {
  const trace = (path, h, r) => {
    path.moveTo(-h + r, -h); path.lineTo(h - r, -h); path.quadraticCurveTo(h, -h, h, -h + r); path.lineTo(h, h - r); path.quadraticCurveTo(h, h, h - r, h);
    path.lineTo(-h + r, h); path.quadraticCurveTo(-h, h, -h, h - r); path.lineTo(-h, -h + r); path.quadraticCurveTo(-h, -h, -h + r, -h);
    return path;
  };
  const shape = trace(new T.Shape(), half, radius);
  shape.holes.push(trace(new T.Path(), hole, holeRadius));
  return shape;
}
export const gloss = (color, more = {}) => new T.MeshPhysicalMaterial({ color, roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.18, envMapIntensity: 0.9, ...more });

function drop(node) {
  node.traverse((x) => {
    x.geometry?.dispose();
    for (const m of [x.material].flat()) if (m) { m.map?.dispose(); m.dispose(); }
  });
  node.removeFromParent();
}

export function createBoard(element, { frame = '#d9a441', floor = '#171028', tilt = TILT } = {}) {
  const renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' });
  renderer.domElement.setAttribute('aria-hidden', 'true');
  element.prepend(renderer.domElement);

  const scene = new T.Scene(), camera = new T.PerspectiveCamera(FOV, 1, 0.1, 200), world = new T.Group(), pieces = new T.Group();
  scene.background = backdrop();
  const room = new T.RoomEnvironment(), pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(room, 0.03).texture;
  scene.environmentIntensity = 0.3;
  pmrem.dispose();
  scene.add(world, new T.HemisphereLight('#cdbcff', '#1a1030', 0.3));
  world.add(pieces);
  const sun = new T.DirectionalLight('#fff3df', 1.9), rim = new T.DirectionalLight('#8a6bff', 1.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 5; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, rim);

  const target = new T.WebGLRenderTarget(2, 2, { type: T.HalfFloatType, samples: 4 }), composer = new T.EffectComposer(renderer, target);
  const bloom = new T.UnrealBloomPass(new T.Vector2(2, 2), 0.28, 0.45, 1.05);
  composer.addPass(new T.RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(new T.OutputPass());

  let n = 0, tray = null, dirty = true, last = 0, slow = 0, ratio = Math.min(2, devicePixelRatio), shakeFor = 0, isGone = false;
  const tweens = new Set(), each = new Set(), home = new T.Vector3();
  const at = (r, c, y = 0) => new T.Vector3(c - (n - 1) / 2, y, r - (n - 1) / 2);
  const redraw = () => { dirty = true; };

  /* As close as the camera can be while the whole frame stays in view. On a phone it looks from above, so that every
     cell is as large as the screen allows. */
  function fit() {
    const { clientWidth: w, clientHeight: h } = element;
    if (!w || !h || !n) return;
    renderer.setPixelRatio(ratio); composer.setPixelRatio(ratio);
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    let lift = 0;
    const isNarrow = w <= NARROW && w <= h * 1.4, lean = isNarrow ? Math.min(tilt, FROM_ABOVE) : tilt, edge = isNarrow ? 0.998 : 0.97;
    const half = n / 2 + (isNarrow ? FRAME_ABOVE : FRAME), corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((z) => (isNarrow ? [0] : [0, 0.5]).map((y) => new T.Vector3(x * half, y, z * half))));
    const isInside = (d) => {
      camera.position.set(0, Math.cos(lean) * d, Math.sin(lean) * d);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      return corners.every((v) => { const p = v.clone().project(camera); return Math.abs(p.x) < edge && Math.abs(p.y) < edge; });
    };
    const closest = () => {
      let near = 2, far = 160;
      for (let i = 0; i < 24; i++) { const mid = (near + far) / 2; if (isInside(mid)) far = mid; else near = mid; }
      isInside(far);
    };
    // The near edge looks larger than the far one, so the picture is moved until both margins are equal.
    camera.clearViewOffset();
    for (let i = 0; i < 4; i++) {
      closest();
      const ys = corners.map((v) => v.clone().project(camera).y), off = (Math.max(...ys) + Math.min(...ys)) / 2;
      lift += off * 0.5;
      camera.setViewOffset(w, h, 0, -lift * h, w, h);
    }
    closest();
    home.copy(camera.position);
    redraw();
  }
  function setSize(size, { keepPieces = false } = {}) {
    if (!keepPieces) clear();
    if (size === n) { fit(); return; }
    n = size;
    if (tray) drop(tray);
    tray = new T.Group();
    const half = n / 2, ring = new T.Mesh(new T.ExtrudeGeometry(ringShape(half + 0.42, 0.5, half + 0.06, 0.16), { depth: 0.3, bevelEnabled: true, bevelSize: 0.09, bevelThickness: 0.09, bevelSegments: 5, curveSegments: 16 }),
      new T.MeshPhysicalMaterial({ color: frame, metalness: 1, roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -0.22;
    ring.castShadow = ring.receiveShadow = true;
    const base = new T.Mesh(new T.BoxGeometry(n + 0.3, 0.2, n + 0.3), new T.MeshPhysicalMaterial({ color: floor, roughness: 0.5, metalness: 0.2 }));
    base.position.y = -0.22; base.receiveShadow = true;
    tray.add(ring, base);
    world.add(tray);
    const s = n * 0.95;
    sun.position.set(-n * 0.7, n * 1.5, n * 0.35); rim.position.set(n, n * 0.5, -n);
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.1, far: n * 4 });
    sun.shadow.camera.updateProjectionMatrix();
    fit();
  }
  const add = (node) => { pieces.add(node); redraw(); return node; };
  const remove = (node) => { if (node) { drop(node); redraw(); } };
  const clear = () => { tweens.clear(); for (const x of [...pieces.children]) drop(x); redraw(); };

  /* Runs fn(0..1). With reduced motion it only runs the end. */
  function tween(ms, fn, { curve = ease, delay = 0 } = {}) {
    if (isCalm() || ms <= 0) { fn(1); redraw(); return Promise.resolve(); }
    return new Promise((done) => {
      fn(0);
      tweens.add({ start: performance.now() + delay, ms, fn, curve, done });
      redraw();
    });
  }
  function slab({ r0, c0, r1, c1 }, { height = 0.34, gap = 0.07, radius = 0.12, material, color = '#fff' } = {}) {
    const w = c1 - c0 + 1, d = r1 - r0 + 1;
    const mesh = new T.Mesh(new T.RoundedBoxGeometry(w - gap, height, d - gap, 4, Math.min(radius, height / 2 - 0.01)), material ?? gloss(color));
    mesh.position.copy(at((r0 + r1) / 2, (c0 + c1) / 2, height / 2 - 0.1));
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
  /* A flat outline around cells, for the pointer and the keyboard. */
  function outline({ r0, c0, r1, c1 }, color, y = 0.32) {
    const w = (c1 - c0 + 1) / 2 - 0.03, d = (r1 - r0 + 1) / 2 - 0.03, t = 0.07, group = new T.Group();
    const material = new T.MeshBasicMaterial({ color, toneMapped: false });
    for (const [x, z, sx, sz] of [[0, -d, 2 * w, t], [0, d, 2 * w, t], [-w, 0, t, 2 * d], [w, 0, t, 2 * d]]) {
      const bar = new T.Mesh(new T.BoxGeometry(sx, t * 0.6, sz), material);
      bar.position.set(x, 0, z);
      group.add(bar);
    }
    group.position.copy(at((r0 + r1) / 2, (c0 + c1) / 2, y));
    return group;
  }
  function label(text, { size = 0.62, color = '#fff', edge = '#160c26' } = {}) {
    const c = Object.assign(document.createElement('canvas'), { width: 160, height: 160 }), g = c.getContext('2d');
    g.font = `800 ${String(text).length > 1 ? 92 : 112}px ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 18; g.strokeStyle = edge; g.strokeText(text, 80, 86);
    g.fillStyle = color; g.fillText(text, 80, 86);
    const map = new T.CanvasTexture(c);
    map.colorSpace = T.SRGBColorSpace; map.anisotropy = 8;
    const mesh = new T.Mesh(new T.PlaneGeometry(size * 1.5, size * 1.5), new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 5;
    return mesh;
  }

  /* ---- effects */
  const dot = dotTexture();
  let flying = 0;
  function burst(position, { color = '#ffd27a', count = 40, speed = 3, size = 0.16, gravity = 5, ms = 900, up = 1 } = {}) {
    if (isCalm() || flying + count > MAX_PARTICLES) return;
    flying += count;
    const start = new Float32Array(count * 3), go = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2, f = Math.random() * speed;
      return [Math.cos(a) * f, (0.4 + Math.random()) * speed * up, Math.sin(a) * f];
    });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(start, 3));
    const points = new T.Points(geometry, new T.PointsMaterial({ map: dot, color: new T.Color(color).multiplyScalar(2.2), size, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
    points.position.copy(position); points.frustumCulled = false;
    world.add(points);
    tween(ms, (t) => {
      const s = (t * ms) / 1000;
      go.forEach(([x, y, z], i) => { start[i * 3] = x * s; start[i * 3 + 1] = Math.max(-0.1 - position.y, y * s - (gravity * s * s) / 2); start[i * 3 + 2] = z * s; });
      geometry.attributes.position.needsUpdate = true;
      points.material.opacity = 1 - t * t;
    }, { curve: (t) => t }).then(() => { flying -= count; points.material.dispose(); geometry.dispose(); points.removeFromParent(); });
  }
  function ripple(position, color = '#bfe8ff', size = 0.9) {
    if (isCalm()) return;
    const mesh = new T.Mesh(new T.RingGeometry(0.42, 0.5, 48), new T.MeshBasicMaterial({ color, transparent: true, depthWrite: false, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.copy(position);
    world.add(mesh);
    tween(700, (t) => { mesh.scale.setScalar(0.2 + t * size * 2); mesh.material.opacity = 1 - t; }).then(() => drop(mesh));
  }
  const shake = (power = 0.12) => { if (!isCalm()) { shakeFor = Math.max(shakeFor, power); redraw(); } };
  function flash(position, color, power = 30, ms = 450) {
    if (isCalm()) return;
    const light = new T.PointLight(color, power, 6);
    light.position.copy(position);
    world.add(light);
    tween(ms, (t) => { light.intensity = power * (1 - t); }).then(() => light.removeFromParent());
  }
  /* The board rises and turns into place when a game begins. */
  const intro = () => tween(900, (t) => { world.rotation.y = (1 - t) * 0.5; world.position.y = (t - 1) * 1.6; world.scale.setScalar(0.86 + 0.14 * t); });
  function celebrate() {
    const colors = ['#ffcf6b', '#ff5fb0', '#6bd4ff', '#8dff9a', '#c18bff'];
    for (let i = 0; i < 10; i++) {
      setTimeout(() => { if (!isGone) burst(at(Math.random() * (n - 1), Math.random() * (n - 1), 0.4), { color: colors[i % colors.length], count: 34, speed: n * 0.55, size: 0.22, ms: 1300 }); }, i * 160);
    }
  }

  /* ---- pointer */
  const ray = new T.Raycaster(), ground = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3(), xy = new T.Vector2();
  function cellAt({ clientX, clientY }, { isClamped = true } = {}) {
    const b = element.getBoundingClientRect();
    xy.set(((clientX - b.left) / b.width) * 2 - 1, 1 - ((clientY - b.top) / b.height) * 2);
    ray.setFromCamera(xy, camera);
    if (!ray.ray.intersectPlane(ground, hit)) return null;
    const c = Math.floor(hit.x + n / 2), r = Math.floor(hit.z + n / 2), keep = (v) => Math.max(0, Math.min(n - 1, v));
    if (!isClamped && (r !== keep(r) || c !== keep(c))) return null;
    return { r: keep(r), c: keep(c) };
  }
  /* Where the middle of a cell is on the screen. */
  element.pointOf = (r, c) => {
    const b = element.getBoundingClientRect(), p = at(r, c).project(camera);
    return { x: b.left + ((p.x + 1) / 2) * b.width, y: b.top + ((1 - p.y) / 2) * b.height };
  };

  /* ---- drawing, only when something changes */
  function draw(now) {
    if (isGone) return;
    requestAnimationFrame(draw);
    const gone = now - last;
    if (!dirty && !tweens.size && !each.size && !shakeFor) { last = now; return; }
    if (!element.clientWidth || !element.clientHeight) return;
    dirty = false;
    for (const t of [...tweens]) {
      const part = Math.min(1, (now - t.start) / t.ms);
      if (part < 0) continue;
      t.fn(t.curve(part));
      if (part >= 1) { tweens.delete(t); t.done(); dirty = true; }
    }
    each.forEach((fn) => fn(now / 1000));
    camera.position.copy(home);
    if (shakeFor > 0.002) {
      camera.position.x += (Math.random() - 0.5) * shakeFor; camera.position.y += (Math.random() - 0.5) * shakeFor;
      shakeFor *= 0.88;
    } else shakeFor = 0;
    composer.render();
    if (shakeFor || tweens.size) dirty = true;
    // A slow computer gets fewer pixels and no glow, and the game stays smooth.
    slow = gone > SLOW_MS && gone < 400 ? slow + 1 : Math.max(0, slow - 1);
    if (slow > 40 && (ratio > 1 || bloom.enabled)) { slow = 0; if (ratio > 1) { ratio = 1; fit(); } else bloom.enabled = false; }
    last = now;
  }
  const watch = new ResizeObserver(fit);
  watch.observe(element);
  requestAnimationFrame(draw);

  return { scene, world, at, add, remove, clear, setSize, tween, slab, outline, label, burst, ripple, shake, flash, intro, celebrate, cellAt, redraw,
    get n() { return n; },
    /* fn(seconds) on every frame, for things that always move. Nothing moves with reduced motion. */
    onFrame: (fn) => { if (isCalm()) { fn(0); return () => {}; } each.add(fn); return () => each.delete(fn); },
    pan: (c) => (n > 1 ? (c / (n - 1)) * 1.4 - 0.7 : 0),
    dispose: () => { isGone = true; watch.disconnect(); renderer.dispose(); renderer.domElement.remove(); } };
}
