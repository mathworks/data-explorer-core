// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_empty_copies_readback.m: does MATLAB read back, as `load` reads the .mat
// variable, a copy of a struct array of no element with fields, and of a complex empty, pasted
// through core's API into a text and a binary dictionary, as an entry's value, a struct field and
// a cell's element?
//
// The values are MATLAB's own, dispcat.mat's: struct('a', {}) as a 0x0 and a 1x0, and
// complex(zeros(0,0)), complex(zeros(1,0)), a complex int16 1x0 and a complex single 1x0. Each is
// copied as a host copies it (serialize().value), as read and once marked edited (the mark an
// edit and its undo leave, which writes the value from its rows). Core spells them:
//   - in a binary dictionary, as MATLAB's own binary dictionary of the same variables does
//     (dispcat_bin.sldd): `<Field Name="a"/>` inside a struct of no element, `IsComplex="1"` on
//     an empty;
//   - in a text dictionary, where MATLAB's own spelling of each loses it (`{"_type": "struct",
//     "_value": "[]"}`, `[]`; dispcat_text.sldd), a struct of no element as the bag
//     `{"_elements": [], "_fields": ["a"]}` and a complex empty as its MAT stream (cdata).
//
// emptyCopiesReadback(core, read) returns { files, cases }: the saved dictionaries by name, and
// one row per place, its `fragment` the value as written there (a text dictionary's JSON, a binary
// one's `<P …>` or `<Element …>` span). test/emptyCopiesReadback.test.ts calls it with the
// package's source and compares each fragment with the one MATLAB read back.
//
// Run: node test/parity/matlab/empty_copies_readback.mjs /tmp/emptycopies
// with dist built; then probe_empty_copies_readback.m with EMPTY_COPIES_OUT set to the same directory.
import { strFromU8, unzipSync } from 'fflate';

const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
export const HOSTS = ['sparse/sparse_text.sldd', 'sparse/sparse_binary.sldd'];
export const VARIABLES = ['dx_struct_0x0_fields', 'dx_struct_1x0', 'dx_complex_0x0', 'dx_complex_1x0', 'dx_complex_int16_1x0', 'e_single_complex_1x0'];
export const PLACES = ['entry', 'field', 'cell'];

/** The `<P …>` or `<Element …>` starting at `from` in `xml`, through its close (or its own `/>`). */
function spanFrom(xml, from) {
  const tag = xml.startsWith('<Element', from) ? 'Element' : 'P';
  const end = xml.indexOf('>', from);
  if (xml[end - 1] === '/') {
    return xml.slice(from, end + 1);
  }
  const close = '</' + tag + '>';
  return xml.slice(from, xml.indexOf(close, from) + close.length).replace(/\s+/g, ' ');
}

/** The value at `place` of the entry named `name` in a saved dictionary. */
function fragmentAt(saved, name, place) {
  if (saved.kind === 'text') {
    const entries = JSON.parse(saved.text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const value = entries.find((e) => e.name === name).value;
    return JSON.stringify(place === 'entry' ? value : place === 'field' ? value._elements[0].f : value._elements[0]);
  }
  const xml = strFromU8(unzipSync(saved.bytes)['data/chunk0.xml']);
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  const value = xml.indexOf('<P Name="Value"', at);
  if (place === 'entry') {
    return spanFrom(xml, value);
  }
  return spanFrom(xml, xml.indexOf(place === 'field' ? '<P Name="f"' : '<Element', value + 1));
}

/** `core` is { createSession, ingest }; `read(rel)` the bytes of a test fixture. */
export function emptyCopiesReadback(core, read) {
  const { createSession, ingest } = core;
  const copyOf = (name, edited) => {
    const mat = createSession().addMatSource('dispcat.mat', ab(read('display/dispcat.mat')));
    const node = mat.children.find((c) => c.name === name);
    if (edited) {
      node._markModified();
    }
    return JSON.parse(JSON.stringify(node.serialize().value));
  };
  const files = {};
  const cases = [];
  HOSTS.forEach((host, h) => {
    const base = host.split('/').pop();
    const s = createSession();
    const root = ingest(s, ab(read(host)), { filename: base });
    const design = root.getSection('design');
    let k = 0;
    // The section's own metadata, as a host's paste gives it: an entry with no namespace makes a
    // dictionary MATLAB refuses to open at all.
    const meta = () => ({ ...design.children[0].metadata, uuid: '00000000-0000-4000-e9fa-' + String(h * 100 + ++k).padStart(12, '0') });
    const rows = [];
    VARIABLES.forEach((variable, v) => {
      for (const edited of [false, true]) {
        const value = copyOf(variable, edited);
        for (const place of PLACES) {
          const entry = 'e' + v + (edited ? 'm' : 'u') + place[0];
          const held =
            place === 'entry'
              ? value
              : place === 'field'
                ? { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: value }], _mw_element_type: 'MATLABArray' }
                : { _array_type: 'Cell', _dimensions: [1, 1], _elements: [value], _mw_element_type: 'MATLABArray' };
          design.parseEntry({ name: entry, metadata: meta(), value: held });
          rows.push({ variable, edited, place, entry });
        }
      }
    });
    const saved = s.serializeSource(root.name);
    const file = 'empty_copies_' + base;
    files[file] = saved.kind === 'text' ? saved.text : saved.bytes;
    for (const row of rows) {
      cases.push({ file, format: saved.kind, ...row, fragment: fragmentAt(saved, row.entry, row.place) });
    }
  });
  return { files, cases };
}

// As a script: the saves, dispcat.mat (the values MATLAB compares them with) and cases.json into a
// directory, from the built package.
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const [outDir] = process.argv.slice(2);
  if (!outDir) {
    throw new Error('usage: node empty_copies_readback.mjs <out dir>');
  }
  const here = fileURLToPath(new URL('.', import.meta.url));
  const core = await import(join(here, '..', '..', '..', 'dist', 'index.js'));
  const read = (rel) => new Uint8Array(readFileSync(join(here, '..', '..', 'fixtures', rel)));
  const { files, cases } = emptyCopiesReadback(core, read);
  mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(outDir, name), bytes);
  }
  writeFileSync(join(outDir, 'dispcat.mat'), read('display/dispcat.mat'));
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(cases, null, 2) + '\n');
  console.log('wrote', Object.keys(files).length, 'saves and', cases.length, 'cases to', outDir);
}
