// Copyright 2026 The MathWorks, Inc.
// The save-fidelity instrument for compressed-binary dictionaries.
//
//   node scripts/save-fidelity.mjs                     fixtures, parity artifacts and the corpus
//   node scripts/save-fidelity.mjs --only repo         fixtures and parity artifacts only
//   node scripts/save-fidelity.mjs --dist <dir>        measure another build's dist/
//   node scripts/save-fidelity.mjs --json              one JSON line per file, then the totals
//   node scripts/save-fidelity.mjs --rename            also rename every entry, save, and count
//                                                      what changed beyond the Name and LastMod elements
//
// It answers two different questions about every binary `.sldd` it finds, and keeps them
// apart because a save that copies what nobody edited no longer exercises the writers:
//
//   no-op save    `session.serializeSource` of a file nobody edited, unzipped and compared
//                 member by member with the file it was read from. Every member should
//                 come back as the bytes it was read as.
//   regenerate    the whole chunk written from the model (`regenerateChunkXml`, or, in a
//                 build that predates it, `buildDataChunkXml`, which was the same thing):
//                 what every reader and writer defect costs on a full rewrite. This is the
//                 census the reader and writer fixes quote before and after, by kind.
//
// Each entry is paired with the file's by UUID and Name (with an occurrence count for the
// entries that carry neither), never by position, so a reordered chunk still pairs.
//
// With --rename it asks a third: `rename`, every entry of a file renamed through the API and the
// file saved, each entry then compared with the bytes it was read from. A rename touches the Name
// and LastMod elements alone, so everything else that differs is a part nobody edited that the
// save rewrote: the count S2 (an edited entry keeps its untouched parts) is measured by.
//
// It also prints a digest of the model (every entry's row and its serialize()) and of
// every textual dictionary's save, which is how two builds are shown to read and write
// the same thing where they were not meant to differ.
//
// The corpus is resolved through perf/corpus.mjs, so no corpus path appears in this file:
// real dictionaries are named after the customers they came from. Files over 100 MB are
// skipped. The clock is frozen, so a run is reproducible.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { filesFor, resolveCorpus } from '../perf/corpus.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

// A frozen clock: nothing a no-op save writes should depend on it, and the zip writer
// stamps members with it when it has no time of its own.
const FROZEN = Date.UTC(2026, 0, 2, 3, 4, 6);
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) {
    super(...(a.length === 0 ? [FROZEN] : a));
  }
  static now() {
    return FROZEN;
  }
};

const DIST = resolve(arg('dist', join(REPO, 'dist')));
const load = (rel) => import(pathToFileURL(join(DIST, rel)).href);
const core = await load('index.js');
const serializer = await load('datamodel/parser/BinarySlddSerializer.js');
const regenerate = serializer.regenerateChunkXml ?? serializer.buildDataChunkXml;
const regenerateName = serializer.regenerateChunkXml ? 'regenerateChunkXml' : 'buildDataChunkXml';

const MAX_BYTES = 100 * 1048576;
const CHUNK = 'data/chunk0.xml';

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.sldd')) out.push(p);
  }
}

function inputs() {
  const only = arg('only');
  const files = [];
  if (only !== 'corpus') {
    walk(join(REPO, 'test', 'fixtures'), files);
    walk(join(REPO, 'test', 'parity', 'artifacts'), files);
  }
  let corpusRoot = null;
  if (only !== 'repo') {
    const corpus = resolveCorpus();
    corpusRoot = corpus.root;
    files.push(...filesFor(corpus, 'sldd-corpus'));
  }
  return { files: [...new Set(files)].sort(), corpusRoot };
}

const isZip = (bytes) => bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b;
const buffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? { $bigint: String(x) } : x));

// ---- entries of a chunk, as written -------------------------------------------------

const OPEN = '<Object Class="DD.ENTRY">';
const CLOSE = '</Object>';

function spans(xml) {
  const out = [];
  let pos = 0;
  for (;;) {
    const s = xml.indexOf(OPEN, pos);
    if (s < 0) break;
    const e = xml.indexOf(CLOSE, s);
    if (e < 0) break;
    out.push([s, e + CLOSE.length]);
    pos = e + CLOSE.length;
  }
  return out;
}

