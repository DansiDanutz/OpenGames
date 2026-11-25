/* Builds kit/three.js, the part of three.js (MIT) that games may use: node tools/build-kit.js
   The built file is kept in the repository, so playing and checking never needs this step. */
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = path.join(import.meta.dirname, '..');
const CORE = ['ACESFilmicToneMapping', 'AdditiveBlending', 'AmbientLight', 'BoxGeometry', 'BufferAttribute', 'BufferGeometry', 'CanvasTexture', 'CapsuleGeometry', 'CircleGeometry', 'Color',
  'ConeGeometry', 'CylinderGeometry', 'DirectionalLight', 'DoubleSide', 'ExtrudeGeometry', 'Group', 'HalfFloatType', 'HemisphereLight', 'IcosahedronGeometry', 'LineBasicMaterial', 'LineSegments',
  'MathUtils', 'Mesh', 'MeshBasicMaterial', 'MeshPhysicalMaterial', 'MeshStandardMaterial', 'OctahedronGeometry', 'Path', 'PCFShadowMap', 'PerspectiveCamera', 'Plane', 'PlaneGeometry', 'PMREMGenerator',
  'PointLight', 'Points', 'PointsMaterial', 'Raycaster', 'RepeatWrapping', 'RingGeometry', 'Scene', 'Shape', 'SphereGeometry', 'SRGBColorSpace', 'TetrahedronGeometry', 'TorusGeometry', 'Vector2', 'Vector3', 'WebGLRenderer', 'WebGLRenderTarget'];
const ADDONS = { RoundedBoxGeometry: 'geometries/RoundedBoxGeometry.js', RoomEnvironment: 'environments/RoomEnvironment.js', EffectComposer: 'postprocessing/EffectComposer.js',
  RenderPass: 'postprocessing/RenderPass.js', UnrealBloomPass: 'postprocessing/UnrealBloomPass.js', OutputPass: 'postprocessing/OutputPass.js' };
const contents = [`export { ${CORE.join(', ')} } from 'three';`, ...Object.entries(ADDONS).map(([name, file]) => `export { ${name} } from 'three/addons/${file}';`)].join('\n');
await build({ stdin: { contents, resolveDir: ROOT }, bundle: true, minify: true, format: 'esm', target: 'es2023', legalComments: 'inline',
  banner: { js: '/* Built by tools/build-kit.js. SPDX-License-Identifier: MIT */' }, outfile: path.join(ROOT, 'kit/three.js') });
