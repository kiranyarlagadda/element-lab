# element-lab

Hand-written WebGL scenes, wrapped in a custom element you can drop anywhere.

```html
<script type="module">import 'element-lab';</script>

<lab-scene name="driftfield" style="height: 60vh"></lab-scene>
```

That is the whole API. Until the element is near the viewport it creates
nothing: no WebGL context, no scene module fetched. Once visible it sizes
itself and runs the render loop, **pauses while scrolled off screen**, and
disposes its GPU resources when removed from the DOM.

## Scenes

| `name` | What it is |
|---|---|
| `driftfield` | 262,144 particles whose positions live in a floating-point texture, advected through a divergence-free curl-noise field. The CPU never touches a particle. |
| `gyroid` | A raymarched gyroid minimal surface. Two triangles cover the screen; normals, soft shadows and ambient occlusion all come from the same distance function. |
| `chroma` | An icosphere displaced by fractal noise, with normals rebuilt per vertex from the displaced neighbourhood rather than left stale. |
| `lattice` | 18,000 billboarded dots in a single instanced call. Designed to sit behind a headline and stay legible. |
| `orrery` | The real solar system. Positions come from NASA/JPL Keplerian elements solved through Kepler's equation, so the planets are where they actually are today. |
| `cabinet` | A dark room with a glowing arcade cabinet. The camera flies in until the screen fills the viewport, easing to a dead stop so a page can fade its own UI in over it. |

## Configuring a scene

Every scene declares a set of parameters, and each one is an attribute:

```html
<lab-scene name="driftfield" speed="0.9" scale="2.4" size="7"></lab-scene>
```

Attributes are read when the scene loads and watched afterwards, so changing one
at runtime updates the running scene in place. Nothing rebuilds.

```js
el.setAttribute('speed', '1.2');   // takes effect on the next frame
```

| Scene | Parameters |
|---|---|
| `driftfield` | `speed` `scale` `size` `decay` |
| `gyroid` | `thickness` `scale` `speed` |
| `chroma` | `amp` `freq` `speed` |
| `lattice` | `amp` `size` `speed` |
| `orrery` | `speed` `size` `zoom` |
| `cabinet` | `zoom` `sway` `glow` `scan` `dust` |

Read the schema at runtime to build your own controls:

```js
el.paramSchema;   // { speed: { label, type, min, max, step, value }, ... }
el.params;        // current values, defaults merged with any attributes set
```

Anything you leave off falls back to the scene's default, so the bare tag always
works.

## Install

```bash
npm install github:kiranyarlagadda/element-lab#v0.1.0
```

`three` is a **peer dependency**, so the package uses whatever copy your app
already has and you never ship two.

```bash
npm install three
```

The package ships as ES source, not a prebuilt bundle. Your bundler tree-shakes
and minifies it alongside the rest of your app.

## Running the demo

```bash
npm install
npm run dev      # http://localhost:5180
```

## API

Dropping the tag is usually enough. The named exports exist for building your
own UI around it:

```js
import { SCENE_NAMES, loadMeta } from 'element-lab';

SCENE_NAMES;                    // ['driftfield', 'gyroid', ...]
await loadMeta('gyroid');       // { title, tags, blurb, stats } without building the scene
```

The element emits `scene-ready` (bubbling) once a scene is built:

```js
el.addEventListener('scene-ready', (e) => {
  console.log(e.detail.name, e.detail.meta.title);
});
```

It also reflects progress on `data-state`: `loading`, `ready`, `error`, or
`unsupported` when there is no WebGL context. Style that last one to provide a
fallback.

## One renderer per element

Each `<lab-scene>` owns a WebGL context once it boots. Browsers allow roughly
sixteen live contexts and silently evict the oldest beyond that.

Because contexts are created on first sighting rather than on page load, a long
page can hold plenty of these. The demo page has five. What you must avoid is
**a dozen visible at once**. For a grid of many animated tiles, render one shared
canvas behind the grid instead and position quads to match each tile's
`getBoundingClientRect()`.

## Adding a scene

1. Create `src/scenes/yourscene.js`
2. Export `meta` and `create`. The contract is documented at the top of
   `src/lab-scene.js`
3. Register it in the `SCENES` map in `src/lab-scene.js`

```js
export const meta = { title, tags, blurb, stats };

export function create({ renderer, width, height }) {
  return {
    render(time, dt, pointer) { renderer.render(scene, camera); },
    resize(w, h) {},
    dispose() {},          // required: free geometries, materials, render targets
    background,            // optional THREE.Color for the clear colour
  };
}
```

`render` calls `renderer.render()` itself on purpose: it lets a scene do
multi-pass work. `driftfield` runs a simulation pass into a texture before
drawing anything.

## Things that will bite you

- **GLSL `smoothstep(a, b, x)` is undefined when `a >= b`.** It happens to work
  on most drivers, which is exactly why it is dangerous. Write
  `1.0 - smoothstep(b, a, x)`. `npm run check` fails the build on this. It had
  already shipped in two scenes before the check existed.
- **Y is flipped between DOM and WebGL.** DOM Y grows downward, world Y grows
  upward. Negating Y mirrors geometry, which reverses triangle winding and makes
  everything back-facing, so you get a draw call that reports triangles and
  paints nothing. Use `side: DoubleSide` for screen-aligned quads.
- **A zero-sized canvas makes camera aspect `NaN`** and silently blanks
  everything. The element clamps to a 1px minimum.

## Data

`orrery` uses Keplerian elements from NASA/JPL Solar System Dynamics,
[Approximate Positions of the Major Planets](https://ssd.jpl.nasa.gov/planets/approx_pos.html)
(Table 1, valid 1800–2050). A US government work, in the public domain.

## Licence

MIT
