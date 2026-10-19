// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_struct_absent_fields_binary.m: the binary dictionaries MATLAB is asked to
// read back. A struct some of whose elements do not hold a field the struct has (an element `{}`
// or `null`, or one holding only some of the fields), or hold them in another order than its
// `_fields`, is pasted through core's API into MATLAB's
// own binary dictionary of lossy_empties_readback (test/fixtures/lossy_empties_readback_binary.sldd)
// at each place core writes a struct from its bag rather than from a struct's rows
// (DataNode._structXml): a Simulink.Parameter's Value, an object's property (Widget.Scalar), a
// struct in a cell at that property, and a struct in a field of a struct at that property.
//
// Each struct is pasted in the forms a save could write it in, each spelled at the place:
//   held      every element with only the fields it holds, in its order, as core wrote it before
//             B-17 (`<Element></Element>` for `{}` or `null`);
//   filled    each field the struct has (its `_fields`, or element 1's) in that order, one the
//             element does not hold as `[]`, then what else the element holds, as core writes it;
//   appended  the same `[]` after what the element holds, where that order differs;
// and, as the source a copy comes from, the held bag pasted at the same place into MATLAB's own
// text dictionary custom_object_text.sldd (form `text`). The held and appended spellings are
// written here (heldXml), not by core's writer, and spliced into the struct core saved at the
// place, so the file holds them whatever core now writes. Each is saved alone to
// <outdir>/<name>.sldd, so a file MATLAB cannot read says so for its own entry only.
// <outdir>/names.json lists each file's entry, its case, form and place, and the spelling at the
// place (the struct's element, whitespace between tags dropped; for `text`, its JSON), which the
// probe copies into its truth.
//
// Run, with dist built:  node test/parity/matlab/struct_absent_fields_binary.mjs /tmp/sab
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const out = process.argv[2];
if (!out) {
  throw new Error('usage: node struct_absent_fields_binary.mjs <outdir>');
}
const core = await import(new URL('../../../dist/index.js', import.meta.url).href);
const BINARY = fileURLToPath(new URL('../../fixtures/lossy_empties_readback_binary.sldd', import.meta.url));
const TEXT = fileURLToPath(new URL('../../fixtures/custom_object_text.sldd', import.meta.url));
const buf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

const PLACES = ['param', 'prop', 'pcell', 'pfield'];
const PREFIX = { param: 'p_', prop: 'w_', pcell: 'c_', pfield: 's_' };
// Where the struct at each place opens, in the entry's XML: the last tag of the match.
const OPENS = {
  param: /<Element Class="Simulink.Parameter">\s*<P Name="Value"[^>]*>/,
  prop: /<P Name="Scalar"[^>]*>/,
  pcell: /<P Name="Scalar" Class="cell"[^>]*>\s*<Element[^>]*>/,
  pfield: /<P Name="Scalar"[^>]*>\s*<Element[^>]*>\s*<P Name="f"[^>]*>/,
};
const S = (elements, fields) => ({
  _array_type: 'Struct',
  _dimensions: [1, elements.length],
  _elements: elements,
  ...(fields ? { _fields: fields } : {}),
  _mw_element_type: 'MATLABArray',
});
// Each case, its forms. `fields` is the struct's field list as core reads it.
const CASES = [
  { id: 'A2', fields: ['a'], held: S([{ a: 1 }, {}]), filled: S([{ a: 1 }, { a: [] }]) },
  { id: 'N2', fields: ['a'], held: S([{ a: 1 }, null]), filled: S([{ a: 1 }, { a: [] }]) },
  { id: 'A1', fields: ['a'], held: S([{}], ['a']), filled: S([{ a: [] }], ['a']) },
  { id: 'N1', fields: ['a'], held: S([null], ['a']), filled: S([{ a: [] }], ['a']) },
  { id: 'F2', fields: ['a', 'b'], held: S([{ a: 1, b: 2 }, { b: 3 }]), filled: S([{ a: 1, b: 2 }, { a: [], b: 3 }]), appended: S([{ a: 1, b: 2 }, { b: 3, a: [] }]) },
  {
    id: 'L2',
    fields: ['a', 'b'],
    held: S([{ b: 2 }, { a: 1, b: 3 }], ['a', 'b']),
    filled: S([{ a: [], b: 2 }, { a: 1, b: 3 }], ['a', 'b']),
    appended: S([{ b: 2, a: [] }, { a: 1, b: 3 }], ['a', 'b']),
  },
  { id: 'X2', fields: ['a'], held: S([{ a: 1 }, { b: 2 }]), filled: S([{ a: 1 }, { a: [], b: 2 }]), appended: S([{ a: 1 }, { b: 2, a: [] }]) },
  // Every field held, in another order than the struct's `_fields`, as MATLAB's own text
  // dictionaries hold their structs (the keys sorted, `_fields` in the struct's order).
  { id: 'R1', fields: ['b', 'a'], held: S([{ a: 1, b: 2 }], ['b', 'a']), filled: S([{ b: 2, a: 1 }], ['b', 'a']) },
  { id: 'R2', fields: ['b', 'a'], held: S([{ a: 1, b: 2 }, { a: 3, b: 4 }], ['b', 'a']), filled: S([{ b: 2, a: 1 }, { b: 4, a: 3 }], ['b', 'a']) },
  // The controls: every element holds every field, as MATLAB writes a struct; C2 holds a field
  // as [], which a Parameter's Value cannot (PrmInvalidStruct, parameter_value_truth.json).
  { id: 'C2', fields: ['a'], held: S([{ a: 1 }, { a: [] }]) },
  { id: 'C1', fields: ['a'], held: S([{ a: 1 }]) },
  { id: 'C3', fields: ['a'], held: S([{ a: 1 }, { a: 2 }]) },
];
const FORMS = ['held', 'filled', 'appended', 'text'];
const LETTER = { held: 'H', filled: 'F', appended: 'P', text: 'T' };
const entriesOf = (text) => JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
// Where the struct is in an entry's value as a text dictionary holds it.
const IN_TEXT = {
  param: (v) => v._elements[0]._properties.Value,
  prop: (v) => v._elements[0]._properties.Scalar,
  pcell: (v) => v._elements[0]._properties.Scalar._elements[0],
  pfield: (v) => v._elements[0]._properties.Scalar._elements[0].f,
};

