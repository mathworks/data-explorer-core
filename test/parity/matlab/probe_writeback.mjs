// THE acceptance gate for the write path: does MATLAB read back what our writer
// emits?
//
// Every check that predates this one round-tripped through our OWN reader, which is
// self-consistency rather than truth — and that is exactly how defect 19 (a
// `Matrix()` spelling MATLAB discards as an empty 1x0) and defect 22 (a rank-3
// header MATLAB reads the same way) each survived three verification passes. So
// this probe takes a dictionary MATLAB wrote, replaces one entry's value with OUR
// serialization of it, and asks MATLAB what it sees.
//
// Two halves, one manifest between them:
//   node test/parity/matlab/probe_writeback.mjs           writes the spliced files
//   probe_writeback.m                                     reads them in MATLAB
//
// Run both (PROBE_OUT must be ABSOLUTE — MATLAB's dictionary API rejects a
// relative path with SLDD:sldd:DictionaryNotFound, which turns every verdict into
// a meaningless FAIL):
//
//   npm run build
//   env PROBE_OUT=/tmp/wb node test/parity/matlab/probe_writeback.mjs
//   env PROBE_OUT=/tmp/wb mw -using Bmain matlab -nodesktop \
//       -batch "run('$PWD/test/parity/matlab/probe_writeback.m')"
//
// It reads the BUILT package rather than `src/`, and so needs a build first: node's
// own type stripping resolves import specifiers literally, and every `.ts` file
// here imports its neighbours with the `.js` spelling that only a bundler rewrites.
// Reading `dist/` is no loss — it is what a consumer runs — but a stale `dist/` is
// a stale verdict, hence the `npm run build` above.
//
// The last line of the MATLAB half is `WRITEBACK FAILURES n of m`. Zero is the
// only acceptable result.
//
// Batches, each answering a different question:
//   rich     all thirteen rank >= 3 kinds, marked modified so the value goes
//            through the writer instead of replaying _rawInput. MATLAB must report
//            a value isequal to the one it wrote, same class, same size.
//   nested   the same rank-3 value in six positions — entry, object property,
//            struct field, cell element, two levels down — compared AT THE LEAF,
//            so a cdata written one level too high fails even though the value
//            inside it survives.
//   typed    the nine typed/char shapes of probe_typed_shapes.m: an int32 vector, a
//            column, a matrix, single, logical, uint64, a struct of typed fields, a
//            struct with a char matrix, a cell of all four.
//   char     the six char shapes of probe_char_shape.m — a row, an empty, a 3x1
//            column, a 2x2, a 2x3 and a 2x3x2 — through the writer unchanged. MATLAB
//            spells a char two ways (a bare string for a row, an mxchar literal of
//            character CODES otherwise) and we had read neither, so this batch is the
//            one that asks MATLAB whether the mxchar we now emit is the mxchar it
//            reads.
//   charedit the same shapes RETYPED through setProperty, including committing a char
//            matrix's own displayed literal — the text the table seeds its editor
//            with, which used to retype the entry char -> string and reshape it.
//   complex  a complex scalar and a complex vector. MATLAB stores BOTH as cdata in
//            its own text dictionary; we emit the binary dictionary's plain-text
//            `{_type: 'cdata', _value: '1+2i'}` for the scalar, and nobody has ever
//            asked MATLAB whether it reads that back.
//   edit     the three rank-3 entries of the parity corpus with a REAL edit through
//            setProperty('Value', ...), the call a consumer makes when a user
//            commits one cell. MATLAB must see the edit AND keep the other eleven.
//   paramedit a Simulink.Parameter's Value typed by the user. This is the one path
//            the batches above miss: they edit an entry, this edits an object
//            PROPERTY, which goes through ParameterNode._adoptValueNode instead.
//   literal  hand-written `_value` spellings, to pin what the grammar accepts
//            independently of what our writer currently does.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createSession, ingest } from '../../../dist/index.js';

// test/parity/loadFile.ts in twelve lines, against the built package: ingest is the
// entry point a host calls, so the format sniffing is exercised too.
function loadFile(path, filename) {
  const u8 = new Uint8Array(readFileSync(path));
  const bytes = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  return ingest(createSession(), bytes, { filename: filename ?? path.split('/').pop() });
}

function findEntry(root, name) {
  const stack = [root];
  const seen = [];
  while (stack.length) {
    const n = stack.shift();
    if (!n) {
      continue;
    }
    seen.push(n.name);
    if (n.name === name && !String(n.id ?? '').startsWith('section:')) {
      return n;
    }
    if (n.children) {
      stack.push(...n.children);
    }
  }
  throw new Error('no entry "' + name + '"; have: ' + seen.filter(Boolean).join(', '));
}

