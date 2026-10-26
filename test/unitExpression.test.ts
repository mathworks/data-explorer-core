// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.ValueType's Unit, and a lookup table's, is a unit expression MATLAB parses: one it does
// not parse is refused at the assignment, and a file holding one loads it as '' with no warning. A
// MAT-file and both dictionaries took any text there (a ValueType's Unit was held to no rule), so
// 'm s' was shown, saved and reopened, and MATLAB loaded ''. The rule (unitExpression) is held here
// to MATLAB's own verdict on every text MATLAB R2027a and R2023b were given (fixtures/unit-
// expression, make_unit_truth.m: both releases, and a ValueType's Unit and a Table's, agree on
// each), and every format refuses what it refuses, in its words.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { unitExpressionRefusal } from '../src/datamodel/parser/unitExpression.js';
import { bufferOf } from './tools/matPaste.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TRUTH = JSON.parse(readFileSync(new URL('./fixtures/unit-expression/truth.json', import.meta.url), 'utf8')) as {
  releases: string[];
  cases: [string, string | null][];
};

describe("MATLAB's unit expression rule", () => {
  it('refuses exactly what MATLAB refuses, in its words, over every text it was given', () => {
    expect(TRUTH.releases.length).toBe(2);
    expect(TRUTH.cases.length).toBeGreaterThan(8000);
    const wrong: string[] = [];
    for (const [text, matlab] of TRUTH.cases) {
      const ours = unitExpressionRefusal(text);
      if (ours !== matlab) {
        wrong.push(JSON.stringify(text) + ': MATLAB ' + JSON.stringify(matlab) + ', here ' + JSON.stringify(ours));
      }
    }
    expect(wrong).toEqual([]);
    // Taken and refused both, and both of MATLAB's refusals.
    const refused = TRUTH.cases.filter(([, m]) => m !== null);
    expect(refused.length).toBeGreaterThan(1000);
    expect(TRUTH.cases.length - refused.length).toBeGreaterThan(1000);
    expect(refused.some(([, m]) => m!.startsWith('Invalid unit expression'))).toBe(true);
  });
});

describe("a Simulink.ValueType's Unit, edited", () => {
  const sources: [string, string, string][] = [
    ['test/parity/artifacts/text/params.sldd', 'params_text.sldd', 'MyValueType'],
    ['test/parity/artifacts/binary/params.sldd', 'params.sldd', 'MyValueType'],
    ['test/fixtures/bus_types_text.sldd', 'bus_types_text.sldd', 'btValueType'],
  ];
  const open = (path: string, filename: string, bytes?: Uint8Array) => {
    const b = bytes ?? new Uint8Array(readFileSync(new URL('../' + path, import.meta.url)));
    const session = createSession();
    const root: any = ingest(session, filename.endsWith('_text.sldd') ? new TextDecoder().decode(b) : b, { filename });
    return { session, root };
  };
  const edit = (o: { session: any; root: any }, name: string, text: string) => {
    const node = o.root.flatten().find((n: any) => n.name === name && !n.isContainer);
    o.session.setActive(o.root, node);
    return { node, result: o.session.editProperty(node.id, 'Unit', text) };
  };
  const save = (o: { session: any; root: any }): Uint8Array => {
    const out = o.session.serializeSource(o.root.name);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
  };

  it('in a dictionary: refused where MATLAB refuses it, in its words, and taken, saved and reopened where it parses', () => {
    for (const [path, filename, name] of sources) {
      for (const text of ['m s', 'kg m', 'm*', '(m', 'm s^-1', 'm,s']) {
        const { node, result } = edit(open(path, filename), name, text);
        expect((result as any)?.reason, path + ' ' + text).toBe('Cannot edit "' + name + '": ' + name + ".Unit would be '" + text + "', which MATLAB refuses: "
          + unitExpressionRefusal(text)!.replace(/\.$/, '') + '.');
        expect(node.Unit, path + ' ' + text).not.toBe(text);
      }
      for (const text of ['km', 'm/s^2', 'µm', 'notAUnit', 'm.s']) {
        const o = open(path, filename);
        expect(edit(o, name, text).result, path + ' ' + text).toBe(true);
        const back = open(path, filename, save(o));
        expect(back.root.flatten().find((n: any) => n.name === name && !n.isContainer).Unit, path + ' ' + text + ', reopened').toBe(text);
      }
    }
  });

  it('in a MAT-file: a ValueType added to it, refused and taken alike', () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/edit-bash/r2027a/values.mat', import.meta.url)));
    const session = createSession();
    const root: any = session.addMatSource('values.mat', bufferOf(bytes));
    session.setActiveContext(root);
    const vt: any = session.addEntry('', 'Simulink.ValueType');
    expect(vt?.className).toBe('Simulink.ValueType');
    session.setActive(root, vt);
    expect((session.editProperty(vt.id, 'Unit', 'kg m') as any)?.reason).toBe(
      'Cannot edit "' + vt.name + '": ' + vt.name + ".Unit would be 'kg m', which MATLAB refuses: Encountered error while parsing unit expression 'kg m' at position 4.",
    );
    expect(session.editProperty(vt.id, 'Unit', 'kg*m')).toBe(true);
    const again: any = createSession().addMatSource('again.mat', bufferOf((session.serializeSource('values.mat') as any).bytes));
    expect(again.children.find((c: any) => c.name === vt.name).Unit).toBe('kg*m');
  });
});
