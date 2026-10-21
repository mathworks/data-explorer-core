// Copyright 2026 The MathWorks, Inc.
//
// THE acceptance gate for the MAT-file save: does MATLAB `load` what
// session.serializeSource writes for a `.mat`, as the edit the session made?
//
// test/matFileSave.test.ts reads every save back with core's own reader, and core's reader is
// more lenient than MATLAB's: it opens files MATLAB refuses. The strict checker
// (MatFileCheck) states the load rules MATLAB was measured to enforce, which is closer, but
// still a model of MATLAB. Only MATLAB can say that a file it is handed loads, loads without a
// warning, and loads as the values the session showed after its edit.
//
// So each case opens a fixture MATLAB wrote through the session API, as a host does, makes
// its edits there (editProperty, deleteNodeById, addChildTo, an added variable, undo), saves
// it with serializeSource, and records beside the saved file THE SAME EDIT as MATLAB
// statements on a struct `S` loaded from the original (`S.kp = 7;`, `S.rowVec(2) = 99;`,
// `S = renameStructField(S, 'negD', 'negD2');`, `S = rmfield(S, 'infP');`, `S.var = 0;`).
// probe_mat_writeback.m loads the original, makes the edit in MATLAB, loads the save, and
// compares the two to the leaf.
//
// Two halves, one manifest between them (PROBE_OUT must be the same ABSOLUTE path in each):
//
//   npm run build
//   env PROBE_OUT=/tmp/matwb node test/parity/matlab/probe_mat_writeback.mjs
//   env PROBE_OUT=/tmp/matwb mw -using Bmain matlab -nodesktop \
//       -batch "run('$PWD/test/parity/matlab/probe_mat_writeback.m')"
//
// It reads the BUILT package, as probe_writeback.mjs does and for its reason, so a stale
// `dist/` is a stale verdict. The fixtures are found from this file's own folder, so node can
// be launched from anywhere.
//
// What this half asserts itself, before MATLAB is asked anything, and records in the
// manifest as `js` (anything but '' fails the case in the MATLAB half too):
//   - every edit the case makes is accepted, and leaves the node showing what the case's
//     MATLAB statements make of it (`shows`), so the two halves describe one edit;
//   - the save answers `{ kind: 'binary', sourceFormat: 'mat' }`;
//   - a save with no edit is the file, byte for byte, and a save with one is not;
//   - a save of a file that holds no compressed record (`-v6`) holds none either;
//   - the strict checker finds no violation in the save that it does not find in the file.
//
// A save core refuses is written to the manifest as `refused`, with core's message, and
// counts as a failure: every case here is an edit phase 1 claims to save.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzlibSync } from 'fflate';
import { createSession } from '../../../dist/index.js';
import { parseMat } from '../../../dist/datamodel/parser/MatParser.js';
import { checkMatFile, violationsAdded } from '../../../dist/datamodel/parser/MatFileCheck.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = process.env.PROBE_OUT || '/tmp/mat_writeback_probe';
if (!OUT.startsWith('/')) {
  throw new Error('PROBE_OUT must be an ABSOLUTE path, the same one the MATLAB half is given; got ' + OUT);
}
mkdirSync(OUT, { recursive: true });

// The fixtures, each MATLAB's own `save`. Between them: every plain class and shape the
// corpus has (cases, dispcat, sparse_values, complex_inf, sparse_cases), objects and strings
// held in the subsystem (cases, nested_objects, strings_mixed, strings), function handles,
// enumerations, fi, categorical and table (dispcat_opaque), a handle DAG of one object held
// twice at every level (dag4), and two `-v6` files, which hold no compressed record
// (nested_handles, hexobj_values). complex_inf and sparse_cases hold no subsystem.
const CASES_MAT = 'test/parity/artifacts/mat/cases.mat';
const DISPCAT = 'test/fixtures/display/dispcat.mat';
const OPAQUE = 'test/fixtures/display/dispcat_opaque.mat';
const NESTED = 'test/fixtures/mcos/nested_objects.mat';
const STR_MIXED = 'test/fixtures/strings_mixed.mat';
const STRINGS = 'test/fixtures/strings.mat';
const SPARSE = 'test/fixtures/sparse/sparse_values.mat';
const SPARSE_CASES = 'test/fixtures/sparse_cases.mat';
const COMPLEX_INF = 'test/fixtures/complex_inf/complex_inf.mat';
const DAG = 'test/fixtures/mcos/shared/dag4.mat';
const V6_HANDLES = 'test/fixtures/display/nested_handles.mat';
const V6_HEXOBJ = 'test/fixtures/sparse/hexobj_values.mat';
// MATLAB's own `save` of variables declared global (gD, gS, gC, gI) beside one that is not
// (plain), -v7 and -v6 (test/fixtures/global/make_global_fixtures.m).
const GLOBAL_V7 = 'test/fixtures/global/global_v7.mat';
const GLOBAL_V6 = 'test/fixtures/global/global_v6.mat';

const LONG_NAME = 'a' + 'b'.repeat(61) + 'c'; // 63 characters, the longest name core writes

const basename = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const sameBytes = (a, b) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

// A fixture is a path under the repo, or (CRAFTED below) one this half writes into OUT.
const crafted = new Map();
function bytesOf(rel) {
  const u8 = crafted.get(rel) ?? new Uint8Array(readFileSync(REPO + rel));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

// ---- one fixture this half assembles: MATLAB's own elements, held one level down ------
//
// No fixture MATLAB wrote holds an empty complex array or an empty struct array with fields
// INSIDE a struct or a cell, beside a value a user can edit, which is what makes a save
// write them fresh without touching them. dispcat.mat holds both at the top level. So this
// takes MATLAB's own elements for `dx_complex_0x0` (complex(zeros(0,0))) and
// `dx_struct_0x0_fields` (a 0x0 struct with a field `a`), drops their names, and puts them
// in a struct `s` and a cell `c`, each beside the double 1, in a `-v6`-style file of plain
// records. The MATLAB half loads it, as it does every original, before judging anything
// saved from it.
const u32 = (n) => new Uint8Array(new Uint32Array([n]).buffer);
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};
const pad8 = (b) => concat([b, new Uint8Array((8 - (b.byteLength % 8)) % 8)]);
const sub = (type, data) => pad8(concat([u32(type), u32(data.byteLength), data]));
const EMPTY_NAME = sub(1, new Uint8Array(0));
const miMatrix = (body) => concat([u32(14), u32(body.byteLength), body]);