const OUT = process.env.PROBE_OUT || '/tmp/writeback_probe';
mkdirSync(OUT, { recursive: true });
const CHUNK = '__MW_TEXT_PART__/data/chunk0';

// Repo-relative, so node has to be launched from the repo root.
const RICH_SRC = 'test/fixtures/nd_rich.sldd';
const NESTED_SRC = 'test/fixtures/nd_nested.sldd';
const TYPED_SRC = 'test/fixtures/typed_text.sldd';
const CHAR_SRC = 'test/fixtures/char_text.sldd';
const CASES_SRC = 'test/parity/artifacts/text/cases.sldd';

// Every record in the manifest carries the same keys, empty where they do not
// apply: MATLAB's jsondecode gives a struct ARRAY only for homogeneous objects, and
// a heterogeneous list arrives as a cell array of structs, which reads e(k).name as
// an error rather than as a value.
const manifest = [];

// The reference each spliced file is compared against. MATLAB is given a COPY
// inside the probe directory, for two reasons: the dictionary API needs an
// absolute path, and a tracked artifact must not be exposed to anything MATLAB
// might write while it holds the file open.
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

function entriesOf(doc) {
  return doc.__MW_TEXT_PARTS__[CHUNK].__MW_TEXT_content.entries;
}

function splice(srcPath, name, value, outPath) {
  const doc = JSON.parse(readFileSync(srcPath, 'utf8'));
  const rec = entriesOf(doc).find((e) => e.name === name);
  if (!rec) {
    throw new Error('entry ' + name + ' not in ' + srcPath);
  }
  rec.value = value;
  writeFileSync(outPath, JSON.stringify(doc));
}

/**
 * Mark this node AND every node under it modified.
 *
 * `_markModified` walks UP the chain, never down, so marking an entry leaves its
 * struct fields and cell elements unmodified — and an unmodified node replays its
 * `_rawInput` verbatim. For a container that means the leaves are byte-copied out of
 * the source file and the writer is never asked about them, so a nested case passed
 * this gate while testing nothing. (The rich batch is immune: its whole value is one
 * cdata built from the live tree. The nested, typed and complex batches were not.)
 */
