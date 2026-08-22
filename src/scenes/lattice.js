import * as THREE from 'three';
import { simplex3, fbm, palette } from '../lib/glsl.js';

export const meta = {
  id: 'lattice',
  title: 'Lattice',
  tags: ['instancing', 'one draw call', 'hero background'],
  blurb:
    'Eighteen thousand billboarded dots drawn in a single instanced call. Height, scale and colour ' +
    'all come out of one fbm field evaluated in the vertex shader, with a travelling swell that ' +
    'follows the pointer. This is the one that actually belongs behind a hero headline. It ' +
    'stays legible under text and costs a single draw call.',
  stats: { instances: '18,000', 'draw calls': '1', 'CPU per frame': '3 uniforms' },
  params: {
    amp: { label: 'Swell height', type: 'range', min: 0.1, max: 4.0, step: 0.05, value: 1.5 },
    size: { label: 'Dot size', type: 'range', min: 0.04, max: 0.32, step: 0.005, value: 0.135 },
    speed: { label: 'Drift speed', type: 'range', min: 0, max: 0.6, step: 0.01, value: 0.16 },
    density: {
      label: 'Grid density',
      type: 'select',
      structural: true,
      value: 180,
      options: [
        { label: '4,500 dots', value: 90 },
        { label: '18,000 dots', value: 180 },
        { label: '40,500 dots', value: 270 },
        { label: '72,000 dots', value: 360 },
      ],
    },
    spacing: { label: 'Spacing', type: 'range', min: 0.12, max: 0.5, step: 0.005, value: 0.26 },
    hue: { label: 'Hue', type: 'range', min: 0, max: 1, step: 0.005, value: 0 },
  },
};



const vert = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec3  uPointer;
  uniform float uPointerAmount;
  uniform float uAmp;
  uniform float uDotSize;
  uniform float uDrift;

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
    float field = fbm(vec3(aOffset * 0.42, uTime * uDrift), 4, 2.0, 0.5);

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
  uniform float uHue;

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
      vec3(0.10, 0.28, 0.52) + uHue
    );

    // Crests pick up a cool highlight, troughs sink toward the background.
    col += vec3(0.40, 0.62, 1.00) * pow(clamp(t, 0.0, 1.0), 4.0) * 0.9;
    col *= mix(0.35, 1.25, t);

    gl_FragColor = vec4(col, alpha * mix(0.35, 1.0, t));
  }
`;

export function create({ renderer, width, height, params = {} }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200);
  camera.position.set(0, -14, 13);
  camera.lookAt(0, 1.5, 0);

  let cols = Number(params.density) || 180;
  let rows = Math.round(cols * 100 / 180);
  let spacing = params.spacing ?? 0.26;

  const base = new THREE.PlaneGeometry(1, 1);
  let geometry = new THREE.InstancedBufferGeometry();

  /** Instance buffers are sized by the grid, so density changes rebuild them. */
  function fillInstances(target) {
    const count = cols * rows;
    const offsets = new Float32Array(count * 2);
    const rands = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      offsets[i * 2 + 0] = (col - cols / 2) * spacing;
      offsets[i * 2 + 1] = (row - rows / 2) * spacing;
      rands[i] = Math.random();
    }
    target.index = base.index;
    target.attributes.position = base.attributes.position;
    target.attributes.uv = base.attributes.uv;
    target.instanceCount = count;
    target.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 2));
    target.setAttribute('aRand', new THREE.InstancedBufferAttribute(rands, 1));
    target.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
  }

  fillInstances(geometry);

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
      uAmp: { value: params.amp ?? 1.5 },
      uDotSize: { value: params.size ?? 0.135 },
      uDrift: { value: params.speed ?? 0.16 },
      uHue: { value: params.hue ?? 0 },
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
        // Trail rather than snap, so the bump lags slightly behind the cursor.
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
    mesh.geometry.dispose();
    material.dispose();
  }

  function setParams(next) {
    if (next.amp !== undefined) material.uniforms.uAmp.value = next.amp;
    if (next.size !== undefined) material.uniforms.uDotSize.value = next.size;
    if (next.speed !== undefined) material.uniforms.uDrift.value = next.speed;
    if (next.hue !== undefined) material.uniforms.uHue.value = next.hue;

    const wantedCols = Number(next.density);
    const wantedSpacing = next.spacing === undefined ? spacing : Number(next.spacing);
    const gridChanged = Number.isFinite(wantedCols) && wantedCols !== cols;
    const spacingChanged = Number.isFinite(wantedSpacing) && wantedSpacing !== spacing;

    if (gridChanged || spacingChanged) {
      if (gridChanged) { cols = wantedCols; rows = Math.round(cols * 100 / 180); }
      if (spacingChanged) spacing = wantedSpacing;
      const old = mesh.geometry;
      const rebuilt = new THREE.InstancedBufferGeometry();
      fillInstances(rebuilt);
      mesh.geometry = rebuilt;
      geometry = rebuilt;
      old.dispose();
    }
  }

  return { render, resize, dispose, setParams, background };
}
