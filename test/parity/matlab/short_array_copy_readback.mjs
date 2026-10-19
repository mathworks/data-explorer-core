// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_short_array_copy_readback.m (B-26 of group H). A .mat file's struct array
// or cell whose bytes hold fewer elements than it declares (a 1x3 struct holding 2, a 1x3 cell
// holding 1, a 2x2 struct cut inside its third element, ones holding none, N-D ones) opens with a
// warning, "declares 3 element(s) and only 2 could be read", and a row for each element held. Its
// copy was the declared size beside only the elements held: a struct bag `_dimensions [1,3]` with
// 2 `_elements`, written in a binary dictionary as `Class="struct" Dimension="1*3"` with two
// `<Element>`s, and a cell holding none as `Dimension="0*0"`. An N-D one copies as the MAT stream
// MatWriter encodes for it. Would MATLAB read any of those as the padded value core showed? MATLAB
// is asked twice for each: what `load` reads of the .mat variable, and what it reads of the copy
// pasted through core's API into a text and a binary dictionary as an entry. A 1x3 struct and a
// 1x3 cell holding every element are the controls: core copies them. The copies of a rank-2 one
// holding none, which MATLAB did not read back as it, are refused now (MatlabVariableNode._heldNone);
// this writes each as core copied it before.
//
// shortArrayCopyReadback(core, mat, read) returns { files, cases }: the .mat files and the saved
// dictionaries by name, and one row per case and venue, its `fragment` what the save holds (a text
// dictionary's entry value as JSON, a binary one's `<P Name="Value" …>` span). `core` is
// { createSession, ingest, uuencode, encodeMatStream }, `mat` the byte builders of
// test/tools/matBytes.ts, and `read(rel)` a test fixture's bytes. test/shortArrayCopy.test.ts calls
// it with the package's source and compares each fragment with the one MATLAB read, so that a
// change to the spelling asks for MATLAB to be asked again.
//
// Run, with dist built:  node test/parity/matlab/short_array_copy_readback.mjs /tmp/shortcopy
// then probe_short_array_copy_readback.m with SHORT_COPY_OUT set to the same directory.
import { strFromU8, unzipSync } from 'fflate';

const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
export const HOSTS = { text: 'sparse/sparse_text.sldd', binary: 'sparse/sparse_binary.sldd' };

/** Each case: the variable `v` it is, and whether it holds every element it declares (a control). */
export function shortArrays(mat) {
  const one = (n) => mat.numericVar({ name: '', cls: mat.CLASS.DOUBLE, dimensions: [1, 1], real: [n] });
  const bags = (n) => Array.from({ length: n }, (_, i) => ({ a: one(i + 1) }));
  const cells = (n) => Array.from({ length: n }, (_, i) => one(7 + i));
  // A 2x2 struct with fields a and b whose bytes hold elements 1 and 2 and element 3's a: the
  // record claims what it holds, as structVar's do.
  const partial = () => {
    const names = new Uint8Array(64);
    names.set([0x61], 0);
    names.set([0x62], 32);
    return mat.matrix([
      mat.arrayFlags(mat.CLASS.STRUCT), mat.dims([2, 2]), mat.varName('v'),
      mat.element(mat.MI.INT32, Uint8Array.from([32, 0, 0, 0])), mat.element(mat.MI.INT8, names),
      one(1), one(2), one(3), one(4), one(5),
    ]);
  };
  return {
    struct_short: { build: () => mat.structVar('v', ['a'], bags(2), [1, 3]), full: false },
    struct_none: { build: () => mat.structVar('v', ['a'], bags(0), [1, 3]), full: false },
    struct_partial: { build: partial, full: false },
    cell_short: { build: () => mat.cellVar('v', cells(1), [1, 3]), full: false },
    cell_none: { build: () => mat.cellVar('v', cells(0), [1, 3]), full: false },
    cell_2x2_short: { build: () => mat.cellVar('v', cells(3), [2, 2]), full: false },
    struct_nd_short: { build: () => mat.structVar('v', ['a'], bags(2), [1, 1, 3]), full: false },
    struct_nd_none: { build: () => mat.structVar('v', ['a'], bags(0), [1, 1, 3]), full: false },
    cell_nd_short: { build: () => mat.cellVar('v', cells(1), [1, 1, 3]), full: false },
    cell_nd_none: { build: () => mat.cellVar('v', cells(0), [1, 1, 3]), full: false },
    struct_full: { build: () => mat.structVar('v', ['a'], bags(3), [1, 3]), full: true },
    cell_full: { build: () => mat.cellVar('v', cells(3), [1, 3]), full: true },
  };
}

