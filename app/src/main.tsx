import { createRoot } from 'react-dom/client';
import { App } from './App';
import { GameRuntime } from './core/runtime';
import './ui/theme.css';
const runtime = new GameRuntime(document.getElementById('app')!);
createRoot(document.getElementById('hud')!).render(<App runtime={runtime} />);
void runtime.boot();
if (import.meta.hot) import.meta.hot.dispose(() => runtime.dispose());