/** The element of `rec`, inflated when compressed: its miMATRIX tag and body. */
function elementOf(rec) {
  const dv = new DataView(rec.bytes.buffer, rec.bytes.byteOffset, rec.bytes.byteLength);
  return dv.getUint32(0, true) === 15 ? unzlibSync(rec.bytes.subarray(8, 8 + dv.getUint32(4, true))) : rec.bytes.subarray(0, 8 + dv.getUint32(4, true));
}

/** `el` with its name sub-element (the third, after the flags and the dims) made empty. */
function nameless(el) {
  const dv = new DataView(el.buffer, el.byteOffset, el.byteLength);
  const skip = (at) => {
    const word = dv.getUint32(at, true);
    return word >>> 16 ? at + 8 : at + 8 + Math.ceil(dv.getUint32(at + 4, true) / 8) * 8;
  };
  const nameAt = skip(skip(8));
  return miMatrix(concat([el.subarray(8, nameAt), EMPTY_NAME, el.subarray(skip(nameAt), 8 + dv.getUint32(4, true))]));
}

const NAME = (n) => sub(1, new TextEncoder().encode(n));
const FLAGS = (cls) => sub(6, concat([u32(cls), u32(0)]));
const DIMS = (d) => sub(5, concat(d.map(u32)));
const doubleScalar = (v) => miMatrix(concat([FLAGS(6), DIMS([1, 1]), EMPTY_NAME, sub(9, new Uint8Array(new Float64Array([v]).buffer))]));

function structVar(name, fields) {
  const len = 32;
  const names = new Uint8Array(len * fields.length);
  fields.forEach(([f], i) => names.set(new TextEncoder().encode(f), i * len));
  return miMatrix(concat([FLAGS(2), DIMS([1, 1]), NAME(name), concat([u32(5 | (4 << 16)), u32(len)]), sub(1, names), ...fields.map(([, el]) => el)]));
}
const cellVar = (name, els) => miMatrix(concat([FLAGS(1), DIMS([1, els.length]), NAME(name), ...els]));

function nestedEmpties() {
  const dispcat = parseMat(bytesOf(DISPCAT));
  const el = (n) => nameless(elementOf(dispcat.records.find((r) => r.name === n)));
  const header = new Uint8Array(128).fill(0x20);
  header.set(new TextEncoder().encode('MATLAB 5.0 MAT-file, assembled by probe_mat_writeback.mjs from the elements of dispcat.mat'));
  header.set([0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x01, 0x49, 0x4d], 116);
  return concat([
    header,
    structVar('s', [
      ['ec', el('dx_complex_0x0')],
      ['es', el('dx_struct_0x0_fields')],
      ['x', doubleScalar(1)],
    ]),
    cellVar('c', [el('dx_complex_0x0'), el('dx_struct_0x0_fields'), doubleScalar(1)]),
  ]);
}
const NESTED_EMPTIES = 'crafted/nested_empties.mat';

// ---- and one of the shapes the fix of those two losses has to hold, byte by byte --------
//
// What no fixture MATLAB wrote holds, built by hand the way MATLAB writes each (a field-name
// stride of 32, as MATLAB's own older saves have it; an empty part as an empty sub-element of
// its class's type, as dispcat.mat's e_single_complex_1x0 has it):
//   c2   a cell {struct('a', {}, 'b', {}), 1}: a struct of no element with two fields, beside a
//        member to edit;
//   z03  complex(zeros(0, 3, 'single')), and sz, a struct holding one beside a field to edit;
//   sa   a 1x2 struct array whose elements each hold an empty struct with a field (a 0x0 and a
//        1x0) beside a field to edit;
//   g    a variable `save` marks global (bit 0x04 of its array flags), and h beside it, not;
//   nz   [-3i, 1+2i, complex(-0, -0)], whose zero parts are -0 (MATLAB's `-3i` is complex(-0,
//        -3)), beside an element to edit.
const flagsOf = (cls, bits = 0) => sub(6, concat([u32(cls | (bits << 8)), u32(0)]));
const emptyStruct = (dims, fields) => {
  const len = 32;
  const names = new Uint8Array(len * fields.length);
  fields.forEach((f, i) => names.set(new TextEncoder().encode(f), i * len));
  return miMatrix(concat([flagsOf(2), DIMS(dims), EMPTY_NAME, concat([u32(5 | (4 << 16)), u32(len)]), sub(1, names)]));
};
const singleComplexEmpty = (name) => miMatrix(concat([flagsOf(7, 0x08), DIMS([0, 3]), name ? NAME(name) : EMPTY_NAME, sub(7, new Uint8Array(0)), sub(7, new Uint8Array(0))]));
const doubles = (values) => new Uint8Array(new Float64Array(values).buffer);
function structArray(name, dims, fields, elements) {
  const len = 32;
  const names = new Uint8Array(len * fields.length);
  fields.forEach((f, i) => names.set(new TextEncoder().encode(f), i * len));
  return miMatrix(concat([flagsOf(2), DIMS(dims), NAME(name), concat([u32(5 | (4 << 16)), u32(len)]), sub(1, names), ...elements.flat()]));
}
function emptiesMore() {
  const header = new Uint8Array(128).fill(0x20);
  header.set(new TextEncoder().encode('MATLAB 5.0 MAT-file, assembled by probe_mat_writeback.mjs'));
  header.set([0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x01, 0x49, 0x4d], 116);
  return concat([
    header,
    cellVar('c2', [emptyStruct([0, 0], ['a', 'b']), doubleScalar(1)]),
    singleComplexEmpty('z03'),
    structVar('sz', [
      ['z', singleComplexEmpty('')],
      ['x', doubleScalar(1)],
    ]),
    structArray('sa', [1, 2], ['es', 'x'], [
      [emptyStruct([0, 0], ['q']), doubleScalar(1)],
      [emptyStruct([1, 0], ['q']), doubleScalar(2)],
    ]),
    miMatrix(concat([flagsOf(6, 0x04), DIMS([1, 2]), NAME('g'), sub(9, doubles([1, 2]))])),
    miMatrix(concat([flagsOf(6), DIMS([1, 2]), NAME('h'), sub(9, doubles([3, 4]))])),
    miMatrix(concat([flagsOf(6, 0x08), DIMS([1, 3]), NAME('nz'), sub(9, doubles([-0, 1, -0])), sub(9, doubles([-3, 2, -0]))])),
  ]);
}
const EMPTIES_MORE = 'crafted/empties_more.mat';

