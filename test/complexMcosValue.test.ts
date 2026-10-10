// Copyright 2026 The MathWorks, Inc.
//
// The MCOS decoder's complex arm on its own: McosParser.complexPropertyValue, the shape it
// hands the node layer, and XmlUtils.formatComplexNum, the spelling inside it.
// complexMcosFixtures.test.ts grades what a host SHOWS for MATLAB's own files; this grades
// the value in between, on MATLAB's bytes where MATLAB wrote one and on hand-built
// variables for the shapes no fixture holds.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { complexPropertyValue, decodeMcosBlob, type OpaqueVarRef } from '../src/datamodel/parser/McosParser.js';
import { parseMat, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { parseBinarySldd } from '../src/datamodel/parser/BinarySlddParser.js';
import { formatComplexNum, parseComplexNum } from '../src/datamodel/parser/XmlUtils.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import '../src/datamodel/node/data/NodeClassMap.js';

function bytes(name: string): ArrayBuffer {
  const buf = readFileSync(fileURLToPath(new URL(`./fixtures/mcos/${name}`, import.meta.url)));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** A complex numeric variable as MatParser builds one: `{ re, im }` pairs, row-major. */
function complexVar(className: string, dimensions: number[], value: unknown[]): MatVariable {
  return { name: '', className, dimensions, isComplex: true, isLogical: false, value, fields: null };
}
const c = (re: unknown, im: unknown) => ({ re, im });

describe('formatComplexNum spells one element', () => {
  const CASES: [re: unknown, im: unknown, text: string][] = [
    [3, 4, '3+4i'],
    [1, -2, '1-2i'],
    [-3, -4, '-3-4i'],
    [0, 5, '0+5i'],
    // complex(3, 0) keeps its zero imaginary part: the value is complex.
    [3, 0, '3+0i'],
    // -0 prints as 0, and `-0 >= 0`.
    [1, -0, '1+0i'],
    [1.5, 0.25, '1.5+0.25i'],
    [0.1, 0.2, '0.1+0.2i'],
    // Every digit the double needs, and no more: 1/3 is not 0.333333333333333 (mat2str's
    // fifteen) and not 0.33333333333333331 (the binary dictionary's seventeen), but what a
    // plain .mat variable holding complex(1/3, 0.1) shows.
    [1 / 3, 0.1, '0.3333333333333333+0.1i'],
    [2 / 3, -Math.PI, '0.6666666666666666-3.141592653589793i'],
    // A single, widened to the double it is: the plain .mat variable's digits too.
    [Math.fround(0.1), Math.fround(0.2), '0.10000000149011612+0.20000000298023224i'],
    // String()'s exponent form, as every other number in this package prints.
    [1e-20, 2e21, '1e-20+2e+21i'],
    // MATLAB's words for the non-finite parts, not JavaScript's `Infinity`.
    [Infinity, -Infinity, 'Inf-Infi'],
    [NaN, 1, 'NaN+1i'],
    [-Infinity, 2, '-Inf+2i'],
    // `NaN >= 0` is false: no sign, as MATLAB writes the element into a binary dictionary.
    [1, NaN, '1NaNi'],
    // An exact 64-bit token, as MatParser keeps an int64 past 2^53: its digits, not a double's.
    ['9223372036854775807', 1, '9223372036854775807+1i'],
    ['-9223372036854775808', '-9223372036854775807', '-9223372036854775808-9223372036854775807i'],
  ];
  for (const [re, im, text] of CASES) {
    it(`${String(re)}, ${String(im)} -> ${text}`, () => {
      expect(formatComplexNum(re, im)).toBe(text);
    });
  }

  it('and parseComplexNum reads every one of them back as the same two parts', () => {
    for (const [re, im, text] of CASES) {
      const exact = typeof re === 'string' ? 'int64' : undefined;
      // -0 prints as 0, so it comes back as 0.
      const want = { re: Object.is(re, -0) ? 0 : re, im: Object.is(im, -0) ? 0 : im };
      expect(parseComplexNum(text, exact), text).toEqual(want);
    }
  });
});

describe('parseComplexNum reads the spellings the other venues hold an element in', () => {
  const CASES: [text: string, re: number | string, im: number | string][] = [
    // A binary dictionary's, MATLAB's own.
    ['3.0+4.0i', 3, 4],
    ['1.0E-20+2.0E+21i', 1e-20, 2e21],
    ['0.33333333333333331+0.1i', 1 / 3, 0.1],
    ['1.0NaNi', 1, NaN],
    ['-Inf+2.0i', -Infinity, 2],
    ['1-0i', 1, -0],
    // A plain .mat variable's, which writes String() for a part.
    ['1+Infinityi', 1, Infinity],
    ['-Infinity-Infinityi', -Infinity, -Infinity],
    ['NaNNaNi', NaN, NaN],
    ['1e+300-1e-300i', 1e300, -1e-300],
  ];
  for (const [text, re, im] of CASES) {
    it(text, () => {
      expect(parseComplexNum(text)).toEqual({ re, im });
    });
  }

  it('keeps an exact 64-bit part as its text only under a 64-bit class', () => {
    expect(parseComplexNum('9223372036854775807+1i', 'int64')).toEqual({ re: '9223372036854775807', im: 1 });
    expect(parseComplexNum('9223372036854775807+1i', 'int16')).toEqual({ re: 9223372036854775807, im: 1 });
  });

  it('refuses what is not one element', () => {
    for (const text of ['3', '4i', '3+4', '123i', '1+2i 3+4i', 'abc', '', 'Inf', '1+2j']) {
      expect(parseComplexNum(text), text).toBeNull();
    }
  });
});

describe('complexPropertyValue: the binary dictionary\'s complex form', () => {
  it('a scalar carries no shape, as a binary scalar has no Dimension attribute', () => {
    expect(complexPropertyValue(complexVar('double', [1, 1], [c(3, 4)]))).toEqual({ _type: 'cdata', _value: '3+4i' });
  });

  it('a row and a column keep their shapes, in one order', () => {
    const elems = [c(1, 2), c(3, -4), c(5, 6)];
    expect(complexPropertyValue(complexVar('double', [1, 3], elems))).toEqual({
      _type: 'cdata',
      _value: '1+2i 3-4i 5+6i',
      _dimensions: [1, 3],
    });
    expect(complexPropertyValue(complexVar('double', [3, 1], elems))).toEqual({
      _type: 'cdata',
      _value: '1+2i 3-4i 5+6i',
      _dimensions: [3, 1],
    });
  });

  it('a matrix is written column-major, undoing MatParser\'s transpose', () => {
    // [1+2i 3+4i; 5+6i 7+8i], row-major as MatParser hands it over.
    const m = complexVar('double', [2, 2], [c(1, 2), c(3, 4), c(5, 6), c(7, 8)]);
    expect(complexPropertyValue(m)).toEqual({ _type: 'cdata', _value: '1+2i 5+6i 3+4i 7+8i', _dimensions: [2, 2] });
  });

  it('an N-D value keeps every extent and transposes every page', () => {
    // Two 2x2 pages, each row-major: [1 2; 3 4] and [5 6; 7 8], imaginary part 1.
    const nd = complexVar('double', [2, 2, 2], [1, 2, 3, 4, 5, 6, 7, 8].map((re) => c(re, 1)));
    expect(complexPropertyValue(nd)).toEqual({
      _type: 'cdata',
      _value: '1+1i 3+1i 2+1i 4+1i 5+1i 7+1i 6+1i 8+1i',
      _dimensions: [2, 2, 2],
    });
  });

  it('spells every numeric class the same way, as the binary dictionary\'s body does, and names it', () => {
    for (const cls of ['single', 'int8', 'uint16', 'int64']) {
      expect(complexPropertyValue(complexVar(cls, [1, 2], [c(3, -4), c(-1, 0)])), cls).toEqual({
        _type: 'cdata',
        _value: '3-4i -1+0i',
        _dimensions: [1, 2],
        _class: cls,
      });
    }
    expect(complexPropertyValue(complexVar('int64', [1, 1], [c('9223372036854775807', 1)]))).toEqual({
      _type: 'cdata',
      _value: '9223372036854775807+1i',
      _class: 'int64',
    });
  });

  it('takes a complex sparse value, which MatParser presents dense and paired', () => {
    // [0 1+1i; 2-2i 0], as readSparse lays it out: dense, row-major. No `_class`: its
    // class is MATLAB's class(), double, which a double says by saying nothing. (It used
    // to arrive as 'sparse', the MAT file's word, which complexClassTag also let pass
    // unstated — so the envelope is the same either way.)
    const sp = { ...complexVar('double', [2, 2], [c(0, 0), c(1, 1), c(2, -2), c(0, 0)]), isSparse: true };
    expect(complexPropertyValue(sp)).toEqual({ _type: 'cdata', _value: '0+0i 2-2i 1+1i 0+0i', _dimensions: [2, 2] });
  });

  it('marks text holding an Inf or NaN part, and nothing else', () => {
    expect(complexPropertyValue(complexVar('double', [1, 3], [c(1, 2), c(NaN, 0), c(3, -4)]))).toEqual({
      _type: 'cdata',
      _value: '1+2i NaN+0i 3-4i',
      _dimensions: [1, 3],
      _nonFinite: true,
    });
    expect(complexPropertyValue(complexVar('double', [1, 1], [c(1, Infinity)]))).toEqual({
      _type: 'cdata',
      _value: '1+Infi',
      _nonFinite: true,
    });
    // An exact 64-bit token is text and finite.
    expect(complexPropertyValue(complexVar('int64', [1, 1], [c('9223372036854775807', 1)]))?._nonFinite).toBeUndefined();
  });

  it('a marked value reads as the complex doubles it is; the same text unmarked does not', () => {
    // [1+2i NaN 3-4i]. Unmarked, this is how a binary dictionary's own non-finite text
    // reads (MatlabVariableNode._isOwnNonFiniteText says why), and how the decoder's read
    // before the marker: one quoted char, class char, no element rows.
    const marked = complexPropertyValue(complexVar('double', [1, 3], [c(1, 2), c(NaN, 0), c(3, -4)]))!;
    const node: any = NodeRegistry.parseValue(marked, 'Value', null);
    expect([node.displayValue, node.className]).toEqual(['[1+2i NaN+0i 3-4i]', 'double']);
    expect(node.children.map((k: any) => k.displayValue)).toEqual(['1+2i', 'NaN+0i', '3-4i']);
    const { _nonFinite, ...unmarked } = marked;
    expect(_nonFinite).toBe(true);
    const plain: any = NodeRegistry.parseValue(unmarked, 'Value', null);
    expect([plain.displayValue, plain.className, plain.children.length]).toEqual(["'1+2i NaN+0i 3-4i'", 'char', 0]);
    // A scalar too, and a part that is NaN and Inf at once.
    for (const [pair, shows] of [
      [c(NaN, NaN), 'NaNNaNi'],
      [c(1, Infinity), '1+Infi'],
      [c(-Infinity, NaN), '-InfNaNi'],
    ] as const) {
      const one: any = NodeRegistry.parseValue(complexPropertyValue(complexVar('double', [1, 1], [pair])), 'V', null);
      expect([one.displayValue, one.className], shows).toEqual([shows, 'double']);
    }
  });

  it('a marked envelope whose text is not elements is still not read as numbers', () => {
    const node: any = NodeRegistry.parseValue({ _type: 'cdata', _value: '1+2i junk', _nonFinite: true }, 'V', null);
    expect(node.className).toBe('char');
  });

  it('a class other than double classes the array the node layer builds', () => {
    for (const cls of ['single', 'int8', 'uint8', 'int16', 'uint32', 'int64', 'uint64']) {
      const v = complexPropertyValue(complexVar(cls, [1, 2], [c(1, 2), c(3, -4)]));
      const node: any = NodeRegistry.parseValue(v, 'Value', null);
      expect([node.className, node.dataType, node.displayValue], cls).toEqual([cls, cls, '[1+2i 3-4i]']);
      // The elements stay complex scalars, which show double in every venue.
      expect(node.children.map((k: any) => k.className), cls).toEqual(['double', 'double']);
    }
    const big: any = NodeRegistry.parseValue(
      complexPropertyValue(complexVar('int16', [1, 60], Array.from({ length: 60 }, (_, k) => c(k + 1, 1)))),
      'Value',
      null,
    );
    expect(big.displayValue).toBe('<1x60 int16>');
    // A scalar's class is shown nowhere, here or in any other venue.
    const one: any = NodeRegistry.parseValue(complexPropertyValue(complexVar('int8', [1, 1], [c(3, -4)])), 'V', null);
    expect([one.className, one.displayValue]).toEqual(['double', '3-4i']);
  });

  it('leaves alone what it is not: real, empty, and a complex flag with no pairs under it', () => {
    expect(complexPropertyValue({ ...complexVar('double', [1, 2], [1, 2]), isComplex: false })).toBeUndefined();
    // Empty: undefined here, so resolveValue's numeric arm keeps the `[]` it always gave.
    expect(complexPropertyValue(complexVar('double', [1, 0], []))).toBeUndefined();
    // MatParser reads no imaginary part when the element ends first, and the value is
    // then a plain number; this arm only ever reads pairs.
    expect(complexPropertyValue({ ...complexVar('double', [1, 1], []), value: 3 })).toBeUndefined();
    expect(complexPropertyValue(complexVar('double', [1, 2], [1, 2]))).toBeUndefined();
  });

  it('is read by the node layer as the binary dictionary\'s value is', () => {
    const m = complexPropertyValue(complexVar('double', [2, 2], [c(1, 2), c(3, -4), c(-5, 6), c(7, 0)]));
    const node: any = NodeRegistry.parseValue(m, 'Value', null);
    expect(node.displayValue).toBe('[1+2i 3-4i; -5+6i 7+0i]');
    expect(node.children.map((k: any) => [k.toRow().Name.label, k.displayValue])).toEqual([
      ['Value(1,1)', '1+2i'],
      ['Value(1,2)', '3-4i'],
      ['Value(2,1)', '-5+6i'],
      ['Value(2,2)', '7+0i'],
    ]);
  });
});

// ---- On MATLAB's bytes -------------------------------------------------------------
//
// complex_objects.mat and complex_binary.sldd hold the same values, written by MATLAB:
// the decoder's bag for each object is graded against the binary reader's bag for the
// same entry, which is the form it claims to produce. MATLAB writes `.0` on an integral
// part (`3.0+4.0i`) and the node layer drops it on read, so it is dropped here before
// comparing; nothing else is normalized.
const dropPointZero = (s: string) => s.replace(/\.0(?!\d)/g, '');

function matBags(): Map<string, Record<string, unknown>> {
  const { variables } = parseMat(bytes('complex_objects.mat'));
  const anon = variables.find((v) => v._anonymous)!;
  const refs = variables
    .filter((v) => v.isOpaque && v.name)
    .map((v): OpaqueVarRef => ({ name: v.name, className: v.className, rawBytes: v._rawBytes }));
  const decoded = decodeMcosBlob(anon._rawBytes!, refs);
  return new Map([...decoded].map(([name, d]) => [name, d.properties]));
}

function binaryBags(): Map<string, Record<string, unknown>> {
  const content: any = parseBinarySldd(bytes('complex_binary.sldd'), []);
  const part = Object.values(content.__MW_TEXT_PARTS__ as Record<string, any>).find((p) => p.__MW_TEXT_content?.entries);
  const out = new Map<string, Record<string, unknown>>();
  for (const e of part.__MW_TEXT_content.entries) {
    const props = e.value?._elements?.[0]?._properties;
    if (props) out.set(e.name, props);
  }
  return out;
}

// A nested object is `{ _object_class, _properties }` from the decoder and
// `{ _array_class, _elements: [{ _properties }] }` from the binary reader.
const nestedProps = (x: any): Record<string, unknown> => x?._properties ?? x?._elements?.[0]?._properties;

// Every complex value anywhere inside `x` with MATLAB's `.0` dropped, and nothing else
// changed: a struct Value holds its complex fields one level down.
function withoutPointZero(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(withoutPointZero);
  if (x === null || typeof x !== 'object') return x;
  const o = x as Record<string, unknown>;
  if (o._type === 'cdata') return { ...o, _value: dropPointZero(String(o._value)) };
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, withoutPointZero(v)]));
}

