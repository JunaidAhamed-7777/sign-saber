/**
 * Sign Saber — core/loop.ts
 *
 * Responsibility: requestAnimationFrame loop with the fixed per-frame order: clock → drain tracking → spawn → simulate → hit → score → audio reactive → render → UI.
 * Spec: docs/02-architecture.md §Frame loop
 * Inputs: Subsystem update hooks
 * Outputs: Per-frame orchestration
 *
 * Implementation follows ROADMAP.md phase gates. This file documents the module contract only.
 */
export {};
