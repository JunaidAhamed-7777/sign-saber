import { createRoot } from 'react-dom/client';
import { App } from './App';
import { GameRuntime } from './core/runtime';
import './ui/theme.css';
const runtime = new GameRuntime(document.getElementById('app')!);
// Dev builds expose the runtime for console debugging (window.signSaber); production does not.
if (import.meta.env.DEV) Object.assign(window, { signSaber: runtime });
createRoot(document.getElementById('hud')!).render(<App runtime={runtime} />);
void runtime.boot();
if (import.meta.hot) import.meta.hot.dispose(() => runtime.dispose());