describe('on MATLAB\'s bytes, the decoder\'s complex Value is the binary dictionary\'s', () => {
  const mat = matBags();
  const bin = binaryBags();
  // Every Parameter both files hold. pArr is the .mat's alone: an object array cannot be
  // a dictionary entry.
  const params = [...mat.keys()].filter((n) => bin.has(n) && n !== 'lut');

  it('decodes every object the .mat holds', () => {
    expect([...mat.keys()].sort()).toEqual(
      ['c1Top', 'c2Top', 'holder', 'lut', 'mptP', 'pArr', 'pCol', 'pFrac', 'pInt16Row', 'pInt64', 'pInt8', 'pMat',
        'pMixedNF', 'pNd', 'pNegIm', 'pNonFinite', 'pRow', 'pScalar', 'pSingle', 'pSingleCol', 'pStruct', 'pThird',
        'pZeroIm', 'pZeroRe', 'spTop', 'svTop'].sort(),
    );
    expect(params).toHaveLength(23);
  });

  // Where the decoder's text is not MATLAB's binary text, and why. Every other Value is
  // equal to the binary reader's once MATLAB's `.0` is dropped, `_class` included.
  const TEXT_DIFFERS: Record<string, [ours: string, matlab: string]> = {
    // Seventeen significant digits in MATLAB's text, the double's shortest spelling in ours.
    pThird: ['0.3333333333333333+0.1i', '0.33333333333333331+0.1i'],
  };

  for (const name of params) {
    it(`${name}.Value`, () => {
      const ours = { ...(mat.get(name)!.Value as Record<string, unknown>) };
      const theirs = withoutPointZero(bin.get(name)!.Value) as Record<string, unknown>;
      expect(JSON.stringify(ours), name).toContain('"_type":"cdata"');
      // The decoder's own marker, which the binary reader never sets: on exactly the values
      // with a non-finite part.
      const nonFinite = /Inf|NaN/.test(JSON.stringify(ours));
      expect(ours._nonFinite, name).toBe(nonFinite ? true : undefined);
      delete ours._nonFinite;
      const differs = TEXT_DIFFERS[name];
      if (differs) {
        expect([ours._value, theirs._value]).toEqual(differs);
        expect({ ...ours, _value: undefined }).toEqual({ ...theirs, _value: undefined });
        return;
      }
      expect(ours).toEqual(theirs);
    });
  }

  it('lut.Table.Value, one object further down', () => {
    const ours = nestedProps(mat.get('lut')!.Table).Value;
    expect(ours).toEqual(withoutPointZero(nestedProps(bin.get('lut')!.Table).Value));
    expect(ours).toEqual({ _type: 'cdata', _value: '1+2i 3+4i 5+6i', _dimensions: [1, 3] });
  });

  it('does not touch a real value beside it', () => {
    expect(nestedProps((mat.get('lut') as any).Breakpoints).Value).toEqual([1, 2, 3]);
  });
});

