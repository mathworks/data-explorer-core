// THE acceptance gate for the BINARY write path: does MATLAB read back the zip our
// serializer produces?
//
// probe_writeback.mjs asks this of the text .sldd. Nothing had ever asked it of the
// binary one — `test/parity/fidelity/*.test.ts` reopens a binary dictionary in
// MATLAB, but only ever after a scalar edit to `params.sldd` (Min = 5, a
// CoderInfo.StorageClass string), so the XML channel's shape, class and complexity
// spellings — `Dimension="2*3*2"`, `IsComplex="1"`, `Class="char" Dimension="2*2"`,
// a typed struct field, an object's `Source="saveobj"` payload — had never been read
// back by MATLAB at all. Every divergence recorded from them was inferred from our
// own reader, which is exactly how defects 19 and 22 survived three passes.
//
// The difference from the text gate is the unit of work. There, one entry's value is
// spliced into a copy of MATLAB's own JSON, so the rest of the file is untouched
// bytes. Here `serializeBinarySldd` rebuilds the WHOLE package — every entry's XML,
// the DataSource header, the dictionary object, and the zip around them — so one
// rebuilt file carries every entry at once, and the manifest lists each entry of it
// as its own case. That is a strictly stronger question (a zip MATLAB cannot open
// fails every entry in it) and it needs no splice.
//
// Two halves, one manifest between them (PROBE_OUT must be ABSOLUTE — MATLAB's
// dictionary API rejects a relative path with SLDD:sldd:DictionaryNotFound, which
// turns every verdict into a meaningless FAIL):
//
//   npm run build
//   env PROBE_OUT=/tmp/wbbin node test/parity/matlab/probe_writeback_bin.mjs
//   env PROBE_OUT=/tmp/wbbin mw -using Bmain matlab -nodesktop \
//       -batch "run('$PWD/test/parity/matlab/probe_writeback_bin.m')"
//
// It reads the BUILT package, so a stale `dist/` is a stale verdict. Last line of
// the MATLAB half: `WRITEBACK FAILURES n of m`. Zero is the only acceptable result.
//
// Batches:
//   rebuild  every entry of every MATLAB-authored binary dictionary in the corpus,
//            marked modified to the leaf so each value goes through the writer
//            rather than being replayed. 96 entries over five files.
//   edit     the edits a consumer actually produces — one N-D element, a retyped
//            char matrix, a retyped complex scalar, an object's Value — each in its
//            own rebuilt file so a failure names one edit.
//
// Controls, which must pass for any verdict above to mean anything:
//   copy_*   MATLAB's file, byte for byte. Proves the probe and MATLAB agree.
//   zip_*    MATLAB's own chunk0.xml, repacked by fflate. Separates "MATLAB cannot
//            read a zip we wrote" from "MATLAB cannot read the XML we wrote" — the
//            two halves of this write path, which fail identically at the API.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { unzipSync, zipSync } from 'fflate';
import { createSession, ingest } from '../../../dist/index.js';
import { serializeBinarySldd } from '../../../dist/datamodel/parser/BinarySlddSerializer.js';

const OUT = process.env.PROBE_OUT || '/tmp/writeback_bin_probe';
mkdirSync(OUT, { recursive: true });

// Repo-relative, so node has to be launched from the repo root.
const SOURCES = [
  ['char', 'test/fixtures/char_binary.sldd'],
  ['typed', 'test/fixtures/typed_binary.sldd'],
  ['nd', 'test/fixtures/nd_binary.sldd'],
  ['ndcplx', 'test/fixtures/nd_complex.sldd'],
  ['cases', 'test/parity/artifacts/binary/cases.sldd'],
];
const CASES_SRC = 'test/parity/artifacts/binary/cases.sldd';
const CHAR_SRC = 'test/fixtures/char_binary.sldd';

function load(path) {
  const u8 = new Uint8Array(readFileSync(path));
  const bytes = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  return ingest(createSession(), bytes, { filename: path.split('/').pop() });
}

