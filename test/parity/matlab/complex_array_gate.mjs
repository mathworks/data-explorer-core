// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_complex_array_gate.m, the complex-array live gate: complex arrays typed as
// Values through core's session, as a host types them, into a text dictionary, a binary dictionary
// and a MAT-file (an entry's Value, and a Simulink.Parameter's), each saved. complexArrayGate(core,
// ingest, testDir) makes them and returns { files, cases }: `files` each save by name, `cases` one
// row per typed Value: the file, the entry, the literal typed, the expression MATLAB is to compare
// the loaded value with (the literal, unless it is this package's display spelling and no MATLAB
// syntax, or the class the entry keeps is not the literal's), whether it is the CONTROL, typed one
// value and compared with another, and whether it is a Parameter's Value.
// test/complexArrayGate.truth.test.ts makes the same cases from the package's source.
//
// Run (writes the saves and cases.json for the probe):
//   node test/parity/matlab/complex_array_gate.mjs /tmp/cxgate
// with dist built; then probe_complex_array_gate.m with CX_OUT set to the same directory.

// [entry, literal typed, the expression MATLAB compares with, 'control']
export const ENTRY_CASES = [
  ['scalarD', '[1+i,2i]'],
  ['negD', '[1+i; 2i]'],
  ['tinyD', '[1+2i, 3-4i; -5+6i, 7]'],
  ['bigD', '[Inf+1i NaN]'],
  ['rowVec', '[-Inf-2i 1]'],
  ['colVec', '[Inf-Infi NaN+1i 1NaNi -Inf+2i]', 'complex([Inf NaN 1 -Inf], [-Inf 1 NaN 2])'],
  ['mat2x3', '[1 +2i]'],
  ['eleven', '[1 - 2i 3]'],
  ['exactly10', '{[1+2i 3] 4}'],
  // An int16 entry keeps its class, as a real edit of it does (classAfterEdit).
  ['s_int16', '[1+2i 3-4i]', 'int16([1+2i 3-4i])'],
  // The CONTROL: typed one value, compared with another; the gate must find them different.
  ['long30', '[1+2i 3]', '[1+2i 4]', 'control'],
];
export const PARAMETER_LITERAL = '[1+2i, 3-4i; -5+6i, 7]';
// [kind, the original under test/, the save's name, the entry cases, the Parameter whose Value is typed]
export const VENUES = [
  ['text', 'parity/artifacts/text/cases.sldd', 'cx_text.sldd', ENTRY_CASES, 'aParam'],
  ['binary', 'parity/artifacts/binary/cases.sldd', 'cx_binary.sldd', ENTRY_CASES, 'aParam'],
  ['mat', 'parity/artifacts/mat/cases.mat', 'cx_cases.mat', ENTRY_CASES, null],
  ['mat', 'fixtures/mcos-templates/targets/r2027a/param.mat', 'cx_param.mat', [], 'p0'],
];

export function complexArrayGate(core, ingest, testDir, readFileSync) {
  const files = {};
  const cases = [];
  for (const [kind, rel, file, entryCases, param] of VENUES) {
    const s = core.createSession();
    const u = new Uint8Array(readFileSync(testDir + '/' + rel));
    const root = ingest(s, kind === 'text' ? new TextDecoder().decode(u) : u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength), { filename: file });
    const entries = kind === 'mat' ? root.children : root.children.flatMap((x) => x.children);
    const type = (name, literal) => {
      const e = entries.find((x) => x.name === name);
      if (!e) throw new Error(file + ': no ' + name);
      s.setActive(root, e);
      const r = s.editProperty(e.id, 'Value', literal);
      if (r !== true) throw new Error(file + ' ' + name + ' ' + literal + ': ' + JSON.stringify(r));
    };
    for (const [name, literal, matlab, control] of entryCases) {
      type(name, literal);
      cases.push({ file, kind, entry: name, literal, matlab: matlab ?? literal, control: control === 'control', parameter: false });
    }
    if (param) {
      type(param, PARAMETER_LITERAL);
      cases.push({ file, kind, entry: param, literal: PARAMETER_LITERAL, matlab: PARAMETER_LITERAL, control: false, parameter: true });
    }
    const saved = s.serializeSource(root.name);
    files[file] = saved.text ?? saved.bytes;
  }
  return { files, cases };
}

const { pathToFileURL, fileURLToPath } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const out = process.argv[2];
  if (!out) throw new Error('usage: node complex_array_gate.mjs <out-dir>');
  const testDir = fileURLToPath(new URL('../..', import.meta.url));
  const dist = join(testDir, '..', 'dist');
  const core = await import(join(dist, 'index.js'));
  const { ingest } = await import(join(dist, 'core', 'ingest.js'));
  mkdirSync(out, { recursive: true });
  const { files, cases } = complexArrayGate(core, ingest, testDir, readFileSync);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(out, name), content);
  writeFileSync(join(out, 'cases.json'), JSON.stringify(cases, null, 1));
  console.log('wrote ' + Object.keys(files).length + ' files and ' + cases.length + ' cases to ' + out);
}
