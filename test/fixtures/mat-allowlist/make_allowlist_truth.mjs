// Copyright 2026 The MathWorks, Inc.
//
// Writes allowlist.truth.json beside this script from the results of the allow-list probe: for
// every case, the edit MATLAB made of an original here (al_*.mat), the cells the probe's writer
// swapped for it (the case's final variant), MATLAB R2027a's verdict on the swapped file, and the
// SHA-256 of that file's inflated subsystem element, which a cell swap of the same edit must
// reproduce byte for byte. Run:
//
//   node test/fixtures/mat-allowlist/make_allowlist_truth.mjs <probe results folder>
//
// The folder holds the probe's manifests (manifest.json, manifest2.json, manifest3.json, each
// mutant's path and edits), final.txt (each case's final variant and verdict), and out/ (the
// .mat files).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const results = process.argv[2];
if (!results) {
  console.error('usage: node make_allowlist_truth.mjs <probe results folder>');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));

// The subsystem element of a Level-5 MAT-file: the record its header's bytes 116-123 place.
function subsystemElement(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = Number(view.getBigUint64(116, true));
  const type = view.getUint32(at, true);
  const size = view.getUint32(at + 4, true);
  const payload = bytes.subarray(at + 8, at + 8 + size);
  return type === 15 ? new Uint8Array(inflateSync(payload)) : bytes.subarray(at, at + 8 + size);
}

const manifests = ['manifest.json', 'manifest2.json', 'manifest3.json']
  .filter((f) => existsSync(join(results, f)))
  .flatMap((f) => JSON.parse(readFileSync(join(results, f), 'utf8')));
const cases = [];
for (const line of readFileSync(join(results, 'final.txt'), 'utf8').split('\n')) {
  const m = /^(\S+)\s+final=(\S+)\s+(\S+)/.exec(line);
  if (!m) {
    continue;
  }
  const [, name, variant, verdict] = m;
  const entry = manifests.find((x) => x.name === name && x.variant === variant) ?? manifests.find((x) => x.name === name);
  if (!entry || cases.some((c) => c.name === name)) {
    continue;
  }
  const mutant = entry.mutant ? join(results, 'out', basename(entry.mutant)) : null;
  const element = mutant && existsSync(mutant) ? subsystemElement(new Uint8Array(readFileSync(mutant))) : null;
  cases.push({
    name,
    group: entry.group,
    original: basename(entry.orig),
    edits: entry.edits.map(({ path, prop, expr }) => ({ path, prop, expr })),
    variant,
    matlab: verdict,
    subsystemSha256: element ? createHash('sha256').update(element).digest('hex') : null,
  });
}
const truth = {
  about: [
    'The originals al_*.mat are MATLAB R2027a saves (make_allowlist_originals.m). Each case is one edit or more, as',
    'MATLAB spells it (`path.prop = expr`), of one original, swapped into the original by an independent writer (only',
    'the value cells it names replaced, and the cells MATLAB\'s own edit changes with it), and judged by MATLAB:',
    'PASS, it loads as MATLAB\'s own edit of the same object, every property, with no warning, and survives a MATLAB',
    're-save; FAIL, it warns on load, as MATLAB\'s own save of the edit does (or the edit changes nothing); INFO, MATLAB',
    'refuses the edit, and the swapped cell loads as the default; NOSWAP, the original holds no value cell to swap.',
    'subsystemSha256 is of the swapped file\'s inflated subsystem element; variant names what the writer swapped.',
  ],
  matlabVersion: '27.1.0.3409468 (R2027a) Prerelease',
  cases,
};
writeFileSync(join(here, 'allowlist.truth.json'), JSON.stringify(truth, null, 1) + '\n');
console.log('wrote', cases.length, 'cases');