/**
 * A fixture opened through the session, as a host opens one, and the edits a host makes on
 * it. Each edit throws when the session refuses it, or when the node does not then show what
 * the case says, so a case whose two halves describe different edits never reaches MATLAB.
 */
function opened(rel) {
  const session = createSession();
  const name = basename(rel);
  const root = session.addMatSource(name, bytesOf(rel));
  const notes = [];

  // `labels`: the variable's name, then the displayName of each child down to the node, as
  // the tree shows them (`'mat2x3', 'mat2x3(1,2)'`; `'struct1x3', 'struct1x3(2)', 'a'`).
  const at = (...labels) => {
    let node = root.children.find((c) => c.name === labels[0]);
    for (const label of labels.slice(1)) {
      node = node?.children?.find((c) => c.displayName === label);
    }
    if (!node) {
      throw new Error('no node ' + labels.join(' > ') + ' in ' + name);
    }
    return node;
  };
  const accepted = (what, ok) => {
    if (ok !== true) {
      throw new Error(what + ' was refused: ' + JSON.stringify(ok));
    }
  };
  const shows = (node, className, displayValue) => {
    const got = [node.className, node.displayValue];
    if (got[0] !== className || (displayValue !== undefined && got[1] !== displayValue)) {
      throw new Error(
        node.displayName + ' shows ' + JSON.stringify(got) + ', not ' + JSON.stringify([className, displayValue]),
      );
    }
  };

  return {
    session,
    root,
    name,
    notes,
    at,
    /** Set the Value of the node at `labels`; then it must show `className` (and `display`). */
    set(labels, value, className, display) {
      const node = at(...labels);
      session.setActive(root, node);
      accepted('Value ' + value + ' of ' + labels.join(' > '), session.editProperty(node.id, 'Value', value));
      shows(node, className, display);
      return node;
    },
    rename(from, to) {
      const node = at(from);
      session.setActive(root, node);
      accepted('rename ' + from + ' -> ' + to, session.editProperty(node.id, 'Name', to));
      if (node.name !== to) {
        throw new Error('rename ' + from + ' -> ' + to + ' left the name ' + node.name);
      }
    },
    remove(name_) {
      const node = at(name_);
      session.setActive(root, node);
      accepted('delete ' + name_, session.deleteNodeById(node.id));
    },
    /** A struct field added to the struct at `labels`; it must be `field`, a double 0. */
    addField(labels, field) {
      const node = at(...labels);
      session.setActive(root, node);
      const added = session.addChildTo(node.id);
      if (!added) {
        throw new Error('addChildTo ' + labels.join(' > ') + ' was refused');
      }
      if (added.name !== field) {
        throw new Error('the field added to ' + labels.join(' > ') + ' is ' + added.name + ', not ' + field);
      }
      shows(added, 'double', '0');
    },
    /**
     * A variable added, as a host adds one: by session.addEntry where it answers for a
     * MAT-file, else by MatNode.execAddEntry, which is all session.addEntry does for a
     * dictionary's section. It must be `name`, a double 0, as the design says a new variable
     * is.
     */
    add(name_) {
      session.setActive(root, root);
      let node = session.addEntry?.('', 'double', name_) ?? null;
      if (node) {
        notes.push('added by session.addEntry');
      } else {
        node = root.execAddEntry(undefined, name_).node;
        notes.push('added by MatNode.execAddEntry (session.addEntry answered null)');
      }
      if (node.name !== name_) {
        throw new Error('the variable added is ' + node.name + ', not ' + name_);
      }
      shows(node, 'double', '0');
      return node;
    },
    undo() {
      session.undo();
    },
    /**
     * Every variable MatWriter can write as what it is, marked edited: the state an edit and
     * its undo leave (DataNode._valueEdited), which writes the variable fresh, holding the
     * value it was read as. This is the MATLAB half's question for the fresh encoder, value by
     * value: every class, shape, empty and non-finite these fixtures hold, written by core.
     */
    freshAll() {
      const plain = root.children.filter((n) => n._matWritable?.() === true && !root.recordOf(n)?.variable?.isOpaque);
      if (plain.length === 0) {
        throw new Error('no plain variable in ' + name);
      }
      plain.forEach((n) => n._markModified());
      notes.push(plain.length + ' variables written fresh');
    },
  };
}

// The cases. Each one: an id (the saved file's name), the fixture, what it asks, the edits
// through the session (`edit`), the same edits in MATLAB (`matlab`), and what the MATLAB half
// must then find:
//   identical  no edit: the save is the file, byte for byte, and MATLAB loads it as itself
//   unchanged  written anew, but holding the same values: MATLAB loads it as the original
//   changed    MATLAB loads it as the original with `matlab` applied, which must differ
//   control    a NEGATIVE control: `matlab` is the edit plus one more change the save does not
//              make, and the case passes only when the comparison names it (`differs`, a
//              piece of the difference it must report). Without these a PASS could be a
//              comparison that never looks where it says it does.
const CASES = [];
function add(id, file, why, edit, matlab, expect = 'changed', differs = '') {
  CASES.push({ id, file, why, edit, matlab, expect, differs });
}
const zero = (id, file, why) => add(id, file, why, () => {}, [], 'identical');
const control = (id, file, why, edit, matlab, differs) => add(id, file, why, edit, matlab, 'control', differs);

// ---- no edit: the file, byte for byte, for every fixture the gate uses ------------------
for (const [id, file] of [
  ['zero_cases', CASES_MAT],
  ['zero_dispcat', DISPCAT],
  ['zero_opaque', OPAQUE],
  ['zero_nested_objects', NESTED],
  ['zero_strings_mixed', STR_MIXED],
  ['zero_strings', STRINGS],
  ['zero_sparse', SPARSE],
  ['zero_sparse_cases', SPARSE_CASES],
  ['zero_complex_inf', COMPLEX_INF],
  ['zero_dag', DAG],
  ['zero_v6_handles', V6_HANDLES],
  ['zero_v6_hexobj', V6_HEXOBJ],
]) {
  zero(id, file, 'a save with no edit is the file');
}

