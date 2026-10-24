import type { GameRuntime } from '../../core/runtime';
import { useStore } from '../../state/store';
import { strings as t } from '../strings';
import { Button } from '../components/MenuShell';
/** Loading is indeterminate: the catalog request has no known denominator, so no percentage is invented. */
export function Boot({ runtime }: { runtime: GameRuntime }) {
  const fatal = useStore((s) => s.fatal);
  return (
    <main className="boot">
      <div className="boot-mark" aria-hidden="true">
        <svg viewBox="0 0 120 120">
          <circle className="boot-ring" cx="60" cy="60" r="52" />
          <path className="boot-saber" d="M30 90L90 30" />
          <path className="boot-saber dim" d="M30 62L62 30M58 90L90 58" />
        </svg>
      </div>
      <h1 className="boot-title">{t.title}</h1>
      <p className="boot-tagline">{t.bootTagline}</p>
      {fatal ? (
        <div className="notice danger boot-error" role="alert">
          <strong>{t.bootErrorTitle}</strong>
          <p>{t.fatalHint}</p>
          <p className="detail">{fatal}</p>
          <a className="btn primary" href="/">
            {t.retry}
          </a>
        </div>
      ) : (
        <div className="boot-progress">
          <span className="meter indeterminate" aria-hidden="true">
            <i />
          </span>
          <p role="status">{t.bootLoading}</p>
          <Button runtime={runtime} id="library-retry" className="quiet">
            {t.retry}
          </Button>
        </div>
      )}
    </main>
  );
}
