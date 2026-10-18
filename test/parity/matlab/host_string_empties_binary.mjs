// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_host_string_empties_binary.m: the binary dictionaries MATLAB is asked to
// read back. An empty string (0x3, 0x0 and 1x0) is pasted through core's API into MATLAB's own
// binary dictionary of lossy_empties_readback (test/fixtures/lossy_empties_readback_binary.sldd) at
// one place each: an entry's value, a cell's element, a struct field, a Simulink.Parameter's Value
// and Widget.Scalar, an object's property in Other Data. It is pasted in each form a host hands one
// in as:
//   host    `{_type: 'string', _emptyDims: [r, c]}`;
//   bag     the String bag, MATLAB's own spelling of it in a text dictionary (a copy out of one);
//   header  `{_type: 'string', _value: 'Matrix(r,c)', _binary_empty: true}`, the binary reader's
//           hold of `Class="string" Dimension="r*c"/>` (a copy out of a binary dictionary);
// and, once at each place, `[]`, a double 0x0, the control. Each is saved alone, as core saves a
// binary dictionary, to <outdir>/<name>.sldd, so a file MATLAB cannot read says so for its own
// entry only. <outdir>/names.json lists each file's entry, its form, its place and the XML core
// wrote there (the element at the place, whitespace between tags dropped), which the probe copies
// into its truth.
//
// Run, with dist built:  node test/parity/matlab/host_string_empties_binary.mjs /tmp/hsb
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';

const out = process.argv[2];
if (!out) {
  throw new Error('usage: node host_string_empties_binary.mjs <outdir>');
}
const core = await import(new URL('../../../dist/index.js', import.meta.url).href);
const BINARY = fileURLToPath(new URL('../../fixtures/lossy_empties_readback_binary.sldd', import.meta.url));
const buf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

const PLACES = ['entry', 'cell', 'field', 'param', 'prop'];
const PREFIX = { entry: 'e_', cell: 'c_', field: 's_', param: 'p_', prop: 'w_' };
// Where the element at each place opens, in the entry's XML: the last tag of the match.
const OPENS = {
  entry: /<P Name="Value"[^>]*>/,
  cell: /<P Name="Value" Class="cell"[^>]*>\s*<Element[^>]*>/,
  field: /<P Name="f"[^>]*>/,
  param: /<Element Class="Simulink.Parameter">\s*<P Name="Value"[^>]*>/,
  prop: /<P Name="Scalar"[^>]*>/,
};
const DIMS = { S03: [0, 3], S00: [0, 0], S10: [1, 0] };
const FORMS = {
  host: (d) => ({ _type: 'string', _emptyDims: d }),
  bag: (d) => ({ _array_type: 'String', _dimensions: d, _elements: [], _mw_element_type: 'MATLABArray' }),
  header: (d) => ({ _type: 'string', _value: 'Matrix(' + d.join(',') + ')', _binary_empty: true }),
};
const CASES = [
  ...Object.entries(FORMS).flatMap(([form, of]) => Object.entries(DIMS).map(([id, dims]) => ({ id, form, dims, value: of(dims) }))),
  { id: 'D00', form: 'control', dims: [0, 0], value: [] },
];
const LETTER = { host: 'H', bag: 'B', header: 'R', control: 'C' };

/** The value of an entry that holds `v` at `place`; the Parameter and the Widget are MATLAB's own, copied out of the file. */
function valueAt(bin, place, v, dims) {
  const copied = (section, name) => JSON.parse(JSON.stringify(bin.getSection(section).children.find((e) => e.name === name).serialize().value));
  switch (place) {
    case 'entry':
      return v;
    case 'cell':
      return { _array_type: 'Cell', _dimensions: [1, 1], _elements: [v], _mw_element_type: 'MATLABArray' };
    case 'field':
      return { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: v }], _fields: ['f'], _mw_element_type: 'MATLABArray' };
    case 'param': {
      const p = copied('design', 'p_D022');
      p._elements[0]._properties.Value = v;
      p._elements[0]._properties.Dimensions = dims;
      return p;
    }
    case 'prop': {
      const w = copied('other', 'w_D022');
      w._elements[0]._properties.Scalar = v;
      return w;
    }
  }
}

/** The element of `xml` that opens at `from`, through its close, with no whitespace between tags. */
function elementAt(xml, from) {
  const tag = /<(\/?)[^>]*?(\/?)>/g;
  tag.lastIndex = from;
  let depth = 0;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    depth += m[1] ? -1 : m[2] ? 0 : 1;
    if (depth === 0) {
      return xml.slice(from, tag.lastIndex).replace(/>\s+</g, '><');
    }
  }
  return '?';
}

mkdirSync(out, { recursive: true });
const names = [];
let n = 0;
for (const { id, form, dims, value } of CASES) {
  for (const place of PLACES) {
    const name = PREFIX[place] + LETTER[form] + id;
    const section = place === 'prop' ? 'other' : 'design';
    const session = core.createSession();
    const bin = core.ingest(session, buf(new Uint8Array(readFileSync(BINARY))), { filename: 'lossy_empties_readback_binary.sldd' });
    const into = bin.getSection(section);
    into.parseEntry({
      name,
      metadata: { ...into.children[0].metadata, uuid: '00000000-0000-4000-a930-' + String(++n).padStart(12, '0') },
      value: valueAt(bin, place, JSON.parse(JSON.stringify(value)), dims),
    });
    const bytes = session.serializeSource(bin.name).bytes;
    const xml = strFromU8(unzipSync(bytes)['data/chunk0.xml']);
    const at = xml.indexOf('>' + name + '<');
    const m = OPENS[place].exec(xml.slice(at));
    const spelling = m ? elementAt(xml, at + m.index + m[0].lastIndexOf('<')) : '?';
    writeFileSync(out + '/' + name + '.sldd', bytes);
    names.push({ id, form, dims, place, name, section, spelling });
  }
}
writeFileSync(out + '/names.json', JSON.stringify(names, null, 1));
console.log('wrote', names.length, 'dictionaries to', out);
for (const r of names) console.log(r.name.padEnd(8), r.form.padEnd(7), r.place.padEnd(5), r.spelling);
