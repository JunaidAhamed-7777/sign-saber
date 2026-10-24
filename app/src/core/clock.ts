/** Worker and main performance clocks may have different origins. All values are ms. */
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60000;
export function normalizeWorkerTime(workerTime: number, workerOrigin: number, mainOrigin: number): number {
  if (![workerTime, workerOrigin, mainOrigin].every(Number.isFinite))
    throw new Error('Non-finite clock timestamp');
  return workerTime + workerOrigin - mainOrigin;
}
export const secondsToMs = (seconds: number): number => seconds * MS_PER_SECOND;
export const msToSeconds = (ms: number): number => ms / MS_PER_SECOND;
