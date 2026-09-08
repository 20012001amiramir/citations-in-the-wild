// Which dataset file a run reads. Versions are kept side by side (v0 stays as published, v0.1 is
// the current one), so every consumer resolves the newest by version number instead of naming a
// file — a bump is then one new file, not a search-and-replace.
import fs from 'node:fs';
import path from 'node:path';

const DATASET_NAME = /^citations-in-the-wild\.v(\d+(?:\.\d+)*)\.json$/;

/** [major, minor, ...] parsed from a dataset filename, or null when the name is not one. */
export function datasetVersion(filename) {
  const m = DATASET_NAME.exec(filename);
  return m ? m[1].split('.').map(Number) : null;
}

export function compareVersions(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Every dataset file under <root>/benchmark, oldest version first. */
export function listDatasets(root) {
  const dir = path.join(root, 'benchmark');
  return fs
    .readdirSync(dir)
    .filter((f) => datasetVersion(f) !== null)
    .sort((a, b) => compareVersions(datasetVersion(a), datasetVersion(b)))
    .map((f) => path.join(dir, f));
}

/** Absolute path of the newest dataset file, which is the one runs score against. */
export function resolveDatasetPath(root) {
  const all = listDatasets(root);
  if (all.length === 0) throw new Error(`no benchmark/citations-in-the-wild.v*.json under ${root}`);
  return all[all.length - 1];
}
