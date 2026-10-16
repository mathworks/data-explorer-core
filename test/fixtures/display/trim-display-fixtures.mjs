// Copyright 2026 The MathWorks, Inc.
//
// Cuts the display catalog's MATLAB output down to the values the display tests read, and
// writes them here. Run after test/parity/matlab/probe_display.m:
//
//   node test/fixtures/display/trim-display-fixtures.mjs <DISPLAY_OUT>
//
// The probe writes 283 values into catalog.mat, dispcat_text.sldd and dispcat_bin.sldd, and
// MATLAB's own Value/Class/Size for each into truth/browser_short.json and truth/meta.json.
// Whole, the three files do not belong in this repo: they hold function handles, whose MAT
// bytes carry the matlabroot MATLAB was run from (fixtureHygiene.test.ts), and every walk of
// test/fixtures would read 283 values for the 56 these tests ask about. So this keeps, byte
// for byte as MATLAB wrote it:
//   - dispcat_bin.sldd: the chosen `DD.ENTRY` blocks of data/chunk0.xml, and every other part;
//   - dispcat_text.sldd: the chosen entries of the data/chunk0 part, and in
//     dispcat_text.null.json the one entry MATLAB wrote as `"value": null` (see TEXT_NULL);
//   - dispcat.mat: the 128-byte header and the chosen top-level records. Only values with no
//     MCOS object in them (no string, enumeration or Simulink object), so the file needs no
//     subsystem, and the header's subsystem offset is zeroed;
//   - browser_short.truth.json / meta.truth.json: the same names' rows (meta without its
//     matlabroot, which is a path of the machine);
//   - text_readback.truth.json: for the few values whose tests ask, what MATLAB read back
//     out of dispcat_text.sldd when it reopened it (truth/files.json's round trip).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const out = (name) => fileURLToPath(new URL(name, import.meta.url));
const root = process.argv[2];
if (!root) {
  throw new Error('usage: node trim-display-fixtures.mjs <DISPLAY_OUT>');
}

const COMPLEX = ['z_scalar', 'z_single', 'z_int16', 'z_uint8', 'z_vector', 'z_int16_vec', 'z_int8_vec',
  'dx_complex_scalar', 'dx_complex_int16', 'dx_complex_vector'];
const COMPLEX_EMPTY = ['dx_complex_0x0', 'dx_complex_1x0', 'dx_complex_int16_1x0', 'e_single_complex_1x0'];
const SPARSE = ['sp_scalar', 'sp_vec', 'sp_complex', 'sp_complex_scalar', 'sp_logical', 'sp_logical_scalar',
  'dx_sparse_0x0', 'dx_sparse_2x0', 'e_sparse_logical_0x0'];
const ENUM = ['en_on', 'en_off', 'en_onoff_vec', 'dx_enum_0x0', 'dx_enum_1x0', 'en_sl_empty', 'en_i32_empty'];
const STRING = ['dx_string_empty_1x1', 'dx_string_0x0', 'dx_string_1x0', 'str_0x3'];
const EMPTY = ['dx_double_0x0', 'dx_double_1x0', 'dx_double_0x1', 'dx_double_0x3', 'dx_double_0x0x2', 'dx_single_0x0',
  'dx_int8_0x3', 'e_uint64_0x0', 'dx_logical_1x0', 'e_logical_0x0', 'e_logical_0x3', 'dx_char_0x0', 'dx_char_1x0',
  'dx_char_0x2', 'dx_cell_0x0', 'dx_cell_1x0', 'dx_cell_0x3', 'dx_struct_0x0', 'dx_struct_0x0_fields', 'dx_struct_1x0'];
const PARAM = ['dx_param_empty', 'dx_param_complex_1x0'];
// Rows of ten and more, which a text dictionary writes under a `Vector(N)` header.
const VECTOR = ['i8_1x10', 'i8_1x11', 'l_1x10', 'l_1x11'];
// A cell holding a Simulink.Parameter, and one holding the double its Value is. The first
// holds an MCOS object, so it stays out of the .mat (see above).
const CELL = ['cell_1', 'cell_of_param'];
// Text holding a newline, a tab and a NUL. The string is an MCOS object, so the .mat keeps
// the three chars only.
const CONTROL = ['c_newline', 'c_tab', 'c_nul', 'str_newline'];

const SLDD = new Set([...COMPLEX, ...COMPLEX_EMPTY, ...SPARSE, ...ENUM, ...STRING, ...EMPTY, ...PARAM, ...VECTOR, ...CELL,
  ...CONTROL]);