/**
 * Mark this node AND every node under it modified.
 *
 * `_markModified` walks UP the chain, never down, so marking an entry leaves its
 * struct fields and cell elements unmodified — and an unmodified node can replay a
 * raw form instead of being asked to write itself. The root SlddNode and the section
 * nodes have no `_markModified`, hence the guard.
 */
function deepMark(n) {
  if (typeof n._markModified === 'function') {
    n._markModified();
  }
  for (const c of n.children ?? []) {
    deepMark(c);
  }
}

function entriesOf(sldd) {
  const out = [];
  for (const section of sldd.children ?? []) {
    for (const entry of section.children ?? []) {
      out.push(entry);
    }
  }
  return out;
}

function byName(sldd, name) {
  const hit = entriesOf(sldd).find((e) => e.name === name);
  if (!hit) {
    throw new Error('no entry "' + name + '"; have ' + entriesOf(sldd).map((e) => e.name).join(','));
  }
  return hit;
}

function byLabel(n, label) {
  const c = n.children.find((k) => k.displayName === label);
  if (!c) {
    throw new Error(
      'no child labelled ' + label + '; have ' + n.children.map((k) => k.displayName).join(','),
    );
  }
  return c;
}

function write(sldd, path) {
  const ab = serializeBinarySldd(sldd);
  writeFileSync(path, new Uint8Array(ab));
}

// The reference each rebuild is compared against. MATLAB is given a COPY inside the
// probe directory: the dictionary API needs an absolute path, and a tracked artifact
// must not be exposed to anything MATLAB might write while it holds the file open.
const refs = new Map();
function reference(srcPath) {
  let dest = refs.get(srcPath);
  if (!dest) {
    dest = OUT + '/ref_' + srcPath.replace(/[\\/]/g, '_');
    copyFileSync(srcPath, dest);
    refs.set(srcPath, dest);
  }
  return dest;
}

const manifest = [];

function record(batch, src, name, file, opts = {}) {
  manifest.push({
    batch,
    file,
    ref: reference(src),
    refexpr: opts.refexpr || '',
    name,
    label: batch + '/' + name + (opts.tag ? '[' + opts.tag + ']' : ''),
    kind: opts.kind || 'same',
    extract: opts.extract || '',
    expect: opts.expect || 'the value MATLAB wrote, to the leaf',
    why: opts.why || '',
  });
}

function skip(batch, src, name, opts, message) {
  record(batch, src, name, '', { ...opts, kind: 'skipped', why: message });
  console.log('SKIP ', batch + '/' + name, '-', String(message).slice(0, 160));
}

// ---- batch: every entry of every binary dictionary, through the writer ---------
for (const [tag, src] of SOURCES) {
  const file = OUT + '/rebuild_' + tag + '.sldd';
  let names = [];
  try {
    const sldd = load(src);
    deepMark(sldd);
    names = entriesOf(sldd).map((e) => e.name);
    write(sldd, file);
    console.log('WROTE rebuild', tag, '->', names.length, 'entries');
  } catch (e) {
    // A file our writer cannot produce at all is a failure of the gate, not an
    // absence from it — but the entry names are unknown, so it is recorded as one
    // case rather than as one per entry.
    skip('rebuild', src, tag, {}, e.message);
    continue;
  }
  for (const name of names) {
    record('rebuild', src, name, file, { tag });
  }
}

