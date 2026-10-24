import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
describe('pinned local font assets', () => {
  it('retains exact font and OFL bytes from immutable official sources', () => {
    const root = new URL('../../public/assets/fonts/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
    expect(manifest.version).toBe(1);
    expect(manifest.fonts.map((font) => font.family)).toEqual(['Orbitron', 'Rajdhani']);
    for (const font of manifest.fonts) {
      const bytes = readFileSync(new URL(font.file, root));
      const license = readFileSync(new URL(font.licenseFile, root));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(font.sha256);
      expect(createHash('sha256').update(license).digest('hex')).toBe(font.licenseSha256);
      expect(bytes.subarray(0, 4).toString('hex')).toBe('00010000');
      expect(license.toString('utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(font.sourceUrl).toContain(font.commit);
      expect(font.commit).toMatch(/^[a-f0-9]{40}$/);
    }
  });
});
