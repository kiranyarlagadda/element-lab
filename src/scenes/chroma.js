import * as THREE from 'three';
import { simplex3, fbm, palette, tonemap } from '../lib/glsl.js';

export const meta = {
  id: 'chroma',
  title: 'Chroma',
  tags: ['vertex displacement', 'analytic normals', 'iridescence'],
  blurb:
    'An icosphere pushed around by fractal noise in the vertex shader. The interesting part is the ' +
    'lighting: displacing vertices invalidates the mesh normals, so this resamples the displacement ' +
    'at two tangent-space neighbours and rebuilds the normal per vertex. Skip that and the whole ' +
    'thing shades like a smooth ball wearing a lumpy costume.',
  stats: { vertices: '194,940', 'noise taps/vertex': '21', normals: 'recomputed' },
  params: {
    amp: { label: 'Displacement', type: 'range', min: 0.02, max: 0.6, step: 0.01, value: 0.28 },
    freq: { label: 'Noise frequency', type: 'range', min: 0.4, max: 4.0, step: 0.05, value: 1.5 },
    speed: { label: 'Rotation', type: 'range', min: 0, max: 0.6, step: 0.01, value: 0.15 },
    detail: {
      label: 'Mesh detail',
      type: 'select',
      structural: true,
      value: 56,
      options: [
        { label: '3,840 verts', value: 7 },
        { label: '21,780 verts', value: 32 },
        { label: '194,940 verts', value: 56 },
        { label: '253,500 verts', value: 64 },
      ],
    },
    hue: { label: 'Hue', type: 'range', min: 0, max: 1, step: 0.005, value: 0 },
    shine: { label: 'Reflectivity', type: 'range', min: 0, max: 1.6, step: 0.01, value: 0.85 },
  },
};

