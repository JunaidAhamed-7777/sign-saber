import { useId } from 'react';
import { coverModel, type CoverSource } from '../coverArt';
/** Decorative generated cover; the adjacent title/artist text carries the meaning. */
export function CoverArt({ track, size = 'card' }: { track: CoverSource; size?: 'card' | 'large' }) {
  const id = useId();
  const model = coverModel(track);
  const gradient = `${id}-bg`;
  // Bars span x = 4..60 with gaps of 0.6 bar widths.
  const count = model.bars.length;
  const barWidth = 56 / (count + 0.6 * (count - 1));
  const round = (value: number): number => Math.round(value * 10) / 10;
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
        <g className="cover-rings">
          {model.rings.map((radius) => (
            <circle key={radius} cx={model.ringX} cy={model.ringY} r={radius} />
          ))}
        </g>
        <g className="cover-bars">
          {model.bars.map((height, index) => (
            <rect
              key={index}
              x={round(4 + index * barWidth * 1.6)}
              y={round(60 - height)}
              width={round(barWidth)}
              height={height}
              opacity={round(0.35 + (index / count) * 0.5)}
            />
          ))}
        </g>
        <line
          className="cover-slash-glow"
          x1={model.slash[0]}
          y1={model.slash[1]}
          x2={model.slash[2]}
          y2={model.slash[3]}
        />
        <line
          className="cover-slash"
          x1={model.slash[0]}
          y1={model.slash[1]}
          x2={model.slash[2]}
          y2={model.slash[3]}
        />
        <text className="cover-initial" x="7" y="21">
          {model.initial}
        </text>
      </svg>
    </span>
  );
}
