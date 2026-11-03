// Copyright 2026 The MathWorks, Inc.
//
// THE acceptance gate for the save of a model's workspace: does MATLAB open what
// session.serializeSource writes for a `.slx`, holding as its Model Workspace the edit the
// session made, and nothing else changed?
//
// test/modelFileSave.test.ts reads every save back with core's own reader. Only MATLAB can say
// that a model it is handed opens, opens without a warning, updates as it did, and holds the
// variables the session showed after its edit.
//
// So each case opens a `.slx` MATLAB wrote through the session API, as a host does, makes its
// edits there (editProperty, addEntry, deleteNodeById, undo), saves it with serializeSource,
// and records beside the saved model THE SAME EDIT as MATLAB statements on a struct `S` of the
// original's workspace variables (`S.scalarD = 42;`, `S = rmfield(S, 'negD');`).
// probe_model_workspace_save.m opens the original, makes the edit in MATLAB, opens the save,
// and compares the two.
//
// Two halves, one manifest between them (PROBE_OUT must be the same ABSOLUTE path in each):
//
//   npm run build
//   env PROBE_OUT=/tmp/mwsave node test/parity/matlab/probe_model_workspace_save.mjs
//   env PROBE_OUT=/tmp/mwsave mw -using Bmain matlab -nodesktop \
//       -batch "run('$PWD/test/parity/matlab/probe_model_workspace_save.m')"
//
// It reads the BUILT package, as probe_mat_writeback.mjs does, so a stale `dist/` is a stale
// verdict. What this half asserts itself, and records as `js` (anything but '' fails the case):
// every edit is accepted; the save answers `{ kind: 'binary', sourceFormat: 'slx' }`; every
// member but the workspace part, [Content_Types].xml and _rels/.rels is as read; and a save with
// no edit holds every member as read.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../../../dist/index.js';

const TEST = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.env.PROBE_OUT || '/tmp/model_workspace_save_probe';
if (!OUT.startsWith('/')) {
  throw new Error('PROBE_OUT must be an ABSOLUTE path, the same one the MATLAB half is given; got ' + OUT);
}
mkdirSync(OUT, { recursive: true });

const CASES = 'parity/artifacts/slx/cases.slx';
const R27 = 'parity/artifacts/slx_layouts/slxcases.slx';
const R21 = 'parity/artifacts/slx_layouts/slxcases_R2021a.slx';
const R18 = 'parity/artifacts/slx_layouts/slxcases_R2018a.slx';
const MCOS = 'fixtures/mcos/mcosfix.slx';
const TYPED = 'fixtures/mcos/typed_ws.slx';
const NESTED = 'fixtures/mcos/nested_ws.slx';
const SPARSE = 'fixtures/sparse/sparse_ws.slx';