const vert = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uAmp;
  uniform float uFreq;
  uniform float uRadius;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vDisp;

  ${simplex3}
  ${fbm}

  float displace(vec3 dir){
    vec3 q = dir * uFreq;
    // Two counter-drifting fbm layers so the surface never looks like it is
    // simply scrolling in one direction.
    float a = fbm(q + vec3(0.0, 0.0,  uTime * 0.20), 4, 2.0, 0.5);
    float b = fbm(q.zxy * 1.7 + vec3(0.0, 0.0, -uTime * 0.13), 3, 2.1, 0.55);
    return (a * 0.75 + b * 0.35) * uAmp;
  }

  vec3 toSurface(vec3 dir){
    return dir * (uRadius + displace(dir));
  }

  void main(){
    vec3 dir = normalize(position);

    // Build a stable tangent frame; swap the up vector near the poles so the
    // cross product never collapses to zero.
    vec3 up = abs(dir.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 tangent   = normalize(cross(dir, up));
    vec3 bitangent = normalize(cross(dir, tangent));

    const float e = 0.015;
    vec3 p0 = toSurface(dir);
    vec3 p1 = toSurface(normalize(dir + tangent   * e));
    vec3 p2 = toSurface(normalize(dir + bitangent * e));

    // Rebuild the normal from the actual displaced neighbourhood.
    vec3 n = normalize(cross(p1 - p0, p2 - p0));

    vDisp    = (length(p0) - uRadius) / max(uAmp, 0.0001);
    vNormal  = normalize(normalMatrix * n);
    vec4 world = modelMatrix * vec4(p0, 1.0);
    vWorldPos = world.xyz;

    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const frag = /* glsl */ `
  precision highp float;

  uniform vec3  uCameraPos;
  uniform float uTime;
  uniform float uHue;
  uniform float uShine;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vDisp;

  ${palette}
  ${tonemap}

  // Cheap procedural environment. Good enough to sell a reflection without
  // shipping a cubemap.
  vec3 environment(vec3 dir){
    float horizon = smoothstep(-0.35, 0.55, dir.y);
    vec3 sky    = mix(vec3(0.05, 0.07, 0.14), vec3(0.30, 0.42, 0.70), horizon);
    vec3 ground = vec3(0.04, 0.035, 0.05);
    vec3 col = mix(ground, sky, smoothstep(-0.10, 0.10, dir.y));
    // A soft key light baked into the environment.
    col += vec3(1.0, 0.85, 0.65) * pow(clamp(dot(dir, normalize(vec3(0.6, 0.7, 0.4))), 0.0, 1.0), 24.0) * 1.6;
    return col;
  }

  void main(){
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 reflectDir = reflect(-viewDir, n);

    float ndv = clamp(dot(n, viewDir), 0.0, 1.0);
    float fresnel = pow(1.0 - ndv, 3.0);

    // Thin-film style shift: the hue tracks view angle, which is what makes
    // oil slicks and soap bubbles read as iridescent rather than just colourful.
    float shift = ndv * 0.85 + vDisp * 0.30 + uTime * 0.03;
    vec3 iridescence = palette(
      shift,
      vec3(0.56, 0.54, 0.62),
      vec3(0.26, 0.24, 0.30),
      vec3(1.00, 1.00, 1.00),
      vec3(0.02, 0.16, 0.32) + uHue
    );

    vec3 keyDir = normalize(vec3(0.6, 0.8, 0.45));
    float diffuse = clamp(dot(n, keyDir), 0.0, 1.0);
    vec3 halfVec = normalize(keyDir + viewDir);
    float spec = pow(clamp(dot(n, halfVec), 0.0, 1.0), 96.0);

    vec3 env = environment(reflectDir);

    vec3 col = iridescence * (0.20 + 0.75 * diffuse);
    col = mix(col, env * iridescence * 1.4, fresnel * uShine);
    col += vec3(1.0) * spec * 0.6;

    // Crevices go darker; ridges catch a little extra light.
    col *= mix(0.72, 1.16, smoothstep(-1.0, 1.0, vDisp));

    col = tonemapACES(col * 1.1);
    col = pow(col, vec3(1.0 / 2.2));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function create({ renderer, width, height, params = {} }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 0, 3.4);

  // 194,940 vertices. Detail is deliberately high: displacement happens per
  // vertex, so mesh density is what decides whether ridges read as smooth
  // curves or as visible facets along the silhouette.
  let detail = Number(params.detail) || 56;
  let geometry = new THREE.IcosahedronGeometry(1, detail);

  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: params.amp ?? 0.28 },
      uFreq: { value: params.freq ?? 1.5 },
      uRadius: { value: 1.0 },
      uCameraPos: { value: new THREE.Vector3() },
      uHue: { value: params.hue ?? 0 },
      uShine: { value: params.shine ?? 0.85 },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  /** Subdivision level is baked into the buffer, so changing it rebuilds. */
  function rebuild(next) {
    detail = next;
    const old = mesh.geometry;
    mesh.geometry = new THREE.IcosahedronGeometry(1, detail);
    geometry = mesh.geometry;
    old.dispose();
  }

  const tilt = new THREE.Vector2(0, 0);
  let spin = params.speed ?? 0.15;
  const background = new THREE.Color(0x06070d);

  function render(time, dt, pointer) {
    material.uniforms.uTime.value = time;

    const tx = pointer.active ? pointer.x : 0;
    const ty = pointer.active ? pointer.y : 0;
    tilt.x += (tx - tilt.x) * 0.05;
    tilt.y += (ty - tilt.y) * 0.05;

    mesh.rotation.y = time * spin + tilt.x * 0.6;
    mesh.rotation.x = tilt.y * -0.5;

    camera.position.z = 3.4;
    camera.lookAt(0, 0, 0);
    material.uniforms.uCameraPos.value.copy(camera.position);

    renderer.render(scene, camera);
  }

  function resize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function dispose() {
    mesh.geometry.dispose();
    material.dispose();
  }

  function setParams(next) {
    if (next.amp !== undefined) material.uniforms.uAmp.value = next.amp;
    if (next.freq !== undefined) material.uniforms.uFreq.value = next.freq;
    if (next.speed !== undefined) spin = next.speed;
    if (next.hue !== undefined) material.uniforms.uHue.value = next.hue;
    if (next.shine !== undefined) material.uniforms.uShine.value = next.shine;

    const wanted = Number(next.detail);
    if (Number.isFinite(wanted) && wanted !== detail) rebuild(wanted);
  }

  return { render, resize, dispose, setParams, background };
}