function deepMark(n) {
  n._markModified();
  for (const c of n.children ?? []) {
    deepMark(c);
  }
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

/**
 * One case: serialize `name` out of `src` (after `edit`, if any) and splice it into
 * a copy of that same file. `extract` is the MATLAB expression that reaches the
 * value being compared — it walks through the containers to the leaf, and it also
 * keeps isequal off two Simulink.Parameter handles, which is handle identity and
 * false for any two distinct objects however equal their contents.
 */
function run(batch, src, name, opts = {}) {
  const ref = reference(src);
  const tag = opts.tag ? '_' + opts.tag : '';
  const label = batch + '/' + name + (opts.tag ? '[' + opts.tag + ']' : '');
  const base = {
    batch,
    file: '',
    ref,
    // An edit given a refexpr is checked for EQUALITY against that expression, not
    // merely for shape: when we know what the user typed we know exactly what MATLAB
    // must report. `kind: 'edited'` is for an edit whose only reference is the
    // UNedited entry, where isequal is false by construction and shape is all
    // there is to compare.
    refexpr: opts.refexpr || '',
    name,
    label,
    kind: opts.edit && !opts.refexpr ? 'edited' : 'same',
    extract: opts.extract || '',
    expect: opts.expect || 'isequal to the value MATLAB wrote' + (opts.extract ? ' at ' + opts.extract : ''),
    why: '',
  };
  try {
    const n = findEntry(loadFile(src), name);
    if (opts.edit) {
      opts.edit(n);
    } else {
      // An untouched .sldd value replays _rawInput verbatim, which is a byte copy
      // and proves nothing about the writer — at every level, hence deepMark.
      deepMark(n);
    }
    const ser = n.serializeValue();
    const f = OUT + '/' + batch + '_' + name + tag + '.sldd';
    splice(src, name, ser, f);
    manifest.push(Object.assign(base, { file: f }));
    console.log('WROTE', label, '->', JSON.stringify(ser).slice(0, 70));
  } catch (e) {
    // A case our writer cannot produce at all is a failure of the gate, not an
    // absence from it: it is counted as one by the MATLAB half.
    console.log('SKIP ', label, '-', String(e.message).slice(0, 160));
    manifest.push(Object.assign(base, { kind: 'skipped', why: String(e.message) }));
  }
}

/**
 * A hand-written `_value` spelling, spliced over an entry of a matching class and
 * compared against a MATLAB expression rather than against another entry. This is
 * how a grammar question gets answered without our writer in the loop at all.
 */
function literal(over, value, refexpr, note, tag) {
  const f = OUT + '/literal_' + over + (tag ? '_' + tag : '') + '.sldd';
  splice(CASES_SRC, over, value, f);
  manifest.push({
    batch: 'literal',
    file: f,
    ref: reference(CASES_SRC),
    refexpr,
    name: over,
    label: 'literal/' + over + (tag ? '[' + tag + ']' : ''),
    kind: 'same',
    extract: '',
    expect: note + ' -> ' + refexpr,
    why: '',
  });
  console.log('WROTE literal', over, '->', JSON.stringify(value).slice(0, 70));
}

// ---- batch: every ND kind, through the writer, value unchanged ---------------
for (const name of [
  'ndDouble', 'ndSingle', 'ndInt32', 'ndUint64', 'ndLogical', 'ndChar', 'ndComplex',
  'ndCellMixed', 'ndStructMulti', 'ndStride3', 'ndStride4', 'ndStride5', 'ndStride6',
]) {
  run('rich', RICH_SRC, name);
}

// ---- batch: the same rank-3 value nested six ways ----------------------------
for (const [name, extract] of [
  ['ndTop', ''], ['ndParam', '.Value'], ['ndSignal', '.Dimensions'],
  ['ndInStruct', '.deep'], ['ndInCell', '{2}'], ['ndTwoLevel', '.inner.deep'],
]) {
  run('nested', NESTED_SRC, name, { extract });
}

// ---- batch: typed arrays and char shapes, at three placements ----------------
for (const name of [
  'i32Vec', 'i32Col', 'i32Mat', 'sglVec', 'lglVec', 'u64Vec2', 'sTyped', 'sCharMat', 'cTyped',
]) {
  run('typed', TYPED_SRC, name);
}

// ---- batch: char shapes, through the writer, value unchanged -----------------
for (const name of ['charRow', 'charEmpty', 'charCol', 'charMat', 'charMat23', 'ndChar']) {
  run('char', CHAR_SRC, name);
}

// ---- batch: char shapes, RETYPED through the editor --------------------------
// The channel with no file to compare against, and the one that was still wrong after
// the reader and both writers were right: the table shows a 2x2 char as ['ab'; 'cd']
// and seeds its editor with that text, so committing it unchanged must reach MATLAB as
// the same 2x2 char. It reached MATLAB as a 2x1 STRING, because the value parser
// discarded which quote a text row had used. Each reference is the literal the user
// typed, so the comparison is equality and not merely shape.
const CHAR_EDITS = [
  // The no-op: the display, retyped verbatim.
  ['same', 'charMat', "['ab'; 'cd']", "['ab'; 'cd']"],
  // A real retype at the same shape, so a value that came back unchanged fails.
  ['retype', 'charMat', "['xy'; 'zw']", "['xy'; 'zw']"],
  // A retype that RESHAPES, 2x2 -> 2x3: the Dimension/header has to follow the value.
  ['grow', 'charMat', "['abc'; 'def']", "['abc'; 'def']"],
  ['col', 'charCol', "['x'; 'y'; 'z']", "['x'; 'y'; 'z']"],
  // A row states no shape, and must not start doing so (the char half of defect 21).
  ['row', 'charRow', "'other'", "'other'"],
  // A matrix collapsed to a row: the mxchar envelope has to disappear again.
  ['flatten', 'charMat', "'hello'", "'hello'"],
  // Pieces on one row concatenate horizontally — MATLAB's own reading of ['a' 'b'].
  ['concat', 'charRow', "['ab' 'cd']", "'abcd'"],
];
for (const [tag, name, typed, refexpr] of CHAR_EDITS) {
  run('charedit', CHAR_SRC, name, {
    tag,
    refexpr,
    expect: 'committing ' + typed + ' -> ' + refexpr,
    edit: (n) => {
      const r = n.setProperty('Value', typed);
      if (r !== true) {
        throw new Error('setProperty rejected ' + typed + ': ' + JSON.stringify(r));
      }
    },
  });
}

// ---- batch: complex, which MATLAB stores as cdata at BOTH shapes -------------
for (const name of ['cplxScalar', 'cplxVec']) {
  run('complex', CASES_SRC, name);
}

// ---- batch: the three rank-3 entries of the parity corpus, edited -----------
run('edit', CASES_SRC, 'nd2x3x2', {
  expect: '2x3x2 double, (1,1,1)=99, the other eleven unchanged',
  edit: (n) => byLabel(n, 'nd2x3x2(1,1,1)').setProperty('Value', '99'),
});
run('edit', CASES_SRC, 'cellNd', {
  expect: '2x3x2 cell, {1,1,1}=99, the other eleven unchanged',
  edit: (n) => byLabel(n, 'cellNd{1,1,1}').setProperty('Value', '99'),
});
run('edit', CASES_SRC, 'structNd', {
  expect: '2x3x2 struct, (1,1,1).a=99, the other eleven unchanged',
  edit: (n) => byLabel(n, 'structNd(1,1,1)').children[0].setProperty('Value', '99'),
});

// ---- batch: a Parameter's Value, typed by the user --------------------------
// The single most ordinary edit a consumer produces, and the one path the batches
// above all miss: they edit an ENTRY, while this edits an OBJECT PROPERTY through
// ParameterNode.setProperty. That path builds a raw value from the typed text and
// hands it to _adoptValueNode, and an adopted node that nobody marked Modified
// replays its `_rawInput` — so our own intermediate spelling went into the file
// without the writer ever being consulted. Both spellings below are ones MATLAB
// reads back as an empty 1x0 double; the reference is what the user typed, so the
// comparison is equality and not merely shape.
const PARAM_EDITS = [
  ['cplx', '3+4i', '3+4i', 'a complex scalar typed into a Parameter'],
  ['mat', '[1 2; 3 4]', '[1 2; 3 4]', 'a matrix typed into a Parameter (newline-joined body, defect 19)'],
  // The control: a plain vector took neither broken spelling, and must not start.
  ['vec', '[7 8 9]', '[7 8 9]', 'a plain double vector typed into a Parameter'],
];
for (const [tag, typed, refexpr, note] of PARAM_EDITS) {
  run('paramedit', CASES_SRC, 'aParam', {
    tag,
    extract: '.Value',
    refexpr,
    expect: note + ' -> ' + refexpr,
    edit: (n) => {
      const r = n.setProperty('Value', typed);
      if (r !== true) {
        throw new Error('setProperty rejected ' + typed + ': ' + JSON.stringify(r));
      }
    },
  });
}

// ---- batch: grammar questions, no writer involved ---------------------------
// A typed ROW vector with the Matrix(1,N) header MATLAB does not write for that
// orientation (defect 21). If MATLAB reads it, the header is cosmetic churn; if it
// does not, defect 21 is data loss and every typed array edit is destroyed.
literal('i16Vec', { _type: 'int16', _value: 'Matrix(1,3)\n[1, 2, 3]' }, 'int16([1 2 3])',
  'a typed row vector carrying the column orientation\'s header');
// A single vector holding Inf. `formatNumLiteral` spells it 'InfF', which is not a
// spelling MATLAB has ever been seen to write.
literal('nonFinVec', { _type: 'single', _value: '[InfF, 2.0F]' }, 'single([Inf 2])',
  'the single suffix on a non-finite');
// The mxchar form MATLAB uses for a char MATRIX, to pin the convention before the
// reader is built on it: bracketed groups are ROWS and the numbers are character
// CODES, so [[97, 98]; [99, 100]] is ['ab'; 'cd'].
literal('charStr', { _type: 'mxchar', _value: 'Matrix(2,2)\n[[97, 98]; [99, 100]]' }, "['ab'; 'cd']",
  'mxchar rows of character codes');
// The row form we deliberately do NOT write, for the same reason defect 21 exists: a
// bare string already reads back as a row, so an mxchar with a 1xN header would be
// churn — IF MATLAB reads it. If it does not, the row rule is load-bearing rather
// than cosmetic, and charNeedsShape is the only thing standing between a char row and
// a value MATLAB cannot open.
literal('charStr', { _type: 'mxchar', _value: 'Matrix(1,4)\n[105, 116, 39, 115]' }, "'it''s'",
  'an mxchar row, the orientation MATLAB spells as a bare string', 'row');
// A column, whose body MATLAB writes FLAT under the header rather than as one
// bracketed group per row. Spelling it in groups is what the matrix form does, so this
// pins that the two are not interchangeable.
literal('charStr', { _type: 'mxchar', _value: 'Matrix(4,1)\n[[105]; [116]; [39]; [115]]' }, "['i'; 't'; ''''; 's']",
  'an mxchar column written as bracketed one-element groups', 'colgroups');

// CONTROL: an unedited re-stringify of each source. If MATLAB cannot read one of
// these, this probe's own JSON handling is at fault and nothing else here means
// anything.
const controls = [];
for (const [src] of refs) {
  const dest = OUT + '/control_' + src.replace(/[\\/]/g, '_');
  writeFileSync(dest, JSON.stringify(JSON.parse(readFileSync(src, 'utf8'))));
  controls.push(dest);
}
writeFileSync(OUT + '/controls.json', JSON.stringify(controls, null, 2));
writeFileSync(OUT + '/manifest.json', JSON.stringify(manifest, null, 2));
console.log('manifest:', manifest.length, 'cases,', controls.length, 'controls ->', OUT);