// ---- cases.mat: a value of every kind phase 1 writes fresh ---------------------------
add('scalar_value', CASES_MAT, 'a double scalar', (f) => f.set(['kp'], '7', 'double', '7'), ['S.kp = 7;']);
add('typed_scalar', CASES_MAT, 'an int16 scalar typed into keeps its class', (f) => f.set(['s_int16'], '9', 'int16', '9'), [
  'S.s_int16 = int16(9);',
]);
add('single_scalar', CASES_MAT, 'a single keeps its class', (f) => f.set(['scalarS'], '2.5', 'single', '2.5'), [
  'S.scalarS = single(2.5);',
]);
add(
  'uint64_exact',
  CASES_MAT,
  'a uint64 past 2^53, exactly',
  (f) => f.set(['maxU64'], '18446744073709551614', 'uint64', '18446744073709551614'),
  ["S.maxU64 = intmax('uint64') - 1;"],
);
add(
  'int64_exact',
  CASES_MAT,
  'an int64 past 2^53, exactly',
  (f) => f.set(['i64Unsafe'], '9007199254740995', 'int64', '9007199254740995'),
  ['S.i64Unsafe = int64(9007199254740992) + 3;'],
);
add('logical_scalar', CASES_MAT, 'a logical', (f) => f.set(['boolT'], 'false', 'logical', 'false'), ['S.boolT = false;']);
add('char_value', CASES_MAT, 'a char row', (f) => f.set(['charStr'], "'new text'", 'char', "'new text'"), [
  "S.charStr = 'new text';",
]);
add('matrix_element', CASES_MAT, 'one element of a 2x3', (f) => f.set(['mat2x3', 'mat2x3(1,2)'], '99', 'double', '99'), [
  'S.mat2x3(1,2) = 99;',
]);
add(
  'int16_elements',
  CASES_MAT,
  'elements of an int16 vector stay int16, a fraction rounded as MATLAB rounds it',
  (f) => {
    f.set(['i16Vec', 'i16Vec(2)'], '99', 'int16', '99');
    f.set(['i16Vec', 'i16Vec(3)'], '1.5', 'int16', '2');
  },
  ['S.i16Vec(2) = 99;', 'S.i16Vec(3) = 1.5;'],
);
add('logical_element', CASES_MAT, 'an element of a logical vector', (f) => f.set(['boolVec', 'boolVec(2)'], 'true', 'logical', 'true'), [
  'S.boolVec(2) = true;',
]);
add('nd_element', CASES_MAT, 'an element of a 2x3x2', (f) => f.set(['nd2x3x2', 'nd2x3x2(2,1,2)'], '99', 'double', '99'), [
  'S.nd2x3x2(2,1,2) = 99;',
]);
add('nonfinite_element', CASES_MAT, 'a non-finite typed into a vector', (f) => f.set(['nonFinVec', 'nonFinVec(1)'], '-Inf', 'double', '-Inf'), [
  'S.nonFinVec(1) = -Inf;',
]);
add('reshape', CASES_MAT, 'a row typed as a 2x2', (f) => f.set(['rowVec'], '[1 2; 3 4]', 'double', '[1 2; 3 4]'), [
  'S.rowVec = [1 2; 3 4];',
]);
add('column_to_row', CASES_MAT, 'a column typed as a row', (f) => f.set(['colVec'], '[7 8 9]', 'double', '[7 8 9]'), [
  'S.colVec = [7 8 9];',
]);
add('to_empty', CASES_MAT, 'a scalar typed as []', (f) => f.set(['negD'], '[]', 'double', '[ ]'), ['S.negD = [];']);
add('struct_field', CASES_MAT, 'a field of a struct', (f) => f.set(['structScalar', 'a'], '9', 'double', '9'), [
  'S.structScalar.a = 9;',
]);
add('nested_struct_field', CASES_MAT, 'a field of a struct in a struct', (f) => f.set(['structNest', 'a', 'b'], '20', 'double', '20'), [
  'S.structNest.a.b = 20;',
]);
add(
  'struct_array_field',
  CASES_MAT,
  "a field of a 1x3 struct array's second element",
  (f) => f.set(['struct1x3', 'struct1x3(2)', 'a'], '9', 'double', '9'),
  ['S.struct1x3(2).a = 9;'],
);
add(
  'struct_2d_field',
  CASES_MAT,
  "a field of a 2x3 struct array's (1,2) element",
  (f) => f.set(['struct2x3', 'struct2x3(1,2)', 'a'], '33', 'double', '33'),
  ['S.struct2x3(1,2).a = 33;'],
);
add(
  'struct_nd_field',
  CASES_MAT,
  "a field of a 2x3x2 struct array's (1,2,1) element",
  (f) => f.set(['structNd', 'structNd(1,2,1)', 'a'], '33', 'double', '33'),
  ['S.structNd(1,2,1).a = 33;'],
);
add('cell_member', CASES_MAT, 'a member of a cell', (f) => f.set(['cellFlat', 'cellFlat{1}'], '9', 'double', '9'), [
  'S.cellFlat{1} = 9;',
]);
add('cell_member_class', CASES_MAT, "a cell's char member typed as a double row", (f) => f.set(['cellFlat', 'cellFlat{2}'], '[1 2]', 'double', '[1 2]'), [
  'S.cellFlat{2} = [1 2];',
]);
add(
  'cell_nested_member',
  CASES_MAT,
  'a member of a cell in a cell in a cell',
  (f) => f.set(['cellNest', 'cellNest{2}', 'cellNest{2}{2}', 'cellNest{2}{2}{1}'], '30', 'double', '30'),
  ['S.cellNest{2}{2}{1} = 30;'],
);
add('cell_nd_member', CASES_MAT, 'a member of a 2x3x2 cell', (f) => f.set(['cellNd', 'cellNd{1,2,1}'], '33', 'double', '33'), [
  'S.cellNd{1,2,1} = 33;',
]);
add('add_struct_field', CASES_MAT, 'a field added to a struct, last', (f) => f.addField(['structScalar'], 'field'), [
  'S.structScalar.field = 0;',
]);
add('class_double_to_char', CASES_MAT, 'a double typed as text', (f) => f.set(['kp'], "'abc'", 'char', "'abc'"), ["S.kp = 'abc';"]);
add('class_char_to_double', CASES_MAT, 'text typed as numbers', (f) => f.set(['charStr'], '[1 2]', 'double', '[1 2]'), [
  'S.charStr = [1 2];',
]);
add('class_to_cell', CASES_MAT, 'a double typed as a cell', (f) => f.set(['infN'], "{1, 'a'}", 'cell', "{1, 'a'}"), [
  "S.infN = {1, 'a'};",
]);
add('complex_scalar', CASES_MAT, 'a complex scalar', (f) => f.set(['cplxScalar'], '1-2i', 'double', '1-2i'), ['S.cplxScalar = 1-2i;']);
add(
  'complex_element',
  CASES_MAT,
  'a real typed into a complex vector, which stays complex',
  (f) => {
    f.set(['cplxVec', 'cplxVec(1)'], '5', 'double', '5');
    if (f.at('cplxVec').displayValue !== '[5 3-4i]') {
      throw new Error('cplxVec shows ' + f.at('cplxVec').displayValue);
    }
  },
  ['S.cplxVec(1) = 5;'],
);
add('real_to_complex', CASES_MAT, 'a real scalar typed as a complex one', (f) => f.set(['scalarD'], '2+3i', 'double', '2+3i'), [
  'S.scalarD = 2+3i;',
]);

