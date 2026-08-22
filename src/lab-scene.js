// <lab-scene name="driftfield"></lab-scene>
//
// A custom element that renders one WebGL scene. Drop the tag on a page, give it
// a name, and it handles the rest: loading the scene, sizing the canvas, running
// the render loop, pausing when scrolled out of view, and cleaning up after
// itself when removed from the page.
//
//   <script type="module" src="/assets/lab.js"></script>
//   <lab-scene name="gyroid" style="height: 60vh"></lab-scene>
//
// ---------------------------------------------------------------------------
// ADDING A NEW SCENE
// ---------------------------------------------------------------------------
// 1. Create src/scenes/<yourname>.js
// 2. Export `meta` and `create` (see the contract below)
// 3. Add it to SCENES in this file
// 4. npm run build
//
// That is the whole process. You do not need to touch the element, the gallery
// page, or the build config.
//
// ---------------------------------------------------------------------------
// THE SCENE CONTRACT
// ---------------------------------------------------------------------------
// Every file in src/scenes/ exports exactly two things:
//
//   export const meta = {
//     title: 'Driftfield',            // shown in the gallery
//     tags:  ['gpgpu', 'curl noise'], // shown as pills
//     blurb: 'One paragraph...',      // shown under the title
//     stats: { particles: '262,144' },// optional key/value readout
//     params: {                       // optional tweakable knobs
//       speed: { label: 'Flow speed', type: 'range', min: 0.1, max: 1.5, step: 0.01, value: 0.48 },
//       tint:  { label: 'Tint', type: 'color', value: '#7fb0ff' },
//     },
//   };
//
// Anything declared in `params` becomes an HTML attribute on the element:
//
//   <lab-scene name="driftfield" speed="0.9" tint="#ff8844"></lab-scene>
//
// Attributes are read on load and watched afterwards, so changing one at
// runtime updates the live scene without rebuilding it.
//
//   export function create({ renderer, width, height, params }) {
//     // Build your scene here. You are handed a live THREE.WebGLRenderer.
//     return {
//       render(time, dt, pointer) { renderer.render(scene, camera); },
//       resize(w, h) { ... },        // optional
//       setParams(next) { ... },     // optional: apply changed params live
//       dispose() { ... },           // REQUIRED: free geometries/materials/targets
//       background: new Color(0x04050a), // optional canvas clear colour
//     };
//   }
//
// `render` is called once per frame and is responsible for calling
// renderer.render() itself. That is deliberate: it lets a scene do multi-pass
// work (Driftfield runs a simulation pass into a texture before drawing).
//
// `pointer` is { x, y, active } with x/y in clip space (-1..1) and active
// false when the cursor has left the element.
//
// ---------------------------------------------------------------------------
// ONE RENDERER PER ELEMENT
// ---------------------------------------------------------------------------
// Each <lab-scene> owns a WebGL context. Browsers allow roughly sixteen live
// contexts and silently evict the oldest beyond that, so do not put a dozen of
// these on one page. For a grid of many animated tiles, use one shared canvas
// behind the grid instead -- src/cards.js does exactly that.

import { WebGLRenderer, Color } from 'three';

// Scenes are lazily imported, so a page only downloads the one it shows.
const SCENES = {
  driftfield: () => import('./scenes/driftfield.js'),
  gyroid: () => import('./scenes/gyroid.js'),
  chroma: () => import('./scenes/chroma.js'),
  lattice: () => import('./scenes/lattice.js'),
  orrery: () => import('./scenes/orrery.js'),
};

export const SCENE_NAMES = Object.keys(SCENES);

/** Load a scene's `meta` without building the scene itself. */
export async function loadMeta(name) {
  const mod = await SCENES[name]?.();
  return mod?.meta ?? null;
}

/**
 * Turn an attribute string into the type the scene expects. Attributes are
 * always strings; a scene wants numbers and booleans.
 */
function coerce(spec, raw) {
  if (raw === null || raw === undefined || raw === '') return spec.value;
  if (spec.type === 'range') {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return spec.value;
    const lo = spec.min ?? -Infinity;
    const hi = spec.max ?? Infinity;
    return Math.min(hi, Math.max(lo, n));
  }
  if (spec.type === 'toggle') return raw !== 'false' && raw !== '0';
  return raw; // colour, or anything else the scene wants as a string
}

/** Merge declared defaults with whatever attributes are actually set. */
export function readParams(schema, element) {
  const out = {};
  for (const [key, spec] of Object.entries(schema ?? {})) {
    out[key] = coerce(spec, element.getAttribute(key));
  }
  return out;
}

export class LabScene extends HTMLElement {
  // `name` is the only fixed attribute. Param attributes vary per scene and are
  // not known until a scene module loads, so they are watched with a
  // MutationObserver instead of this static list.
  static observedAttributes = ['name'];

  #canvas = null;
  #renderer = null;
  #scene = null;        // the active scene instance
  #raf = null;
  #elapsed = 0;
  #lastMs = 0;
  #visible = false;
  #token = 0;           // guards against out-of-order async loads
  #pointer = { x: 0, y: 0, active: false };
  #observers = [];
  #reduceMotion = false;
  #booted = false;
  #schema = null;