/**
 * What core copied of `v`, a short one's as it did before its copy was refused: a rank-2 struct
 * array's bag and a cell's as the node builds them (MatlabVariableNode._serializeStructValue,
 * _serializeCell), an N-D one's as the stream MatWriter encodes for it (_matStream). A control's
 * is its copy.
 */
function copyOf(core, v, full) {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  if (full) {
    return clone(v.serialize().value);
  }
  if (v._dims.length > 2) {
    return { _type: 'cdata', _value: core.uuencode(core.encodeMatStream(v._var)) };
  }
  return clone(v._kind === 'cell' ? v._serializeCell() : v._serializeStructValue());
}

/** The value at entry `name` of a saved dictionary: a text one's as JSON, a binary one's `<P Name="Value" …>…</P>`. */
function fragmentOf(saved, name) {
  if (saved.kind === 'text') {
    const entries = JSON.parse(saved.text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    return JSON.stringify(entries.find((e) => e.name === name).value);
  }
  const xml = strFromU8(unzipSync(saved.bytes)['data/chunk0.xml']);
  const at = xml.indexOf('<P Name="Value"', xml.indexOf('<P Name="Name" Class="char">' + name + '</P>'));
  const selfClosed = xml.indexOf('/>', at);
  const open = xml.indexOf('>', at);
  if (selfClosed >= 0 && selfClosed < open) {
    return xml.slice(at, selfClosed + 2);
  }
  // The `</P>` that closes this one, past the `<P …>…</P>` of each field it holds.
  let depth = 0;
  const tag = /<P\b[^>]*?(\/?)>|<\/P>/g;
  tag.lastIndex = at;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    if (m[0] === '</P>') {
      depth--;
    } else if (m[1] !== '/') {
      depth++;
    }
    if (depth === 0) {
      return xml.slice(at, m.index + m[0].length);
    }
  }
  throw new Error('no end to the Value of ' + name);
}

export function shortArrayCopyReadback(core, mat, read) {
  const { createSession, ingest } = core;
  const files = {};
  const cases = [];
  let seq = 0;
  for (const [id, { build, full }] of Object.entries(shortArrays(mat))) {
    const bytes = new Uint8Array(mat.matFile([build()]));
    files[id + '.mat'] = bytes;
    const v = createSession().addMatSource(id + '.mat', ab(bytes)).children[0];
    const value = copyOf(core, v, full);
    for (const [format, host] of Object.entries(HOSTS)) {
      const s = createSession();
      const root = ingest(s, ab(read(host)), { filename: host.split('/').pop() });
      const design = root.getSection('design');
      // The section's own metadata, as a host's paste gives it (fieldless_struct_readback.mjs).
      const metadata = { ...design.children[0].metadata, uuid: '00000000-0000-4000-eb26-' + String(++seq).padStart(12, '0') };
      design.parseEntry({ name: 'pasted', metadata, value });
      const saved = s.serializeSource(root.name);
      const file = id + '_' + format + '.sldd';
      files[file] = saved.kind === 'text' ? saved.text : saved.bytes;
      cases.push({ id, full, mat: id + '.mat', file, format, entry: 'pasted', fragment: fragmentOf(saved, 'pasted') });
    }
  }
  return { files, cases };
}

// As a script: the .mat files, the saves and cases.json into a directory, from the built package.
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const [outDir] = process.argv.slice(2);
  if (!outDir) {
    throw new Error('usage: node short_array_copy_readback.mjs <out dir>');
  }
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dist = join(here, '..', '..', '..', 'dist');
  const { createSession, ingest } = await import(join(dist, 'index.js'));
  const { uuencode } = await import(join(dist, 'datamodel', 'parser', 'CdataCodec.js'));
  const { encodeMatStream } = await import(join(dist, 'datamodel', 'parser', 'MatWriter.js'));
  const mat = await import(join(here, '..', '..', 'tools', 'matBytes.ts'));
  const read = (rel) => new Uint8Array(readFileSync(join(here, '..', '..', 'fixtures', rel)));
  const { files, cases } = shortArrayCopyReadback({ createSession, ingest, uuencode, encodeMatStream }, mat, read);
  mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(outDir, name), bytes);
  }
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(cases, null, 2) + '\n');
  console.log('wrote', Object.keys(files).length, 'files and', cases.length, 'cases to', outDir);
}