const MAT = new Set([...COMPLEX, ...COMPLEX_EMPTY, ...SPARSE, ...EMPTY, ...VECTOR, 'cell_1', 'c_newline', 'c_tab', 'c_nul']);
// A value the text dictionary could not hold: MATLAB saved the 2x2x2 string with a warning, as
// `"value": null`. Its entry is kept as MATLAB wrote it, but beside dispcat_text.sldd, in
// dispcat_text.null.json, and not in it: the reader warns that the entry holds no value, and
// test/parseWarnings.test.ts holds every .sldd in the repo to no warning at all. The test that
// reads it puts it back into the dictionary. Out of the browser and meta truth too, which are of
// the value MATLAB had and not of what the file holds; its truth is the read-back below.
const TEXT_NULL = ['str_2x2x2'];
// The text dictionary's values whose tests read MATLAB's own read-back of that file
// (truth/files.json: closed, reopened, getValue), kept as text_readback.truth.json.
const TEXT_READBACK = [...VECTOR, ...TEXT_NULL];

// --- binary: whole DD.ENTRY blocks, in MATLAB's order, between its header and its DD.Dictionary
const zip = unzipSync(new Uint8Array(readFileSync(join(root, 'files', 'dispcat_bin.sldd'))));
const xml = strFromU8(zip['data/chunk0.xml']);
const first = xml.indexOf('    <Object Class="DD.ENTRY">');
const tail = xml.indexOf('    <Object Class="DD.Dictionary">');
const blocks = xml.slice(first, tail).match(/ {4}<Object Class="DD\.ENTRY">\n[\s\S]*?\n {4}<\/Object>\n/g);
if (blocks.join('') !== xml.slice(first, tail)) {
  throw new Error('data/chunk0.xml is not a run of DD.ENTRY blocks');
}
const nameOf = (block) => /<P Name="Name" Class="char">([^<]+)<\/P>/.exec(block)[1];
const kept = blocks.filter((b) => SLDD.has(nameOf(b)));
zip['data/chunk0.xml'] = strToU8(xml.slice(0, first) + kept.join('') + xml.slice(tail));
writeFileSync(out('dispcat_bin.sldd'), zipSync(zip, { level: 6, mtime: new Date('1980-01-01T00:00:00') }));

// --- text: the chosen entries of the one data part
const text = JSON.parse(readFileSync(join(root, 'files', 'dispcat_text.sldd'), 'utf8'));
const part = text.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
const nulls = part.entries.filter((e) => TEXT_NULL.includes(e.name));
part.entries = part.entries.filter((e) => SLDD.has(e.name));
writeFileSync(out('dispcat_text.sldd'), JSON.stringify(text, null, '\t'));
writeFileSync(out('dispcat_text.null.json'), JSON.stringify(nulls, null, '\t') + '\n');

// --- .mat: the header, then each chosen record as it stands
const mat = new Uint8Array(readFileSync(join(root, 'files', 'catalog.mat')));
const view = new DataView(mat.buffer, mat.byteOffset, mat.byteLength);
const records = [];
for (let at = 128; at + 8 <= mat.length; ) {
  const type = view.getUint32(at, true);
  const size = view.getUint32(at + 4, true);
  const body = mat.subarray(at + 8, at + 8 + size);
  const raw = type === 15 ? new Uint8Array(inflateSync(body)) : body;
  const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  // miMATRIX tag (8), array flags (16), dimensions (small or not), then the name.
  let off = 24;
  const dimsTag = rv.getUint32(off, true);
  off += dimsTag >>> 16 ? 8 : 8 + Math.ceil(rv.getUint32(off + 4, true) / 8) * 8;
  const nameTag = rv.getUint32(off, true);
  const name = nameTag >>> 16
    ? strFromU8(raw.subarray(off + 4, off + 4 + (nameTag >>> 16)))
    : strFromU8(raw.subarray(off + 8, off + 8 + rv.getUint32(off + 4, true)));
  if (MAT.has(name)) {
    records.push(mat.subarray(at, at + 8 + size));
  }
  at += 8 + size;
}
const header = mat.slice(0, 128);
header.fill(0, 116, 124);
writeFileSync(out('dispcat.mat'), Buffer.concat([header, ...records]));

// --- MATLAB's own display of the same names
const names = new Set([...SLDD]);
const browser = JSON.parse(readFileSync(join(root, 'truth', 'browser_short.json'), 'utf8'));
writeFileSync(out('browser_short.truth.json'), JSON.stringify(browser.filter((r) => names.has(r.Name)), null, 2) + '\n');
const meta = JSON.parse(readFileSync(join(root, 'truth', 'meta.json'), 'utf8'));
const keep = ['version', 'release', 'date', 'userNumericFormat', 'timesSymbol', 'maxDisplayElements', 'maxTextDisplayLength'];
const trimmed = Object.fromEntries(keep.map((k) => [k, meta[k]]));
trimmed.entries = meta.entries.filter((e) => names.has(e.name));
writeFileSync(out('meta.truth.json'), JSON.stringify(trimmed, null, 2) + '\n');
const files = JSON.parse(readFileSync(join(root, 'truth', 'files.json'), 'utf8'));
const readback = files.sldd_text.roundtrip.filter((r) => TEXT_READBACK.includes(r.name));
writeFileSync(out('text_readback.truth.json'), JSON.stringify(readback, null, 2) + '\n');
console.log(`kept ${kept.length} binary entries, ${part.entries.length} text entries, ${records.length} .mat records`);
