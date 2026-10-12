// Copyright 2026 The MathWorks, Inc.
//
// An element of a complex array, edited, undone, redone and saved, in files MATLAB wrote:
// a text dictionary's dense complex arrays (cdata streams) and a sparse one, a binary
// dictionary's dense ones (complex text), N-D arrays, a single and an int16 array, and
// elements with an Inf or NaN part.
//
// MatlabVariableNode._setConstrainedValue took only a real number for an element of a
// numeric array. So `3+4i` typed into an element of a complex array was refused ("Array
// elements must be scalar numbers"), and so was the session's undo of any edit to one:
// DataModel.editProperty undoes an edit by setting the element back to the text it showed,
// `1+2i`, and that was refused with nothing said. The element kept the edit, and the next
// save wrote it.
//
// A complex value typed into a REAL array is still refused. MATLAB's `x(1) = 3+4i` makes
// the whole array complex, which an element editor cannot express.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string): ArrayBuffer => {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};

const FILES = [
  'nd_complex.sldd',
  'nd_rich.sldd',
  'mcos/complex.sldd',
  'mcos/complex_binary.sldd',
  'sparse/sparse_text.sldd',
  'sparse/sparse_binary.sldd',
];

function open(file: string, session = createSession()): any {
  return ingest(session, fixture(file), { filename: file.split('/').pop() });
}

/** What a save writes, opened again in a session of its own. */
function saveAndReopen(session: any, root: any): any {
  const saved = session.serializeSource(root.name);
  const bytes = saved.kind === 'binary' ? saved.bytes : new TextEncoder().encode(saved.text);
  return ingest(createSession(), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    filename: root.name,
  });
}

/** Every element of a complex array that offers an editor, as read. */
const complexElements = (root: any): any[] =>
  root.flatten().filter(
    (n: any) => n._scalarType === 'complex' && n.parent?._kind === 'array' && n.parent._elementType === 'complex' && n.valueEditable,
  );

/** Every complex array's rows, by id: the array's display and each element's. */
function complexRows(root: any): Record<string, string> {
  const rows: Record<string, string> = {};
  for (const el of complexElements(root)) {
    rows[el.parent.id] = el.parent.displayValue;
    rows[el.id] = el.displayValue;
  }
  return rows;
}

describe('the fixtures are what these tests need', () => {
  it('hold editable complex elements, dense and sparse, with an Inf or NaN part among them', () => {
    const all = FILES.flatMap((f) => complexElements(open(f)));
    expect(all.length).toBeGreaterThan(100);
    expect(all.some((el) => el.parent._sparse)).toBe(true);
    expect(all.some((el) => !el.parent._sparse)).toBe(true);
    expect(all.some((el) => /Inf|NaN/.test(el.displayValue))).toBe(true);
    expect(all.some((el) => el.parent._dims.length > 2)).toBe(true);
    expect(all.some((el) => el.parent._scalarType === 'int16')).toBe(true);
  });
});

describe('a complex value typed into an element of a complex array is taken, and saved', () => {
  for (const file of FILES) {
    it(file, () => {
      const session = createSession();
      const root = open(file, session);
      const before = complexRows(root);
      const firsts = complexElements(root).filter((el: any) => el.parent.children[0] === el);
      expect(firsts.length).toBeGreaterThan(0);
      for (const el of firsts) {
        const shown = el.displayValue;
        session.setActive(root, el);
        expect(session.editProperty(el.id, 'Value', '3-4i'), el.id).toBe(true);
        expect(el.displayValue, el.id).toBe('3-4i');
        session.undo();
        expect(el.displayValue, el.id).toBe(shown);
        session.redo();
        expect(el.displayValue, el.id).toBe('3-4i');
      }
      const after = complexRows(saveAndReopen(session, root));
      for (const [id, shown] of Object.entries(before)) {
        const first = firsts.find((el: any) => el.id === id);
        if (first) {
          expect(after[id], id).toBe('3-4i');
        } else if (!firsts.some((el: any) => el.parent.id === id)) {
          expect(after[id], id).toBe(shown);
        }
      }
    });
  }
});

describe('an edit to an element of a complex array is undone, redone and undone again', () => {
  for (const file of FILES) {
    it(file, () => {
      const session = createSession();
      const root = open(file, session);
      const before = complexRows(root);
      const fresh = createSession();
      const untouched = complexRows(saveAndReopen(fresh, open(file, fresh)));
      for (const el of complexElements(root)) {
        const shown = el.displayValue;
        const arrayShown = el.parent.displayValue;
        session.setActive(root, el);
        expect(session.editProperty(el.id, 'Value', '5'), el.id).toBe(true);
        expect(el.displayValue, el.id).toBe('5');
        session.undo();
        expect(el.displayValue, el.id).toBe(shown);
        expect(el.parent.displayValue, el.id).toBe(arrayShown);
        session.redo();
        expect(el.displayValue, el.id).toBe('5');
        session.undo();
        expect(el.displayValue, el.id).toBe(shown);
      }
      expect(complexRows(root)).toEqual(before);
      // And the file it saves is the one an untouched save writes, row for row.
      expect(complexRows(saveAndReopen(session, root))).toEqual(untouched);
    });
  }
});

describe('a complex value typed into an element of a real array is still refused', () => {
  for (const [file, name] of [
    ['sparse/sparse_text.sldd', 'dRow'],
    ['sparse/sparse_text.sldd', 'spDiag'],
    ['sparse/sparse_binary.sldd', 'dRow'],
  ] as const) {
    it(`${file} ${name}`, () => {
      const session = createSession();
      const root = open(file, session);
      const array = root.getSection('design').children.find((e: any) => e.name === name);
      expect(array._kind, name).toBe('array');
      expect(array._elementType, name).not.toBe('complex');
      const el = array.children[0];
      expect(el.valueEditable, el.id).toBe(true);
      const shown = el.displayValue;
      session.setActive(root, el);
      expect(session.editProperty(el.id, 'Value', '3+4i'), el.id).toMatchObject({
        error: true,
        reason: 'Array elements must be scalar numbers',
      });
      expect(el.displayValue).toBe(shown);
      expect(session.canUndo()).toBe(false);
    });
  }
});
