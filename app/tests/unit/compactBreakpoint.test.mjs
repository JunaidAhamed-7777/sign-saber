import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
// CSS media queries cannot import the TypeScript registry, so the stylesheet must mirror it exactly.
describe('compact menu breakpoint registry', () => {
  it('mirrors MENU_COMPACT_MAX_WIDTH_PX / MENU_COMPACT_MAX_HEIGHT_PX in theme.css', () => {
    const constants = readFileSync(new URL('../../src/core/constants.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../src/ui/theme.css', import.meta.url), 'utf8');
    const width = Number(/MENU_COMPACT_MAX_WIDTH_PX = (\d+)/.exec(constants)?.[1]);
    const height = Number(/MENU_COMPACT_MAX_HEIGHT_PX = (\d+)/.exec(constants)?.[1]);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(css).toContain(`@media (max-width: ${width}px), (max-height: ${height}px)`);
    expect(css).toContain(`(min-width: ${width + 1}px)`);
    // No stale compact bound remains in the stylesheet.
    const queries = css
      .split(/\r?\n/)
      .filter((line) => line.startsWith('@media'))
      .join(' ');
    for (const match of queries.matchAll(/max-(width|height): (\d+)px/g)) {
      const value = Number(match[2]);
      if (match[1] === 'width' && value < 1200) expect([width, 1279]).toContain(value);
      if (match[1] === 'height' && value < 700) expect(value).toBe(height);
    }
  });
});
