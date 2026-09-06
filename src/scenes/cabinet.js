import * as THREE from 'three';
import { hash } from '../lib/glsl.js';

// Site palette. The screen and the marquee are the only things allowed to be
// bright in here -- everything else exists to catch their light.
const GROUND = 0x04050a;
const INK = 0xeef1f8;
const AMBER = 0xffb454;
const BLUE = 0x7fb0ff;
const FAINT = 0x5c6478;

// The screen is the thing the zoom parameter aims at, so its size and position
// are constants rather than buried in the mesh-building code below.
const SCREEN_W = 0.52;
const SCREEN_H = 0.39; // 4:3, matches the cabinet's real screen aspect
const SCREEN_Y = 0.9;
const BEZEL_Z = 0.34;
const BEZEL_TILT_DEG = -6; // top tilts back a touch
// A plain BoxGeometry has no hole in it, so there is no real cavity to recess
// the screen into. Sitting it just past the bezel's most-forward point (its
// tilted front face is closest to the camera at the bottom edge) is the cheap
// equivalent: close enough to read as "inside the frame" without the bezel's
// own opaque face hiding it.
const SCREEN_Z = 0.44;
const FOV = 50;

const MARQUEE_EMISSIVE = 1.4;
const POINT_LIGHT_BASE = 1.6;

export const meta = {
  id: 'cabinet',
  title: 'Cabinet',
  tags: ['three', 'glsl', 'scene'],
  blurb:
    'The arcade intro: a dark room, one glowing cabinet, and a camera that walks up to the ' +
    'screen until the screen is the whole page. The attract-mode dots keep pacing their grid ' +
    'whether or not anyone is watching.',
  stats: { triangles: '44', 'draw calls': '8' },
  params: {
    zoom: { label: 'Zoom', type: 'range', min: 0, max: 1, step: 0.01, value: 0 },
    sway: { label: 'Camera sway', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35 },
    glow: { label: 'Glow', type: 'range', min: 0, max: 2, step: 0.01, value: 1 },
    scan: { label: 'Scanlines', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5 },
    dust: {
      label: 'Dust motes',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.6,
      structural: true, // rebuilds the Points geometry rather than nudging a uniform
    },
  },
};

