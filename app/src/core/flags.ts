/**
 * Sign Saber — core/flags.ts
 *
 * Responsibility: Reads URL query flags once at boot (?replay, ?tier, ?probe, ?contrast, ?seg, ?difficulty) and exposes a frozen Flags object; registers dev-only debug keys (D, Q, H, R).
 * Spec: docs/02-architecture.md §Runtime flags & debug keys
 * Inputs: window.location.search, keydown events
 * Outputs: Flags, debug key callbacks
 *
 * Implementation follows ROADMAP.md phase gates. This file documents the module contract only.
 */
export {};
