/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import glsl from 'vite-plugin-glsl';
import { developmentCsp, securityHeaders } from '../scripts/security-headers.mjs';
import { createStaticHandler } from '../scripts/serve.mjs';

// See docs/02-architecture.md §Build & tooling.
// - Workers are bundled via `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`.
// - MediaPipe WASM + models are served from /models (app/public/models), populated by `npm run models`.
// - No cross-origin isolation headers are needed (no SharedArrayBuffer).
export default defineConfig({
  plugins: [
    {
      name: 'local-model-runtime',
      configureServer(server) {
        if (!server.config.publicDir) return;
        const serve = createStaticHandler({ root: server.config.publicDir });
        // Vite appends ?import to the SDK's dynamic import. Its public middleware
        // skips that query, then transform rejects public JS. Serve the local
        // immutable runtime before either middleware, without SDK code patches.
        server.middlewares.use((request, response, next) => {
          if (!request.originalUrl?.startsWith('/models/')) {
            next();
            return;
          }
          void serve(request, response);
        });
      },
    },
    react(),
    glsl(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
    headers: { ...securityHeaders, 'Content-Security-Policy': developmentCsp },
    hmr: { host: 'localhost', port: 5173 },
  },
  preview: { host: 'localhost', headers: securityHeaders },
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
  // Full-chart replays and real-asset decodes share the host with builds and training; keep
  // timeouts generous so a busy CPU is not reported as a behavioural failure.
  test: { testTimeout: 20000 },
});