// ---------------------------------------------------------------------------
// Floor: a flat shaded plane faking the glow the screen would actually throw
// onto the carpet in front of it, plus a grid that reads as an arcade floor.
// ---------------------------------------------------------------------------
const floorVert = /* glsl */ `
  varying vec2 vGround; // world-space XZ, so the fragment shader knows real distances

  void main(){
    vGround = (modelMatrix * vec4(position, 1.0)).xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const floorFrag = /* glsl */ `
  precision highp float;

  uniform vec3  uGround;
  uniform vec3  uGlowColor;
  uniform float uGlow;
  uniform float uTime;
  varying vec2  vGround;

  void main(){
    float d = length(vGround);

    // The cabinet faces +Z, so "in front of it" is the positive side. Bias
    // the glow that way instead of spreading it evenly in a circle.
    float forward = smoothstep(-2.0, 3.0, vGround.y);
    float pulse = 0.92 + 0.08 * sin(uTime * 0.6);
    float glow = (1.0 - smoothstep(0.6, 3.5, d)) * mix(0.06, 0.28, forward) * pulse;

    // Faint carpet grid, thin lines every half metre, fading before the edge
    // of the plane so there is no visible seam against the clear colour.
    vec2 g = abs(fract(vGround * 2.0) - 0.5);
    float line = max(1.0 - smoothstep(0.02, 0.05, g.x), 1.0 - smoothstep(0.02, 0.05, g.y));
    line *= 1.0 - smoothstep(2.0, 12.0, d);

    vec3 col = uGround + uGlowColor * glow * uGlow + vec3(0.5, 0.55, 0.65) * line * 0.04;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Screen: attract-mode content. A 3x3 grid of dots with one lit and walking,
// scanlines, a barrel-curved edge and a bit of noise so it reads as alive.
// ---------------------------------------------------------------------------
const screenVert = /* glsl */ `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const screenFrag = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uScan;
  uniform float uGlow;
  uniform vec3  uAmber;
  uniform vec3  uBlue;
  varying vec2  vUv;

  ${hash}

  // Cheap barrel distortion. Cheaper than it looks: one dot product.
  vec2 curveUv(vec2 uv){
    vec2 c = uv * 2.0 - 1.0;
    c *= 1.0 + 0.12 * dot(c, c);
    return c * 0.5 + 0.5;
  }

  void main(){
    vec2 uv = curveUv(vUv);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Three by three dot grid -- the cabinet's mark. One dot walks the grid
    // roughly once a second so the screen never looks paused.
    vec2 cell = floor(uv * 3.0);
    vec2 local = fract(uv * 3.0) - 0.5;
    float dotShape = 1.0 - smoothstep(0.16, 0.30, length(local));

    float index = cell.y * 3.0 + cell.x;
    float activeIndex = mod(floor(uTime * 1.1), 9.0);
    float lit = 1.0 - step(0.5, abs(index - activeIndex));
    float pulse = 0.75 + 0.25 * sin(uTime * 6.0);

    vec3 dim = vec3(0.14, 0.17, 0.24);
    vec3 litColor = uAmber * (1.0 + 0.4 * pulse);
    vec3 col = vec3(0.01, 0.015, 0.02) + dotShape * mix(dim, litColor, lit);

    // Scanlines, tinted faintly blue in the gaps between them.
    float scanline = 0.5 + 0.5 * sin(uv.y * 260.0);
    col *= mix(1.0, 0.82 + 0.18 * scanline, uScan);
    col += uBlue * (1.0 - scanline) * 0.025 * uScan;

    // Phosphor flicker plus a little animated grain so the tube never looks
    // like a static texture.
    float flicker = 0.97 + 0.02 * sin(uTime * 33.0) + 0.01 * hash11(floor(uTime * 14.0));
    float grain = hash11(dot(uv * 512.0, vec2(12.9898, 78.233)) + uTime * 47.0) - 0.5;
    col *= flicker;
    col += grain * 0.03;

    // Vignette to sell the curved glass.
    vec2 vc = vUv * 2.0 - 1.0;
    float vig = 1.0 - smoothstep(0.55, 1.05, dot(vc, vc));
    col *= mix(0.55, 1.0, vig);

    vec3 base = vec3(0.01, 0.015, 0.02);
    col = base + (col - base) * uGlow;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Glow: additive planes sitting just proud of the bezel and marquee faces, so
// the cabinet reads as the thing lighting the room instead of a lit prop.
// ---------------------------------------------------------------------------
const glowVert = /* glsl */ `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFrag = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uGlow;
  varying vec2  vUv;
  void main(){
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    // A ring rather than a filled disc: it stays dark over whatever bright
    // thing this plane sits in front of (the screen's own content, the
    // marquee's own emissive face) and only shows as light bleeding onto the
    // surface just past it.
    float ring = smoothstep(0.55, 0.75, r) * (1.0 - smoothstep(0.85, 1.05, r)) * 0.55;
    gl_FragColor = vec4(uColor * ring, ring * uGlow);
  }
`;

// ---------------------------------------------------------------------------
// Dust: a few hundred motes drifting in the light thrown off the screen.
// ---------------------------------------------------------------------------
const dustVert = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelRatio;

  void main(){
    vec3 p = position;
    p.y += sin(uTime * 0.15 + aSeed * 6.2831) * 0.08;
    p.x += sin(uTime * 0.09 + aSeed * 4.0) * 0.05;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(48.0, (1.6 + aSeed * 1.4) * uPixelRatio / max(-mv.z, 0.05));
  }
`;

const dustFrag = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  void main(){
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q) * 2.0;
    if (r > 1.0) discard;
    float a = 1.0 - smoothstep(0.0, 1.0, r);
    gl_FragColor = vec4(uColor, a * a * 0.5);
  }