// ---- cases.mat: renames, deletes and adds -------------------------------------------
add('rename_plain', CASES_MAT, 'a plain variable renamed', (f) => f.rename('kp', 'kpRenamed'), [
  "S = renameStructField(S, 'kp', 'kpRenamed');",
]);
add('rename_long', CASES_MAT, 'a struct renamed to 63 characters', (f) => f.rename('structNest', LONG_NAME), [
  `S = renameStructField(S, 'structNest', '${LONG_NAME}');`,
]);
add(
  'rename_swap',
  CASES_MAT,
  'two variables trading names through a third',
  (f) => {
    f.rename('kp', 'tmpName');
    f.rename('scalarD', 'kp');
    f.rename('tmpName', 'scalarD');
  },
  ["S = renameStructField(S, 'kp', 'tmpName');", "S = renameStructField(S, 'scalarD', 'kp');", "S = renameStructField(S, 'tmpName', 'scalarD');"],
);
add('rename_param', CASES_MAT, 'a Simulink.Parameter renamed', (f) => f.rename('aParam', 'renamedParam'), [
  "S = renameStructField(S, 'aParam', 'renamedParam');",
]);
add('rename_string', CASES_MAT, 'a string renamed', (f) => f.rename('strScalar', 'str2'), ["S = renameStructField(S, 'strScalar', 'str2');"]);
const CASES_OBJECTS = ['strScalar', 'strArray', 'strMat', 'aParam', 'aSignal', 'aBus', 'aLookup', 'aVariant', 'objRow', 'objCol', 'obj2x3', 'obj2x3x2'];
add(
  'rename_objects_all',
  CASES_MAT,
  'every variable the subsystem holds renamed: strings, a Parameter, Signal, Bus, LookupTable, VariantVariable and Parameter arrays',
  (f) => CASES_OBJECTS.forEach((n) => f.rename(n, n + 'R')),
  CASES_OBJECTS.map((n) => `S = renameStructField(S, '${n}', '${n}R');`),
);
add('delete_plain', CASES_MAT, 'a plain variable deleted', (f) => f.remove('infP'), ["S = rmfield(S, 'infP');"]);
add('delete_param', CASES_MAT, 'a Simulink.Parameter deleted: its object stays in the subsystem, held by nothing', (f) => f.remove('aParam'), [
  "S = rmfield(S, 'aParam');",
]);
add(
  'delete_objects_all',
  CASES_MAT,
  'every variable the subsystem holds deleted: the subsystem stays, held by nothing',
  (f) => CASES_OBJECTS.forEach((n) => f.remove(n)),
  [`S = rmfield(S, {${CASES_OBJECTS.map((n) => `'${n}'`).join(', ')}});`],
);
add(
  'delete_all',
  CASES_MAT,
  'every variable deleted: the file holds only the subsystem',
  (f) => [...f.root.children].forEach((n) => f.remove(n.name)),
  ['S = struct();'],
);
add('add_variable', CASES_MAT, 'a variable added, before the subsystem', (f) => f.add('var'), ['S.var = 0;']);
add(
  'add_and_edit',
  CASES_MAT,
  'a variable added, then its value typed',
  (f) => {
    f.add('added');
    f.set(['added'], '[1 2 3]', 'double', '[1 2 3]');
  },
  ['S.added = [1 2 3];'],
);
add(
  'several_at_once',
  CASES_MAT,
  'a value, a cell member, two renames (one an object), two deletes (one an object) and an add, in one save',
  (f) => {
    f.set(['kp'], '[7 8]', 'double', '[7 8]');
    f.rename('scalarD', 'renamedD');
    f.set(['cellFlat', 'cellFlat{3}'], "'x'", 'char', "'x'");
    f.rename('aSignal', 'sig2');
    f.remove('negD');
    f.remove('objRow');
    f.add('added');
  },
  [
    'S.kp = [7 8];',
    "S = renameStructField(S, 'scalarD', 'renamedD');",
    "S.cellFlat{3} = 'x';",
    "S = renameStructField(S, 'aSignal', 'sig2');",
    "S = rmfield(S, {'negD', 'objRow'});",
    'S.added = 0;',
  ],
);
add(
  'edit_undone',
  CASES_MAT,
  'an element edited and the edit undone: written fresh, holding the value read',
  (f) => {
    f.set(['mat2x3', 'mat2x3(1,1)'], '9', 'double', '9');
    f.undo();
  },
  [],
  'unchanged',
);
add(
  'rename_undone',
  CASES_MAT,
  'a rename undone: the file as it was',
  (f) => {
    f.rename('kp', 'kp2');
    f.undo();
  },
  [],
  'identical',
);

// ---- every plain variable written fresh, holding what it was read as -----------------
for (const [id, file] of [
  ['fresh_cases', CASES_MAT],
  ['fresh_dispcat', DISPCAT],
  ['fresh_sparse', SPARSE],
  ['fresh_sparse_cases', SPARSE_CASES],
  ['fresh_complex_inf', COMPLEX_INF],
]) {
  add(id, file, 'every plain variable written fresh by core', (f) => f.freshAll(), [], 'unchanged');
}

