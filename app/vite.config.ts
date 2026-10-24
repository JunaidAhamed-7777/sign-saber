import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import glsl from 'vite-plugin-glsl';

// See docs/02-architecture.md §Build & tooling.
// - Workers are bundled via `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`.
// - MediaPipe WASM + models are served from /models (app/public/models), populated by `npm run models`.
// - No cross-origin isolation headers are needed (no SharedArrayBuffer).
export default defineConfig({
  plugins: [react(), glsl()],
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
});