const charP = (frag, name) => {
  const m = new RegExp(`<P Name="${name}" Class="char">([^<]*)</P>`).exec(frag);
  return m ? m[1] : '';
};

/** Each entry's text, keyed by UUID and Name plus an occurrence count, in document order. */
function keyedEntries(xml) {
  const seen = new Map();
  return spans(xml).map(([s, e]) => {
    const text = xml.slice(s, e);
    const base = charP(text, 'UUID') + '\u0000' + charP(text, 'Name');
    const k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    return { key: `${base}\u0000${k}`, text };
  });
}

// Entries moved: N minus the longest run kept in order.
function moved(order) {
  const tails = [];
  for (const x of order) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (tails[m] < x) lo = m + 1;
      else hi = m;
    }
    tails[lo] = x;
  }
  return order.length - tails.length;
}

// ---- leaves of one entry, for the census by kind ------------------------------------

const TAG = /<(\/?)([A-Za-z][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

function leaves(frag) {
  const out = [];
  const stack = [];
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(frag))) {
    const [, closing, name, attrs, self] = m;
    if (closing) {
      const node = stack.pop();
      if (node && node.children === 0) {
        out.push({ path: node.path, attrs: node.attrs, text: frag.slice(node.textAt, m.index), self: false });
      }
      continue;
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.children++;
    const label = /\sName="([^"]*)"/.exec(attrs)?.[1] ?? (name === 'Element' ? `#${parent ? parent.elements++ : 0}` : '');
    const path = `${parent ? parent.path : ''}/${name}[${label}]`;
    if (self) {
      out.push({ path, attrs: attrs.trim(), text: '', self: true });
    } else {
      stack.push({ path, attrs: attrs.trim(), textAt: TAG.lastIndex, children: 0, elements: 0 });
    }
  }
  const seen = new Map();
  return new Map(out.map((l) => {
    const k = seen.get(l.path) ?? 0;
    seen.set(l.path, k + 1);
    return [`${l.path}#${k}`, l];
  }));
}

const decode = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (_m, e) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'"
      : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

const attrsWithout = (attrs, name) => attrs.replace(new RegExp(`\\s*${name}="[^"]*"`), '').trim();
const numbers = (text) => {
  const toks = text.trim().split(/\s+/);
  const vals = toks.map((t) => Number(t));
  return toks.length > 0 && toks[0] !== '' && vals.every((v) => !Number.isNaN(v)) ? vals : null;
};

function kindOf(o, r) {
  if (!o) return 'leaf added';
  if (!r) return 'leaf dropped';
  if (o.attrs !== r.attrs) {
    if (attrsWithout(o.attrs, 'Dimension') === attrsWithout(r.attrs, 'Dimension')) return 'Dimension';
    if (attrsWithout(o.attrs, 'Class') === attrsWithout(r.attrs, 'Class')) return 'Class';
    return 'attributes';
  }
  if (o.self !== r.self && o.text === r.text) return 'self-closed tag';
  if (decode(o.text) === decode(r.text)) return 'escaping';
  if (o.text.toLowerCase() === r.text.toLowerCase()) return 'exponent case';
  const a = numbers(o.text);
  const b = numbers(r.text);
  if (a && b && a.length === b.length) {
    if (a.every((v, i) => Object.is(v, b[i]))) return 'number spelling';
    if (a.every((v, i) => v === b[i])) return 'sign of zero';
  }
  return 'text';
}

function censusKinds(o, r, into) {
  const lo = leaves(o);
  const lr = leaves(r);
  for (const [k, leaf] of lo) {
    const other = lr.get(k);
    if (!other || other.attrs !== leaf.attrs || other.text !== leaf.text || other.self !== leaf.self) {
      const kind = kindOf(leaf, other);
      into[kind] = (into[kind] ?? 0) + 1;
    }
  }
  for (const k of lr.keys()) {
    if (!lo.has(k)) into['leaf added'] = (into['leaf added'] ?? 0) + 1;
  }
}

