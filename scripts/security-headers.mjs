/** Local asset policy also applies to dedicated worker responses. */
export const productionCsp = [
  "default-src 'self'",
  "connect-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
  "form-action 'none'",
].join("; ");
// Vite's React refresh preamble is inline; its HMR socket remains loopback-only.
export const developmentCsp = productionCsp
  .replace(
    "connect-src 'self'",
    "connect-src 'self' ws://localhost:5173 ws://127.0.0.1:5173",
  )
  .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
export const securityHeaders = {
  "Content-Security-Policy": productionCsp,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
};
