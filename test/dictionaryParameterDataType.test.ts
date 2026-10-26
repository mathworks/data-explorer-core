// Copyright 2026 The MathWorks, Inc.
//
// A dictionary's Simulink.Parameter's DataType follows its Value as MATLAB's own `p.Value = v` makes
// it (McosPropertyRules.parameterDataTypeAfter, measured against R2027a: an int16 v makes it 'int16',
// a logical one 'boolean', text 'string', a double v over a Value of another class 'auto', over a
// double the DataType it held), as a MAT-file's does (matObjectEdit.dataTypeShownFor), decision D9.
// A dictionary's Parameter kept the DataType it was read with: `true` typed over an int8 one was saved
// as a logical under 'int8', which MATLAB loads as a double, with a warning; 7 typed over it was saved
// under 'int8', where MATLAB's is 'auto'.
//
// Over every Parameter of every dictionary fixture, a Value of each class typed in: the DataType the
// row shows is the rule's of what the file held, a save writes it and a reopen reads it, and an undo
// puts back the one read. And the parity fixtures' Parameters show, after the same edits, what the
// same Parameters of the MAT-files do.
//
// MATLAB applies the rule one edit at a time, to the Value and DataType each edit leaves: "abc" and
// then 7 typed over pProps (5, DataType 'single') make it 'auto' (measured, R2027a). Derived from what
// the file held, core showed and saved 'single' (in every format; MATLAB loads that without a
// warning), and an edit after a save followed the file as read.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { inMcosStream } from '../src/datamodel/node/BaseNode.js';
import { parameterDataTypeAfter } from '../src/datamodel/parser/McosPropertyRules.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function slddUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...slddUnder(p));
    else if (e.name.endsWith('.sldd')) out.push(p);
  }
  return out.sort();
}

function opened(bytes: Uint8Array, filename: string) {
  const session = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  const save = (): Uint8Array => {
    const out: Any = session.serializeSource(root.name);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
  };
  return { session, root, save };
}
const nodeAt = (root: Any, path: string): Any => (root.flatten() as Any[]).find((n) => n.matlabPath === path && !n.isContainer);
const dataTypeOf = (p: Any): string => {
  const c = p.toRow().DataType;
  return typeof c === 'object' && c ? c.text : c;
};

// A Value of each class, typed, and the class it makes.
const TYPED: [string, string][] = [['7', 'double'], ['[4 5]', 'double'], ['true', 'logical'], ['[true false]', 'logical'], ['"abc"', 'string'], ['3+4i', 'double']];