// ---- sparse ---------------------------------------------------------------------------
add('sparse_element', SPARSE, 'a non-zero of a sparse double', (f) => f.set(['spDiag', 'spDiag(3,3)'], '99', 'double', '99'), [
  'S.spDiag(3,3) = 99;',
]);
add(
  'sparse_complex_element',
  SPARSE,
  'a real typed into a complex sparse, which stays complex',
  (f) => f.set(['spComplex', 'spComplex(1,1)'], '5', 'double', '5'),
  ['S.spComplex(1,1) = 5;'],
);
add('sparse_in_struct', SPARSE, 'a non-zero of a sparse in a struct field', (f) => f.set(['st', 'sp', 'sp(2,1)'], '1', 'double', '1'), [
  'S.st.sp(2,1) = 1;',
]);
add('sparse_in_cell', SPARSE, 'a non-zero of a sparse in a cell', (f) => f.set(['c', 'c{1}', 'c{1}(1,3)'], '10', 'double', '10'), [
  'S.c{1}(1,3) = 10;',
]);
add('sparse_rename_delete_add', SPARSE, 'a sparse renamed, a sparse Parameter deleted, a variable added', (f) => {
  f.rename('spTall', 'spTallR');
  f.remove('pSp');
  f.add('var');
}, ["S = renameStructField(S, 'spTall', 'spTallR');", "S = rmfield(S, 'pSp');", 'S.var = 0;']);

// ---- a file with no subsystem ---------------------------------------------------------
add(
  'nosubsystem_edit_add',
  COMPLEX_INF,
  'a file with no subsystem: an element edited, a variable renamed, one added after the last',
  (f) => {
    f.set(['zInfRow', 'zInfRow(2)'], 'Inf', 'double', 'Inf');
    f.rename('zInf', 'zInfR');
    f.add('var');
  },
  ['S.zInfRow(2) = Inf;', "S = renameStructField(S, 'zInf', 'zInfR');", 'S.var = 0;'],
);

// ---- an edit beside an empty, which the save writes fresh without its being touched ---
crafted.set(NESTED_EMPTIES, nestedEmpties());
zero('zero_nested_empties', NESTED_EMPTIES, 'a save with no edit is the file (and MATLAB loads the assembled file)');
add(
  'sibling_struct_field',
  NESTED_EMPTIES,
  'a struct field edited beside an empty complex and an empty struct with a field, both written fresh with it',
  (f) => f.set(['s', 'x'], '2', 'double', '2'),
  ['S.s.x = 2;'],
);
add(
  'sibling_cell_member',
  NESTED_EMPTIES,
  'a cell member edited beside an empty complex and an empty struct with a field, both written fresh with it',
  (f) => f.set(['c', 'c{3}'], '9', 'double', '9'),
  ['S.c{3} = 9;'],
);

crafted.set(EMPTIES_MORE, emptiesMore());
zero('zero_empties_more', EMPTIES_MORE, 'a save with no edit is the file (and MATLAB loads the assembled file)');
add(
  'sibling_cell_two_fields',
  EMPTIES_MORE,
  'a cell member edited beside a struct of no element with two fields, written fresh with it',
  (f) => f.set(['c2', 'c2{2}'], '9', 'double', '9'),
  ['S.c2{2} = 9;'],
);
add('fresh_complex_single_0x3', EMPTIES_MORE, 'every plain variable written fresh: complex(zeros(0,3,\'single\')), and the rest of the file', (f) => f.freshAll(), [], 'unchanged');
add(
  'sibling_complex_single_0x3',
  EMPTIES_MORE,
  "a struct field edited beside complex(zeros(0,3,'single')), written fresh with it",
  (f) => f.set(['sz', 'x'], '2', 'double', '2'),
  ['S.sz.x = 2;'],
);
add(
  'struct_array_nested_empty',
  EMPTIES_MORE,
  "a field of a struct array's element edited beside an empty struct with a field in each element",
  (f) => f.set(['sa', 'sa(2)', 'x'], '5', 'double', '5'),
  ['S.sa(2).x = 5;'],
);
add('global_element', EMPTIES_MORE, 'an element of a variable saved as global: written fresh, and still global', (f) => f.set(['g', 'g(2)'], '7', 'double', '7'), [
  'S.g(2) = 7;',
]);
add(
  'negative_zero_parts',
  EMPTIES_MORE,
  'an element of a complex row edited beside elements whose zero parts are -0, which keep their sign',
  (f) => f.set(['nz', 'nz(2)'], '5', 'double', '5'),
  ['S.nz(2) = 5;'],
);

// ---- variables saved as global: written fresh, still global -----------------------------
zero('zero_global_v7', GLOBAL_V7, 'a save with no edit is the file');
zero('zero_global_v6', GLOBAL_V6, 'a save with no edit is the file');
add('global_v7_element', GLOBAL_V7, 'an element of a global double: written fresh, and still global', (f) => f.set(['gD', 'gD(2)'], '20', 'double', '20'), [
  'S.gD(2) = 20;',
]);
add(
  'global_v7_struct_field',
  GLOBAL_V7,
  'a field of a global struct: the struct written fresh, global, and nothing nested in it global',
  (f) => f.set(['gS', 'a'], '5', 'double', '5'),
  ['S.gS.a = 5;'],
);
add('global_v6_cell_member', GLOBAL_V6, 'a member of a global cell in a -v6 file: still global, still uncompressed', (f) => f.set(['gC', 'gC{1}'], '40', 'double', '40'), [
  'S.gC{1} = 40;',
]);
add('global_v6_int16', GLOBAL_V6, 'a global int16 typed into, which keeps its class and stays global', (f) => f.set(['gI'], '-8', 'int16', '-8'), [
  'S.gI = int16(-8);',
]);
add('fresh_global_v7', GLOBAL_V7, 'every plain variable written fresh: the globals stay global, the other stays not', (f) => f.freshAll(), [], 'unchanged');
add(
  'global_rename_delete_add',
  GLOBAL_V7,
  'a global renamed (its bytes, renamed), another deleted, a field of a third edited, a variable added (not global)',
  (f) => {
    f.rename('gD', 'gD2');
    f.remove('gI');
    f.set(['gS', 'a'], '6', 'double', '6');
    f.add('var');
  },
  ["S = renameStructField(S, 'gD', 'gD2');", "S = rmfield(S, 'gI');", 'S.gS.a = 6;', 'S.var = 0;'],
);