/** How a written chunk differs from the one it was read from, entry by entry. */
function compareChunks(orig, ours, kinds) {
  const a = keyedEntries(orig);
  const b = keyedEntries(ours);
  const byKey = new Map(a.map((e, i) => [e.key, { text: e.text, at: i }]));
  let changed = 0;
  let missing = 0;
  const order = [];
  for (const e of b) {
    const o = byKey.get(e.key);
    if (!o) {
      missing++;
      continue;
    }
    order.push(o.at);
    if (o.text !== e.text) {
      changed++;
      if (kinds) censusKinds(o.text, e.text, kinds);
    }
  }
  return {
    entries: a.length,
    written: b.length,
    changed,
    missing,
    lost: a.length - order.length,
    moved: moved(order),
    identical: orig === ours,
    trailingNewlineLost: orig.endsWith('\n') && !ours.endsWith('\n'),
    crlfLost: orig.includes('\r\n') && !ours.includes('\r\n'),
    dictionaryAdded: !orig.includes('<Object Class="DD.Dictionary">') && ours.includes('<Object Class="DD.Dictionary">'),
  };
}

// The members a zip's central directory lists, with each one's DOS time and date and its
// compression method: the package's zip-level metadata, read without core.
function directory(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const out = [];
  let p = view.getUint32(eocd + 16, true);
  for (let i = view.getUint16(eocd + 10, true); i > 0; i--) {
    const n = view.getUint16(p + 28, true);
    out.push([new TextDecoder().decode(zip.subarray(p + 46, p + 46 + n)), view.getUint16(p + 12, true), view.getUint16(p + 14, true), view.getUint16(p + 10, true)]);
    p += 46 + n + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return JSON.stringify(out);
}

// ---- one file ----------------------------------------------------------------------

// A throw is part of the answer, not a reason to stop: a build that throws where another
// returns is a difference the digest has to show.
const attempt = (fn) => {
  try {
    return fn();
  } catch (err) {
    return { $threw: String(err?.message ?? err) };
  }
};

function modelDigest(root) {
  const rows = [];
  const serialized = [];
  let threw = 0;
  for (const section of root.children) {
    for (const entry of section.children) {
      rows.push(json(attempt(() => [section.name, entry.name, entry.className, entry.kind, entry.dataType, entry.displayValue, entry.status])));
      const value = attempt(() => entry.serialize());
      if (value && typeof value === 'object' && '$threw' in value) threw++;
      serialized.push(json(value));
    }
  }
  return { rows: sha(rows.join('\n')), serialize: sha(serialized.join('\n')), serializeThrew: threw };
}

function measureBinary(path, bytes) {
  const parts = unzipSync(bytes);
  const orig = new TextDecoder().decode(parts[CHUNK]);
  const session = core.createSession();
  const root = core.ingest(session, buffer(bytes), { filename: path.split('/').pop() });

  const t0 = performance.now();
  const saved = session.serializeSource(root.name);
  const saveMs = performance.now() - t0;
  const savedParts = unzipSync(saved.bytes);
  const memberDiff = [];
  for (const name of new Set([...Object.keys(parts), ...Object.keys(savedParts)])) {
    const x = parts[name];
    const y = savedParts[name];
    if (!x || !y || x.length !== y.length || !x.every((v, i) => v === y[i])) memberDiff.push(name);
  }
  const noop = compareChunks(orig, new TextDecoder().decode(savedParts[CHUNK]), null);

  const kinds = {};
  const t1 = performance.now();
  const regenerated = regenerate(root);
  const regenMs = performance.now() - t1;
  const regen = compareChunks(orig, regenerated, kinds);

  return {
    kind: 'binary',
    noop: {
      ...noop,
      membersIdentical: memberDiff.length === 0,
      membersChanged: memberDiff,
      directoryIdentical: directory(bytes) === directory(saved.bytes),
      ms: Math.round(saveMs),
    },
    regen: { ...regen, kinds, ms: Math.round(regenMs) },
    model: modelDigest(root),
  };
}

// Every entry renamed, the file saved, and each entry compared with the bytes it was read from,
// its Name and LastMod elements aside: what the save changed that the rename did not. Compared as
// multisets of markup tokens (each tag, and the text before it, trimmed), so that a chunk written
// on one line counts as one written on many does. Paired by UUID and by the name it was read with.
const RENAMED = 'S2r';
const NAME_AND_LASTMOD = /<P Name="(?:Name|LastMod)"[^>]*(?:\/>|>[^<]*<\/P>)/g;
function tokens(text) {
  const m = new Map();
  for (const t of text.replace(NAME_AND_LASTMOD, '').split(/(?<=>)/)) {
    const token = t.trim();
    if (token !== '') m.set(token, (m.get(token) ?? 0) + 1);
  }
  return m;
}
function measureRename(path, bytes) {
  const orig = new TextDecoder().decode(unzipSync(bytes)[CHUNK]);
  const session = core.createSession();
  const root = core.ingest(session, buffer(bytes), { filename: path.split('/').pop() });
  let renamed = 0;
  for (const section of root.children) {
    for (const entry of section.children) {
      if (entry.setProperty('Name', entry.name + RENAMED) === true) renamed++;
    }
  }
  const t0 = performance.now();
  const saved = new TextDecoder().decode(unzipSync(session.serializeSource(root.name).bytes)[CHUNK]);
  const ms = performance.now() - t0;
  const before = new Map(keyedEntries(orig).map((e) => [e.key, e.text]));
  let changedEntries = 0;
  let changedTokens = 0;
  let changedBytes = 0;
  let unpaired = 0;
  for (const e of keyedEntries(saved.split(RENAMED + '</P>').join('</P>'))) {
    const o = before.get(e.key);
    if (o === undefined) {
      unpaired++;
      continue;
    }
    if (e.text === o) continue;
    const was = tokens(o);
    let count = 0;
    for (const [token, n] of tokens(e.text)) {
      const extra = n - (was.get(token) ?? 0);
      if (extra > 0) {
        count += extra;
        changedBytes += extra * token.length;
      }
    }
    if (count > 0) {
      changedEntries++;
      changedTokens += count;
    }
  }
  return { entries: before.size, renamed, changedEntries, changedTokens, changedBytes, unpaired, ms: Math.round(ms) };
}

function measureText(path, bytes) {
  const session = core.createSession();
  const root = core.ingest(session, buffer(bytes), { filename: path.split('/').pop() });
  const saved = attempt(() => session.serializeSource(root.name));
  return { kind: 'text', save: sha(saved?.$threw !== undefined ? json(saved) : saved?.text ?? ''), saveThrew: saved?.$threw !== undefined, model: modelDigest(root) };
}

// ---- the run -------------------------------------------------------------------------

const { files, corpusRoot } = inputs();
const label = (p) => (corpusRoot && p.startsWith(corpusRoot + '/') ? `corpus:${relative(corpusRoot, p)}` : relative(REPO, p));
const asJson = flag('json');
const totals = {
  binary: 0, entries: 0,
  noopIdentical: 0, noopMembersIdentical: 0, noopDirectoryIdentical: 0, noopChanged: 0, noopFilesChanged: 0,
  regenChanged: 0, regenFilesChanged: 0, regenReordered: 0, regenNewlineLost: 0, regenCrlfLost: 0, regenDictionaryAdded: 0,
  kinds: {}, text: 0, textSaveThrew: 0, skipped: 0, failed: 0,
  renameEntries: 0, renamed: 0, renameChangedEntries: 0, renameChangedTokens: 0, renameChangedBytes: 0, renameFilesChanged: 0, renameUnpaired: 0,
};
const renameMode = flag('rename');

console.log(`dist: ${relative(REPO, DIST) || '.'} (regenerating with ${regenerateName})`);
for (const path of files) {
  if (statSync(path).size > MAX_BYTES) {
    totals.skipped++;
    continue;
  }
  const bytes = new Uint8Array(readFileSync(path));
  let result;
  try {
    result = isZip(bytes) ? measureBinary(path, bytes) : measureText(path, bytes);
  } catch (err) {
    totals.failed++;
    console.log(`${label(path)}\tFAILED\t${err?.message ?? err}`);
    continue;
  }
  if (result.kind === 'text') {
    totals.text++;
    totals.textSaveThrew += result.saveThrew ? 1 : 0;
    console.log(asJson ? json({ file: label(path), ...result }) : `${label(path)}\ttext\tsave ${result.save}${result.saveThrew ? ' (threw)' : ''}\trows ${result.model.rows}\tserialize ${result.model.serialize}`);
    continue;
  }
  const { noop, regen } = result;
  totals.binary++;
  totals.entries += noop.entries;
  totals.noopIdentical += noop.identical ? 1 : 0;
  totals.noopMembersIdentical += noop.membersIdentical ? 1 : 0;
  totals.noopDirectoryIdentical += noop.directoryIdentical ? 1 : 0;
  totals.noopChanged += noop.changed + noop.lost;
  totals.noopFilesChanged += noop.changed + noop.lost > 0 ? 1 : 0;
  totals.regenChanged += regen.changed + regen.lost;
  totals.regenFilesChanged += regen.changed + regen.lost > 0 ? 1 : 0;
  totals.regenReordered += regen.moved > 0 ? 1 : 0;
  totals.regenNewlineLost += regen.trailingNewlineLost ? 1 : 0;
  totals.regenCrlfLost += regen.crlfLost ? 1 : 0;
  totals.regenDictionaryAdded += regen.dictionaryAdded ? 1 : 0;
  for (const [k, n] of Object.entries(regen.kinds)) totals.kinds[k] = (totals.kinds[k] ?? 0) + n;
  if (renameMode) {
    let r;
    try {
      r = measureRename(path, bytes);
    } catch (err) {
      r = { failed: String(err?.message ?? err) };
      totals.failed++;
    }
    result.rename = r;
    if (!r.failed) {
      totals.renameEntries += r.entries;
      totals.renamed += r.renamed;
      totals.renameChangedEntries += r.changedEntries;
      totals.renameChangedTokens += r.changedTokens;
      totals.renameChangedBytes += r.changedBytes;
      totals.renameFilesChanged += r.changedEntries > 0 ? 1 : 0;
      totals.renameUnpaired += r.unpaired;
    }
  }
  if (asJson) {
    console.log(json({ file: label(path), ...result }));
  } else {
    console.log([
      label(path),
      `entries ${noop.entries}`,
      `no-op ${noop.identical && noop.membersIdentical ? 'identical' : `CHANGED (${noop.changed + noop.lost} entries; members ${noop.membersChanged.join(',') || 'none'})`}`,
      `regenerate ${regen.changed + regen.lost} entries changed, ${regen.moved} moved`,
      ...(renameMode ? [result.rename.failed ? `rename FAILED ${result.rename.failed}` : `rename ${result.rename.renamed} entries, ${result.rename.changedEntries} changed beyond Name and LastMod (${result.rename.changedTokens} tokens)`] : []),
      `rows ${result.model.rows}`,
      `serialize ${result.model.serialize}`,
    ].join('\t'));
  }
}

console.log('');
console.log(`binary dictionaries: ${totals.binary}, entries ${totals.entries}`);
console.log(`  no-op save: chunk identical in ${totals.noopIdentical}, every member identical in ${totals.noopMembersIdentical}, ` +
  `zip directory (member order, times, compression) identical in ${totals.noopDirectoryIdentical}; ` +
  `${totals.noopChanged} entries changed in ${totals.noopFilesChanged} files`);
console.log(`  regenerate: ${totals.regenChanged} entries changed in ${totals.regenFilesChanged} files; ` +
  `${totals.regenReordered} reordered, ${totals.regenNewlineLost} lose the trailing newline, ` +
  `${totals.regenCrlfLost} lose CRLF, ${totals.regenDictionaryAdded} gain a DD.Dictionary`);
console.log(`  regenerate, changed leaves by kind: ${Object.entries(totals.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
if (renameMode) {
  console.log(`  rename every entry and save: ${totals.renamed} of ${totals.renameEntries} entries renamed; ` +
    `${totals.renameChangedEntries} entries in ${totals.renameFilesChanged} files changed beyond the Name and LastMod elements ` +
    `(${totals.renameChangedTokens} tokens, ${totals.renameChangedBytes} bytes); ${totals.renameUnpaired} unpaired`);
}
console.log(`text dictionaries: ${totals.text} (the save threw in ${totals.textSaveThrew}); skipped over 100 MB: ${totals.skipped}; failed: ${totals.failed}`);
process.exitCode = totals.failed > 0 ? 1 : 0;
