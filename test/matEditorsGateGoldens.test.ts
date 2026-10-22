// Copyright 2026 The MathWorks, Inc.
//
// The live gate of the editors a MAT-file offers of properties a node shows read-only elsewhere
// (BaseNode.sourceOfferedEditor), held byte for byte: test/fixtures/mat-create-gate/editors.json.
// Each case is a file core saved after edits of those rows, a Signal's Dimensions, InitialValue,
// SampleTime, SamplingMode and Identifier, a Bus's DataScope, HeaderFile, Alignment and
// PreserveElementDimensions and an element's Dimensions, a ValueType's Dimensions, an AliasType's
// DataScope and HeaderFile, a NumericType's every row in sequences of its modes, a Parameter's Unit
// and Identifier, of objects created and of objects files of R2023b, R2024b and R2027a hold, all
// through the session; and MATLAB loaded each in R2027a, R2023b and R2024b equal to its own objects
// with the same assignments, in order (each case's `verdicts`; the creation gate's checks, its
// README in the research probes, tierb/gate-create). Here the same edits must save that file again.
//
// Of the files whose original is cases.mat, R2023b and R2024b ran every check but the last
// ('PASS_NO_RESAVE'): each of them crashes on a save of what it loads of that original, untouched,
// and a load of that save. Of an edit of a CoderInfo R2027a wrote, they judged every check with the
// CoderInfo held to what they read of it ('PASS_CODERINFO_UNREAD'): none, of the original's too.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

const TEST = fileURLToPath(new URL('.', import.meta.url));