// ---- function handles, enumerations, fi, categorical, table -------------------------
add(
  'rename_fhandles',
  OPAQUE,
  'a named and an anonymous function handle renamed',
  (f) => {
    f.rename('fh_sin', 'sinHandle');
    f.rename('fh_anon', 'anonHandle');
  },
  ["S = renameStructField(S, 'fh_sin', 'sinHandle');", "S = renameStructField(S, 'fh_anon', 'anonHandle');"],
);
add(
  'delete_fhandles',
  OPAQUE,
  'an anonymous and an empty function handle deleted',
  (f) => {
    f.remove('fh_anon');
    f.remove('e_func_handle_none');
  },
  ["S = rmfield(S, {'fh_anon', 'e_func_handle_none'});"],
);
add(
  'rename_opaque_objects',
  OPAQUE,
  'an enumeration, a Parameter holding one, a fi, a categorical and a table renamed',
  (f) => ['en_on', 'p_enum', 'fi_vec', 'cat_ab', 'tbl_2x2'].forEach((n) => f.rename(n, n + 'R')),
  ['en_on', 'p_enum', 'fi_vec', 'cat_ab', 'tbl_2x2'].map((n) => `S = renameStructField(S, '${n}', '${n}R');`),
);
add(
  'delete_opaque_objects_add',
  OPAQUE,
  'an enumeration vector, a categorical and a table deleted, a variable added',
  (f) => {
    f.remove('en_sl_vec');
    f.remove('cat_ab');
    f.remove('tbl_2x2');
    f.add('var');
  },
  ["S = rmfield(S, {'en_sl_vec', 'cat_ab', 'tbl_2x2'});", 'S.var = 0;'],
);

// ---- objects and strings held in the subsystem ---------------------------------------
add(
  'nested_objects_rename',
  NESTED,
  'Parameters, strings, a missing string and structs and cells holding objects, renamed',
  (f) => ['s', 'c', 'pTop', 'strTop', 'missTop', 'busTop', 'cArr'].forEach((n) => f.rename(n, n + 'R')),
  ['s', 'c', 'pTop', 'strTop', 'missTop', 'busTop', 'cArr'].map((n) => `S = renameStructField(S, '${n}', '${n}R');`),
);
add(
  'nested_objects_delete_add',
  NESTED,
  'a Parameter, a Bus, a string matrix and a cell of objects deleted, a variable added',
  (f) => {
    ['qTop', 'busTop', 'strsTop', 'cArr'].forEach((n) => f.remove(n));
    f.add('var');
  },
  ["S = rmfield(S, {'qTop', 'busTop', 'strsTop', 'cArr'});", 'S.var = 0;'],
);
add(
  'strings_mixed_rename',
  STR_MIXED,
  'a string and a Parameter beside it renamed',
  (f) => {
    f.rename('mixStr', 'mixStr2');
    f.rename('mixParam', 'mixParam2');
  },
  ["S = renameStructField(S, 'mixStr', 'mixStr2');", "S = renameStructField(S, 'mixParam', 'mixParam2');"],
);
add('strings_mixed_delete', STR_MIXED, 'the Parameter before a string deleted', (f) => f.remove('mixParam'), [
  "S = rmfield(S, 'mixParam');",
]);
add(
  'strings_rename_delete',
  STRINGS,
  'strings of astral and non-ASCII text renamed, another deleted',
  (f) => {
    f.rename('sAstral', 'sAstralR');
    f.rename('sUnicode', 'sUnicodeR');
    f.remove('sScalar');
  },
  ["S = renameStructField(S, 'sAstral', 'sAstralR');", "S = renameStructField(S, 'sUnicode', 'sUnicodeR');", "S = rmfield(S, 'sScalar');"],
);
add(
  'dag_rename_add',
  DAG,
  'a handle DAG, one object held twice at every level, renamed; a variable added',
  (f) => {
    f.rename('root', 'rootR');
    f.add('var');
  },
  ["S = renameStructField(S, 'root', 'rootR');", 'S.var = 0;'],
);

// ---- -v6 files: no compressed record, before or after ---------------------------------
add(
  'v6_handles_edit',
  V6_HANDLES,
  'a -v6 file of function handles: one renamed, one deleted, a variable added',
  (f) => {
    f.rename('s_fh', 's_fh2');
    f.remove('c_fh');
    f.add('var');
  },
  ["S = renameStructField(S, 's_fh', 's_fh2');", "S = rmfield(S, 'c_fh');", 'S.var = 0;'],
);
add(
  'v6_hexobj_edit',
  V6_HEXOBJ,
  'a -v6 file of objects: a value and a cell member beside a 10000000x2 sparse edited, an object renamed, another deleted, a variable added',
  (f) => {
    f.set(['control'], '[1 2 3]', 'double', '[1 2 3]');
    f.set(['cTall', 'cTall{2}'], '3', 'double', '3');
    f.rename('anonAlias', 'anonAliasR');
    f.remove('holder');
    f.add('var');
  },
  [
    'S.control = [1 2 3];',
    'S.cTall{2} = 3;',
    "S = renameStructField(S, 'anonAlias', 'anonAliasR');",
    "S = rmfield(S, 'holder');",
    'S.var = 0;',
  ],
);

