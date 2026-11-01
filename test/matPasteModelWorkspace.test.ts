// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Parameter copied out of a model workspace pastes into a MAT-file. MATLAB saves a model
// workspace's Parameter with CoderInfo.HasCoderInfo false and CustomAttributes [] (its coder
// information never set up), and keeps them so through every copy it makes; a MAT-file's own
// Parameter holds true and MATLAB's default SimulinkCSC.AttribClass_Simulink_Default. MATLAB's isequal
// holds the two equal (R2027a: param_model.slx's 50 Parameters against a MAT-file's same-named ones,
// 50 of 50). A paste makes MATLAB's default object (matPaste.carryObject) and held the copy's two
// leaves to it, so every Parameter of a model workspace was refused ("CoderInfo.HasCoderInfo is
// false in what was copied"). The unset pair is now MATLAB's default CoderInfo, taken together and
// only so: the Parameter made is MATLAB's default object, true and the AttribClass, and holds a
// coder setting the user makes later, which a false one does not keep (MATLAB's save drops it).
// MATLAB ignores what else such a CoderInfo holds (a StorageClass read back Auto), so a copy whose
// unset CoderInfo holds anything but MATLAB's default is refused, naming it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { variableDifference } from '../src/datamodel/parser/MatFileWriter.js';
import { matVariableOfNode } from '../src/datamodel/node/container/matPaste.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import { MIXED, fixture, parsedCopy, reopened, rowsOf, target } from './tools/matPaste.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

// MATLAB-written model workspaces (test/fixtures/mcos/make_*_fixtures.m, test/fixtures/sparse).
const WORKSPACES = [
  'test/fixtures/mcos/typed_ws.slx',
  'test/fixtures/mcos/complex_ws.slx',
  'test/fixtures/mcos/nested_ws.slx',
  'test/fixtures/mcos/mcosfix.slx',
  'test/fixtures/sparse/sparse_ws.slx',
  // param-paste's Parameters in a workspace (make_param_paste_slx.m): struct, integer, single and
  // vector Values, each a Value a paste carries as data or as the text that makes it.
  'test/fixtures/param-paste/r2027a/param_paste.slx',
];

// sparse_ws.slx's Parameters whose Value is sparse.
const SPARSE = ['pSp', 'pSpComplex', 'pSpLogical'];

/** The entries of a model's workspace, each with its copy as a host copies one. */
function workspaceOf(file: string): { entry: Any; payload: Any }[] {
  const root: Any = ingest(createSession(), new Uint8Array(readFileSync(file)), { filename: file.split('/').pop()! });
  const ws = root.children.find((s: Any) => s.name === 'workspace');
  return ws.children.map((entry: Any) => ({ entry, payload: structuredClone(entry.serialize()) }));
}

const coderInfoOf = (payload: Any): Any => payload.value._elements[0]._properties.CoderInfo._properties;

// A Parameter's Value as a node, and where two of them differ, as the variables a MAT reader hands over.
const valueNodeOf = (p: Any): Any => p._valueNode ?? NodeRegistry.parseValue(p.Value === undefined ? [] : p.Value, 'Value', null);
function valueDiffers(copy: Any, made: Any): string | null {
  const a = matVariableOfNode(valueNodeOf(copy), 'Value');
  const b = matVariableOfNode(valueNodeOf(made), 'Value');
  return 'why' in a || 'why' in b ? 'unwritable' : variableDifference(a, b, 'Value');
}

/** `payload` pasted into MIXED, saved and opened again: the Parameter it is, held to the copy. */
function expectPasted(payload: Any) {
  const t = target(fixture(MIXED));
  const res: Any = t.session.pasteEntries('t.mat', [payload]);
  expect(res.error, res.reason).toBeUndefined();
  const [node] = res.nodes;
  const again = reopened(t.save()).children.find((c: Any) => c.name === node.name);
  expect(again?.className, payload.name).toBe('Simulink.Parameter');
  expect(valueDiffers(parsedCopy(payload, node.name), again), payload.name).toBeNull();
  expect(rowsOf(again), payload.name).toEqual(rowsOf(node));
  return again;
}