describe("a dictionary's Simulink.Parameter's DataType, after its Value is typed", () => {
  it('is the one MATLAB makes of what the file held, saved and read back, and undone to the one read', () => {
    const wrong: string[] = [];
    let edited = 0;
    for (const file of slddUnder('test')) {
      const bytes = new Uint8Array(readFileSync(file));
      const name = file.split('/').pop()!;
      let root: Any;
      try {
        root = opened(bytes, name).root;
      } catch {
        continue;
      }
      // A Parameter whose Value takes an edit, in a dictionary's own XML or JSON (a MAT stream holding
      // objects follows its own rule, which is a MAT-file's: test/slddStreamObjects.test.ts).
      const params = (root.flatten() as Any[]).filter((n) => n.className === 'Simulink.Parameter' && n.valueEditable && !inMcosStream(n));
      for (const p0 of params) {
        for (const [typed, cls] of TYPED) {
          const o = opened(bytes, name);
          const p = nodeAt(o.root, p0.matlabPath);
          const read = { cls: p._classFollowed as string | undefined, dataType: dataTypeOf(p) };
          // Its own shown text set back is no edit (DataNode._isUnchangedCommit).
          if (p.displayValue === typed) continue;
          o.session.setActive(o.root, p);
          const r = o.session.editProperty(p.id, 'Value', typed);
          if (r !== true) continue;
          edited++;
          const label = `${name} ${p.matlabPath} = ${typed}`;
          const want = parameterDataTypeAfter(read.cls ?? 'double', cls, read.dataType);
          if (dataTypeOf(p) !== want) wrong.push(`${label}: shows ${dataTypeOf(p)}, MATLAB's ${want}`);
          const back = nodeAt(opened(o.save(), name).root, p.matlabPath);
          if (dataTypeOf(back) !== want) wrong.push(`${label}: reopened ${dataTypeOf(back)}, MATLAB's ${want}`);
          o.session.setActive(o.root, null);
          o.session.undo();
          if (dataTypeOf(nodeAt(o.root, p.matlabPath)) !== read.dataType) wrong.push(`${label}: undone ${dataTypeOf(nodeAt(o.root, p.matlabPath))}, read ${read.dataType}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // Measured when this was written: 1201 edits.
    expect(edited).toBeGreaterThanOrEqual(1100);
  }, 300_000);

  it('is what the same Parameter of a MAT-file shows after the same edit', () => {
    const files = ['values.mat', 'values_text.sldd', 'values_binary.sldd'].map((f) => [f, new Uint8Array(readFileSync('test/fixtures/edit-bash/r2027a/' + f))] as const);
    const shown = (f: string, bytes: Uint8Array, path: string, typed: string) => {
      const o = opened(bytes, f);
      const p = nodeAt(o.root, path);
      o.session.setActive(o.root, p);
      return o.session.editProperty(p.id, 'Value', typed) === true ? dataTypeOf(p) : 'refused';
    };
    const rows: string[] = [];
    for (const path of ['pInt8', 'pComplex', 'pMatrix']) {
      for (const [typed] of TYPED) {
        const [mat, text, binary] = files.map(([f, b]) => shown(f, b, path, typed));
        if (mat !== 'refused') {
          rows.push(`${path} = ${typed}: ${mat}`);
          expect([text, binary], `${path} = ${typed}`).toEqual([mat, mat]);
        }
      }
    }
    expect(rows.length).toBeGreaterThanOrEqual(15);
  });
});

// pProps is Simulink.Parameter(5) with DataType 'single' (test/fixtures/edit-bash/make_edit_bash.m), in
// a MAT-file and both dictionary formats. Each sequence is typed in turn, with the DataType MATLAB
// R2027a gives after each statement of `v.Value = ...; v.Value = ...;` on its getValue / load.
const PARITY = 'test/fixtures/edit-bash/r2027a/';
const FORMATS = ['values.mat', 'values_text.sldd', 'values_binary.sldd'];
const SEQUENCES: [string[], string[]][] = [
  [['"abc"', '7'], ['string', 'auto']],
  [['true', '7'], ['boolean', 'auto']],
  [['[true false]', '[4 5]'], ['boolean', 'auto']],
  [['7', '"abc"', '8'], ['single', 'string', 'auto']],
];

describe("a Simulink.Parameter's DataType follows each edit of its Value in turn, as MATLAB's own `p.Value = v` does", () => {
  for (const f of FORMATS) {
    const bytes = new Uint8Array(readFileSync(PARITY + f));
    const edit = (o: ReturnType<typeof opened>, typed: string) => {
      const p = nodeAt(o.root, 'pProps');
      o.session.setActive(o.root, p);
      expect(o.session.editProperty(p.id, 'Value', typed), `${f} pProps = ${typed}`).toBe(true);
      return dataTypeOf(p);
    };

    it(`${f}: shown after each edit, saved and read back as the last; undone one edit at a time`, () => {
      for (const [typed, want] of SEQUENCES) {
        // A MAT-file holds the bounds to the DataType (D10): a logical under pProps's Max 10 is refused.
        if (f.endsWith('.mat') && want.includes('boolean')) continue;
        const o = opened(bytes, f);
        expect(typed.map((t) => edit(o, t)), `${f} ${typed.join(', ')}`).toEqual(want);
        expect(dataTypeOf(nodeAt(opened(o.save(), f).root, 'pProps')), `${f} ${typed.join(', ')} reopened`).toBe(want[want.length - 1]);
        const undone: string[] = [];
        for (let k = typed.length - 1; k >= 0; k--) {
          o.session.setActive(o.root, null);
          o.session.undo();
          undone.push(dataTypeOf(nodeAt(o.root, 'pProps')));
        }
        expect(undone, `${f} ${typed.join(', ')} undone`).toEqual([...want.slice(0, -1).reverse(), 'single']);
        // And redone, each edit follows on from the one before it again.
        const redone: string[] = [];
        for (let k = 0; k < typed.length; k++) {
          o.session.setActive(o.root, null);
          o.session.redo();
          redone.push(dataTypeOf(nodeAt(o.root, 'pProps')));
        }
        expect(redone, `${f} ${typed.join(', ')} redone`).toEqual(want);
      }
    });

    it(`${f}: the Value typed back to the file's after another class leaves 'auto', saved and read back`, () => {
      const o = opened(bytes, f);
      expect([edit(o, '"abc"'), edit(o, '5')]).toEqual(['string', 'auto']);
      expect(dataTypeOf(nodeAt(opened(o.save(), f).root, 'pProps'))).toBe('auto');
    });

    it(`${f}: an edit after a save follows on from the Value and DataType saved, not those read`, () => {
      const o = opened(bytes, f);
      expect(edit(o, '"abc"')).toBe('string');
      expect(dataTypeOf(nodeAt(opened(o.save(), f).root, 'pProps'))).toBe('string');
      expect(edit(o, '7')).toBe('auto');
      expect(dataTypeOf(nodeAt(opened(o.save(), f).root, 'pProps'))).toBe('auto');
    });
  }

  it("a Parameter added to a dictionary follows on from MATLAB's default Value, an empty double", () => {
    for (const f of ['values_text.sldd', 'values_binary.sldd']) {
      const o = opened(new Uint8Array(readFileSync(PARITY + f)), f);
      const shown: string[] = [];
      for (const typed of ['true', '"abc"', '7']) {
        const p = o.root.addEntry('Simulink.Parameter', 'pAdded' + shown.length, 'design');
        o.session.setActive(o.root, p);
        expect(o.session.editProperty(p.id, 'Value', typed)).toBe(true);
        shown.push(dataTypeOf(p));
      }
      expect(shown, f).toEqual(['boolean', 'string', 'auto']);
      const back = opened(o.save(), f).root;
      expect([0, 1, 2].map((k) => dataTypeOf(nodeAt(back, 'pAdded' + k))), f).toEqual(['boolean', 'string', 'auto']);
    }
  });
});

// sDt is struct('p', P, 'sp', sparse([0 1])), P Simulink.Parameter(5) with DataType 'single'
// (test/fixtures/sldd-stream-objects/make_stream_datatype.m): a binary dictionary writes the whole value
// as a MAT stream, whose object holds a DataType cell over the double Value; a text one writes P as
// JSON in the struct.
describe("a Simulink.Parameter's DataType inside a dictionary value's MAT stream follows each edit of its Value in turn", () => {
  const STREAM = 'test/fixtures/sldd-stream-objects/';
  for (const f of ['stream_datatype_binary.sldd', 'stream_datatype_text.sldd']) {
    const bytes = new Uint8Array(readFileSync(STREAM + f));
    const edit = (o: ReturnType<typeof opened>, typed: string) => {
      const p = nodeAt(o.root, 'sDt.p');
      o.session.setActive(o.root, p);
      expect(o.session.editProperty(p.id, 'Value', typed), `${f} sDt.p = ${typed}`).toBe(true);
      return dataTypeOf(p);
    };

    it(`${f}: shown after each edit, saved and read back as the last; undone one edit at a time`, () => {
      expect(inMcosStream(nodeAt(opened(bytes, f).root, 'sDt.p'))).toBe(f.includes('binary'));
      for (const [typed, want] of SEQUENCES) {
        const o = opened(bytes, f);
        expect(typed.map((t) => edit(o, t)), `${f} ${typed.join(', ')}`).toEqual(want);
        expect(dataTypeOf(nodeAt(opened(o.save(), f).root, 'sDt.p')), `${f} ${typed.join(', ')} reopened`).toBe(want[want.length - 1]);
        const undone: string[] = [];
        for (let k = typed.length - 1; k >= 0; k--) {
          o.session.setActive(o.root, null);
          o.session.undo();
          undone.push(dataTypeOf(nodeAt(o.root, 'sDt.p')));
        }
        expect(undone, `${f} ${typed.join(', ')} undone`).toEqual([...want.slice(0, -1).reverse(), 'single']);
      }
    });

    it(`${f}: the Value typed back to the file's after another class leaves 'auto', saved and read back`, () => {
      const o = opened(bytes, f);
      expect([edit(o, 'true'), edit(o, '5')]).toEqual(['boolean', 'auto']);
      expect(dataTypeOf(nodeAt(opened(o.save(), f).root, 'sDt.p'))).toBe('auto');
    });

    it(`${f}: an edit after a save follows on from the Value and DataType saved`, () => {
      const o = opened(bytes, f);
      expect(edit(o, 'true')).toBe('boolean');
      expect(dataTypeOf(nodeAt(opened(o.save(), f).root, 'sDt.p'))).toBe('boolean');
      expect(edit(o, '7')).toBe('auto');
      expect(dataTypeOf(nodeAt(opened(o.save(), f).root, 'sDt.p'))).toBe('auto');
    });
  }
});