  connectedCallback() {
    if (this.#canvas) return; // already set up; a move in the DOM re-fires this

    this.#reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Light DOM would let page CSS accidentally restyle the canvas, so the
    // element keeps its own.
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { display: block; position: relative; contain: content; }
        canvas { display: block; width: 100%; height: 100%; }
      </style>
      <canvas part="canvas"></canvas>`;
    this.#canvas = root.querySelector('canvas');

    // Nothing is created until the element is near the viewport. A page can
    // hold more of these than the browser's WebGL context limit, so long as
    // they are not all on screen together.
    const io = new IntersectionObserver((entries) => {
      this.#visible = entries[entries.length - 1].isIntersecting;
      if (this.#visible) {
        this.#boot();
        this.#start();
      } else {
        this.#stop();
      }
    }, { rootMargin: '128px' });
    io.observe(this);
    this.#observers.push(() => io.disconnect());

    const ro = new ResizeObserver(() => this.#resize());
    ro.observe(this);
    this.#observers.push(() => ro.disconnect());

    const onMove = (e) => {
      const r = this.getBoundingClientRect();
      this.#pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.#pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.#pointer.active = true;
    };
    const onLeave = () => { this.#pointer.active = false; };
    this.addEventListener('pointermove', onMove, { passive: true });
    this.addEventListener('pointerleave', onLeave);
    this.#observers.push(() => {
      this.removeEventListener('pointermove', onMove);
      this.removeEventListener('pointerleave', onLeave);
    });

    const onVisibility = () => (document.hidden ? this.#stop() : this.#visible && this.#start());
    document.addEventListener('visibilitychange', onVisibility);
    this.#observers.push(() => document.removeEventListener('visibilitychange', onVisibility));

    // Param attributes are scene-specific, so watch every attribute and filter
    // against the loaded scene's schema.
    const mo = new MutationObserver((records) => {
      if (!this.#schema || !this.#scene?.setParams) return;
      if (records.some((r) => r.attributeName !== 'name' && r.attributeName in this.#schema)) {
        this.#scene.setParams(readParams(this.#schema, this));
      }
    });
    mo.observe(this, { attributes: true });
    this.#observers.push(() => mo.disconnect());
  }

  /** Create the WebGL context and load the scene. Runs once, on first sighting. */
  #boot() {
    if (this.#booted || !this.#canvas) return;
    this.#booted = true;

    try {
      this.#renderer = new WebGLRenderer({ canvas: this.#canvas, antialias: false, alpha: false });
    } catch {
      // No WebGL. Signal it so CSS can show a fallback, and stop.
      this.dataset.state = 'unsupported';
      return;
    }
    this.#renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.#load(this.getAttribute('name'));
  }

  disconnectedCallback() {
    this.#stop();
    this.#observers.forEach((off) => off());
    this.#observers = [];
    this.#scene?.dispose?.();
    this.#scene = null;
    this.#renderer?.dispose();
    this.#renderer = null;
    this.#canvas = null;
    this.#booted = false;
  }

  attributeChangedCallback(attr, previous, next) {
    if (attr === 'name' && previous !== next && this.#renderer) this.#load(next);
  }

  get sceneName() { return this.getAttribute('name'); }
  set sceneName(value) { this.setAttribute('name', value); }

  /** The active scene's param schema, or null while nothing is loaded. */
  get paramSchema() { return this.#schema; }

  /** Current param values, defaults merged with any attributes that are set. */
  get params() { return readParams(this.#schema, this); }

  async #load(name) {
    if (!name || !SCENES[name]) {
      this.dataset.state = 'error';
      return;
    }
    const token = ++this.#token;
    this.dataset.state = 'loading';

    const module = await SCENES[name]();
    // A newer load started while this one was in flight; drop this result.
    if (token !== this.#token || !this.#renderer) return;

    this.#scene?.dispose?.();

    const { width, height } = this.#size();
    this.#renderer.setSize(width, height, false);
    this.#schema = module.meta?.params ?? null;
    this.#scene = module.create({
      renderer: this.#renderer,
      width,
      height,
      params: readParams(this.#schema, this),
    });

    this.#renderer.setClearColor(this.#scene.background ?? new Color(0x04050a), 1);
    this.#scene.resize?.(width, height);

    this.dataset.state = 'ready';
    this.dispatchEvent(new CustomEvent('scene-ready', {
      detail: { name, meta: module.meta },
      bubbles: true,
    }));

    if (this.#visible) this.#start();
    else this.#renderFrame(); // paint one frame so it is not blank before scroll
  }

  #size() {
    // A zero-sized box makes camera aspect NaN and blanks the canvas.
    return {
      width: Math.max(1, this.clientWidth || 1),
      height: Math.max(1, this.clientHeight || 1),
    };
  }

  #resize() {
    if (!this.#renderer) return;
    const { width, height } = this.#size();
    this.#renderer.setSize(width, height, false);
    this.#scene?.resize?.(width, height);
  }

  #renderFrame() {
    if (!this.#scene) return;
    const now = performance.now();
    const dt = Math.min((now - this.#lastMs) / 1000, 1 / 30);
    this.#lastMs = now;
    this.#elapsed += this.#reduceMotion ? dt * 0.1 : dt;
    this.#scene.render(this.#elapsed, dt, this.#pointer);
  }

  #start() {
    if (this.#raf !== null || !this.#scene || document.hidden) return;
    this.#lastMs = performance.now();
    const tick = () => {
      this.#raf = requestAnimationFrame(tick);
      this.#renderFrame();
    };
    tick();
  }

  #stop() {
    if (this.#raf === null) return;
    cancelAnimationFrame(this.#raf);
    this.#raf = null;
  }
}

if (!customElements.get('lab-scene')) {
  customElements.define('lab-scene', LabScene);
}
