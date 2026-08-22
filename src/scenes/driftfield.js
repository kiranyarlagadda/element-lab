import * as THREE from 'three';
import { simplex3, curl, hash, palette } from '../lib/glsl.js';

export const meta = {
  id: 'driftfield',
  title: 'Driftfield',
  tags: ['gpgpu', 'ping-pong fbo', 'curl noise'],
  blurb:
    'Up to a million particles whose positions live entirely in a floating-point ' +
    'texture. Each frame a fragment shader advects every one of them through a ' +
    'divergence-free curl-noise field and writes the result to a second texture, ' +
    'which becomes next frame’s input. The CPU never touches a particle.',
  stats: { 'sim passes/frame': '1', 'CPU work': 'none', 'CPU per particle': 'zero' },
  params: {
    // `structural` means changing it rebuilds GPU resources rather than setting
    // a uniform, so the UI applies it on release instead of mid-drag.
    count: {
      label: 'Particles',
      type: 'select',
      structural: true,
      value: 512,
      options: [
        { label: '16,384', value: 128 },
        { label: '65,536', value: 256 },
        { label: '262,144', value: 512 },
        { label: '1,048,576', value: 1024 },
      ],
    },
    speed: { label: 'Flow speed', type: 'range', min: 0.05, max: 1.4, step: 0.01, value: 0.48 },
    scale: { label: 'Noise scale', type: 'range', min: 0.4, max: 4.0, step: 0.01, value: 1.75 },
    size: { label: 'Particle size', type: 'range', min: 2, max: 11, step: 0.1, value: 5.5 },
    decay: { label: 'Lifetime', type: 'range', min: 0.03, max: 0.6, step: 0.01, value: 0.14 },
    force: { label: 'Pointer push', type: 'range', min: 0, max: 1.6, step: 0.01, value: 0.55 },
    hue: { label: 'Hue', type: 'range', min: 0, max: 1, step: 0.005, value: 0 },
    exposure: { label: 'Brightness', type: 'range', min: 0.15, max: 1.6, step: 0.01, value: 0.55 },
  },
};

const simFrag = /* glsl */ `
  precision highp float;

  uniform sampler2D uPos;
  uniform float uTime;
  uniform float uDt;
  uniform float uScale;
  uniform float uSpeed;
  uniform float uDecay;
  uniform vec3  uPointer;
  uniform float uPointerForce;

  varying vec2 vUv;

  ${simplex3}
  ${curl}
  ${hash}

  void main(){
    vec4 data  = texture2D(uPos, vUv);
    vec3 pos   = data.xyz;
    float life = data.w;

    // Flow: curl noise sampled in a slowly drifting 4th dimension (time on z)
    // so the field itself evolves instead of being a frozen sculpture.
    vec3 vel = curlNoise(pos * uScale + vec3(0.0, 0.0, uTime * 0.06)) * uSpeed;

    // Pointer shoves particles away with an inverse-square falloff.
    vec3 away = pos - uPointer;
    float d2  = dot(away, away);
    vel += normalize(away + 1e-5) * uPointerForce / (1.0 + d2 * 9.0);

    // Weak spring to the origin, otherwise the cloud slowly evaporates.
    vel -= pos * 0.09;

    pos  += vel * uDt;
    life -= uDt * uDecay;

    // Respawn dead particles on a jittered shell.
    if (life <= 0.0){
      vec3 r   = hash31(vUv.x * 3571.0 + vUv.y * 7919.0 + uTime * 13.0);
      vec3 dir = normalize(r * 2.0 - 1.0);
      pos  = dir * (0.30 + r.x * 0.55);
      life = 1.0;
    }

    gl_FragColor = vec4(pos, life);
  }
`;

const passVert = /* glsl */ `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const copyFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D uPos;
  varying vec2 vUv;
  void main(){ gl_FragColor = texture2D(uPos, vUv); }
`;

