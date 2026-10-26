// Copyright 2026 The MathWorks, Inc.
// Writes manifest.json from the made.json make_edit_bash.m left in r2027a/ and r2023b/: for each
// value, its group, class and size, the files that hold it, what MATLAB said where one does not,
// and how a file that holds it reads it back where that is not as made. Run it after both
// releases have run make_edit_bash.m:
//
//   node test/fixtures/edit-bash/make_manifest.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const RELEASES = ['r2027a', 'r2023b'];
// Each value is in the one of the two MAT-files its made.json `matFile` names.
const FORMATS = {
  mat: { file: 'values.mat', format: 'MAT-file, save -v7' },
  'mat-handles': { file: 'handles.mat', format: 'MAT-file, save -v7 -nocompression, its matlabroot scrubbed' },
  text: { file: 'values_text.sldd', format: "dictionary, FileFormat 'uncompressed-text' (JSON)" },
  binary: { file: 'values_binary.sldd', format: "dictionary, FileFormat 'compressed-binary'" },
};
// The innermost member of each nested value, as MATLAB indexes it.
const DEEPEST = {
  sArr: 'sArr(3).b',
  c2x2: 'c2x2{2,2}',
  sNest: 'sNest.c{2}.s.f',
  cNest: 'cNest{1}{2}{1}',
  saCell: 'saCell(2).c{1}.x',
  deep4: 'deep4.a.b{1}.c.d',
  pStruct: 'pStruct.Value.inner.y',
  pStructArr: 'pStructArr.Value(2).a',
  sHoldsParam: 'sHoldsParam.p.Value',
  cHoldsParam: 'cHoldsParam{1}.Value',
  bus: 'bus.Elements(2).DataType',
};
const ASYMMETRIES = [
  "R2023b has no text dictionary: setting FileFormat fails (\"Unrecognized property 'FileFormat' for class " +
    "'Simulink.data.Dictionary'.\"), so r2023b/ has no values_text.sldd.",
  'A missing string, alone or in a struct field or a cell, is in no dictionary ("<missing> string element not ' +
    'supported."). R2027a takes one alone in addEntry and refuses it at saveChanges, so the error comes at the save.',
  'A function handle, alone or in a struct field or a cell, is in no dictionary; MATLAB says so in four ways ' +
    '(see refused). The values holding one are in handles.mat, not values.mat (see make_edit_bash.m).',
  'The R2027a text dictionary drops the sign of -0 (it writes 0), the shape of an empty numeric (0x3 double and ' +
    "1x0 int8 read back 0x0) and the fields of an empty struct array (struct('a', {}) reads back with none), alone " +
    'and in sLeaves and cLeaves. The binary dictionaries of both releases and both MAT-files keep them.',
  "A Simulink.Parameter's struct Value cannot hold a cell: MATLAB refuses the assignment (\"A valid structure " +
    'must be numeric", both releases), so pStructCell is in no file.',
  'Every dictionary holds a sparse matrix, an enumeration value (matlab.lang.OnOffSwitchState.on) and a struct ' +
    'or a cell holding a Simulink.Parameter, as the MAT-files do.',
  'R2027a loads r2023b/values.mat and opens r2023b/values_binary.sldd with every getValue equal to the MAT-file; ' +
    'R2023b cannot read R2027a-written Simulink objects or dictionaries.',
];

const made = Object.fromEntries(RELEASES.map((r) => [r, JSON.parse(readFileSync(here(`${r}/made.json`), 'utf8'))]));
const files = {};
const notWritten = {};
const variables = {};
const leaves = made.r2027a.values.filter((v) => v.group === 'leaf').map((v) => v.name);
for (const r of RELEASES) {
  for (const [fmt, { file, format }] of Object.entries(FORMATS)) {
    const key = `${r}-${fmt}`;
    const field = fmt.startsWith('mat') ? 'mat' : fmt;
    const mine = made[r].values.filter((v) => field !== 'mat' || v.matFile === file);
    const statuses = mine.map((v) => v[field]);
    if (statuses.every((s) => s.startsWith('n/a: '))) {
      notWritten[key] = statuses[0].slice('n/a: '.length);
      continue;
    }
    files[key] = { path: `${r}/${file}`, writtenBy: made[r].version, format };
    for (const v of mine) {
      const entry = (variables[v.name] ??= { group: v.group, class: v.class, size: v.size, in: [] });
      if (entry.class !== v.class || entry.size !== v.size) {
        throw new Error(`${v.name} is ${v.class} ${v.size} in ${r}, ${entry.class} ${entry.size} before`);
      }
      const s = v[field];
      if (s === 'same') {
        entry.in.push(key);
      } else if (s.startsWith('differs: ')) {
        entry.in.push(key);
        (entry.readsBackOtherwise ??= {})[key] = s.slice('differs: '.length);
      } else if (s.startsWith('refused')) {
        (entry.refused ??= {})[key] = s;
      } else {
        throw new Error(`${v.name} in ${key}: ${s}`);
      }
    }
  }
}
for (const [name, entry] of Object.entries(variables)) {
  if (name === 'sLeaves') entry.fields = leaves;
  if (name === 'cLeaves') entry.elements = leaves;
  const edge = /^(.*)In(Struct|Cell)$/.exec(name);
  entry.deepest = DEEPEST[name] ?? (edge ? (edge[2] === 'Struct' ? `${name}.v` : `${name}{1}`) : undefined);
}
const notConstructed = made.r2027a.notConstructed.map((n) => ({
  ...n,
  releases: RELEASES.filter((r) => made[r].notConstructed.some((m) => m.name === n.name && m.error === n.error)),
}));
const manifest = {
  about:
    'The edit-bash parity fixtures (make_edit_bash.m, then this script). "in" lists the files that hold a ' +
    'value; "refused" is what MATLAB said where a file does not; "readsBackOtherwise" is how MATLAB reads a ' +
    'held value back where that is not the value it was given.',
  files,
  notWritten,
  variables,
  notConstructed,
  asymmetries: ASYMMETRIES,
};
writeFileSync(here('manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('WROTE manifest.json:', Object.keys(variables).length, 'values,', Object.keys(files).length, 'files');
