/**
 * Sign Saber — render/quality.ts
 *
 * Responsibility: Quality tiers (high / medium / low): boot probe, applyTier(tier) that sets pixel ratio, bloom scale, particle counts and feature flags in one place; runtime downgrade rule.
 * Spec: docs/16-performance-budget.md §Quality tiers; docs/03-decisions.md ADR-014
 * Inputs: Probe frame times, rolling FPS, ?tier= / ?probe=1 flags, localStorage ss:tier
 * Outputs: Active QualityTier applied to renderer, postfx, trails, shatter, skeleton
 *
 * Implementation begins at the hackathon kick-off (docs/19-build-plan.md). This file documents the module contract only.
 */
export {};
