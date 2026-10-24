/**
 * Sign Saber — tracking/workerClient.ts
 *
 * Responsibility: Main-thread wrapper around the worker: protocol typing, buffer ring, latest-frame access, latency stats.
 * Spec: docs/05-tracking-pipeline.md §Worker protocol
 * Inputs: Worker messages
 * Outputs: TrackingFrame | null per render frame
 *
 * Implementation follows ROADMAP.md phase gates. This file documents the module contract only.
 */
export {};
