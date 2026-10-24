/**
 * Sign Saber — utils/hash.ts
 *
 * Responsibility: SHA-256 of file bytes via SubtleCrypto.
 * Spec: docs/09-beatmap-format.md §song.sourceHash
 * Inputs: ArrayBuffer
 * Outputs: hex string
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
export async function sha256(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
