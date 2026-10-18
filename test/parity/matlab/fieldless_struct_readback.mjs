// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_fieldless_struct_readback.m (F1-9, run for group F on 2026-10-18): a copy
// of MATLAB's own repmat(struct(), 1e4, 1e4) (test/fixtures/mcos/fieldless_1e4x1e4.mat, the 181
// bytes MATLAB's `save` wrote), pasted through core's API into a text and a binary dictionary as an
// entry's value, a struct field and a cell's element, and saved. A text dictionary is given a
// 132-byte cdata stream for it and a binary one a 72-byte hex stream (MatlabVariableNode's
// _unexpandedStruct): MATLAB's own spelling is one element per element, 1e8 `<Element/>` (2.3 GB
// of chunk0.xml) or 1e8 `{}` (1.2 GB of text), which no save of this package could write.
//
// fieldlessStructReadback(core, read) returns { files, cases }: the saved dictionaries by name,
// and one row per place, its `fragment` the stream as written (a text dictionary's cdata `_value`,
// a binary one's `<P …>` or `<Element …>` span). test/fieldlessStructReadback.test.ts calls it with
// the package's source and compares each fragment with the one MATLAB read back, so that a change
// to the spelling asks for MATLAB to be asked again.
//
// Run: node test/parity/matlab/fieldless_struct_readback.mjs /tmp/fieldless
// with dist built; then probe_fieldless_struct_readback.m with FIELDLESS_OUT set to the same directory.
import { strFromU8, unzipSync } from 'fflate';

const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
export const HOSTS = ['char_text.sldd', 'char_binary.sldd', 'sparse/sparse_text.sldd', 'sparse/sparse_binary.sldd'];
export const PLACES = { entry: 'bigPasted', field: 'bigInField', cell: 'bigInCell' };

/** The `<P …>` or `<Element …>` starting at `from` in `xml`, through its close: a hex stream's body holds no tag. */
function spanFrom(xml, from) {
  const tag = xml.startsWith('<Element', from) ? 'Element' : 'P';
  const close = '</' + tag + '>';
  return xml.slice(from, xml.indexOf(close, from) + close.length);
}

/** The stream at `place` of the entry named `name` in a saved dictionary. */
function streamAt(saved, name, place) {
  if (saved.kind === 'text') {
    const entries = JSON.parse(saved.text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const value = entries.find((e) => e.name === name).value;
    const stream = place === 'entry' ? value : place === 'field' ? value._elements[0].f : value._elements[0];
    return JSON.stringify(stream);
  }
  const xml = strFromU8(unzipSync(saved.bytes)['data/chunk0.xml']);
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  const value = xml.indexOf('<P Name="Value"', at);
  if (place === 'entry') {
    return spanFrom(xml, value);
  }
  const inner = xml.indexOf(place === 'field' ? '<P Name="f"' : '<Element', value + 1);
  return spanFrom(xml, inner);
}

/** `core` is { createSession, ingest }; `read(rel)` the bytes of a test fixture. */
export function fieldlessStructReadback(core, read) {
  const { createSession, ingest } = core;
  const session = createSession();
  const mat = session.addMatSource('fieldless_1e4x1e4.mat', ab(read('mcos/fieldless_1e4x1e4.mat')), { path: 'fieldless_1e4x1e4.mat' });
  const value = JSON.parse(JSON.stringify(mat.children.find((c) => c.name === 'big').serialize().value));
  const files = {};
  const cases = [];
  HOSTS.forEach((host, h) => {
    const base = host.split('/').pop();
    const s = createSession();
    const root = ingest(s, ab(read(host)), { filename: base });
    const design = root.getSection('design');
    // The section's own metadata, as a host's paste gives it: an entry with no namespace makes a
    // dictionary MATLAB refuses to open at all.
    const meta = (k) => ({ ...design.children[0].metadata, uuid: '00000000-0000-4000-e9f9-' + String(h * 3 + k).padStart(12, '0') });
    design.parseEntry({ name: PLACES.entry, metadata: meta(1), value });
    design.parseEntry({ name: PLACES.field, metadata: meta(2), value: { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: value }], _mw_element_type: 'MATLABArray' } });
    design.parseEntry({ name: PLACES.cell, metadata: meta(3), value: { _array_type: 'Cell', _dimensions: [1, 1], _elements: [value], _mw_element_type: 'MATLABArray' } });
    const saved = s.serializeSource(root.name);
    const file = 'fieldless_' + base;
    files[file] = saved.kind === 'text' ? saved.text : saved.bytes;
    for (const [place, name] of Object.entries(PLACES)) {
      cases.push({ file, format: saved.kind, place, entry: name, fragment: streamAt(saved, name, place) });
    }
  });
  return { files, cases };
}

// As a script: the saves and cases.json into a directory, from the built package.
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const [outDir] = process.argv.slice(2);
  if (!outDir) {
    throw new Error('usage: node fieldless_struct_readback.mjs <out dir>');
  }
  const here = fileURLToPath(new URL('.', import.meta.url));
  const core = await import(join(here, '..', '..', '..', 'dist', 'index.js'));
  const read = (rel) => new Uint8Array(readFileSync(join(here, '..', '..', 'fixtures', rel)));
  const { files, cases } = fieldlessStructReadback(core, read);
  mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(outDir, name), bytes);
  }
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(cases, null, 2) + '\n');
  console.log('wrote', Object.keys(files).length, 'saves and', cases.length, 'cases to', outDir);
}