const pointsVert = /* glsl */ `
  precision highp float;

  uniform sampler2D uPos;
  uniform sampler2D uPrevPos;
  uniform float uSize;
  uniform float uPixelRatio;

  attribute vec2 aRef;

  varying float vSpeed;
  varying float vLife;

  void main(){
    vec4 cur  = texture2D(uPos,     aRef);
    vec3 prev = texture2D(uPrevPos, aRef).xyz;

    // Velocity for free: the ping-pong pair already holds both frames.
    vSpeed = length(cur.xyz - prev);
    vLife  = cur.w;

    vec4 mv = modelViewMatrix * vec4(cur.xyz, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio / max(-mv.z, 0.001);
  }
`;

const pointsFrag = /* glsl */ `
  precision highp float;

  uniform float uExposure;
  uniform float uHue;
  varying float vSpeed;
  varying float vLife;

  ${palette}

  void main(){
    vec2 q = gl_PointCoord - 0.5;
    float r2 = dot(q, q);
    if (r2 > 0.25) discard;

    // Soft round sprite, no texture needed.
    float sprite = 1.0 - smoothstep(0.0, 0.25, r2);

    // Fade in on spawn, out on death, so respawns never pop.
    float fade = (1.0 - smoothstep(0.82, 1.0, vLife)) * smoothstep(0.0, 0.18, vLife);

    float t = clamp(vSpeed * 42.0, 0.0, 1.0);
    vec3 col = palette(
      t,
      vec3(0.34, 0.30, 0.44),
      vec3(0.42, 0.36, 0.44),
      vec3(1.00, 0.95, 0.85),
      vec3(0.00, 0.18, 0.42) + uHue
    );
    col += vec3(0.35, 0.55, 1.0) * pow(t, 3.0) * 0.8;

    gl_FragColor = vec4(col * uExposure, sprite * fade * 0.35);
  }
`;