// Each edit: ['edit', path, key, text], ['add', name], ['delete', path], ['undo']. A path is a
// variable's name, then each child by its name or, for an element, by its 0-based index (`rowVec.1`).
const cases = [
  { id: 'cases_none', file: CASES, edits: [], m: '' },
  { id: 'cases_value', file: CASES, edits: [['edit', 'scalarD', 'Value', '42']], m: 'S.scalarD = 42;' },
  { id: 'cases_element', file: CASES, edits: [['edit', 'rowVec.1', 'Value', '99']], m: 'S.rowVec(2) = 99;' },
  { id: 'cases_matrix', file: CASES, edits: [['edit', 'mat2x3', 'Value', '[9 8 7; 6 5 4]']], m: 'S.mat2x3 = [9 8 7; 6 5 4];' },
  { id: 'cases_int', file: CASES, edits: [['edit', 's_int16', 'Value', '-123']], m: 'S.s_int16 = int16(-123);' },
  { id: 'cases_char', file: CASES, edits: [['edit', 'charStr', 'Value', "'edited text'"]], m: "S.charStr = 'edited text';" },
  { id: 'cases_logical', file: CASES, edits: [['edit', 'boolT', 'Value', 'false']], m: 'S.boolT = false;' },
  { id: 'cases_complex', file: CASES, edits: [['edit', 'cplxScalar', 'Value', '3-4i']], m: 'S.cplxScalar = 3-4i;' },
  { id: 'cases_rename', file: CASES, edits: [['edit', 'tinyD', 'Name', 'Atiny']], m: "S.Atiny = S.tinyD; S = rmfield(S, 'tinyD');" },
  { id: 'cases_add', file: CASES, edits: [['add', 'added']], m: 'S.added = 0;' },
  { id: 'cases_delete', file: CASES, edits: [['delete', 'negD']], m: "S = rmfield(S, 'negD');" },
  { id: 'cases_add_delete_rename', file: CASES, edits: [['add', 'zz'], ['delete', 'eleven'], ['edit', 'exactly10', 'Name', 'ten']], m: "S.zz = 0; S = rmfield(S, 'eleven'); S.ten = S.exactly10; S = rmfield(S, 'exactly10');" },
  { id: 'cases_struct_field', file: CASES, edits: [['edit', 'structScalar.a', 'Value', '17']], m: 'S.structScalar.a = 17;' },
  { id: 'cases_param_value', file: CASES, edits: [['edit', 'aParam', 'Value', '9']], m: 'S.aParam.Value = 9;' },
  { id: 'cases_param_description', file: CASES, edits: [['edit', 'aParam', 'Description', 'edited here']], m: "S.aParam.Description = 'edited here';" },
  { id: 'cases_undo', file: CASES, edits: [['edit', 'scalarD', 'Value', '42'], ['undo']], m: '' },
  { id: 'r27_value', file: R27, edits: [['edit', 'tau', 'Value', '0.5']], m: 'S.tau = 0.5;' },
  { id: 'r21_value', file: R21, edits: [['edit', 'tau', 'Value', '0.5']], m: 'S.tau = 0.5;' },
  { id: 'r21_add_rename', file: R21, edits: [['add', 'k'], ['edit', 'label', 'Name', 'Label']], m: "S.k = 0; S.Label = S.label; S = rmfield(S, 'label');" },
  { id: 'r18_value', file: R18, edits: [['edit', 'tau', 'Value', '0.5']], m: 'S.tau = 0.5;' },
  { id: 'r18_add_delete', file: R18, edits: [['add', 'k'], ['delete', 'flag']], m: "S.k = 0; S = rmfield(S, 'flag');" },
  { id: 'first_r27', file: 'parity/artifacts/slx_layouts/slxcfgref.slx', edits: [['add', 'k']], m: 'S.k = 0;' },
  { id: 'first_r21', file: 'parity/artifacts/slx_layouts/slxcfgref_R2021a.slx', edits: [['add', 'k']], m: 'S.k = 0;' },
  { id: 'first_r18', file: 'parity/artifacts/slx_layouts/slxcfgref_R2018a.slx', edits: [['add', 'k']], m: 'S.k = 0;' },
  { id: 'mcos_signal_description', file: MCOS, edits: [['edit', 'Sig', 'Description', 'a signal']], m: "S.Sig.Description = 'a signal';" },
  { id: 'mcos_param_value', file: MCOS, edits: [['edit', 'Param', 'Value', '7']], m: 'S.Param.Value = 7;' },
  { id: 'mcos_last_deleted', file: MCOS, edits: [['delete', 'Alias'], ['delete', 'Bp'], ['delete', 'Lut'], ['delete', 'Numeric'], ['delete', 'Param'], ['delete', 'ParamMat'], ['delete', 'Sig']], m: 'S = struct();' },
  // A Value typed in is the value MATLAB makes of the text, written in its own class, as `p.Value =`
  // writes it: `5` is a double, whatever the Parameter held, and `int8(5)` an int8.
  { id: 'typed_double_over_int8', file: TYPED, edits: [['edit', 'pInt8', 'Value', '5']], m: 'S.pInt8.Value = 5;' },
  { id: 'typed_int8', file: TYPED, edits: [['edit', 'pInt8', 'Value', 'int8(5)']], m: 'S.pInt8.Value = int8(5);' },
  { id: 'nested_field_rename', file: NESTED, edits: [['edit', 'cfg.k', 'Name', 'kk']], m: "S.cfg.kk = S.cfg.k; S.cfg = rmfield(S.cfg, 'k');" },
  // A Parameter's storage class a model workspace keeps (ModelWorkspaceNode offers every one but
  // Custom), of one whose coder settings MATLAB keeps: nested in a struct, HasCoderInfo true.
  { id: 'nested_storage_exported', file: NESTED, edits: [['edit', 'cfg.k', 'storageClass', 'ExportedGlobal']], m: "S.cfg.k.CoderInfo.StorageClass = 'ExportedGlobal';" },
  { id: 'sparse_plain', file: SPARSE, edits: [['edit', 'dRow', 'Value', '[1 2 3]']], m: 'S.dRow = [1 2 3];' },
];

