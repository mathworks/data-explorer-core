// Copyright 2026 The MathWorks, Inc.
// Leak check: no internal MathWorks references may reach the tree. The package is
// public-bound, so this guards the boundary before any publish. `git grep` scans
// every tracked file — including the committed dist/ (shipped so the git dependency
// resolves without an install-time build) and package-lock.json, where internal
// Artifactory `resolved` URLs regress if `npm install` runs against the internal
// registry.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';

// `data-explorer-ts` is the internal codename for the vendored subsystem; it must
// never surface in the public tree (the public name is "data explorer"). The rest are
// a machine's paths: an internal build archive (where MATLAB's own matlabroot lives on
// the development machines) and a home folder, which carries an account name.
const NEEDLES = [
  'insidelabs', 'ipws', 'mw-npm-repository', 'gitlab', 'data-explorer-ts',
  '/System/Volumes', 'mathworks/devel', 'jobarchive', '/Users/[A-Za-z0-9._-]',
];

// The same paths, and a sandbox's, as they are searched for INSIDE what a fixture
// encodes (checkEmbeddedPaths) — where nothing but a MATLAB value lives, so no prose
// can match them by accident.
const EMBEDDED = [/\/System\/Volumes/, /mathworks\/devel/, /jobarchive/, /\/Users\/[A-Za-z0-9._-]+/, /\/home\/[A-Za-z0-9._-]+/, /sandbox/i];

// Every phase runs, and the exit code is decided at the END. An early process.exit(0)
// on the no-match path silently skipped the corpus phase below, so a planted corpus
// path went undetected — a check that cannot fail is worse than no check.
let failed = false;
if (!checkNeedles()) failed = true;
if (!checkCorpusPaths()) failed = true;
if (!checkEmbeddedPaths()) failed = true;
process.exit(failed ? 1 : 0);

// Use git grep so it respects .gitignore (skips node_modules, dist, *.tgz).
// This script is excluded from its own scan — it necessarily contains the
// needle strings as literals.
function checkNeedles() {
  let hits = '';
  try {
    hits = execFileSync(
      'git',
      ['grep', '-nI', '-E', NEEDLES.join('|'), '--', '.', ':(exclude)scripts/leak-check.mjs'],
      { encoding: 'utf8' },
    );
  } catch (e) {
    // git grep exits 1 when there are no matches — that's the success case.
    if (e.status === 1) {
      console.log('OK: no internal references found');
      return true;
    }
    throw e;
  }

  if (hits.trim()) {
    console.error('LEAK FAIL — internal references found:');
    console.error(hits);
    return false;
  }
  console.log('OK: no internal references found');
  return true;
}

