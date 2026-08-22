// Importing this module registers the <lab-scene> custom element.
//
//   import 'element-lab';
//   // then, anywhere in your HTML:
//   // <lab-scene name="driftfield"></lab-scene>
//
// The named exports are only needed if you want to build your own UI around it
// (a picker, a router) rather than just dropping tags on a page.

export { LabScene, SCENE_NAMES, loadMeta } from './lab-scene.js';
