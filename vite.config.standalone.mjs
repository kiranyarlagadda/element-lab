import { defineConfig } from 'vite';

// Single-file build: everything in one chunk so it can be inlined into one HTML
// file. inlineDynamicImports is the point -- without it the scenes stay separate
// chunks and a "standalone" file would still fetch them over the network.
export default defineConfig({
  root: 'demo',
  build: {
    outDir: '../dist-standalone',
    emptyOutDir: true,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