// ---- batch: the edits a consumer produces, one rebuilt file each --------------
// Each is its own file so a failure names one edit rather than one dictionary. The
// reference is a MATLAB expression, so the comparison is equality and not merely
// shape: when we know what the user typed we know exactly what MATLAB must report.
const EDITS = [
  {
    tag: 'ndnum', src: CASES_SRC, name: 'nd2x3x2',
    refexpr: 'cat(3,[99 2 3;4 5 6],[7 8 9;10 11 12])',
    expect: 'a 2x3x2 double, (1,1,1)=99, the other eleven unchanged',
    edit: (n) => byLabel(n, 'nd2x3x2(1,1,1)').setProperty('Value', '99'),
  },
  {
    tag: 'ndcell', src: CASES_SRC, name: 'cellNd',
    refexpr: 'reshape([{99} num2cell(2:12)],[2 3 2])',
    expect: 'a 2x3x2 cell, {1,1,1}=99, the other eleven unchanged',
    edit: (n) => byLabel(n, 'cellNd{1,1,1}').setProperty('Value', '99'),
  },
  {
    tag: 'ndstruct', src: CASES_SRC, name: 'structNd',
    refexpr: "reshape(struct('a', [{99} num2cell(2:12)]),[2 3 2])",
    expect: 'a 2x3x2 struct, (1,1,1).a=99, the other eleven unchanged',
    edit: (n) => byLabel(n, 'structNd(1,1,1)').children[0].setProperty('Value', '99'),
  },
  {
    // A char matrix typed into a char ROW entry: the Dimension attribute has to
    // appear where there was none, which is the char half of defect 25 on the XML
    // channel rather than the text one.
    tag: 'charmat', src: CASES_SRC, name: 'charStr',
    refexpr: "['ab'; 'cd']",
    expect: "committing ['ab'; 'cd'] over a 1x4 char row",
    edit: (n) => n.setProperty('Value', "['ab'; 'cd']"),
  },
  {
    // The display of a char matrix, retyped verbatim: it must come back as the same
    // 2x2 char rather than a 2x1 string.
    tag: 'same', src: CHAR_SRC, name: 'charMat',
    refexpr: "['ab'; 'cd']",
    expect: "committing a 2x2 char's own displayed literal unchanged",
    edit: (n) => n.setProperty('Value', "['ab'; 'cd']"),
  },
  {
    // IsComplex on the XML channel, through an edit rather than a replay.
    tag: 'cplx', src: CASES_SRC, name: 'cplxScalar',
    refexpr: '5-6i',
    expect: 'committing 5-6i over 3+4i',
    edit: (n) => n.setProperty('Value', '5-6i'),
  },
  {
    // An object PROPERTY, which goes through ParameterNode._adoptValueNode rather
    // than through an entry's own setter — defect 26's path, on the XML channel.
    tag: 'mat', src: CASES_SRC, name: 'aParam', extract: '.Value',
    refexpr: '[1 2; 3 4]',
    expect: 'a matrix typed into a Simulink.Parameter Value',
    edit: (n) => n.setProperty('Value', '[1 2; 3 4]'),
  },
];

for (const spec of EDITS) {
  const file = OUT + '/edit_' + spec.name + '_' + spec.tag + '.sldd';
  try {
    const sldd = load(spec.src);
    const entry = byName(sldd, spec.name);
    const r = spec.edit(entry);
    if (r !== true && r !== undefined) {
      throw new Error('the edit was rejected: ' + JSON.stringify(r));
    }
    write(sldd, file);
    record('edit', spec.src, spec.name, file, {
      tag: spec.tag, refexpr: spec.refexpr, extract: spec.extract, expect: spec.expect,
    });
    console.log('WROTE edit', spec.name + '[' + spec.tag + ']');
  } catch (e) {
    skip('edit', spec.src, spec.name, { tag: spec.tag, expect: spec.expect }, e.message);
  }
}

// ---- controls ----------------------------------------------------------------
const controls = [];
for (const [, src] of SOURCES) {
  // MATLAB's own bytes, so a FAILED line here means the probe and MATLAB disagree
  // and nothing above means anything.
  const copy = OUT + '/control_copy_' + src.replace(/[\\/]/g, '_');
  copyFileSync(src, copy);
  controls.push(copy);
  // MATLAB's own chunk0.xml, repacked by fflate. The zip layer alone.
  const zip = OUT + '/control_zip_' + src.replace(/[\\/]/g, '_');
  writeFileSync(zip, zipSync(unzipSync(new Uint8Array(readFileSync(src))), { level: 6 }));
  controls.push(zip);
}
writeFileSync(OUT + '/controls.json', JSON.stringify(controls, null, 2));
writeFileSync(OUT + '/manifest.json', JSON.stringify(manifest, null, 2));
console.log('manifest:', manifest.length, 'cases,', controls.length, 'controls ->', OUT);
