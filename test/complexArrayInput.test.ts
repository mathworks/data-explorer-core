// Copyright 2026 The MathWorks, Inc.
//
// A complex array typed as a Value is read as MATLAB reads the same literal, and saved and reopened
// as itself, in a text dictionary, a binary one and a MAT-file.
//
// MatlabValueParser read each member of a `[...]` row as a real number, so one complex member made
// the whole literal "Invalid MATLAB expression": `[1+i, 2i]`, `[1+1i 2+2i]`, `[1+i; 2i]`, even
// `[1i]`, though `1+i` and `{1+i}` were taken. And every complex array a cell showed, `[Inf-Infi
// NaN+1i 1NaNi -Inf+2i]` among them, was text the editor could not take back. A member may be a
// complex literal now, split from the next by MATLAB's rule inside brackets (a `+` or `-` with
// whitespace after it is binary, one with whitespace only before it starts a member), and the
// array is what MATLAB makes of the literal: complex, a real member x as x+0i, or real where every
// imaginary part is 0. Every case below is held to MATLAB R2027a's own reading of the same literal
// (test/parity/matlab/probe_complex_array_literals.m, complex_array_literals.truth.json).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import MatlabValueParser from '../src/datamodel/parser/MatlabValueParser.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { parseComplexNum } from '../src/datamodel/parser/XmlUtils.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST = fileURLToPath(new URL('.', import.meta.url));
type Shape = { class: string; isreal: boolean; size: number[]; re: number[]; im: number[] };
type Truth = { literal: string; error?: string; class?: string; isreal?: boolean; size?: number[]; re?: string[]; im?: string[]; cell?: Truth[] };
const TRUTH: { release: string; cases: Truth[] } = JSON.parse(readFileSync(TEST + 'parity/matlab/complex_array_literals.truth.json', 'utf8'));
const byLiteral = new Map(TRUTH.cases.map((c) => [c.literal, c]));

const part = (s: string): number => (s === 'Inf' ? Infinity : s === '-Inf' ? -Infinity : s === 'NaN' ? NaN : Number(s));
/** Two numbers equal as isequaln holds them: NaN equal to NaN, -0 to 0. */
const same = (a: number, b: number) => (Number.isNaN(a) && Number.isNaN(b)) || a === b;
const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((x, k) => same(x, b[k]));

/** What MATLAB read a literal (or one cell member) as. */
function truthShape(t: Truth): Shape {
  return { class: t.class!, isreal: !!t.isreal, size: ([] as number[]).concat(t.size!), re: ([] as string[]).concat(t.re ?? []).map(part), im: ([] as string[]).concat(t.im ?? []).map(part) };
}

/** What a node holds: its class, whether real, its size, and each element's parts, column-major. */
function nodeShape(n: any): Shape {
  const complex = n._isComplexValue();
  const cls = complex ? n._complexClass() : n.className === 'logical' ? 'logical' : n.className;
  const parts = (v: unknown): [number, number] => {
    if (typeof v === 'string' && /i$/.test(v)) {
      const p = parseComplexNum(v)!;
      return [Number(p.re), Number(p.im)];
    }
    return [typeof v === 'boolean' ? Number(v) : Number(v), 0];
  };
  let values: unknown[];
  if (n._kind === 'array') {
    const [rows, cols] = n._dims;
    values = [];
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) values.push(n._elements[r * cols + c]);
  } else {
    values = [n._scalarValue];
  }
  const pairs = values.map(parts);
  return { class: cls, isreal: !complex, size: n._dims.slice(), re: pairs.map((p) => p[0]), im: pairs.map((p) => p[1]) };
}

/** `literal` typed as a Value, as the node it makes (MatlabVariableNode._applyParsed), or null where the parser refuses it. */
function typed(literal: string): any {
  const parsed = MatlabValueParser.parse(literal);
  if (!parsed) return null;
  const node = new MatlabVariableNode('v', null, {});
  node._applyParsed(parsed);
  return node;
}

function expectShape(got: Shape, want: Shape, label: string) {
  expect({ class: got.class, isreal: got.isreal, size: got.size }, label).toEqual({ class: want.class, isreal: want.isreal, size: want.size });
  expect(sameList(got.re, want.re) && sameList(got.im, want.im), `${label}: ${JSON.stringify(got)} where MATLAB reads ${JSON.stringify(want)}`).toBe(true);
}