// ---------------------------------------------------------------------------------
// Second needle set, derived rather than listed: the performance corpus.
//
// Real dictionaries are named after the customers they came from, so those names
// cannot be written down here — putting them in a tracked file to forbid them would
// BE the leak. Instead the needles come from perf/corpus.local.json, which is
// gitignored, and the assertion is that none of its paths appear in a tracked file.
// perf/corpus.mjs therefore declares only the SHAPE of each role.
//
// Known limit: with no manifest (a fresh clone, or CI) there is nothing to derive
// from and this phase is a no-op. That is acceptable because it runs exactly where
// the risk lives — the machine that actually holds the corpus.
function checkCorpusPaths() {
  const manifest = join(dirname(fileURLToPath(import.meta.url)), '..', 'perf', 'corpus.local.json');
  if (!existsSync(manifest)) {
    console.log('OK: no perf corpus manifest, so no corpus paths to check');
    return true;
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch (e) {
    console.error(`LEAK CHECK INCONCLUSIVE — perf/corpus.local.json is unreadable: ${e.message}`);
    return false;
  }

  // Both the relative path and the bare filename: a tracked file could name either,
  // and the filename alone is the part that carries the customer's name.
  //
  // A needle must look like a path or a filename — it has to contain a separator or
  // an extension. Bare single-segment names are skipped because they are ordinary
  // words as often as not: a `dirs` entry of "complex" matched a hundred lines of
  // prose across src/ and dist/ and made the whole check useless. The consequence is
  // that a single-segment directory name is NOT guarded, so it must not be one that
  // identifies anybody; the skipped ones are printed rather than dropped in silence.
  const needles = new Set();
  const skipped = [];
  const consider = (rel) => {
    if (typeof rel !== 'string' || rel.length === 0) return;
    if (rel.includes('/') || rel.includes('.')) needles.add(rel);
    else skipped.push(rel);
    const base = basename(rel);
    if (base !== rel && base.includes('.')) needles.add(base);
  };
  for (const rel of Object.values(parsed.files ?? {})) consider(rel);
  for (const rel of Object.values(parsed.dirs ?? {})) consider(rel);

  if (skipped.length > 0) {
    console.log(
      `note: not guarding ${skipped.length} single-segment name(s) — too generic to ` +
        `grep for: ${skipped.join(', ')}`,
    );
  }
  if (needles.size === 0) {
    console.log('OK: perf corpus manifest names no guardable paths');
    return true;
  }

  const args = ['grep', '-nI', '-F'];
  for (const n of needles) args.push('-e', n);
  args.push('--', '.', ':(exclude)scripts/leak-check.mjs');

  let corpusHits = '';
  try {
    corpusHits = execFileSync('git', args, { encoding: 'utf8' });
  } catch (e) {
    if (e.status === 1) {
      console.log(`OK: none of ${needles.size} corpus path(s) appear in a tracked file`);
      return true;
    }
    throw e;
  }

  if (corpusHits.trim()) {
    console.error('LEAK FAIL — a performance-corpus path reached a tracked file:');
    console.error(corpusHits);
    console.error(
      'Move it into perf/corpus.local.json and refer to the role id instead. Those\n' +
        'filenames identify the customers the dictionaries came from.',
    );
    return false;
  }
  console.log(`OK: none of ${needles.size} corpus path(s) appear in a tracked file`);
  return true;
}

// ---------------------------------------------------------------------------------
// Third: what a fixture ENCODES. `git grep -I` skips a binary file, and a text one can
// still hold bytes no grep sees: a binary dictionary's values are hex text inside a
// deflated zip part, a text dictionary's are six bits a character, a classic .mdl's
// workspace is uuencoded, and a .mat's variables are zlib streams. MATLAB writes its own
// matlabroot into every function handle it serializes, so a fixture holding one carried
// an internal build-archive path in exactly those places, and the two phases above
// passed it. Every tracked file of these kinds is unpacked here, every stream in it
// decoded, and the bytes searched as Latin-1 and as UTF-16LE (MATLAB's char data is
// either).
function checkEmbeddedPaths() {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const KINDS = new Set(['.mat', '.sldd', '.slx', '.mdl', '.mxarray', '.zip', '.sltx', '.slxp', '.mldatx']);
  const hits = [];
  let streams = 0;
  const search = (bytes, where) => {
    const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const views = [b.toString('latin1'), b.subarray(0, b.length & ~1).toString('utf16le'), b.subarray(1, 1 + ((b.length - 1) & ~1)).toString('utf16le')];
    for (const view of views) {
      for (const re of EMBEDDED) {
        const m = re.exec(view);
        if (m) hits.push(`${where}: ${m[0]}`);
      }
    }
  };
  const stream = (bytes, where) => {
    streams++;
    search(bytes, where);
  };
  const uudecode = (text) => {
    const out = new Uint8Array(Math.floor((text.length * 6) / 8));
    let acc = 0;
    let bits = 0;
    let n = 0;
    for (let i = 0; i < text.length; i++) {
      acc = (acc << 6) | ((text.charCodeAt(i) - 0x20) & 0x3f);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[n++] = (acc >> bits) & 0xff;
      }
    }
    return out;
  };
  const matFile = (bytes, where) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let at = 128; at + 8 <= bytes.length; ) {
      const type = view.getUint32(at, true);
      const size = view.getUint32(at + 4, true);
      if (type === 0 && size === 0) break;
      const body = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size));
      if (type === 15) {
        try {
          stream(new Uint8Array(inflateSync(body)), `${where} [record at ${at}]`);
        } catch {
          hits.push(`${where}: a compressed record at ${at} does not inflate, so it was not searched`);
        }
      } else {
        stream(body, `${where} [record at ${at}]`);
      }
      at += 8 + size;
    }
  };
  const text = (bytes, name, where) => {
    const t = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
    for (const m of t.matchAll(/Encoding="hex"[^>]*>([^<]*)</g)) {
      stream(Uint8Array.from(Buffer.from(m[1].replace(/\s+/g, ''), 'hex')), `${where} [hex]`);
    }
    for (const m of t.matchAll(/"_value"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      let value;
      try {
        value = JSON.parse(`"${m[1]}"`);
      } catch {
        continue;
      }
      if (value.startsWith('  %)')) stream(uudecode(value), `${where} [cdata]`);
    }
    if (name.endsWith('.mdl')) {
      for (const m of t.matchAll(/Data\s+((?:"(?:[^"\\]|\\.)*"\s*)+)/g)) {
        const record = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((c) => c[1]).join('').replace(/\\(.)/g, (_, c) => (c === 'n' || c === 'r' ? '' : c === 't' ? '\t' : c));
        if (record.startsWith('  %)')) stream(uudecode(record.replace(/[\r\n]/g, '')), `${where} [MatData]`);
      }
    }
  };
  const unpack = (bytes, name, where) => {
    search(bytes, where);
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      let parts;
      try {
        parts = unzipSync(bytes);
      } catch {
        return;
      }
      for (const [part, data] of Object.entries(parts)) unpack(data, part, `${where}::${part}`);
      return;
    }
    if (name.endsWith('.mat') && bytes.length >= 128) {
      matFile(bytes, where);
      return;
    }
    text(bytes, name, where);
  };
  let searched = 0;
  for (const file of files) {
    if (!KINDS.has(extname(file).toLowerCase())) continue;
    searched++;
    unpack(new Uint8Array(readFileSync(file)), file, file);
  }
  if (hits.length > 0) {
    console.error('LEAK FAIL — a path inside what a tracked file encodes:');
    for (const hit of [...new Set(hits)]) console.error('  ' + hit);
    return false;
  }
  console.log(`OK: no path inside ${files.length > 0 ? searched : 0} MATLAB file(s), ${streams} decoded stream(s)`);
  return true;
}
