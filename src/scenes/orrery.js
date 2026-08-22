import {
  BufferGeometry, BufferAttribute, LineSegments, LineBasicMaterial,
  Points, ShaderMaterial, Scene, PerspectiveCamera, Color,
  AdditiveBlending, Vector2, Sphere, Vector3,
} from 'three';
import { PLANETS, heliocentric, orbitPath, julianCenturies } from '../lib/jpl-planets.js';

// How much simulated time passes per real second.
const DAYS_PER_SECOND = 45;

// Real distances span 0.39 AU to 30 AU. Drawn linearly, the four inner planets
// collapse into the Sun's glare. Taking the square root of the radius keeps the
// ordering, the eccentric offsets and the orbit shapes readable while fitting
// Neptune on screen. Angles and orbital periods are untouched.
const AU_SCALE = 1.6;
const compress = (r) => Math.sqrt(r) * AU_SCALE;

const EPOCH = new Date();

export const meta = {
  id: 'orrery',
  title: 'Orrery',
  tags: ['nasa/jpl data', 'kepler', 'real positions'],
  blurb:
    'The actual solar system, not an impression of one. Every position comes from ' +
    'JPL’s Keplerian elements, solved through Kepler’s equation and rotated into the ' +
    'J2000 ecliptic, so the planets start exactly where they are today. The orbits carry ' +
    'their real shapes, tilts and relative periods. Radial distance is square-rooted and ' +
    'the bodies are not to scale, or Mercury would sit inside the Sun’s glare.',
  stats: {
    epoch: EPOCH.toISOString().slice(0, 10),
    source: 'JPL SSD',
    'draw calls': '3',
  },
  params: {
    speed: { label: 'Days per second', type: 'range', min: 0, max: 400, step: 1, value: 45 },
    size: { label: 'Body size', type: 'range', min: 40, max: 320, step: 1, value: 130 },
    zoom: { label: 'Camera distance', type: 'range', min: 9, max: 30, step: 0.1, value: 16 },
  },
};

const planetVert = /* glsl */ `
  precision highp float;
  attribute float aSize;
  attribute vec3 aColour;
  uniform float uPixelRatio;
  uniform float uBodyScale;
  varying vec3 vColour;
  void main(){
    vColour = aColour;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * uBodyScale / max(-mv.z, 0.001);
  }
`;

const planetFrag = /* glsl */ `
  precision highp float;
  varying vec3 vColour;
  void main(){
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q) * 2.0;
    if (r > 1.0) discard;
    // Solid core with a soft halo, so small bodies still read at distance.
    float core = (1.0 - smoothstep(0.30, 0.55, r));
    float halo = (1.0 - smoothstep(0.0, 1.0, r)) * 0.5;
    vec3 col = vColour * (core * 1.6 + halo * 1.5);
    gl_FragColor = vec4(col, min(1.0, core + halo * 1.2));
  }
`;

const sunFrag = /* glsl */ `
  precision highp float;
  uniform float uTime;
  void main(){
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q) * 2.0;
    if (r > 1.0) discard;
    float core = (1.0 - smoothstep(0.0, 0.22, r));
    float halo = pow((1.0 - smoothstep(0.0, 1.0, r)), 2.2);
    // Barely-there breathing so the star does not look like a dead sprite.
    float pulse = 0.94 + 0.06 * sin(uTime * 0.7);
    vec3 col = mix(vec3(1.0, 0.72, 0.32), vec3(1.0, 0.97, 0.88), core);
    gl_FragColor = vec4(col * (core * 2.2 + halo * 1.1) * pulse, core + halo * 0.85);
  }
`;

