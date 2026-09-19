// Recursively scans public/exercises (including subfolders) for .yaml/.yml
// files and writes manifest.json listing them as paths relative to
// public/exercises, so the app can fetch the list at runtime (the public/
// folder is served as static assets with no directory listing).
import { readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const exercisesDir = path.join(dir, '..', 'public', 'exercises');

function walk(relDir) {
  const absDir = path.join(exercisesDir, relDir);
  const entries = readdirSync(absDir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files = files.concat(walk(rel));
    } else if (/\.(ya?ml)$/i.test(entry.name)) {
      files.push(rel);
    }
  }
  return files;
}

const files = walk('').sort();

writeFileSync(path.join(exercisesDir, 'manifest.json'), JSON.stringify({ files }, null, 2) + '\n');

console.log(`Wrote manifest.json with ${files.length} exercise file(s): ${files.join(', ')}`);
