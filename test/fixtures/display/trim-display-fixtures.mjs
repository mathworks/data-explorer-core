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
// test/fixtures would read 283 values for the 65 these tests ask about. So this keeps, byte
// for byte as MATLAB wrote it:
//   - dispcat_bin.sldd: the chosen `DD.ENTRY` blocks of data/chunk0.xml, and every other part;
//   - dispcat_text.sldd: the chosen entries of the data/chunk0 part;
//   - dispcat.mat: the 128-byte header and the chosen top-level records. Only values with no
//     MCOS object in them (no string, enumeration or Simulink object), so the file needs no
//     subsystem, and the header's subsystem offset is zeroed;
//   - dispcat_opaque.mat: the same header, the chosen records of MCOS objects (enumerations),
//     and the subsystem they are objects of, whole, with the header's offset moved to it. A
//     record holding the matlabroot of the MATLAB that wrote it (the subsystem does) has it
//     replaced by a token of the same length, as test/fixtures/sparse/scrub_matlabroot.m does,
//     and is compressed again; every other record is as MATLAB wrote it;
//   - browser_short.truth.json / meta.truth.json: the same names' rows (meta without its
//     matlabroot, which is a path of the machine).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
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
// Enumeration values of a user class, scalar and row, and a Parameter holding one, with the
// catalog's EnumTypeDefinition beside them.
const ENUM_VALUE = ['en_sl_red', 'en_sl_vec', 'en_i32_high', 'en_i32_vec', 'p_enum', 'enumdef'];
// Objects whose size is their data's: a fixed-point row, a categorical row, a 2x2 table.
const SIZED = ['fi_vec', 'cat_ab', 'tbl_2x2'];

const SLDD = new Set([...COMPLEX, ...COMPLEX_EMPTY, ...SPARSE, ...ENUM, ...STRING, ...EMPTY, ...PARAM, ...ENUM_VALUE, ...SIZED]);
const MAT = new Set([...COMPLEX, ...COMPLEX_EMPTY, ...SPARSE, ...EMPTY]);
// MCOS objects of the .mat, which need its subsystem: enumeration values, empties among them,
// a Parameter holding one, and the SIZED objects.
const MAT_ENUM = ['en_on', 'en_off', 'en_onoff_vec', 'en_sl_red', 'en_sl_vec', 'en_sl_empty', 'en_i32_high', 'en_i32_vec',
  'en_i32_empty', 'dx_enum_0x0', 'dx_enum_1x0', 'p_enum'];
const OPAQUE_MAT = new Set([...MAT_ENUM, ...SIZED]);

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
part.entries = part.entries.filter((e) => SLDD.has(e.name));
writeFileSync(out('dispcat_text.sldd'), JSON.stringify(text, null, '\t'));

// --- .mat: the header, then each chosen record as it stands
const mat = new Uint8Array(readFileSync(join(root, 'files', 'catalog.mat')));
const view = new DataView(mat.buffer, mat.byteOffset, mat.byteLength);
const records = [];
const opaqueRecords = [];
let subsystem = null;
for (let at = 128; at + 8 <= mat.length; ) {
  const type = view.getUint32(at, true);
  const size = view.getUint32(at + 4, true);
  const body = mat.subarray(at + 8, at + 8 + size);
  const raw = type === 15 ? new Uint8Array(inflateSync(body)) : body;
  const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  // miMATRIX tag (8), array flags (16), dimensions (small or not), then the name; an MCOS
  // object (class 17) has no dimensions, its name coming straight after the flags.
  let off = 24;
  if (raw[16] !== 17) {
    const dimsTag = rv.getUint32(off, true);
    off += dimsTag >>> 16 ? 8 : 8 + Math.ceil(rv.getUint32(off + 4, true) / 8) * 8;
  }
  const nameTag = rv.getUint32(off, true);
  const name = nameTag >>> 16
    ? strFromU8(raw.subarray(off + 4, off + 4 + (nameTag >>> 16)))
    : strFromU8(raw.subarray(off + 8, off + 8 + rv.getUint32(off + 4, true)));
  if (MAT.has(name)) {
    records.push(mat.subarray(at, at + 8 + size));
  }
  if (OPAQUE_MAT.has(name)) {
    opaqueRecords.push(scrubbed(mat.subarray(at, at + 8 + size), raw));
  }
  if (name === '' && at === Number(view.getBigUint64(116, true))) {
    subsystem = scrubbed(mat.subarray(at, at + 8 + size), raw);
  }
  at += 8 + size;
}
const header = mat.slice(0, 128);
header.fill(0, 116, 124);
writeFileSync(out('dispcat.mat'), Buffer.concat([header, ...records]));

// The record `record`, whose miMATRIX is `raw`, with the writing MATLAB's matlabroot replaced.
function scrubbed(record, raw) {
  const matlabroot = JSON.parse(readFileSync(join(root, 'truth', 'meta.json'), 'utf8')).matlabroot;
  const token = ('<matlabroot>' + '_'.repeat(Math.max(0, matlabroot.length - 12))).slice(0, matlabroot.length);
  const forms = [[Buffer.from(matlabroot, 'utf8'), Buffer.from(token, 'utf8')], [Buffer.from(matlabroot, 'utf16le'), Buffer.from(token, 'utf16le')]];
  const bytes = Buffer.from(raw);
  let n = 0;
  for (const [from, to] of forms) {
    for (let k = bytes.indexOf(from); k >= 0; k = bytes.indexOf(from, k + from.length)) {
      to.copy(bytes, k);
      n++;
    }
  }
  if (n === 0) {
    return record;
  }
  const body = deflateSync(bytes, { level: 9 });
  const tag = Buffer.alloc(8);
  tag.writeUInt32LE(15, 0);
  tag.writeUInt32LE(body.length, 4);
  return Buffer.concat([tag, body]);
}
if (!subsystem) {
  throw new Error('catalog.mat has no subsystem where its header says');
}
const opaqueHeader = mat.slice(0, 128);
const opaqueBody = Buffer.concat(opaqueRecords);
new DataView(opaqueHeader.buffer, opaqueHeader.byteOffset, 128).setBigUint64(116, BigInt(128 + opaqueBody.length), true);
writeFileSync(out('dispcat_opaque.mat'), Buffer.concat([opaqueHeader, opaqueBody, subsystem]));

// --- MATLAB's own display of the same names
const names = new Set([...SLDD, ...OPAQUE_MAT]);
const browser = JSON.parse(readFileSync(join(root, 'truth', 'browser_short.json'), 'utf8'));
writeFileSync(out('browser_short.truth.json'), JSON.stringify(browser.filter((r) => names.has(r.Name)), null, 2) + '\n');
const meta = JSON.parse(readFileSync(join(root, 'truth', 'meta.json'), 'utf8'));
const keep = ['version', 'release', 'date', 'userNumericFormat', 'timesSymbol', 'maxDisplayElements', 'maxTextDisplayLength'];
const trimmed = Object.fromEntries(keep.map((k) => [k, meta[k]]));
trimmed.entries = meta.entries.filter((e) => names.has(e.name));
writeFileSync(out('meta.truth.json'), JSON.stringify(trimmed, null, 2) + '\n');
console.log(`kept ${kept.length} binary entries, ${part.entries.length} text entries, ${records.length} .mat records, ${opaqueRecords.length} .mat objects`);
