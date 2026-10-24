import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkDocs, headingIds } from './check-docs.mjs';

test('heading fragments cover code, symbols, duplicate names and explicit IDs', () => {
  const ids = headingIds('# Audio → `SongClock`\n## Timing & sync\n## Timing & sync\n<a id="custom"></a>\n```md\n# Fake\n```');
  assert.deepEqual([...ids], ['audio--songclock', 'timing--sync', 'timing--sync-1', 'custom']);
});

test('validates paths, fragments, references and encoded filenames; ignores code and dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'sign-saber-docs-'));
  try {
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', 'README.md'), '[bad](missing.md)');
    writeFileSync(join(root, 'two words.md'), '# Target\n## Repeated\n## Repeated');
    writeFileSync(join(root, 'README.md'), '# Home\n[ok](two%20words.md#repeated-1)\n[ref][t]\n[t]: <two words.md#target>\n`[code](absent.md)`\n```md\n[code](also-absent.md)\n```\n[web](https://example.com)');
    assert.deepEqual(checkDocs(root).errors, []);
    writeFileSync(join(root, 'bad.md'), '[missing](absent.md)\n[fragment](README.md#absent)\n[encoding](%zz)\n[ref][missing]');
    const result = checkDocs(root);
    assert.equal(result.errors.length, 4);
    assert.match(result.errors[0], /undefined reference|missing path/);
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL('./check-docs.mjs', import.meta.url)), root], { encoding: 'utf8' });
    assert.equal(cli.status, 1, 'broken docs must fail CI');
    assert.match(cli.stdout, /4 errors/);
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('sign-saber-docs-'));
    rmSync(root, { recursive: true, force: true });
  }
});