interface GateCase {
  name: string;
  original: string;
  sha256: string;
  verdicts: Record<string, 'PASS' | 'PASS_NO_RESAVE' | 'PASS_CODERINFO_UNREAD'>;
}
const DOC = JSON.parse(readFileSync(TEST + 'fixtures/mat-create-gate/editors.json', 'utf8')) as { cases: GateCase[] };
const CASES_MAT = 'parity/artifacts/mat/cases.mat';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function opened(path: string) {
  const b = readFileSync(TEST + path);
  const session = createSession();
  const root: any = session.addMatSource('f.mat', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const by = (name: string): any => root.children.find((c: any) => c.name === name);
  const edit = (node: any, prop: string, value: string) => {
    session.setActive(root, node);
    expect(session.editProperty(node.id, prop, value), `${node.matlabPath} ${prop} = ${value}`).toBe(true);
  };
  const add = (cls: string, name: string): any => {
    session.setActiveContext(root);
    return session.addEntry('', cls, name);
  };
  const addElement = (bus: any): any => session.addChildTo(bus.id);
  const save = (): Uint8Array => (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;
  return { by, edit, add, addElement, save };
}
type Opened = ReturnType<typeof opened>;

const EDITS: Record<string, [string, string][]> = {
  signal: [['dimensions', '[2 3]'], ['initialValue', '0.5'], ['sampleTime', '[0.2 0.1]'], ['samplingMode', 'Sample based'], ['Unit', 'V'], ['storageClass', 'ExportedGlobal'], ['identifier', 'sigId']],
  parameter: [['Unit', 'm'], ['storageClass', 'ImportedExtern'], ['identifier', 'pId']],
  bus: [['dataScope', 'Exported'], ['headerFile', 'bus.h'], ['alignment', '16'], ['preserveElementDimensions', 'true']],
  valueType: [['dimensions', '[3 1]']],
  aliasType: [['dataScope', 'Imported'], ['headerFile', 'a.h']],
  ntBinary: [['dataTypeMode', 'Fixed-point: binary point scaling'], ['wordLength', '8'], ['fractionLength', '3'], ['signedness', 'Unsigned']],
  ntSlopeBias: [['dataTypeMode', 'Fixed-point: slope and bias scaling'], ['slope', '0.75'], ['bias', '2'], ['isAlias', 'true'], ['dataTypeOverride', 'Off'], ['headerFile', 'n.h'], ['dataScope', 'Exported']],
  ntModes: [['dataTypeMode', 'Fixed-point: binary point scaling'], ['wordLength', '8'], ['dataTypeMode', 'Single'], ['dataTypeMode', 'Fixed-point: unspecified scaling']],
  ntFixed: [['wordLength', '12'], ['fractionLength', '-2'], ['dataTypeMode', 'Fixed-point: slope and bias scaling'], ['bias', '-1.5']],
  ntToDouble: [['dataTypeMode', 'Double']],
};
const ELEMENT_DIMS: [string, string][] = [['dimensions', '[2 3]']];

const apply = (o: Opened, node: any, edits: [string, string][]) => edits.forEach(([k, v]) => o.edit(node, k, v));

const TARGETS: Record<string, string> = {
  r2023b_none: 'fixtures/mcos-templates/targets/r2023b/none.mat',
  r2027a_param: 'fixtures/mcos-templates/targets/r2027a/param.mat',
  r2023b_mixed: 'fixtures/mcos-templates/targets/r2023b/mixed.mat',
  r2027a_mixed: 'fixtures/mcos-templates/targets/r2027a/mixed.mat',
  cases: CASES_MAT,
};
const held = (rel: string, f: string) => (rel === 'r27' ? `fixtures/mcos-rules/${f}.mat` : `fixtures/mat-edits-gate/${rel}/${f}.mat`);

// Each case's original, and the steps made on it, by its name.
function stepsOf(name: string): { original: string; steps: (o: Opened) => void } {
  const [what, at] = name.split('__');
  if (what === 'created') {
    return {
      original: TARGETS[at],
      steps: (o) => {
        apply(o, o.add('Simulink.Signal', 'nsig'), EDITS.signal);
        apply(o, o.add('Simulink.Parameter', 'npar'), EDITS.parameter);
        const bus = o.add('Simulink.Bus', 'nbus');
        apply(o, bus, EDITS.bus);
        apply(o, o.addElement(bus), ELEMENT_DIMS);
        apply(o, o.add('Simulink.ValueType', 'nvt'), EDITS.valueType);
        apply(o, o.add('Simulink.AliasType', 'nat'), EDITS.aliasType);
        apply(o, o.add('Simulink.NumericType', 'ntb'), EDITS.ntBinary);
        apply(o, o.add('Simulink.NumericType', 'nts'), EDITS.ntSlopeBias);
        apply(o, o.add('Simulink.NumericType', 'ntm'), EDITS.ntModes);
      },
    };
  }
  if (what === 'edited_cases') {
    return {
      original: CASES_MAT,
      steps: (o) => {
        apply(o, o.by('aSignal'), EDITS.signal.slice(0, 4));
        apply(o, o.by('aBus').children[0], ELEMENT_DIMS);
      },
    };
  }
  if (what === 'edited_b2_b_bus') {
    return {
      original: held(at, 'b2'),
      steps: (o) => {
        apply(o, o.by('b'), EDITS.bus);
        apply(o, o.by('b').children[0], ELEMENT_DIMS);
      },
    };
  }
  // edited_<file>_<variable>_<edits>: the edits named, of a variable of a file of the release.
  const [, file, variable, set] = what.split('_');
  const edits = set === 'signal4' ? EDITS.signal.slice(0, 4) : EDITS[set];
  return { original: held(at, file), steps: (o) => apply(o, o.by(variable), edits) };
}

describe('each file the editors gate judged saves again, byte for byte', () => {
  it('covers every case of the gate, each passed in every release it ran in', () => {
    expect(DOC.cases.length).toBeGreaterThanOrEqual(30);
    for (const c of DOC.cases) {
      const older = c.original === CASES_MAT ? 'PASS_NO_RESAVE' : /_(signal|parameter)__r27$/.test(c.name) ? 'PASS_CODERINFO_UNREAD' : 'PASS';
      expect(c.verdicts, c.name).toEqual({ R2027a: 'PASS', R2023b: older, R2024b: older });
    }
  });

  for (const c of DOC.cases) {
    it(c.name, () => {
      const { original, steps } = stepsOf(c.name);
      expect(original).toBe(c.original);
      const o = opened(original);
      steps(o);
      expect(sha(o.save())).toBe(c.sha256);
    });
  }
});
