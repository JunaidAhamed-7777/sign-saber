import { useId } from 'react';
import { coverModel, type CoverSource } from '../coverArt';
/** Metadata-seeded geometric sleeves; adjacent title/artist text carries the meaning. */
export function CoverArt({ track, size = 'card' }: { track: CoverSource; size?: 'card' | 'large' }) {
  const id = useId();
  const model = coverModel(track);
  const gradient = `${id}-bg`;
  const shift = model.bars[0]! / 4;
  return (
    <span className={`cover-art cover-${model.accent} cover-${size}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="cover-stop-a" />
            <stop offset="1" className="cover-stop-b" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" fill={`url(#${gradient})`} />
        {model.accent === 'cyan' ? (
          <g transform={`translate(${shift - 6} 0)`}>
            <path d="M-6 58 40-8H58L12 58Z" fill="var(--accent)" opacity=".22" />
            <path d="M7 72 53 6H67L21 72Z" fill="var(--accent)" />
            <path d="M27 72 73 6" fill="none" stroke="var(--text)" strokeWidth="1" opacity=".7" />
            <path d="M-6 48 26 2" fill="none" stroke="var(--accent)" strokeWidth="1" />
            <circle
              cx={model.ringX}
              cy={model.ringY}
              r="18"
              fill="none"
              stroke="var(--accent)"
              opacity=".22"
            />
            <path d="M5 57H22" fill="none" stroke="var(--void)" strokeWidth="3" />
          </g>
        ) : model.accent === 'magenta' ? (
          <g transform={`translate(32 ${30 + shift / 3}) rotate(-24)`}>
            <rect x="-26" y="-26" width="52" height="52" fill="var(--accent)" opacity=".12" />
            <path d="M-26 16V-26H16M26-16V26H-16" fill="none" stroke="var(--accent)" strokeWidth="6" />
            <rect
              x="-15"
              y="-15"
              width="30"
              height="30"
              fill="none"
              stroke="var(--text)"
              strokeWidth="1"
              opacity=".8"
            />
            <rect x="-7" y="-7" width="14" height="14" fill="var(--accent)" />
            <path d="M-34 5H34" stroke="var(--void)" strokeWidth="5" />
            <path d="M-34 7H34" stroke="var(--accent)" strokeWidth="1" />
          </g>
        ) : (
          <g>
            <circle cx={model.ringX - 14} cy="33" r="27" fill="var(--accent)" />
            <circle cx={model.ringX - 14} cy="33" r="19" fill="var(--void)" />
            {model.rings.map((radius) => (
              <circle
                key={radius}
                cx={model.ringX - 14}
                cy="33"
                r={radius / 2 + 7}
                fill="none"
                stroke="var(--accent)"
                strokeWidth=".6"
                opacity=".55"
              />
            ))}
            <circle cx={model.ringX - 14} cy="33" r="3" fill="var(--text)" />
            <path d={`M-4 ${50 + shift} 68 ${9 + shift}`} stroke="var(--void)" strokeWidth="8" />
            <path d={`M-4 ${46 + shift} 68 ${5 + shift}`} stroke="var(--text)" strokeWidth="1" opacity=".7" />
          </g>
        )}
      </svg>
    </span>
  );
}
