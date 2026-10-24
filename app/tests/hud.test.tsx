/** Rendered HUD semantics only; these samples are not webcam or gesture-model evidence. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Hud } from '../src/ui/screens/Hud';
import { useStore } from '../src/state/store';
import type * as StoreModule from '../src/state/store';

vi.mock('../src/state/store', async () => {
  const actual = await vi.importActual<typeof StoreModule>('../src/state/store');
  let current = actual.useStore.getState();
  const useStore = Object.assign((selector: (state: typeof current) => unknown) => selector(current), {
    getState: () => current,
    setState: (patch: Partial<typeof current>, replace = false) => {
      current = replace ? (patch as typeof current) : { ...current, ...patch };
    },
  });
  return { useStore };
});
const initial = structuredClone(useStore.getState());
function render(patch: Partial<typeof initial.hud>): string {
  useStore.setState({ hud: { ...useStore.getState().hud, ...patch } });
  return renderToStaticMarkup(<Hud />);
}
beforeEach(() => useStore.setState(structuredClone(initial), true));

describe('hand HUD display contract', () => {
  it('keeps missing dataset hand input unavailable and ignores its stale gesture/charge', () => {
    useStore.setState({ replay: true });
    const html = render({
      leftPresent: false,
      rightPresent: false,
      left: 'point',
      right: 'fist',
      leftCharge: 1,
      rightCharge: 1,
    });
    expect(html.match(/Unavailable/g)).toHaveLength(2);
    expect(html.match(/No hand data/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Left hand status"');
    expect(html).toContain('aria-label="Right hand status"');
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('Beam charged');
    expect(html).not.toContain('gesture-point');
    expect(html).not.toContain('gesture-fist');
  });
  it('labels each measured gesture and side independently with bounded charge arcs', () => {
    const html = render({
      leftPresent: true,
      rightPresent: true,
      left: 'open',
      right: 'point',
      leftCharge: 0.25,
      rightCharge: 0.625,
    });
    expect(html).toContain('hud-hand-left gesture-open');
    expect(html).toContain('hud-hand-right gesture-point');
    expect(html).toContain('Open · slash');
    expect(html).toContain('Point · beam');
    expect(html).toMatch(/aria-label="Left hand beam charge"[^>]*aria-valuenow="25"/);
    expect(html).toMatch(/aria-label="Right hand beam charge"[^>]*aria-valuenow="62"/);
    expect(html).toContain('stroke-dasharray="25 100"');
    expect(html).toContain('stroke-dasharray="62 100"');
    expect(html).toContain('transform="rotate(-90 40 40)"');
  });
  it('shows a full cue only when pointing charge really reaches one', () => {
    let html = render({ leftPresent: true, left: 'point', leftCharge: 0.999 });
    expect(html).toContain('Beam charge 99%');
    expect(html).not.toContain('Beam charged');
    html = render({ leftCharge: 1 });
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('Beam charged');
    html = render({ left: 'open' });
    expect(html).toContain('Beam charge 100%');
    expect(html).not.toContain('Beam charged');
  });
  it('distinguishes a present but unrecognized gesture from an unavailable hand', () => {
    const html = render({
      leftPresent: true,
      left: 'unknown',
      leftCharge: 0,
      rightPresent: true,
      right: 'fist',
      rightCharge: 0,
    });
    expect(html).toContain('hud-hand-left gesture-none');
    expect(html).toContain('No gesture');
    expect(html).toContain('Fist · smash');
    expect(html).not.toContain('Unavailable');
    expect(html).not.toContain('hud-charge-fill');
  });
  it('removes stale charge immediately after presence is lost', () => {
    expect(render({ leftPresent: true, left: 'point', leftCharge: 1 })).toContain('Beam charged');
    const html = render({ leftPresent: false });
    expect(html).not.toContain('Beam charged');
    expect(html).not.toContain('aria-label="Left hand beam charge"');
    expect(html).toContain('No hand data');
  });
  it('keeps invalid display values finite without generating announcements each update', () => {
    const html = render({
      leftPresent: true,
      left: 'point',
      leftCharge: NaN,
      rightPresent: true,
      right: 'point',
      rightCharge: Infinity,
    });
    expect(html.match(/aria-valuenow="0"/g)).toHaveLength(2);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
    expect(html).not.toContain('aria-live=');
    expect(html).toContain('aria-label="Song progress"');
  });
});
