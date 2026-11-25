// SPDX-License-Identifier: MIT
/* The sea, the planes, the boats and the marks of Avioane & Barcute. */
import { THREE, gloss } from '/kit/board3d.js';

const { Group, Mesh } = THREE;
const part = (geometry, material, x = 0, y = 0, z = 0) => { const m = new Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };
const round = (w, h, d, r = 0.06) => new THREE.RoundedBoxGeometry(w, h, d, 3, r);

/* Waves are part of the water's own drawing, so they cost nothing between frames. */
export function sea(board) {
  const { n } = board, time = { value: 0 };
  const material = new THREE.MeshPhysicalMaterial({ color: '#0b5d8f', roughness: 0.16, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.2 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = time;
    shader.vertexShader = `uniform float time; varying float vHigh;
      vec3 wave(vec2 p){ vec3 o = vec3(0.); vec2 d; float k,a,s;
        d=vec2(.8,.6);k=2.1;a=.030;s=1.1; o+=vec3(d.x*k*a*cos(dot(d,p)*k+time*s), d.y*k*a*cos(dot(d,p)*k+time*s), a*sin(dot(d,p)*k+time*s));
        d=vec2(-.5,.86);k=3.7;a=.016;s=1.7; o+=vec3(d.x*k*a*cos(dot(d,p)*k+time*s), d.y*k*a*cos(dot(d,p)*k+time*s), a*sin(dot(d,p)*k+time*s));
        d=vec2(.95,-.3);k=6.1;a=.008;s=2.3; o+=vec3(d.x*k*a*cos(dot(d,p)*k+time*s), d.y*k*a*cos(dot(d,p)*k+time*s), a*sin(dot(d,p)*k+time*s));
        return o; }\n${shader.vertexShader}`
      .replace('#include <beginnormal_vertex>', 'vec3 w = wave(position.xy); vec3 objectNormal = normalize(vec3(-w.x, -w.y, 1.));')
      .replace('#include <begin_vertex>', 'vec3 transformed = position + vec3(0., 0., w.z); vHigh = w.z;');
    shader.fragmentShader = `varying float vHigh;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.10,.62,.74), smoothstep(.0,.055,vHigh)*.55);');
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
function plane({ color, trim }) {
  const g = new Group(), body = gloss(color, { metalness: 0.25 }), dark = gloss(trim, { metalness: 0.25 });
  const tube = part(new THREE.CapsuleGeometry(0.27, 2.75, 8, 18), body, 0, 0.36, 1.55);
  tube.rotation.x = Math.PI / 2;
  const nose = part(new THREE.SphereGeometry(0.2, 20, 14), new THREE.MeshPhysicalMaterial({ color: '#fff', emissive: '#fff', emissiveIntensity: 0.5, roughness: 0.2 }), 0, 0.5, 0.0);
  const glass = part(new THREE.SphereGeometry(0.2, 18, 12), new THREE.MeshPhysicalMaterial({ color: '#9fe6ff', roughness: 0.04, metalness: 0.2, clearcoat: 1 }), 0, 0.56, 0.75);
  glass.scale.set(0.85, 0.75, 1.6);
  const fin = part(round(0.1, 0.5, 0.5), dark, 0, 0.72, 3.0);
  g.add(tube, nose, glass, part(round(4.72, 0.12, 0.78), body, 0, 0.36, 1), part(round(0.5, 0.13, 0.79), dark, 2.1, 0.365, 1), part(round(0.5, 0.13, 0.79), dark, -2.1, 0.365, 1),
    part(round(2.72, 0.11, 0.62), dark, 0, 0.4, 3), fin);
  return g;
}
function boat(length, { color, trim }) {
  const s = new THREE.Shape(), e = length - 0.12, h = 0.34;
  s.moveTo(-0.4, -h); s.lineTo(e - 0.9, -h); s.quadraticCurveTo(e - 0.6, -h, e - 0.5, 0); s.quadraticCurveTo(e - 0.6, h, e - 0.9, h); s.lineTo(-0.4, h); s.quadraticCurveTo(-0.48, 0, -0.4, -h);
  const hull = part(new THREE.ExtrudeGeometry(s, { depth: 0.24, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.06, bevelSegments: 3 }), gloss(color, { metalness: 0.3 }), 0, 0.06, 0);
  hull.rotation.x = -Math.PI / 2;
  const g = new Group(), middle = (length - 1) / 2, dark = gloss(trim);
  g.add(hull, part(round(0.55, 0.24, 0.4), gloss('#f2efe6'), middle - 0.1, 0.46, 0), part(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 16), dark, middle - 0.25, 0.66, 0));
  for (let k = 0; k < length; k++) if (Math.abs(k - middle) > 0.6) g.add(part(new THREE.CylinderGeometry(0.13, 0.15, 0.14, 18), dark, k - 0.05, 0.42, 0));
  return g;
}
const PAINT = { plane: [{ color: '#f2483c', trim: '#ffd35a' }, { color: '#8a3ffc', trim: '#ff9ad5' }, { color: '#f07f13', trim: '#fff2cf' }], boat: { color: '#e7edf5', trim: '#2b3f63' } };
export function piece(board, p, index, { isBad = false, isChosen = false, isDown = false } = {}) {
  const isPlane = p.kind === 'plane', mesh = isPlane ? plane(PAINT.plane[index % PAINT.plane.length]) : boat(Number(p.kind.slice(4)), PAINT.boat);
  mesh.position.copy(board.at(p.r, p.c, isPlane ? (isDown ? -0.16 : 0.14) : (isDown ? -0.2 : 0)));
  mesh.rotation.y = (-p.dir * Math.PI) / 2;
  mesh.traverse((x) => {
    if (!x.material) return;
    if (isDown) { x.material.color.lerp(new THREE.Color('#1d1a22'), 0.72); x.material.emissiveIntensity = 0; x.material.roughness = 0.8; x.material.clearcoat = 0; }
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
