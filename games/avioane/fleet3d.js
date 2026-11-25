// SPDX-License-Identifier: MIT
/* The sea, the planes, the boats and the marks of Avioane & Barcute. */
import { THREE, gloss } from '/kit/board3d.js';

const { Group, Mesh } = THREE;
const part = (geometry, material, x = 0, y = 0, z = 0) => { const m = new Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };
const round = (w, h, d, r = 0.06) => new THREE.RoundedBoxGeometry(w, h, d, 3, r);

/* Waves are part of the water's own drawing, so they cost nothing between frames. */
const WAVES = `uniform float time; varying vec2 vSea;
  vec3 swell(vec2 p) {
    vec3 sum = vec3(0.); vec2 d = normalize(vec2(.8, .6)); float k = 1.7, a = .03, s = .9;
    for (int i = 0; i < 7; i++) {
      float x = dot(d, p) * k + time * s + float(i) * 1.7;
      sum += vec3(d * k * a * cos(x), a * sin(x));
      d = mat2(.28, .96, -.96, .28) * d; k *= 1.62; a *= .56; s *= 1.3;
    }
    return sum;
  }`;
export function sea(board) {
  const { n } = board, time = { value: 0 };
  const material = new THREE.MeshPhysicalMaterial({ color: '#06476f', roughness: 0.2, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.15, envMapIntensity: 1.6 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = time;
    shader.vertexShader = `${WAVES}\n${shader.vertexShader}`.replace('#include <begin_vertex>', 'vSea = position.xy; vec3 transformed = position + vec3(0., 0., swell(vSea).z);');
    shader.fragmentShader = `${WAVES}\nuniform mat3 normalMatrix;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>', '#include <color_fragment>\n float high = swell(vSea).z; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.03, .38, .5), smoothstep(-.02, .07, high) * .7); diffuseColor.rgb += vec3(.5, .62, .66) * smoothstep(.06, .085, high) * .35;')
      .replace('#include <normal_fragment_maps>', 'vec3 slope = swell(vSea); normal = normalize(normalMatrix * normalize(vec3(-slope.xy * 1.6, 1.))); ')
      .replace('#include <clearcoat_normal_fragment_maps>', 'clearcoatNormal = normal;');
  };
  const water = new Mesh(new THREE.PlaneGeometry(n, n, n * 5, n * 5), material);
  water.rotation.x = -Math.PI / 2; water.receiveShadow = true;
  const lines = new Float32Array((n + 1) * 12);
  for (let i = 0; i <= n; i++) lines.set([i - n / 2, 0, -n / 2, i - n / 2, 0, n / 2, -n / 2, 0, i - n / 2, n / 2, 0, i - n / 2], i * 12);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(lines, 3));
  const grid = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#d6f3ff', transparent: true, opacity: 0.34, toneMapped: false }));
  grid.position.y = 0.07;
  const group = new Group();
  group.add(water, grid);
  board.add(group);
  return (seconds) => { time.value = seconds; };
}
/* Half a wing, from the middle to its tip, as a thin plate with a slanted front edge. */
function wing(span, root, tip, material, thickness) {
  const s = new THREE.Shape();
  s.moveTo(-span, -tip * 0.3); s.lineTo(0, -root / 2); s.lineTo(span, -tip * 0.3); s.lineTo(span, tip * 0.7); s.lineTo(0, root / 2); s.lineTo(-span, tip * 0.7); s.closePath();
  const m = part(new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 3 }), material);
  m.rotation.x = Math.PI / 2;
  return m;
}
function plane({ color, trim }) {
  const g = new Group(), body = gloss(color, { metalness: 0.35, roughness: 0.28 }), dark = gloss(trim, { metalness: 0.2 }), steel = gloss('#c9d2de', { metalness: 0.9, roughness: 0.25 });
  const tube = part(new THREE.CapsuleGeometry(0.28, 2.7, 10, 24), body, 0, 0.42, 1.55);
  tube.rotation.x = Math.PI / 2;
  const band = part(new THREE.CylinderGeometry(0.286, 0.286, 0.3, 24), dark, 0, 0.42, 2.35);
  band.rotation.x = Math.PI / 2;
  const nose = part(new THREE.SphereGeometry(0.2, 24, 16), new THREE.MeshPhysicalMaterial({ color: '#fff', emissive: '#fff', emissiveIntensity: 0.22, roughness: 0.25 }), 0, 0.55, 0.0);
  const glass = part(new THREE.SphereGeometry(0.2, 20, 14), new THREE.MeshPhysicalMaterial({ color: '#16476b', roughness: 0.03, metalness: 0.4, clearcoat: 1, envMapIntensity: 2.5 }), 0, 0.6, 0.8);
  glass.scale.set(0.9, 0.75, 1.7);
  const main = wing(2.38, 0.95, 0.55, body, 0.05), back = wing(1.38, 0.72, 0.42, dark, 0.04), fin = part(round(0.08, 0.55, 0.55, 0.04), dark, 0, 0.82, 3.0);
  main.position.set(0, 0.44, 1); back.position.set(0, 0.48, 3);
  g.add(tube, band, nose, glass, main, back, fin);
  for (const x of [-1, 1]) {
    const engine = part(new THREE.CapsuleGeometry(0.16, 0.5, 8, 18), steel, x, 0.34, 0.92);
    engine.rotation.x = Math.PI / 2;
    const prop = part(new THREE.CylinderGeometry(0.34, 0.34, 0.015, 28), new THREE.MeshBasicMaterial({ color: '#eaf4ff', transparent: true, opacity: 0.28, depthWrite: false }), x, 0.34, 0.5);
    prop.rotation.x = Math.PI / 2; prop.castShadow = false;
    const badge = new Mesh(new THREE.CircleGeometry(0.17, 28), new THREE.MeshBasicMaterial({ color: trim }));
    badge.rotation.x = -Math.PI / 2; badge.position.set(x * 1.75, 0.5, 1);
    g.add(engine, prop, badge);
  }
  return g;
}
function boat(length, { color, trim, deck }) {
  const shape = (e, h) => {
    const s = new THREE.Shape();
    s.moveTo(-0.38, -h); s.lineTo(e - 0.95, -h); s.quadraticCurveTo(e - 0.62, -h, e - 0.52, 0); s.quadraticCurveTo(e - 0.62, h, e - 0.95, h); s.lineTo(-0.38, h); s.quadraticCurveTo(-0.47, 0, -0.38, -h);
    return s;
  };
  const plate = (e, h, depth, material, y, bevel = 0.04) => { const m = part(new THREE.ExtrudeGeometry(shape(e, h), { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3 }), material, 0, y, 0); m.rotation.x = -Math.PI / 2; return m; };
  const paint = gloss(color, { metalness: 0.35 }), dark = gloss(trim, { metalness: 0.4 }), wood = gloss(deck, { roughness: 0.6, clearcoat: 0.2 }), white = gloss('#d9dde4');
  const g = new Group(), middle = (length - 1) / 2;
  g.add(plate(length - 0.04, 0.35, 0.06, gloss('#9c2b22'), 0.02), plate(length, 0.35, 0.2, paint, 0.1), plate(length - 0.12, 0.28, 0.02, wood, 0.33, 0.01),
    part(round(0.62, 0.2, 0.4), white, middle - 0.1, 0.45, 0), part(round(0.36, 0.16, 0.32), white, middle - 0.02, 0.62, 0), part(round(0.1, 0.07, 0.3, 0.02), gloss('#16476b', { roughness: 0.05 }), middle + 0.16, 0.64, 0));
  const funnel = part(new THREE.CylinderGeometry(0.1, 0.12, 0.34, 18), dark, middle - 0.3, 0.68, 0), top = part(new THREE.CylinderGeometry(0.105, 0.105, 0.08, 18), gloss('#e3b23c'), middle - 0.3, 0.84, 0);
  g.add(funnel, top);
  for (let k = 0; k < length; k++) {
    if (Math.abs(k - middle) < 0.6) continue;
    const barrel = part(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 10), dark, k + 0.12, 0.47, 0);
    barrel.rotation.z = Math.PI / 2;
    g.add(part(new THREE.CylinderGeometry(0.14, 0.17, 0.15, 22), paint, k - 0.06, 0.43, 0), barrel);
  }
  return g;
}
const PAINT = { plane: [{ color: '#c8281e', trim: '#f0b429' }, { color: '#5f22c9', trim: '#e85fae' }, { color: '#0f8a5f', trim: '#e9e2c4' }], boat: { color: '#7d8da3', trim: '#26344d', deck: '#9a7448' } };
export function piece(board, p, index, { isBad = false, isChosen = false, isDown = false } = {}) {
  const isPlane = p.kind === 'plane', mesh = isPlane ? plane(PAINT.plane[index % PAINT.plane.length]) : boat(Number(p.kind.slice(4)), PAINT.boat);
  mesh.position.copy(board.at(p.r, p.c, isPlane ? (isDown ? -0.16 : 0.14) : (isDown ? -0.2 : 0)));
  mesh.rotation.y = (-p.dir * Math.PI) / 2;
  mesh.traverse((x) => {
    if (!x.material?.color) return;
    if (isDown) { x.material.color.lerp(new THREE.Color('#1d1a22'), 0.72); x.material.emissiveIntensity = 0; x.material.metalness = 0; x.material.roughness = 0.8; x.material.clearcoat = 0; }
    if (!x.material.emissive) return;
    if (isBad) { x.material.emissive = new THREE.Color('#ff2e2e'); x.material.emissiveIntensity = 0.7; }
    else if (isChosen) { x.material.emissive = new THREE.Color('#ffcf6b'); x.material.emissiveIntensity = 0.28; }
  });
  return mesh;
}
/* Every mark has its own shape: one ring, two rings, a flame, a cross. */
export function mark(board, cell, says) {
  const g = new Group(), glow = (color, power) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), toneMapped: false });
  const ring = (r, material) => { const m = new Mesh(new THREE.TorusGeometry(r, 0.045, 10, 36), material); m.rotation.x = Math.PI / 2; return m; };
  if (says === 'miss') g.add(ring(0.24, glow('#d9f4ff', 0.9)));
  else if (says === 'near') g.add(ring(0.18, glow('#ffd35a', 1.1)), ring(0.33, glow('#ffd35a', 1.1)));
  else if (says === 'wait') g.add(ring(0.3, glow('#ffffff', 1.6)));
  else {
    const isDown = says === 'down', color = isDown ? '#ff3b2e' : '#ff8a1f';
    if (isDown) for (const a of [1, -1]) { const bar = new Mesh(round(0.72, 0.1, 0.13, 0.04), glow(color, 1.5)); bar.rotation.y = (a * Math.PI) / 4; g.add(bar); }
    else {
      const flame = new Mesh(new THREE.ConeGeometry(0.2, 0.6, 7), glow(color, 1.9)), core = new Mesh(new THREE.ConeGeometry(0.1, 0.36, 7), glow('#ffe9a0', 2.2));
      flame.position.y = 0.3; core.position.y = 0.2;
      g.add(flame, core);
      g.userData.isFlame = true;
    }
  }
  g.position.copy(board.at(Math.floor(cell / board.n), cell % board.n, says === 'hit' ? 0.2 : says === 'down' ? 0.85 : 0.12));
  return g;
}