function nodeAt(workspace, path) {
  let node = null;
  for (const [i, step] of path.split('.').entries()) {
    const from = i === 0 ? workspace : node;
    node = /^\d+$/.test(step) ? from.children[Number(step)] : from.children.find((c) => c.name === step);
    if (!node) throw new Error('no node at ' + path);
  }
  return node;
}

const NAMING = new Set(['[Content_Types].xml', '_rels/.rels', 'simulink/modelWorkspace.mxarray', 'simulink/modelworkspace.mat']);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const manifest = [];
for (const c of cases) {
  const read = new Uint8Array(readFileSync(TEST + c.file));
  const s = createSession();
  const model = s.addModelSource(c.id + '.slx', read.buffer.slice(read.byteOffset, read.byteOffset + read.byteLength));
  s.setActiveContext(model);
  const workspace = model.getSection('workspace');
  let js = '';
  try {
    for (const e of c.edits) {
      if (e[0] === 'edit') {
        const node = nodeAt(workspace, e[1]);
        s.setActive(model, node);
        const r = s.editProperty(node.id, e[2], e[3]);
        if (r !== true) throw new Error('edit ' + e.join(' ') + ' refused: ' + JSON.stringify(r));
      } else if (e[0] === 'add') {
        if (!s.addEntry('workspace', '', e[1])) throw new Error('add ' + e[1] + ' refused: ' + s.addEntryRefusal());
      } else if (e[0] === 'delete') {
        if (!s.deleteNodeById(nodeAt(workspace, e[1]).id)) throw new Error('delete ' + e[1] + ' refused: ' + s.deleteRefusal(nodeAt(workspace, e[1]).id));
      } else if (e[0] === 'undo') {
        s.undo();
      }
    }
    const out = s.serializeSource(c.id + '.slx');
    if (!out || out.kind !== 'binary' || out.sourceFormat !== 'slx') throw new Error('the save answered ' + JSON.stringify(out && { kind: out.kind, sourceFormat: out.sourceFormat }));
    writeFileSync(OUT + '/' + c.id + '.slx', out.bytes);
    const before = unzipSync(read);
    const after = unzipSync(out.bytes);
    for (const name of Object.keys(before)) {
      const kept = after[name] && same(after[name], before[name]);
      if (!kept && (c.edits.length === 0 || c.m === '' || !NAMING.has(name))) throw new Error('member ' + name + ' changed');
    }
  } catch (err) {
    js = String(err.message ?? err);
  }
  manifest.push({ id: c.id, original: TEST + c.file, saved: OUT + '/' + c.id + '.slx', statements: c.m, js });
  console.log((js ? 'JS FAIL ' : 'JS ok   ') + c.id + (js ? ' ' + js : ''));
}
writeFileSync(OUT + '/manifest.json', JSON.stringify(manifest, null, 1));
console.log('MODEL_WORKSPACE_SAVE JS DONE ' + manifest.length + ' cases, ' + manifest.filter((m) => m.js).length + ' failed');