export function create({ renderer, width, height, params = {} }) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, width / height, 0.1, 400);

  const T0 = julianCenturies(EPOCH);

  // ---- orbit paths: every planet merged into one LineSegments -------------
  const segments = [];
  const segmentColours = [];
  for (const planet of PLANETS) {
    const path = orbitPath(planet, T0, 320);
    const c = new Color(planet.colour);
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      for (const p of [a, b]) {
        const r = Math.hypot(p.x, p.y, p.z);
        const k = compress(r) / r;
        segments.push(p.x * k, p.y * k, p.z * k);
        // Fade the far half of each orbit so the ellipse reads as 3D.
        segmentColours.push(c.r * 0.8, c.g * 0.8, c.b * 0.8);
      }
    }
  }
  const orbitGeometry = new BufferGeometry();
  orbitGeometry.setAttribute('position', new BufferAttribute(new Float32Array(segments), 3));
  orbitGeometry.setAttribute('color', new BufferAttribute(new Float32Array(segmentColours), 3));
  const orbitMaterial = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  scene.add(new LineSegments(orbitGeometry, orbitMaterial));

  // ---- planets ------------------------------------------------------------
  const count = PLANETS.length;
  const planetPositions = new Float32Array(count * 3);
  const planetColours = new Float32Array(count * 3);
  const planetSizes = new Float32Array(count);
  PLANETS.forEach((planet, i) => {
    const c = new Color(planet.colour);
    planetColours[i * 3 + 0] = c.r;
    planetColours[i * 3 + 1] = c.g;
    planetColours[i * 3 + 2] = c.b;
    planetSizes[i] = planet.size;
  });

  const planetGeometry = new BufferGeometry();
  const positionAttr = new BufferAttribute(planetPositions, 3);
  positionAttr.setUsage(35048); // DynamicDrawUsage
  planetGeometry.setAttribute('position', positionAttr);
  planetGeometry.setAttribute('aColour', new BufferAttribute(planetColours, 3));
  planetGeometry.setAttribute('aSize', new BufferAttribute(planetSizes, 1));
  planetGeometry.boundingSphere = new Sphere(new Vector3(), 40);

  const planetMaterial = new ShaderMaterial({
    vertexShader: planetVert,
    fragmentShader: planetFrag,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uPixelRatio: { value: renderer.getPixelRatio() },
      uBodyScale: { value: params.size ?? 130 },
    },
  });
  scene.add(new Points(planetGeometry, planetMaterial));

  // ---- the Sun ------------------------------------------------------------
  const sunGeometry = new BufferGeometry();
  sunGeometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
  sunGeometry.setAttribute('aSize', new BufferAttribute(new Float32Array([3.4]), 1));
  sunGeometry.setAttribute('aColour', new BufferAttribute(new Float32Array([1, 1, 1]), 3));
  sunGeometry.boundingSphere = new Sphere(new Vector3(), 1);
  const sunMaterial = new ShaderMaterial({
    vertexShader: planetVert,
    fragmentShader: sunFrag,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uPixelRatio: { value: renderer.getPixelRatio() },
      uBodyScale: { value: params.size ?? 130 },
      uTime: { value: 0 },
    },
  });
  scene.add(new Points(sunGeometry, sunMaterial));

  const tilt = new Vector2(0, 0);
  let daysPerSecond = params.speed ?? DAYS_PER_SECOND;
  let orbitRadius = params.zoom ?? 16.0;
  const background = new Color(0x03040a);

  function render(time, dt, pointer) {
    // Advance simulated time from today's real epoch.
    const T = T0 + (time * daysPerSecond) / 36525;

    PLANETS.forEach((planet, i) => {
      const p = heliocentric(planet, T);
      const k = compress(p.r) / p.r;
      planetPositions[i * 3 + 0] = p.x * k;
      planetPositions[i * 3 + 1] = p.y * k;
      planetPositions[i * 3 + 2] = p.z * k;
    });
    positionAttr.needsUpdate = true;
    sunMaterial.uniforms.uTime.value = time;

    const tx = pointer.active ? pointer.x : 0;
    const ty = pointer.active ? pointer.y : 0;
    tilt.x += (tx - tilt.x) * 0.04;
    tilt.y += (ty - tilt.y) * 0.04;

    // Slow drift around the ecliptic; the pointer raises and lowers the view.
    const angle = time * 0.045 + tilt.x * 0.7;
    const elevation = 6.8 + tilt.y * 4.5;
    const radius = orbitRadius;
    camera.position.set(Math.sin(angle) * radius, Math.cos(angle) * radius, elevation);
    camera.up.set(0, 0, 1);              // z is ecliptic north here
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  function resize(w, h) {
    camera.aspect = w / h;
    // Shift the whole frustum left so the system renders right-of-centre, clear
    // of the readout. Only worth doing when there is room for it.
    const bias = w > 760 ? -w * 0.17 : 0;
    camera.setViewOffset(w, h, bias, 0, w, h);
    camera.updateProjectionMatrix();
    planetMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    sunMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  }

  function dispose() {
    orbitGeometry.dispose();
    orbitMaterial.dispose();
    planetGeometry.dispose();
    planetMaterial.dispose();
    sunGeometry.dispose();
    sunMaterial.dispose();
  }

  function setParams(next) {
    if (next.speed !== undefined) daysPerSecond = next.speed;
    if (next.zoom !== undefined) orbitRadius = next.zoom;
    if (next.size !== undefined) {
      planetMaterial.uniforms.uBodyScale.value = next.size;
      sunMaterial.uniforms.uBodyScale.value = next.size;
    }
  }

  return { render, resize, dispose, setParams, background };
}
