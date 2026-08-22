import * as THREE from 'three';
import { simplex3, fbm, palette } from '../lib/glsl.js';

export const meta = {
  id: 'lattice',
  title: 'Lattice',
  tags: ['instancing', 'one draw call', 'hero background'],
  blurb:
    'Eighteen thousand billboarded dots drawn in a single instanced call. Height, scale and colour ' +
    'all come out of one fbm field evaluated in the vertex shader, with a travelling swell that ' +
    'follows the pointer. This is the one that actually belongs behind a hero headline — it stays ' +
    'legible under text and costs one draw call.',
  stats: { instances: '18,000', 'draw calls': '1', 'CPU per frame': '3 uniforms' },
};

const COLS = 180;
const ROWS = 100;
const COUNT = COLS * ROWS;

const vert = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec3  uPointer;
  uniform float uPointerAmount;
  uniform float uAmp;
  uniform float uDotSize;

  attribute vec2  aOffset;
  attribute float aRand;

  varying float vHeight;
  varying float vRand;
  varying vec2  vLocal;

  ${simplex3}
  ${fbm}

  void main(){
    vec3 base = vec3(aOffset.x, aOffset.y, 0.0);

    // Slow drifting swell.
    float field = fbm(vec3(aOffset * 0.42, uTime * 0.16), 4, 2.0, 0.5);

    // Pointer raises a soft gaussian bump that trails the cursor.
    float d = distance(aOffset, uPointer.xy);
    float bump = exp(-d * d * 0.35) * uPointerAmount;

    float h = field * uAmp + bump * 1.5;
    base.z += h;

    vHeight = h;
    vRand = aRand;
    vLocal = position.xy;

    // Billboard in view space so every dot faces the camera regardless of the
    // plane's tilt.
    vec4 mv = modelViewMatrix * vec4(base, 1.0);

    float scale = uDotSize * (0.45 + 0.75 * smoothstep(-1.0, 1.5, h)) * (0.7 + aRand * 0.6);
    mv.xy += position.xy * scale;

    gl_Position = projectionMatrix * mv;
  }
`;

const frag = /* glsl */ `
  precision highp float;

  uniform float uTime;

  varying float vHeight;
  varying float vRand;
  varying vec2  vLocal;

  ${palette}

  void main(){
    // Round the quad off into a soft disc.
    float r = length(vLocal) * 2.0;
    float alpha = (1.0 - smoothstep(0.35, 1.0, r));
    if (alpha <= 0.001) discard;

    float t = clamp(vHeight * 0.42 + 0.5, 0.0, 1.0);

    vec3 col = palette(
      t * 0.8 + vRand * 0.05,
      vec3(0.28, 0.30, 0.40),
      vec3(0.32, 0.34, 0.40),
      vec3(0.90, 0.85, 0.80),
      vec3(0.10, 0.28, 0.52)
    );

    // Crests pick up a cool highlight, troughs sink toward the background.
    col += vec3(0.40, 0.62, 1.00) * pow(clamp(t, 0.0, 1.0), 4.0) * 0.9;
    col *= mix(0.35, 1.25, t);

    gl_FragColor = vec4(col, alpha * mix(0.35, 1.0, t));
  }
`;

export function create({ renderer, width, height }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200);
  camera.position.set(0, -14, 13);
  camera.lookAt(0, 1.5, 0);

  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.attributes.position = base.attributes.position;
  geometry.attributes.uv = base.attributes.uv;
  geometry.instanceCount = COUNT;

  const offsets = new Float32Array(COUNT * 2);
  const rands = new Float32Array(COUNT);
  const spacing = 0.26;

  for (let i = 0; i < COUNT; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    offsets[i * 2 + 0] = (col - COLS / 2) * spacing;
    offsets[i * 2 + 1] = (row - ROWS / 2) * spacing;
    rands[i] = Math.random();
  }

  geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 2));
  geometry.setAttribute('aRand', new THREE.InstancedBufferAttribute(rands, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);

  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector3(0, 0, 0) },
      uPointerAmount: { value: 0 },
      uAmp: { value: 1.5 },
      uDotSize: { value: 0.135 },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  const smoothPointer = new THREE.Vector3(0, 0, 0);
  const ndc = new THREE.Vector2();
  const background = new THREE.Color(0x04050a);

  function render(time, dt, pointer) {
    material.uniforms.uTime.value = time;

    if (pointer.active) {
      ndc.set(pointer.x, pointer.y);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(plane, hit)) {
        // Trail rather than snap — the bump lags the cursor slightly.
        smoothPointer.lerp(hit, 0.08);
      }
    }
    material.uniforms.uPointer.value.copy(smoothPointer);
    material.uniforms.uPointerAmount.value +=
      ((pointer.active ? 1.0 : 0.0) - material.uniforms.uPointerAmount.value) * 0.05;

    // Barely-there camera sway keeps it alive when nobody is interacting.
    camera.position.x = Math.sin(time * 0.09) * 1.6;
    camera.position.y = -14 + Math.cos(time * 0.07) * 0.8;
    camera.lookAt(0, 1.5, 0);

    renderer.render(scene, camera);
  }

  function resize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function dispose() {
    base.dispose();
    geometry.dispose();
    material.dispose();
  }

  return { render, resize, dispose, background };
}
