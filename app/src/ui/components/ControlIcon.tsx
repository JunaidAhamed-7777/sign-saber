/** Small interface symbols share one stroke; gesture symbols remain in GestureIcon. */
export function ControlIcon({ name }: { name: 'back' | 'next' | 'sound' | 'camera' | 'play' | 'check' }) {
  return (
    <svg className="control-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {name === 'back' ? (
        <path d="M19 12H5m6-6-6 6 6 6" />
      ) : name === 'next' ? (
        <path d="M5 12h14m-6-6 6 6-6 6" />
      ) : name === 'sound' ? (
        <>
          <path d="m11 5-5 4H3v6h3l5 4V5Z" />
          <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
        </>
      ) : name === 'camera' ? (
        <>
          <path d="M4 7h4l2-3h4l2 3h4v13H4V7Z" />
          <circle cx="12" cy="13" r="4" />
        </>
      ) : name === 'play' ? (
        <path d="m9 5 11 7-11 7V5Z" />
      ) : (
        <path d="m5 12 4 4L19 6" />
      )}
    </svg>
  );
}
