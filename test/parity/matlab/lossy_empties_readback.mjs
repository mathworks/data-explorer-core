// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_lossy_empties_readback.m (agenda follow-up 4 of group F's reviews, run for
// group G on 2026-10-18): the candidate text-dictionary spellings MATLAB is asked to read back, each
// as the JSON text a text dictionary holds at a place. Each MAT stream is the one core writes for a
// host's N-D `{_type, _emptyDims}` pasted into a text dictionary as an entry; each other spelling
// is a literal: MATLAB's own spelling of an empty string (the String bag, with and without
// `_mw_element_type`), the forms a host hands in, the bare `Matrix(…)` headers, and the bag core
// wrote in a cell for a binary dictionary's N-D empty enumeration.
//
// Run, with dist built:  node test/parity/matlab/lossy_empties_readback.mjs /tmp/lossyempty
// which writes /tmp/lossyempty/cands.json for the probe.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const out = process.argv[2];
if (!out) {
  throw new Error('usage: node lossy_empties_readback.mjs <outdir>');
}
const core = await import(new URL('../../../dist/index.js', import.meta.url).href);
const bytes = (rel) => new Uint8Array(readFileSync(fileURLToPath(new URL('../../fixtures/' + rel, import.meta.url))));
const buf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const entriesOf = (text) => JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
const flat = (n, o = []) => {
  o.push(n);
  for (const c of n.children ?? []) flat(c, o);
  return o;
};

/** What a text dictionary is given for `value` pasted into it as an entry. */
function written(value) {
  const session = core.createSession();
  const txt = core.ingest(session, buf(bytes('custom_object_text.sldd')), { filename: 'custom_object_text.sldd' });
  const design = txt.getSection('design');
  design.parseEntry({ name: 'x', metadata: { ...design.children[0].metadata, uuid: '00000000-0000-4000-a800-000000000001' }, value });
  return entriesOf(session.serializeSource(txt.name).text).find((e) => e.name === 'x').value;
}

/** The bag a text dictionary was given in a cell for a binary dictionary's GearMode 0x2x2, before this item. */
function enumBagInCell() {
  const xml = strFromU8(unzipSync(bytes('custom_object_binary.sldd'))['data/chunk0.xml']);
  const NOTHING = '                <P Name="Nothing" Class="double" Dimension="0*0"/>';
  const files = unzipSync(bytes('custom_object_binary.sldd'));
  files['data/chunk0.xml'] = strToU8(xml.replace(NOTHING, NOTHING + '\n                <P Name="C" Class="cell" Dimension="1*1">\n                    <Element IsEnum="1" Class="GearMode" Dimension="0*2*2"/>\n                </P>'));
  const bin = core.ingest(core.createSession(), buf(zipSync(files)), { filename: 'custom_object_binary.sldd' });
  const payload = JSON.parse(JSON.stringify(flat(bin).find((n) => n?.isEntry && n.name === 'widget').serialize()));
  const session = core.createSession();
  const txt = core.ingest(session, buf(bytes('custom_object_text.sldd')), { filename: 'custom_object_text.sldd' });
  payload.name = 'x';
  payload.metadata = { ...txt.getSection('design').children[0].metadata, uuid: '00000000-0000-4000-a800-000000000002' };
  txt.getSection('design').parseEntry(payload);
  return entriesOf(session.serializeSource(txt.name).text).find((e) => e.name === 'x').value._elements[0]._properties.C._elements[0];
}

const bag = (dims, mw = true) => ({ _array_type: 'String', _dimensions: dims, _elements: [], ...(mw ? { _mw_element_type: 'MATLABArray' } : {}) });
const stream = (type, dims) => {
  const v = written({ _type: type, _emptyDims: dims });
  if (v?._type !== 'cdata') {
    throw new Error(type + ' ' + dims.join('x') + ' was not written as a stream: ' + JSON.stringify(v));
  }
  return v;
};
const CANDIDATES = [
  ['S03', bag([0, 3])],
  ['S00', bag([0, 0])],
  ['S10', bag([1, 0])],
  ['S03nomw', bag([0, 3], false)],
  ['Shost', { _type: 'string', _emptyDims: [0, 3] }],
  ['Fhost10', { _type: 'function_handle', _emptyDims: [1, 0] }],
  ['Fhost00', { _type: 'function_handle', _emptyDims: [0, 0] }],
  ['Nd022', stream('double', [0, 2, 2])],
  ['Ni8203', stream('int8', [2, 0, 3])],
  ['Nlg012', stream('logical', [0, 1, 2])],
  ['Nch002', stream('char', [0, 0, 2])],
  ['Ni32022', stream('int32', [0, 2, 2])],
  ['Hd022', { _type: 'double', _value: 'Matrix(0,2,2)' }],
  ['Hlg012', { _type: 'logical', _value: 'Matrix(0,1,2)' }],
  ['He022', { _type: 'GearMode', _value: 'Matrix(0,2,2)' }],
  ['Ebag022', enumBagInCell()],
  ['Hwide', { _type: 'double', _value: 'Matrix(0,2,2147483648)' }],
];
mkdirSync(out, { recursive: true });
writeFileSync(out + '/cands.json', JSON.stringify(CANDIDATES.map(([id, v]) => ({ id, spelling: JSON.stringify(v) })), null, 1));
console.log('wrote', CANDIDATES.length, 'candidates to', out + '/cands.json');