`;

/** Distance along the screen's normal at which it fills the viewport, cropping
 *  whichever axis has room to spare. Same idea as CSS `background-size: cover`,
 *  just solved for camera distance instead of image scale. */
function coverDistance(width, height) {
  const aspect = width / height;
  const fovTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const byHeight = SCREEN_H / (2 * fovTan);
  const byWidth = SCREEN_W / (2 * fovTan * aspect);
  return Math.max(0.12, Math.min(byHeight, byWidth));
}

function buildDust(count) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * 0.8;
    positions[i * 3 + 1] = SCREEN_Y - 0.32 + Math.random() * 0.67;
    positions[i * 3 + 2] = SCREEN_Z + 0.15 + Math.random() * 1.25;
    seeds[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, SCREEN_Y, SCREEN_Z + 0.7), 2);
  return geometry;
}

export function create({ renderer, width, height, params = {} }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.05, 30);

  let zoom = params.zoom ?? 0;
  let sway = params.sway ?? 0.35;
  let glow = params.glow ?? 1;
  let scan = params.scan ?? 0.5;
  let dustAmount = params.dust ?? 0.6;
  let coverDist = coverDistance(width, height);

  // ---- shared geometry: one quad, one box, scaled per use --------------
  const quad = new THREE.PlaneGeometry(1, 1);
  const box = new THREE.BoxGeometry(1, 1, 1);

  // ---- floor --------------------------------------------------------------
  const floorMaterial = new THREE.ShaderMaterial({
    vertexShader: floorVert,
    fragmentShader: floorFrag,
    uniforms: {
      uGround: { value: new THREE.Color(GROUND) },
      uGlowColor: { value: new THREE.Color(AMBER).lerp(new THREE.Color(BLUE), 0.15) },
      uGlow: { value: glow },
      uTime: { value: 0 },
    },
  });
  const floor = new THREE.Mesh(quad, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.scale.set(26, 26, 1);
  scene.add(floor);

  // ---- cabinet body ---------------------------------------------------
  function boxMaterial(color, roughness) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: roughness + (Math.random() - 0.5) * 0.08,
      metalness: 0.08,
    });
  }

  const bodyMaterial = boxMaterial(0x0b0d14, 0.75);
  const body = new THREE.Mesh(box, bodyMaterial);
  body.scale.set(0.74, 1.3, 0.62);
  body.position.set(0, 0.65, 0);
  scene.add(body);

  const bezelMaterial = boxMaterial(0x0a0c12, 0.7);
  const bezel = new THREE.Mesh(box, bezelMaterial);
  bezel.scale.set(0.64, 0.56, 0.1);
  bezel.position.set(0, SCREEN_Y, BEZEL_Z);
  bezel.rotation.x = THREE.MathUtils.degToRad(BEZEL_TILT_DEG);
  scene.add(bezel);

  const marqueeMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a0f06,
    roughness: 0.6,
    metalness: 0.05,
    emissive: new THREE.Color(AMBER),
    emissiveIntensity: MARQUEE_EMISSIVE * glow,
  });
  const marquee = new THREE.Mesh(box, marqueeMaterial);
  marquee.scale.set(0.68, 0.22, 0.14);
  marquee.position.set(0, 1.41, 0.32);
  scene.add(marquee);

  // ---- screen -------------------------------------------------------------
  const screenMaterial = new THREE.ShaderMaterial({
    vertexShader: screenVert,
    fragmentShader: screenFrag,
    uniforms: {
      uTime: { value: 0 },
      uScan: { value: scan },
      uGlow: { value: glow },
      uAmber: { value: new THREE.Color(AMBER) },
      uBlue: { value: new THREE.Color(BLUE) },
    },
  });
  const screen = new THREE.Mesh(quad, screenMaterial);
  screen.scale.set(SCREEN_W, SCREEN_H, 1);
  screen.position.set(0, SCREEN_Y, SCREEN_Z);
  scene.add(screen);

  // ---- glow: shared material, two meshes ----------------------------------
  const glowMaterial = new THREE.ShaderMaterial({
    vertexShader: glowVert,
    fragmentShader: glowFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(AMBER) },
      uGlow: { value: glow },
    },
  });
  const screenGlow = new THREE.Mesh(quad, glowMaterial);
  screenGlow.scale.set(0.8, 0.6, 1);
  screenGlow.position.set(0, SCREEN_Y, SCREEN_Z - 0.01);
  scene.add(screenGlow);

  const marqueeGlow = new THREE.Mesh(quad, glowMaterial);
  marqueeGlow.scale.set(0.9, 0.34, 1);
  marqueeGlow.position.set(0, 1.41, 0.4);
  scene.add(marqueeGlow);

  // ---- dust ----------------------------------------------------------------
  let dustCount = Math.round(dustAmount * 500);
  let dustGeometry = buildDust(dustCount);
  const dustMaterial = new THREE.ShaderMaterial({
    vertexShader: dustVert,
    fragmentShader: dustFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uColor: { value: new THREE.Color(AMBER).lerp(new THREE.Color(INK), 0.5) },
    },
  });
  let dust = new THREE.Points(dustGeometry, dustMaterial);
  scene.add(dust);

  // ---- lights ---------------------------------------------------------------
  const ambient = new THREE.AmbientLight(FAINT, 0.6);
  scene.add(ambient);

  const pointLight = new THREE.PointLight(AMBER, POINT_LIGHT_BASE * glow, 4, 2);
  pointLight.position.set(0, SCREEN_Y, SCREEN_Z + 0.15);
  scene.add(pointLight);

  // ---- camera ---------------------------------------------------------------
  // At zoom 0 the camera stands back at a slight low angle, above the
  // cabinet's base but below the screen's centre so it looks faintly up at
  // it. Both position axes converge on the screen at zoom 1 -- the low angle
  // "levels out" purely because the camera rises to meet its own look target,
  // no separate pitch tracking needed.
  const CAM_START = new THREE.Vector3(0, 0.35, 3.1);
  const drift = new THREE.Vector2(0, 0);
  const background = new THREE.Color(GROUND);

  function render(time, dt, pointer) {
    floorMaterial.uniforms.uTime.value = time;
    screenMaterial.uniforms.uTime.value = time;
    dustMaterial.uniforms.uTime.value = time;

    const t = THREE.MathUtils.clamp(zoom, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3); // decelerates into the final frame

    const camEnd = SCREEN_Z + coverDist;
    camera.position.set(
      THREE.MathUtils.lerp(CAM_START.x, 0, eased),
      THREE.MathUtils.lerp(CAM_START.y, SCREEN_Y, eased),
      THREE.MathUtils.lerp(CAM_START.z, camEnd, eased),
    );

    // Idle sway and pointer parallax both fade out by zoom 1, so the final
    // frame is dead steady for whatever the page fades in over it.
    const idle = 1 - t;
    camera.position.x += Math.sin(time * 0.35) * 0.1 * sway * idle;
    camera.position.y += Math.cos(time * 0.27) * 0.045 * sway * idle;

    const tx = pointer.active ? pointer.x : 0;
    const ty = pointer.active ? pointer.y : 0;
    drift.x += (tx - drift.x) * 0.05;
    drift.y += (ty - drift.y) * 0.05;
    camera.position.x += drift.x * 0.14 * idle;
    camera.position.y += drift.y * 0.07 * idle;

    camera.lookAt(0, SCREEN_Y, SCREEN_Z);

    renderer.render(scene, camera);
  }

  function resize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    coverDist = coverDistance(w, h);
    dustMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  }

  function dispose() {
    quad.dispose();
    box.dispose();
    floorMaterial.dispose();
    bodyMaterial.dispose();
    bezelMaterial.dispose();
    marqueeMaterial.dispose();
    screenMaterial.dispose();
    glowMaterial.dispose();
    dustGeometry.dispose();
    dustMaterial.dispose();
  }

  function setParams(next) {
    if (next.zoom !== undefined) zoom = next.zoom;
    if (next.sway !== undefined) sway = next.sway;
    if (next.scan !== undefined) {
      scan = next.scan;
      screenMaterial.uniforms.uScan.value = scan;
    }
    if (next.glow !== undefined) {
      glow = next.glow;
      screenMaterial.uniforms.uGlow.value = glow;
      glowMaterial.uniforms.uGlow.value = glow;
      floorMaterial.uniforms.uGlow.value = glow;
      marqueeMaterial.emissiveIntensity = MARQUEE_EMISSIVE * glow;
      pointLight.intensity = POINT_LIGHT_BASE * glow;
    }

    const wantedDust = Number(next.dust);
    if (Number.isFinite(wantedDust)) {
      const wantedCount = Math.round(wantedDust * 500);
      if (wantedCount !== dustCount) {
        dustAmount = wantedDust;
        dustCount = wantedCount;
        const old = dustGeometry;
        dustGeometry = buildDust(dustCount);
        dust.geometry = dustGeometry;
        old.dispose();
      }
    }
  }

  return { render, resize, dispose, setParams, background };
}