/** The value of an entry that holds `v` at `place`; the Parameter and the Widget are MATLAB's own, copied out of the file. */
function valueAt(bin, place, v) {
  const copied = (section, name) => JSON.parse(JSON.stringify(bin.getSection(section).children.find((e) => e.name === name).serialize().value));
  if (place === 'param') {
    const p = copied('design', 'p_D022');
    p._elements[0]._properties.Value = v;
    p._elements[0]._properties.Dimensions = v._dimensions;
    return p;
  }
  const w = copied('other', 'w_D022');
  w._elements[0]._properties.Scalar =
    place === 'prop'
      ? v
      : place === 'pcell'
        ? { _array_type: 'Cell', _dimensions: [1, 1], _elements: [v], _mw_element_type: 'MATLABArray' }
        : S([{ f: v }], ['f']);
  return w;
}

/** Where the element of `xml` that opens at `from` ends its opening tag, and where its closing tag starts and ends. */
function extentAt(xml, from) {
  const tag = /<(\/?)[^>]*?(\/?)>/g;
  tag.lastIndex = from;
  let depth = 0;
  let open = -1;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    depth += m[1] ? -1 : m[2] ? 0 : 1;
    if (open < 0) {
      open = tag.lastIndex;
    }
    if (depth === 0) {
      return { open, close: m.index, end: tag.lastIndex };
    }
  }
  return null;
}

/** The element of `xml` that opens at `from`, through its close, with no whitespace between tags. */
function elementAt(xml, from) {
  const at = extentAt(xml, from);
  return at ? xml.slice(from, at.end).replace(/>\s+</g, '><') : '?';
}

/** The `<Element>`s of struct bag `v`, each with only the fields it holds, in its order (its doubles and `[]` only). */
function heldXml(v) {
  const field = ([f, x]) =>
    Array.isArray(x) && x.length === 0 ? '<P Name="' + f + '" Class="double" Dimension="0*0"/>' : '<P Name="' + f + '" Class="double">' + (Number.isInteger(x) ? x + '.0' : x) + '</P>';
  const bag = (e) => (e !== null && typeof e === 'object' && !Array.isArray(e) ? e : {});
  return v._elements.map((e) => '<Element>' + Object.entries(bag(e)).map(field).join('') + '</Element>').join('');
}

mkdirSync(out, { recursive: true });
const names = [];
let n = 0;
for (const c of CASES) {
  for (const form of FORMS.filter((f) => c[f === 'text' ? 'held' : f])) {
    for (const place of PLACES) {
      const name = PREFIX[place] + LETTER[form] + c.id;
      const section = place === 'param' ? 'design' : 'other';
      const bin = core.ingest(core.createSession(), buf(new Uint8Array(readFileSync(BINARY))), { filename: 'lossy_empties_readback_binary.sldd' });
      const value = valueAt(bin, place, JSON.parse(JSON.stringify(c[form === 'text' ? 'held' : form])));
      const session = core.createSession();
      const dict = form === 'text'
        ? core.ingest(session, readFileSync(TEXT, 'utf8'), { filename: 'custom_object_text.sldd' })
        : core.ingest(session, buf(new Uint8Array(readFileSync(BINARY))), { filename: 'lossy_empties_readback_binary.sldd' });
      const into = dict.getSection(section);
      into.parseEntry({ name, metadata: { ...into.children[0].metadata, uuid: '00000000-0000-4000-a950-' + String(++n).padStart(12, '0') }, value });
      if (form === 'text') {
        const text = session.serializeSource(dict.name).text;
        writeFileSync(out + '/' + name + '.sldd', text);
        names.push({ id: c.id, fields: c.fields, form, place, name, section, spelling: JSON.stringify(IN_TEXT[place](entriesOf(text).find((e) => e.name === name).value)) });
        continue;
      }
      const parts = unzipSync(session.serializeSource(dict.name).bytes);
      let xml = strFromU8(parts['data/chunk0.xml']);
      const at = xml.indexOf('>' + name + '<');
      const m = OPENS[place].exec(xml.slice(at));
      const from = m ? at + m.index + m[0].lastIndexOf('<') : -1;
      if (from >= 0 && form !== 'filled') {
        const { open, close } = extentAt(xml, from);
        xml = xml.slice(0, open) + heldXml(c[form]) + xml.slice(close);
        parts['data/chunk0.xml'] = strToU8(xml);
      }
      const spelling = from >= 0 ? elementAt(xml, from) : '?';
      writeFileSync(out + '/' + name + '.sldd', zipSync(parts, { mtime: new Date('2026-10-19T00:00:00Z') }));
      names.push({ id: c.id, fields: c.fields, form, place, name, section, spelling });
    }
  }
}
writeFileSync(out + '/names.json', JSON.stringify(names, null, 1));
console.log('wrote', names.length, 'dictionaries to', out);
for (const r of names) console.log(r.name.padEnd(8), r.form.padEnd(8), r.place.padEnd(6), r.spelling);