/** `payload` refused, naming the entry, with `reason`. */
function expectRefused(payload: Any, reason: RegExp) {
  const t = target(fixture(MIXED));
  const res: Any = t.session.pasteEntries('t.mat', [payload]);
  expect(res.error, JSON.stringify(res).slice(0, 200)).toBe(true);
  expect(res.reason).toMatch(new RegExp(`^Cannot paste "${payload.name}" into "t\\.mat": .+\\. Nothing was pasted\\.$`));
  expect(res.reason).toMatch(reason);
  expect(t.session.pasteRefusal('t.mat', payload, { deep: true })).toBe(res.reason);
}

describe("every Parameter of a model workspace pastes into a MAT-file, as MATLAB's default object", () => {
  for (const file of WORKSPACES) {
    it(file, () => {
      let pasted = 0;
      for (const { entry, payload } of workspaceOf(file)) {
        if (entry.className !== 'Simulink.Parameter') continue;
        // MATLAB's own form of a workspace Parameter's coder information.
        expect([coderInfoOf(payload).HasCoderInfo, coderInfoOf(payload).CustomAttributes], entry.name).toEqual([false, []]);
        // A sparse Value, which this package writes into no Parameter of a MAT-file, stays refused.
        if (SPARSE.includes(entry.name) && file.endsWith('sparse_ws.slx')) {
          expectRefused(payload, /\.Value would be a sparse (double|logical), which this editor does not write into a Simulink\.Parameter\./);
          continue;
        }
        const again = expectPasted(payload);
        // MATLAB's default CoderInfo, as a Parameter MATLAB makes holds it: one a later coder edit is kept in.
        const made = coderInfoOf(structuredClone(again.serialize()));
        expect([made.HasCoderInfo, made.CustomAttributes?._object_class], entry.name).toEqual([true, 'SimulinkCSC.AttribClass_Simulink_Default']);
        pasted++;
      }
      expect(pasted, file).toBeGreaterThan(0);
    });
  }

  it('and a Signal of one, whose coder information is set, as it did', () => {
    const sig = workspaceOf('test/fixtures/mcos/mcosfix.slx').find(({ entry }) => entry.className === 'Simulink.Signal')!;
    expect(coderInfoOf(sig.payload).HasCoderInfo).toBe(true);
    const t = target(fixture(MIXED));
    const res: Any = t.session.pasteEntries('t.mat', [sig.payload]);
    expect(res.error, res.reason).toBeUndefined();
  });
});

describe('a copy whose coder information is not MATLAB\'s unset form is still refused', () => {
  const base = () => workspaceOf('test/fixtures/mcos/typed_ws.slx').find(({ entry }) => entry.name === 'pDouble')!.payload;
  const withCoderInfo = (name: string, change: (ci: Any) => void) => {
    const p = structuredClone(base());
    p.name = name;
    change(coderInfoOf(p));
    return p;
  };

  it('an unset CoderInfo holding a coder setting, which MATLAB ignores', () => {
    expectRefused(withCoderInfo('pStorage', (ci) => (ci.StorageClass = 'ExportedGlobal')), /: pStorage\.CoderInfo\.StorageClass is "ExportedGlobal" in what was copied, a coder setting MATLAB ignores on a Parameter whose coder information was never set up, where it reads "Auto"\./);
    expectRefused(withCoderInfo('pAlias', (ci) => (ci.Alias = 'probeName')), /: pAlias\.CoderInfo\.Alias is "probeName" in what was copied, a coder setting MATLAB ignores on a Parameter whose coder information was never set up, where it reads ""\./);
  });

  it('half of the unset pair only', () => {
    const attrib = { _object_class: 'SimulinkCSC.AttribClass_Simulink_Default', _properties: {} };
    expectRefused(withCoderInfo('pHalfFlag', (ci) => (ci.CustomAttributes = attrib)), /: pHalfFlag\.CoderInfo\.HasCoderInfo is false in what was copied/);
    expectRefused(withCoderInfo('pHalfAttrib', (ci) => (ci.HasCoderInfo = true)), /: pHalfAttrib\.CoderInfo\.CustomAttributes is \[\] in what was copied/);
  });
});
