import type { GameRuntime } from '../../core/runtime';
import { useStore } from '../../state/store';
import { strings as t } from '../strings';
import { Button } from '../components/MenuShell';
export function Boot({ runtime }: { runtime: GameRuntime }) {
  const fatal = useStore((s) => s.fatal);
  return (
    <main className="boot">
      <h1>{t.title}</h1>
      {fatal ? (
        <>
          <p role="alert">
            {t.fatalTitle}. {t.fatalHint}
          </p>
          <a className="button" href="/">
            {t.retry}
          </a>
        </>
      ) : (
        <>
          <p role="status">{t.loading}</p>
          <Button runtime={runtime} id="library-retry">
            {t.retry}
          </Button>
        </>
      )}
    </main>
  );
}
