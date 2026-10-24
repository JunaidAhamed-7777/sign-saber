#!/usr/bin/env node
// Check repository Markdown paths and heading fragments without network access.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const excluded = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.vite']);

function markdownFiles(root) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && extname(path).toLowerCase() === '.md') files.push(path);
    }
  }
  walk(root);
  return files.sort();
}

function withoutFences(source) {
  let fence;
  return source.split(/\r?\n/).map((line) => {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence && match) {
      fence = { char: match[1][0], length: match[1].length };
      return '';
    }
    if (fence) {
      if (match && match[1][0] === fence.char && match[1].length >= fence.length && !match[2].trim()) fence = undefined;
      return '';
    }
    return line;
  });
}

export function headingIds(source) {
  const ids = new Set();
  const counts = new Map();
  const lines = withoutFences(source);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const match of line.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) ids.add(match[1]);
    const atx = /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+\s*)?$/.exec(line);
    const setext = line.trim() && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1] ?? '');
    const heading = atx?.[1] ?? (setext ? line.trim() : undefined);
    if (heading === undefined) continue;
    const slug = heading.replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&(?:lt|gt|quot|apos);/g, '')
      .toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
    let count = counts.get(slug) ?? 0;
    let id = count === 0 ? slug : `${slug}-${count}`;
    while (ids.has(id)) id = `${slug}-${++count}`;
    counts.set(slug, count + 1);
    ids.add(id);
  }
  return ids;
}

export function checkDocs(root) {
  root = resolve(root);
  const files = markdownFiles(root);
  const errors = [];
  const anchors = new Map();
  let checked = 0;
  for (const file of files) {
    const lines = withoutFences(readFileSync(file, 'utf8'));
    const definitions = new Map();
    for (const line of lines) {
      const def = /^ {0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)/.exec(line);
      if (def) definitions.set(def[1].toLowerCase(), def[2]);
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/(`+).*?\1/g, '');
      const links = [...line.matchAll(/\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\s*\)/g)].map((m) => m[1]);
      for (const match of line.matchAll(/\[([^\]]+)\]\[([^\]]*)\]/g)) {
        const label = (match[2] || match[1]).toLowerCase();
        if (!definitions.has(label)) errors.push(`${relative(root, file)}:${i + 1}: undefined reference [${label}]`);
        else links.push(definitions.get(label));
      }
      for (let target of links) {
        if (target.startsWith('<')) target = target.slice(1, -1);
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
        checked++;
        const hash = target.indexOf('#');
        let path, fragment;
        try {
          path = decodeURIComponent((hash < 0 ? target : target.slice(0, hash)).split('?')[0]);
          fragment = hash < 0 ? '' : decodeURIComponent(target.slice(hash + 1));
        } catch {
          errors.push(`${relative(root, file)}:${i + 1}: invalid URL encoding: ${target}`);
          continue;
        }
        const dest = path ? resolve(path.startsWith('/') ? root : dirname(file), path.replace(/^\//, '')) : file;
        if (!existsSync(dest)) {
          errors.push(`${relative(root, file)}:${i + 1}: missing path: ${target}`);
          continue;
        }
        if (fragment && statSync(dest).isFile() && extname(dest).toLowerCase() === '.md') {
          if (!anchors.has(dest)) anchors.set(dest, headingIds(readFileSync(dest, 'utf8')));
          if (!anchors.get(dest).has(fragment)) errors.push(`${relative(root, file)}:${i + 1}: missing heading: ${target}`);
        }
      }
    }
  }
  return { files: files.length, links: checked, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = checkDocs(root);
  for (const error of result.errors) console.error(error);
  console.log(`Docs: ${result.files} Markdown files, ${result.links} local links, ${result.errors.length} errors.`);
  process.exitCode = result.errors.length ? 1 : 0;
}