export function create({ renderer, width, height, params = {} }) {
  const gl = renderer.getContext();
  const canFloat = !!gl.getExtension('EXT_color_buffer_float');
  const dataType = canFloat ? THREE.FloatType : THREE.HalfFloatType;

  const rtOptions = {
    type: dataType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  };

  // ---- offscreen sim scene (built once, reused across rebuilds) -----------
  const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const simScene = new THREE.Scene();
  const quad = new THREE.PlaneGeometry(2, 2);

  const simMaterial = new THREE.ShaderMaterial({
    vertexShader: passVert,
    fragmentShader: simFrag,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uPos: { value: null },
      uTime: { value: 0 },
      uDt: { value: 0.016 },
      uScale: { value: params.scale ?? 1.75 },
      uSpeed: { value: params.speed ?? 0.48 },
      uDecay: { value: params.decay ?? 0.14 },
      uPointer: { value: new THREE.Vector3(999, 999, 999) },
      uPointerForce: { value: 0 },
    },
  });

  const copyMaterial = new THREE.ShaderMaterial({
    vertexShader: passVert,
    fragmentShader: copyFrag,
    depthTest: false,
    depthWrite: false,
    uniforms: { uPos: { value: null } },
  });

  const simMesh = new THREE.Mesh(quad, simMaterial);
  simMesh.frustumCulled = false;
  simScene.add(simMesh);

  const pointsMaterial = new THREE.ShaderMaterial({
    vertexShader: pointsVert,
    fragmentShader: pointsFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uPos: { value: null },
      uPrevPos: { value: null },
      uSize: { value: params.size ?? 5.5 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uExposure: { value: params.exposure ?? 0.55 },
      uHue: { value: params.hue ?? 0 },
    },
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
  camera.position.set(0, 0, 3.1);

  // ---- simulation resources, rebuilt when the particle count changes ------
  let side = 0;
  let targets = null;
  let seedTex = null;
  let geometry = null;
  let points = null;
  let current = 0;

  function releaseSim() {
    if (points) scene.remove(points);
    targets?.forEach((t) => t.dispose());
    seedTex?.dispose();
    geometry?.dispose();
    targets = null;
    seedTex = null;
    geometry = null;
    points = null;
  }

  /** (Re)build the FBO pair and point cloud for an n x n particle texture. */
  function buildSim(n) {
    releaseSim();
    side = n;
    const count = n * n;

    targets = [
      new THREE.WebGLRenderTarget(n, n, rtOptions),
      new THREE.WebGLRenderTarget(n, n, rtOptions),
    ];

    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      // Uniform point in a spherical shell.
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const radius = 0.3 + Math.random() * 0.6;
      seed[i * 4 + 0] = s * Math.cos(theta) * radius;
      seed[i * 4 + 1] = s * Math.sin(theta) * radius;
      seed[i * 4 + 2] = u * radius;
      seed[i * 4 + 3] = Math.random(); // staggered life so deaths never sync up
    }
    seedTex = new THREE.DataTexture(seed, n, n, THREE.RGBAFormat, THREE.FloatType);
    seedTex.needsUpdate = true;

    // Prime both targets with the seed so frame 0 has a valid previous frame.
    copyMaterial.uniforms.uPos.value = seedTex;
    simMesh.material = copyMaterial;
    for (const target of targets) {
      renderer.setRenderTarget(target);
      renderer.render(simScene, simCamera);
    }
    renderer.setRenderTarget(null);
    simMesh.material = simMaterial;

    const refs = new Float32Array(count * 2);
    const positions = new Float32Array(count * 3); // required by three, unused by the shader
    for (let i = 0; i < count; i++) {
      refs[i * 2 + 0] = ((i % n) + 0.5) / n;
      refs[i * 2 + 1] = (Math.floor(i / n) + 0.5) / n;
    }
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);

    points = new THREE.Points(geometry, pointsMaterial);
    points.frustumCulled = false;
    scene.add(points);

    current = 0;
    pointsMaterial.uniforms.uPos.value = targets[0].texture;
    pointsMaterial.uniforms.uPrevPos.value = targets[1].texture;
  }

  buildSim(Number(params.count) || 512);

  const pointerWorld = new THREE.Vector3(999, 999, 999);
  const background = new THREE.Color(0x05060b);
  let pointerForce = params.force ?? 0.55;

  function render(time, dt, pointer) {
    // Project the 2D pointer onto the z = 0 plane in world space.
    if (pointer.active) {
      pointerWorld.set(pointer.x, pointer.y, 0.5).unproject(camera);
      pointerWorld.sub(camera.position).normalize();
      const distance = -camera.position.z / pointerWorld.z;
      pointerWorld.multiplyScalar(distance).add(camera.position);
      simMaterial.uniforms.uPointer.value.copy(pointerWorld);
    }
    simMaterial.uniforms.uPointerForce.value +=
      ((pointer.active ? pointerForce : 0) - simMaterial.uniforms.uPointerForce.value) * 0.06;

    simMaterial.uniforms.uTime.value = time;
    simMaterial.uniforms.uDt.value = dt;

    const next = 1 - current;
    simMaterial.uniforms.uPos.value = targets[current].texture;
    renderer.setRenderTarget(targets[next]);
    renderer.render(simScene, simCamera);
    renderer.setRenderTarget(null);

    pointsMaterial.uniforms.uPos.value = targets[next].texture;
    pointsMaterial.uniforms.uPrevPos.value = targets[current].texture;
    current = next;

    // Slow drift so the silhouette keeps changing without any user input.
    const orbit = time * 0.07;
    camera.position.x = Math.sin(orbit) * 3.1;
    camera.position.z = Math.cos(orbit) * 3.1;
    camera.position.y = Math.sin(time * 0.11) * 0.35;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  function setParams(next) {
    const u = simMaterial.uniforms;
    if (next.scale !== undefined) u.uScale.value = next.scale;
    if (next.speed !== undefined) u.uSpeed.value = next.speed;
    if (next.decay !== undefined) u.uDecay.value = next.decay;
    if (next.force !== undefined) pointerForce = next.force;
    if (next.size !== undefined) pointsMaterial.uniforms.uSize.value = next.size;
    if (next.hue !== undefined) pointsMaterial.uniforms.uHue.value = next.hue;
    if (next.exposure !== undefined) pointsMaterial.uniforms.uExposure.value = next.exposure;

    const wanted = Number(next.count);
    if (Number.isFinite(wanted) && wanted !== side) buildSim(wanted);
  }

  function resize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    pointsMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  }

  function dispose() {
    releaseSim();
    quad.dispose();
    simMaterial.dispose();
    copyMaterial.dispose();
    pointsMaterial.dispose();
  }

  return { render, resize, dispose, setParams, background };
}