// ---- negative controls: the comparison must see each of these ------------------------
control('control_value', CASES_MAT, 'a value the save did not write', (f) => f.set(['kp'], '7', 'double', '7'), ['S.kp = 8;'], 'kp: 8 vs 7');
control('control_class', CASES_MAT, 'the same number in another class', (f) => f.set(['s_int16'], '9', 'int16', '9'), ['S.s_int16 = 9;'], 's_int16: class double vs int16');
control('control_complexity', CASES_MAT, 'the same number, complex', (f) => f.set(['scalarD'], '2', 'double', '2'), ['S.scalarD = complex(2, 0);'], 'scalarD: real 0 vs 1');
control(
  'control_object_property',
  CASES_MAT,
  "a Parameter's Value, two levels into the comparison",
  (f) => f.rename('aParam', 'renamedParam'),
  ["S = renameStructField(S, 'aParam', 'renamedParam');", 'S.renamedParam.Value = 6;'],
  'renamedParam(1).Value',
);
control(
  'control_nested_property',
  CASES_MAT,
  "a Parameter's CoderInfo.StorageClass, three levels in",
  (f) => f.rename('aParam', 'renamedParam'),
  ["S = renameStructField(S, 'aParam', 'renamedParam');", "S.renamedParam.CoderInfo.StorageClass = 'ExportedGlobal';"],
  'renamedParam(1).CoderInfo(1).StorageClass',
);
control(
  'control_string',
  CASES_MAT,
  'a string the save did not write',
  (f) => f.rename('strScalar', 'str2'),
  ["S = renameStructField(S, 'strScalar', 'str2');", 'S.str2 = "other";'],
  'str2: "other" vs "world"',
);
control(
  'control_order',
  CASES_MAT,
  'the variables in another order',
  (f) => f.rename('kp', 'kpR'),
  ["S = renameStructField(S, 'kp', 'kpR');", 'S = orderfields(S);'],
  'variables [',
);
control(
  'control_field_order',
  CASES_MAT,
  "a struct's fields in another order",
  (f) => f.addField(['structScalar'], 'field'),
  ['S.structScalar.field = 0;', 'S.structScalar = orderfields(S.structScalar, [3 1 2]);'],
  'structScalar: fields [field,a,b] vs [a,b,field]',
);
control(
  'control_handle_sharing',
  DAG,
  "one object held twice made two equal objects: the values agree, the sharing does not",
  (f) => f.rename('root', 'rootR'),
  ["S = renameStructField(S, 'root', 'rootR');", 'k = S.rootR.Kids(1); n = DagNode; n.Tag = k.Tag; n.Kids = k.Kids; S.rootR.Kids = [k n];'],
  'handle sharing differs',
);
control(
  'control_anonymous_handle',
  OPAQUE,
  "an anonymous function handle's text",
  (f) => f.rename('fh_anon', 'anonHandle'),
  ["S = renameStructField(S, 'fh_anon', 'anonHandle');", 'S.anonHandle = @(x)x.^2+2;'],
  'anonHandle: @(x)x.^2+2 vs @(x)x.^2+1',
);
control(
  'control_enum',
  OPAQUE,
  'an enumeration member',
  (f) => f.rename('en_on', 'en_onR'),
  ["S = renameStructField(S, 'en_on', 'en_onR');", 'S.en_onR = matlab.lang.OnOffSwitchState.off;'],
  'en_onR: off vs on',
);
control(
  'control_negative_zero',
  EMPTIES_MORE,
  "a complex zero's -0 parts made +0, which isequaln does not see and the bits do",
  (f) => f.set(['nz', 'nz(2)'], '5', 'double', '5'),
  ['S.nz(2) = 5;', 'S.nz(3) = complex(0, 0);'],
  'nz: equal, but not bit for bit',
);
control(
  'control_categorical',
  OPAQUE,
  'a categorical, which has no public property, so only isequaln sees it',
  (f) => f.rename('cat_ab', 'cat_abR'),
  ["S = renameStructField(S, 'cat_ab', 'cat_abR');", 'S.cat_abR(1) = S.cat_abR(2);'],
  'cat_abR: isequaln false',
);

// ---- run ------------------------------------------------------------------------------
const originals = new Map();
function original(rel) {
  let dest = originals.get(rel);
  if (!dest) {
    // A copy, so nothing MATLAB does can touch a tracked fixture.
    dest = OUT + '/orig_' + rel.replace(/[\\/]/g, '_');
    if (crafted.has(rel)) {
      writeFileSync(dest, crafted.get(rel));
    } else {
      copyFileSync(REPO + rel, dest);
    }
    originals.set(rel, dest);
  }
  return dest;
}

const manifest = [];
let saved = 0;
let refused = 0;
let jsFailed = 0;
for (const c of CASES) {
  const rec = {
    id: c.id,
    fixture: c.file,
    original: original(c.file),
    saved: '',
    statements: c.matlab,
    expect: c.expect,
    differs: c.differs,
    plain: false,
    why: c.why,
    refused: '',
    js: '',
    notes: '',
  };
  manifest.push(rec);
  const input = new Uint8Array(bytesOf(c.file));
  const plainBefore = parseMat(input.buffer.slice(0)).records.every((r) => !r.compressed);
  rec.plain = plainBefore;
  let f;
  try {
    // So that "stays uncompressed" below is asked of the files it is about.
    if ((c.file === V6_HANDLES || c.file === V6_HEXOBJ) && !plainBefore) {
      throw new Error(c.file + ' holds a compressed record: it is not the -v6 file this case needs');
    }
    f = opened(c.file);
    c.edit(f);
  } catch (e) {
    rec.js = 'the edit: ' + e.message;
    jsFailed++;
    continue;
  }
  let out;
  try {
    out = f.session.serializeSource(f.name);
  } catch (e) {
    rec.refused = e.message;
    refused++;
    continue;
  }
  const problems = [];
  if (!out || out.kind !== 'binary' || out.sourceFormat !== 'mat') {
    rec.js = 'serializeSource answered ' + JSON.stringify(out && { kind: out.kind, sourceFormat: out.sourceFormat });
    jsFailed++;
    continue;
  }
  const bytes = out.bytes;
  rec.saved = OUT + '/saved_' + c.id + '.mat';
  writeFileSync(rec.saved, bytes);
  saved++;
  if (c.expect === 'identical' && !sameBytes(bytes, input)) {
    problems.push('a save with no edit is not the file, byte for byte');
  }
  if (c.expect !== 'identical' && sameBytes(bytes, input)) {
    problems.push('a save with an edit is the file, byte for byte');
  }
  const after = parseMat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (plainBefore && !after.records.every((r) => !r.compressed)) {
    problems.push('a file of no compressed record saved with one: ' + after.records.filter((r) => r.compressed).map((r) => r.name).join(','));
  }
  const before = checkMatFile(input);
  const added = before.length === 0 ? checkMatFile(bytes) : violationsAdded(before, checkMatFile(bytes));
  if (added.length > 0) {
    problems.push('the checker finds what the file did not have: ' + added.map((v) => v.code + ' ' + v.message).join('; '));
  }
  rec.js = problems.join('; ');
  if (problems.length > 0) {
    jsFailed++;
  }
  rec.notes = [...f.notes, bytes.byteLength + ' bytes (' + input.byteLength + ' read)'].join('; ');
}

writeFileSync(OUT + '/manifest.json', JSON.stringify(manifest, null, 2));
for (const r of manifest) {
  const verdict = r.js ? 'JSFAIL ' + r.js : r.refused ? 'REFUSED ' + r.refused : 'saved';
  console.log(r.id.padEnd(28) + ' ' + verdict);
}
console.log(`PROBE_MAT_WRITEBACK_JS cases=${manifest.length} saved=${saved} refused=${refused} jsfail=${jsFailed} out=${OUT}`);
