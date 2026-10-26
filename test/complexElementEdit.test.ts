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
// A complex value typed into a REAL array makes the whole array complex, as MATLAB's
// `x(1) = 3+4i` does, and a real number typed into a complex one is x+0i while another element
// has an imaginary part that is not 0 (MatlabVariableNode._settleComplexity, and
// complexIndexedAssignment.test.ts in every format).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { zipSync } from 'fflate';
import { regenerateChunkXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { parseComplexNum } from '../src/datamodel/parser/XmlUtils.js';
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

/**
 * The package with every entry written from the model, reopened. A save writes an unedited
 * entry as the bytes it was read from, so this is how the writers are asked for the entries
 * nobody edited.
 */
function regenerateAndReopen(root: any): any {
  const bytes = zipSync({ ...root._zipMetadata, 'data/chunk0.xml': new TextEncoder().encode(regenerateChunkXml(root)) });
  return ingest(createSession(), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { filename: root.name });
}

/** Every element of a complex array that offers an editor, as read. */
const complexElements = (root: any): any[] =>
  root.flatten().filter(
    (n: any) => n._scalarType === 'complex' && n.parent?._kind === 'array' && n.parent._elementType === 'complex' && n.valueEditable,
  );

/** Whether an element other than `el` of its array has an imaginary part that is not 0. */
const othersComplex = (el: any): boolean =>
  el.parent.children.some((c: any) => {
    const parts = c !== el && typeof c._scalarValue === 'string' ? parseComplexNum(c._scalarValue) : null;
    return parts !== null && Number(parts.im) !== 0;
  });

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
    // Sparse ones among them: a text dictionary's sparse array is a MAT stream, and a binary
    // dictionary's hex, each of which MatWriter writes as it reads back once edited (the C-012
    // ruling, revised 2026-10-24).
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
      // A text dictionary holds every complex array as a MAT stream: a dense one takes the edit
      // (the C-012 ruling, revised 2026-10-24), and a sparse one is shown and not edited.
      for (const el of root.flatten().filter((n: any) => n._scalarType === 'complex' && n.parent?._sparse && n._streamHolder?.())) {
        expect(el.setProperty('Value', '3-4i'), el.id).toMatchObject({ error: true });
      }
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
        // 5+0i while the array stays complex, and 5 where the edit leaves it real.
        const five = othersComplex(el) ? '5+0i' : '5';
        session.setActive(root, el);
        expect(session.editProperty(el.id, 'Value', '5'), el.id).toBe(true);
        expect(el.displayValue, el.id).toBe(five);
        session.undo();
        expect(el.displayValue, el.id).toBe(shown);
        expect(el.parent.displayValue, el.id).toBe(arrayShown);
        session.redo();
        expect(el.displayValue, el.id).toBe(five);
        session.undo();
        expect(el.displayValue, el.id).toBe(shown);
      }
      expect(complexRows(root)).toEqual(before);
      // And the file it saves is the one an untouched save writes, row for row, as is a
      // binary one written from the model.
      expect(complexRows(saveAndReopen(session, root))).toEqual(untouched);
      if (root.sourceFormat === 'xml') {
        expect(complexRows(regenerateAndReopen(root))).toEqual(untouched);
        expect(complexRows(regenerateAndReopen(open(file))), 'the untouched file, written from the model').toEqual(untouched);
      }
    });
  }
});

describe('a complex value typed into an element of a real array makes it complex, as MATLAB does', () => {
  for (const file of ['sparse/sparse_text.sldd', 'sparse/sparse_binary.sldd']) {
    it(`${file} dRow`, () => {
      const session = createSession();
      const root = open(file, session);
      const array = root.getSection('design').children.find((e: any) => e.name === 'dRow');
      expect([array._kind, array._isComplexValue()]).toEqual(['array', false]);
      const el = array.children[0];
      const shown = array.displayValue;
      session.setActive(root, el);
      expect(session.editProperty(el.id, 'Value', '3+4i'), el.id).toBe(true);
      expect([el.displayValue, array._isComplexValue()]).toEqual(['3+4i', true]);
      expect(array.children.slice(1).every((c: any) => /\+0i$/.test(c.displayValue))).toBe(true);
      session.undo();
      expect([array.displayValue, array._isComplexValue()]).toEqual([shown, false]);
    });
  }

  // A sparse array a dictionary holds as a MAT stream, which takes an edit of its non-zeros: a complex
  // one makes it complex too, as MATLAB's sp(1,1) = 3+4i does, and its save holds it so.
  for (const file of ['sparse/sparse_text.sldd', 'sparse/sparse_binary.sldd']) {
    it(`${file} spDiag, a sparse array held as a MAT stream`, () => {
      const session = createSession();
      const root = open(file, session);
      const array = root.getSection('design').children.find((e: any) => e.name === 'spDiag');
      const el = array.children[0];
      const shown = array.displayValue;
      session.setActive(root, el);
      expect(session.editProperty(el.id, 'Value', '3+4i'), el.id).toBe(true);
      expect([el.displayValue, array._isComplexValue()]).toEqual(['3+4i', true]);
      const again = saveAndReopen(session, root).getSection('design').children.find((e: any) => e.name === 'spDiag');
      expect([again._isComplexValue(), again.children[0].displayValue]).toEqual([true, '3+4i']);
      session.undo();
      expect([array.displayValue, array._isComplexValue()]).toEqual([shown, false]);
    });
  }
});
