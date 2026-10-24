/** Original stroke icons for the gesture vocabulary; text labels always accompany them. */
export type GestureIconName = 'open' | 'fist' | 'point' | 'lean' | 'none';
const PATHS: Record<GestureIconName, string> = {
  open: 'M7 13V6.5a1.5 1.5 0 0 1 3 0V11M10 11V4.5a1.5 1.5 0 0 1 3 0V11M13 11V5.5a1.5 1.5 0 0 1 3 0V12M16 12V8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7l-2.3-3.7a1.5 1.5 0 0 1 2.5-1.7L7 14',
  point:
    'M10 14V4.5a1.5 1.5 0 0 1 3 0V11M13 11a1.5 1.5 0 0 1 3 0v1M16 12a1.5 1.5 0 0 1 3 0v3a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7l-2.3-3.7a1.5 1.5 0 0 1 2.5-1.7L10 16',
  fist: 'M6 10a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5ZM10 8v3.5M14 8v3.5M6 12.5h6.5',
  lean: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
  none: 'M7 12h10',
};
export function GestureIcon({ name, className }: { name: GestureIconName; className?: string | undefined }) {
  return (
    <svg
      className={className ? `gesture-icon ${className}` : 'gesture-icon'}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