// What the parser does with each literal MATLAB was asked about.
//   read:       as MATLAB reads it;
//   expression: refused, as arithmetic, a call or a transpose MATLAB evaluates and this parser does not;
//   error:      refused, as MATLAB refuses it;
//   shown:      MATLAB refuses it, and it is this package's spelling of a complex element
//               (XmlUtils.formatComplexNum), read as the value it shows.
const EXPRESSION = ['[1+2i+3]', '[1+i*2]', '[complex(1,2)]', "[1+2i 3]'", '[1+-2i]', '[1-+2i]', '[1 + -2i]', '[1 - -2i]', '[int16(1) 2i]', '[1+Inf*1i]', '[1+1i*Inf]', '[Inf*1i]', '[1 - 2]'];
const SHOWN: Record<string, Shape> = {
  '[NaN+NaNi]': { class: 'double', isreal: false, size: [1, 1], re: [NaN], im: [NaN] },
  '[1+Infi]': { class: 'double', isreal: false, size: [1, 1], re: [1], im: [Infinity] },
  '[1NaNi]': { class: 'double', isreal: false, size: [1, 1], re: [1], im: [NaN] },
  '[Inf-Infi NaN+1i 1NaNi -Inf+2i]': { class: 'double', isreal: false, size: [1, 4], re: [Infinity, NaN, 1, -Infinity], im: [-Infinity, 1, NaN, 2] },
};

describe('an array literal holding a complex member, read as MATLAB R2027a reads it', () => {
  it('was asked of MATLAB, every case', () => {
    expect(TRUTH.release).toBe('(R2027a)');
    expect(TRUTH.cases.length).toBeGreaterThan(90);
    // The probe's control: a real literal is real.
    expect(byLiteral.get('[1 2]')).toMatchObject({ class: 'double', isreal: true, size: [1, 2] });
  });

  for (const t of TRUTH.cases) {
    const what = EXPRESSION.includes(t.literal) ? 'expression' : SHOWN[t.literal] ? 'shown' : t.error ? 'error' : 'read';
    it(`${JSON.stringify(t.literal)}: ${what}`, () => {
      const node = typed(t.literal);
      if (what === 'expression') {
        expect(t.error, 'MATLAB evaluates it').toBeUndefined();
        expect(node).toBeNull();
      } else if (what === 'error') {
        expect(node).toBeNull();
      } else if (what === 'shown') {
        expect(t.error, 'not MATLAB syntax').toBeDefined();
        expectShape(nodeShape(node), SHOWN[t.literal], t.literal);
      } else if (t.class === 'cell') {
        expect(node, t.literal).not.toBeNull();
        expect([node._kind, node._dims]).toEqual(['cell', ([] as number[]).concat(t.size!)]);
        const members = ([] as Truth[]).concat(t.cell!);
        expect(node.children.length).toBe(members.length);
        members.forEach((m, k) => expectShape(nodeShape(node.children[k]), truthShape(m), `${t.literal}{${k + 1}}`));
      } else {
        expect(node, t.literal).not.toBeNull();
        expectShape(nodeShape(node), truthShape(t), t.literal);
      }
    });
  }

  it('refuses an array literal that holds a complex array as one member, in an element of a complex array', () => {
    const s = createSession();
    const root: any = ingest(s, new TextDecoder().decode(readFileSync(TEST + 'fixtures/display/dispcat_text.sldd')), { filename: 'd.sldd' });
    const z = root.getSection('design').children.find((e: any) => e.name === 'z_vector');
    s.setActive(root, z.children[0]);
    expect(s.editProperty(z.children[0].id, 'Value', '[1i 2i]')).toMatchObject({
      error: true,
      reason: 'Cannot edit "z_vector(1)": an element of the 1x2 complex double array takes one number, and the text typed, “[1i 2i]”, is a 1x2 complex array.',
    });
    expect(z.displayValue).toBe('[1+2i 3-4i]');
  });
});

// Every complex array a fixture holds whose Value takes an edit shows text that reads back as the
// value it is: a commit of what it shows, or of an edit of it, starts from the value shown. An empty
// shows `[ ]`, as every empty does, and a large or N-D one a summary, which no edit takes.
describe('every complex array of every fixture, its shown text read back', () => {
  const files = (dir: string, out: string[] = []): string[] => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) files(p, out);
      else if (/\.(mat|sldd)$/.test(f)) out.push(p);
    }
    return out;
  };
  const shown: { where: string; node: any }[] = [];
  for (const f of [...files(TEST + 'fixtures'), ...files(TEST + 'parity/artifacts')]) {
    let root: any;
    try {
      const u = new Uint8Array(readFileSync(f));
      root = ingest(createSession(), u[0] === 0x7b ? new TextDecoder().decode(u) : (u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer), { filename: f.split('/').pop()! });
    } catch {
      continue;
    }
    const stack = [...root.children];
    while (stack.length > 0) {
      const n: any = stack.pop();
      stack.push(...(n.children ?? []));
      if (typeof n._isComplexValue === 'function' && n._kind === 'array' && n._isComplexValue() && n._elements.length > 0 && n.valueEditable) {
        shown.push({ where: f.slice(TEST.length) + ' ' + n.matlabPath, node: n });
      }
    }
  }

  it('finds them', () => {
    expect(shown.length).toBeGreaterThan(60);
  });

  it('reads each shown text back as the value it is, complex, of its size and parts', () => {
    for (const { where, node } of shown) {
      const back = typed(node.displayValue);
      expect(back, where + ' ' + node.displayValue).not.toBeNull();
      const want = nodeShape(node);
      // Typed in, it is a double, as MATLAB's literal is.
      expectShape(nodeShape(back), { ...want, class: 'double' }, where);
    }
  });
});