describe('on MATLAB\'s bytes, the positions no dictionary holds', () => {
  const { variables } = parseMat(bytes('complex_objects.mat'));
  const anon = variables.find((v) => v._anonymous)!;
  const refs = variables
    .filter((v) => v.isOpaque && v.name)
    .map((v): OpaqueVarRef => ({ name: v.name, className: v.className, rawBytes: v._rawBytes }));
  const decoded = decodeMcosBlob(anon._rawBytes!, refs);

  it('every element of an object array', () => {
    expect(decoded.get('pArr')!.elements.map((e) => e.Value)).toEqual([
      { _type: 'cdata', _value: '1+1i' },
      { _type: 'cdata', _value: '2-2i' },
    ]);
  });

  it('a custom class\'s scalar, struct field, cell elements and matrix', () => {
    const { Z, S, C, Zm } = decoded.get('holder')!.properties as Record<string, any>;
    expect(Z).toEqual({ _type: 'cdata', _value: '3+4i' });
    expect(S._elements[0].f).toEqual({ _type: 'cdata', _value: '1-2i' });
    expect(C._elements).toEqual([
      { _type: 'cdata', _value: '1+2i' },
      { _type: 'cdata', _value: '3+4i 5+6i', _dimensions: [1, 2] },
    ]);
    // [1+1i 2+2i; 3+3i 4+4i], column-major.
    expect(Zm).toEqual({ _type: 'cdata', _value: '1+1i 3+3i 2+2i 4+4i', _dimensions: [2, 2] });
  });
});