const read = (rel: string): Uint8Array => new Uint8Array(readFileSync(TEST + rel));
const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const VENUES: [string, string, string][] = [
  ['a text dictionary', 'parity/artifacts/text/cases.sldd', 'cases.sldd'],
  ['a binary dictionary', 'parity/artifacts/binary/cases.sldd', 'cases.sldd'],
  ['a MAT-file', 'parity/artifacts/mat/cases.mat', 'cases.mat'],
];

/** A venue opened in a session, an entry of it by name, its save, and its save reopened. */
function venue(rel: string, file: string) {
  const bytes = read(rel);
  const session = createSession();
  const open = (input: Uint8Array | string) => ingest(createSession(), typeof input === 'string' ? input : bufferOf(input), { filename: file }) as any;
  const root: any = ingest(session, file.endsWith('.sldd') && bytes[0] === 0x7b ? new TextDecoder().decode(bytes) : bufferOf(bytes), { filename: file });
  const entries = (r: any): any[] => (r.constructor.name === 'MatNode' ? r.children : r.children.flatMap((s: any) => s.children));
  const by = (name: string, r = root) => entries(r).find((e: any) => e.name === name);
  const edit = (node: any, value: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, 'Value', value);
  };
  const reopened = () => {
    const out = session.serializeSource(root.name) as { text?: string; bytes?: Uint8Array };
    return open(out.text ?? out.bytes!);
  };
  return { session, root, by, edit, reopened };
}

// The literals each venue is given, and what MATLAB makes of them (the truth's).
const TYPED = ['[1+i,2i]', '[1+i; 2i]', '[1+2i, 3-4i; -5+6i, 7]', '[Inf+1i NaN]', '[-Inf-2i 1]', '[Inf-Infi NaN+1i 1NaNi -Inf+2i]'];
const wantOf = (literal: string): Shape => (SHOWN[literal] ?? truthShape(byLiteral.get(literal)!));

describe('a complex array typed as an entry\'s Value, saved and reopened', () => {
  for (const [what, rel, file] of VENUES) {
    for (const literal of TYPED) {
      it(`${what}: ${literal} is saved, reopens as the value MATLAB makes of it, and its undo puts back what was`, () => {
        const v = venue(rel, file);
        const entry = v.by('scalarD');
        const was = entry.displayValue;
        expect(v.edit(entry, literal)).toBe(true);
        expectShape(nodeShape(entry), wantOf(literal), literal);
        expectShape(nodeShape(v.by('scalarD', v.reopened())), wantOf(literal), literal + ', reopened');
        v.session.undo();
        expect([entry.displayValue, entry.className, entry._isComplexValue()]).toEqual([was, 'double', false]);
        expect(v.by('scalarD', v.reopened()).displayValue).toBe(was);
      });
    }
  }

  for (const [what, rel, file] of VENUES) {
    it(`${what}: in a cell, the complex array a member is, saved and reopened`, () => {
      const v = venue(rel, file);
      const entry = v.by('scalarD');
      expect(v.edit(entry, '{[1+2i 3] 4}')).toBe(true);
      const back = v.by('scalarD', v.reopened());
      expect([back._kind, back._dims, back.children.length]).toEqual(['cell', [1, 2], 2]);
      expectShape(nodeShape(back.children[0]), { class: 'double', isreal: false, size: [1, 2], re: [1, 3], im: [2, 0] }, 'member');
    });
  }
});

describe("a complex array typed as a Simulink.Parameter's Value, saved and reopened", () => {
  const PARAMETERS: [string, string, string, string][] = [
    ['a text dictionary', 'parity/artifacts/text/cases.sldd', 'cases.sldd', 'aParam'],
    ['a binary dictionary', 'parity/artifacts/binary/cases.sldd', 'cases.sldd', 'aParam'],
    ['a MAT-file', 'fixtures/mcos-templates/targets/r2027a/param.mat', 'param.mat', 'p0'],
  ];
  for (const [what, rel, file, name] of PARAMETERS) {
    it(`${what}: its Value, Dimensions and Complexity follow, reopened, and undone`, () => {
      const v = venue(rel, file);
      const p = v.by(name);
      expect(p, name).toBeDefined();
      const props = (n: any) => [n.serial._properties.Dimensions, n.serial._properties.Complexity];
      const was = [p.displayValue, ...props(p)];
      expect(v.edit(p, '[1+2i, 3-4i; -5+6i, 7]')).toBe(true);
      const back = v.by(name, v.reopened());
      for (const n of [p, back]) {
        expectShape(nodeShape(n._valueNode), wantOf('[1+2i, 3-4i; -5+6i, 7]'), what);
        // Where the object holds them, as MATLAB's `p.Value = v` makes them.
        expect(props(n), what).toEqual([was[1] === undefined ? undefined : [2, 2], was[2] === undefined ? undefined : 'complex']);
      }
      v.session.undo();
      expect([p.displayValue, ...props(p)]).toEqual(was);
    });
  }
});
