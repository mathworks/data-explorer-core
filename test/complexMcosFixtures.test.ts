// Copyright 2026 The MathWorks, Inc.
//
// Complex numbers inside MCOS objects, against MATLAB's own answers, on the fixtures
// test/fixtures/mcos/make_complex_fixtures.m writes: complex_objects.mat; complex_ws.slx,
// whose MODEL WORKSPACE holds the same kind of values; and complex.sldd (text) and
// complex_binary.sldd (compressed-binary), dictionaries holding the .mat's values entry
// for variable. A Simulink.Parameter whose Value is 3+4i used to show `[[object Object]]`
// in the .mat and the workspace, while the same Parameter in either dictionary showed
// `3+4i`; these fixtures are that comparison, made by MATLAB.
//
// Everything here is driven by the truth files, so a value, a twin or a venue added to
// the generator is covered without editing this file:
//
//   * every Parameter's Value has MATLAB's numbers, spelled the way this package spells a
//     complex number — in its own cell, its Value row, and each element row;
//   * that spelling is MATLAB's own mat2str wherever MATLAB's spelling is of the same
//     form, and every place it is not is listed below with MATLAB's answer beside it;
//   * every `twins` pair presents identically;
//   * every value presents the same in the .mat and in each other venue that holds it;
//   * and every path is one of the kinds checked, so none goes unchecked.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFile } from './parity/loadFile.js';
import { nodeAt } from './tools/matlabPath.js';
import { presentation } from './tools/nodePresentation.js';

// One part of a complex number as the truth records it: a plain number, or MATLAB's own
// text where JSON cannot carry the number ('Inf', '-Inf', 'NaN', an int64 past 2^53).
type Part = number | string;

interface ValueTruth {
  class: string;
  size: number[];
  numel: number;
  isreal: boolean;
  mat2str?: string;
  mat2str_error?: string;
  real: Part[];
  imag: Part[];
  elementMat2str: string[];
  elementIsreal: boolean[];
}

// What make_complex_fixtures.m's field_truth records for a property: a number's
// value_truth, or a struct or a cell of them.
type FieldTruth =
  | ValueTruth
  | { class: 'struct'; fields: string[]; values: Record<string, FieldTruth> }
  | { class: 'cell'; size: number[]; elements: FieldTruth[] };

interface TruthRecord extends Partial<ValueTruth> {
  class: string;
  size: number[];
  numel: number;
  isobject: boolean;
  disp: string;
  Value?: FieldTruth;
  DataType?: string;
  Dimensions?: number | number[];
  Complexity?: string;
  // An object array.
  elements?: TruthRecord[];
}

interface Truth {
  paths: Record<string, TruthRecord>;
  twins: { nested: string; twin: string }[];
}

const truthOf = (name: string): Truth =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/mcos/${name}`, import.meta.url)), 'utf8'));

// Each fixture, the node its MATLAB top-level variables sit under, and its truth.
const FIXTURES = [
  {
    file: 'complex_objects.mat',
    truth: truthOf('complex_objects.truth.json'),
    variables: (): any => loadFile('../fixtures/mcos/complex_objects.mat'),
  },
  {
    file: 'complex_ws.slx',
    truth: truthOf('complex_ws.truth.json'),
    variables: (): any => loadFile('../fixtures/mcos/complex_ws.slx').getSection('workspace'),
  },
  {
    file: 'complex.sldd',
    truth: truthOf('complex_sldd.truth.json'),
    variables: (): any => loadFile('../fixtures/mcos/complex.sldd').getSection('design'),
  },
  {
    file: 'complex_binary.sldd',
    truth: truthOf('complex_binary_sldd.truth.json'),
    variables: (): any => loadFile('../fixtures/mcos/complex_binary.sldd').getSection('design'),
  },
];
const MAT = FIXTURES[0];

// ---- The spelling ----------------------------------------------------------------
//
// This package's spelling of one complex element, `3+4i`: each part as a number prints
// (MATLAB's own word for a non-finite one), and between them the imaginary part's sign,
// or '+' when it is not negative. It is the spelling a plain complex .mat variable and a
// dictionary entry have always shown — z and zRow below are the control — and it is not
// MATLAB's Command Window `3.0000 + 4.0000i`.
const partText = (p: Part): string => (typeof p === 'number' ? String(p) : p);
const elementText = (re: Part, im: Part): string =>
  partText(re) + (Number(im) >= 0 ? '+' : '') + partText(im) + 'i';

// Where MATLAB's mat2str of an ELEMENT is not of that form, MATLAB's answer and ours.
// Every other element is graded against mat2str directly.
const ELEMENT_MAT2STR_DIFFERS: Record<string, string> = {
  // mat2str writes a non-finite imaginary part as a product, never as `Infi`/`NaNi`.
  'Inf-1i*Inf': 'Inf-Infi',
  '1+1i*NaN': '1NaNi',
  // mat2str of a complex int64 is a constructor call, because `9223372036854775807+1i`
  // would be evaluated in double.
  'complex(9223372036854775807,1)': '9223372036854775807+1i',
  // mat2str writes 15 significant digits unless asked for more; a part prints as every
  // number in this package does, with the digits that make it the same double. pThird's
  // real part is 1/3, which JavaScript spells 0.3333333333333333, and so does a plain .mat
  // variable holding it (zThird).
  '0.333333333333333+0.1i': '0.3333333333333333+0.1i',
};

/** The elements as this package shows them, in MATLAB's column-major order. */
function elementsOf(v: ValueTruth, path: string): string[] {
  expect(v.real, path).toHaveLength(v.numel);
  expect(v.imag, path).toHaveLength(v.numel);
  return v.real.map((re, k) => {
    const ours = elementText(re, v.imag[k]);
    const matlab = v.elementMat2str[k];
    const label = `${path}(${k + 1})`;
    if (v.elementIsreal[k]) {
      // complex(1, 0): MATLAB hands the ELEMENT back real, so its mat2str is `1`. The value
      // is still complex — isreal is false and Complexity is 'complex' — and both
      // dictionaries spell the element 1+0i, which is the spelling kept here.
      expect(ours, label).toBe(matlab + '+0i');
    } else {
      expect(ours, label).toBe(ELEMENT_MAT2STR_DIFFERS[matlab] ?? matlab);
    }
    return ours;
  });
}

/** The whole value's own cell: a scalar inline, a matrix in brackets, N-D summarized. */
function wholeText(v: ValueTruth, elements: string[]): string {
  if (v.numel === 1) return elements[0];
  if (v.size.length > 2) return `<${v.size.join('x')} ${v.class}>`;
  const [rows, cols] = v.size;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const line: string[] = [];
    for (let c = 0; c < cols; c++) line.push(elements[c * rows + r]);
    lines.push(line.join(' '));
  }
  const ours = '[' + lines.join('; ') + ']';
  // The layout is MATLAB's too: mat2str separates rows with ';' where a cell uses '; '.
  if (v.mat2str !== undefined && elements.every((e, k) => e === v.elementMat2str[k])) {
    expect(ours.replace(/; /g, ';')).toBe(v.mat2str);
  }
  return ours;
}

// An element row's label names its subscripts — `Value(3)`, `Value(2,1)`,
// `Value(1,2,2)` — and the truth is column-major, so the label says which element it is.
function columnMajorIndex(label: string, size: number[]): number {
  const m = /\(([\d,]+)\)$/.exec(label);
  if (!m) throw new Error(`no subscripts in ${label}`);
  const subs = m[1].split(',').map(Number);
  if (subs.length === 1) return subs[0] - 1;
  let k = 0;
  let stride = 1;
  subs.forEach((s, d) => {
    k += (s - 1) * stride;
    stride *= size[d];
  });
  return k;
}

// The row channel, as nestedMcosFixtures reads it: a cell is a string or an editor
// object carrying `text`.
const cellText = (cell: unknown): string =>
  cell !== null && typeof cell === 'object' ? String((cell as { text: unknown }).text) : String(cell ?? '');
const shown = (v: number | number[] | undefined): string =>
  Array.isArray(v) ? (v.length === 0 ? '' : v.length === 1 ? String(v[0]) : '[' + v.join(' ') + ']') : String(v);

/** A value with no object around it: its cell, and one row per element. */
function expectValueNode(node: any, v: ValueTruth, path: string): string {
  const elements = elementsOf(v, path);
  const whole = wholeText(v, elements);
  expect(node.displayValue, path).toBe(whole);
  if (v.numel === 1) {
    expect(node.children, path).toHaveLength(0);
    return whole;
  }
  // The array's own class, which MATLAB's class() gives — `<1x3 int16>`, not double. An
  // element is a complex scalar, which shows double in every venue, as a complex scalar
  // of any class does.
  expect(node.className, path).toBe(v.class);
  expect(node.children, path).toHaveLength(v.numel);
  for (const child of node.children) {
    const label = child.toRow().Name.label;
    const k = columnMajorIndex(label, v.size);
    expect(child.displayValue, `${path} ${label}`).toBe(elements[k]);
    expect(child.className, `${path} ${label}`).toBe('double');
  }
  // The Variable Editor grid shows the same elements under the same labels.
  for (const { label, value } of node.displayElements()) {
    expect(value, `${path} grid ${label}`).toBe(elements[columnMajorIndex(label, v.size)]);
  }
  return whole;
}

// The values whose presentation is NOT the one above, by venue: what each shows instead,
// and why. Pinned exactly rather than skipped, so a change to any of them is seen. None is
// in the .mat or the workspace, whose MCOS values are graded against MATLAB everywhere,
// and none is a regression: each is a dictionary showing its own copy of the value its own
// way, as it did before.
const PINNED: [file: string, path: string, shows: string, why: string][] = [
  [
    'complex.sldd',
    'pNonFinite',
    '[Infinity-Infinityi NaN+1i 1NaNi -Infinity+2i]',
    'a text dictionary holds a complex value as a MAT stream, read by the .mat reader\'s complex ' +
      'arm, which spells an infinite part with String(): the `Infinity` a plain .mat variable shows',
  ],
  [
    'complex_binary.sldd',
    'pNonFinite',
    "'Inf-Infi NaN+1.0i 1.0NaNi -Inf+2.0i'",
    'MATLAB\'s own text, quoted as a char: parseCdata\'s text test does not admit `Inf` or `NaN`',
  ],
  [
    'complex_binary.sldd',
    'pMixedNF',
    "'1.0+2.0i NaN+0.0i 3.0-4.0i'",
    'the same: one NaN part is enough for the whole of MATLAB\'s text to be quoted as a char',
  ],
  [
    'complex_binary.sldd',
    'pThird',
    '0.33333333333333331+0.1i',
    'MATLAB\'s own text, which a binary dictionary shows as written apart from a trailing `.0`: ' +
      'seventeen significant digits where every other venue shows the shortest spelling of the double',
  ],
  ['complex_binary.sldd', 'zThird', '0.33333333333333331+0.1i', 'the same text, for the plain variable'],
];
const pinnedAt = (file: string, path: string) => PINNED.find(([f, p]) => f === file && p === path);

// Where MATLAB itself does not read a venue's copy back as the value it wrote: MATLAB's
// mat2str of the reopened value, pinned. The binary dictionary stores complex(1, NaN) as
// `1.0NaNi` — no sign before a NaN imaginary part — and MATLAB's own reader takes
// `1.0NaNi -Inf+2.0i` back as two REAL elements, 1 and NaN.
const MATLAB_READS_BACK: [file: string, path: string, mat2str: string][] = [
  ['complex_binary.sldd', 'pNonFinite', '[Inf-1i*Inf NaN+1i 1 NaN]'],
];

const isNumeric = (f: FieldTruth): f is ValueTruth => f.class !== 'struct' && f.class !== 'cell';

/**
 * A value one level or more inside a property — a struct's fields, a cell's elements —
 * down to the numbers, which are graded as above. Returns what the node shows.
 */
function expectHeld(node: any, f: FieldTruth, path: string): string {
  if (isNumeric(f)) return expectValueNode(node, f, path);
  if (f.class === 'struct') {
    expect(node.children.map((c: any) => c.name), path).toEqual(f.fields);
    f.fields.forEach((name, i) => expectHeld(node.children[i], f.values[name], `${path}.${name}`));
    expect(node.displayValue, path).toBe('<1x1 struct>');
    return node.displayValue;
  }
  // A 1xN cell, whose one-line literal is its elements' own cells in a row.
  expect(f.size[0], `${path} is a row`).toBe(1);
  expect(node.children, path).toHaveLength(f.elements.length);
  const shownAs = f.elements.map((e, i) => expectHeld(node.children[i], e, `${path}{${i + 1}}`));
  expect(node.displayValue, path).toBe('{' + shownAs.join(', ') + '}');
  return node.displayValue;
}

/** A Parameter (Simulink or mpt): its own cell and row, its Value row, its element rows. */
function expectParameter(node: any, t: TruthRecord, path: string, fixture: string): void {
  if (t.elements) {
    // An object array: MATLAB's shape, then each element as the Parameter it is.
    expect(node.dims, path).toEqual(t.size);
    expect(node.children, path).toHaveLength(t.numel);
    expect(node.displayValue, path).toBe(`<${t.size.join('x')} ${t.class}>`);
    t.elements.forEach((e, k) => expectParameter(nodeAt(node.parent, `${node.name}(${k + 1})`), e, `${path}(${k + 1})`, fixture));
    return;
  }
  const v = t.Value!;
  expect(v, `${path} records its Value`).toBeDefined();
  const row = node.toRow();
  expect(row.DataType, path).toBe(t.DataType);
  expect(cellText(row.dimensions), path).toBe(shown(t.Dimensions));
  expect(cellText(row.complexity), path).toBe(t.Complexity);
  const pinned = pinnedAt(fixture, path);
  if (pinned) {
    expect(node.displayValue, `${path}: ${pinned[3]}`).toBe(pinned[2]);
    return;
  }
  if (!isNumeric(v)) {
    // A struct Value: its numbers are one level down, under the Value row.
    expect(node.children.map((c: any) => c.name), path).toEqual(['Value']);
    const whole = expectHeld(node.children[0], v, `${path}.Value`);
    expect(node.displayValue, path).toBe(whole);
    expect(row.Value, path).toBe(whole);
    return;
  }
  expect(v.isreal, `${path} is complex in MATLAB`).toBe(false);
  const elements = elementsOf(v, path);
  const whole = wholeText(v, elements);
  expect(node.displayValue, path).toBe(whole);
  expect(row.Value, path).toBe(whole);
  if (v.numel === 1) {
    // A complex scalar shows inline and gets no Value row, as in a dictionary
    // (parameterNode.test.ts).
    expect(node.children, path).toHaveLength(0);
    return;
  }
  expect(node.children.map((c: any) => c.name), path).toEqual(['Value']);
  expectValueNode(node.children[0], v, `${path}.Value`);
}

// The keys every truth record has; any other key of a custom object's record is one of
// its own properties (make_complex_fixtures.m's class_fields).
const RECORD_KEYS = new Set(['class', 'size', 'numel', 'isobject', 'isempty', 'isreal', 'disp', 'properties']);

/** A custom class: one row per property, each holding MATLAB's numbers. */
function expectCustomObject(node: any, t: TruthRecord, path: string): void {
  const props = Object.keys(t).filter((k) => !RECORD_KEYS.has(k));
  expect(props.length, path).toBeGreaterThan(0);
  expect(node.className, path).toBe(t.class);
  expect(node.displayValue, path).toBe(`<1x1 ${t.class}>`);
  for (const name of props) {
    expectHeld(nodeAt(node.parent, `${node.name}.${name}`), (t as any)[name] as FieldTruth, `${path}.${name}`);
  }
}

const isParameter = (t: TruthRecord) => t.class === 'Simulink.Parameter' || t.class === 'mpt.Parameter';
const isContainer = (t: TruthRecord) => t.class === 'struct' || t.class === 'cell';
const isPlainComplex = (t: TruthRecord) => !t.isobject && !isContainer(t) && t.isreal === false;
const isCustomObject = (t: TruthRecord) => t.isobject && !/^(Simulink|mpt)\./.test(t.class);

const valueLabel = (t: TruthRecord): string => {
  const v = t.Value ?? t.elements?.[0]?.Value;
  return v && isNumeric(v) ? (v.mat2str ?? v.mat2str_error ?? '') : (v?.class ?? '');
};

describe('every complex Value shows MATLAB\'s numbers, in every venue', () => {
  for (const fx of FIXTURES) {
    const variables = fx.variables();
    for (const [path, t] of Object.entries(fx.truth.paths)) {
      if (!isParameter(t)) continue;
      it(`${fx.file}: ${path} (${t.class}) = ${valueLabel(t)}`, () => {
        expectParameter(nodeAt(variables, path), t, path, fx.file);
      });
    }
  }
});

describe('a custom class\'s complex properties show MATLAB\'s numbers', () => {
  for (const fx of FIXTURES) {
    const variables = fx.variables();
    for (const [path, t] of Object.entries(fx.truth.paths)) {
      if (!isCustomObject(t)) continue;
      it(`${fx.file}: ${path} (${t.class})`, () => {
        expectCustomObject(nodeAt(variables, path), t, path);
      });
    }
  }
});

describe('a plain complex value beside them is the control', () => {
  // z, zRow and s.z are not in any object; they showed this spelling before objects did.
  for (const fx of FIXTURES) {
    const variables = fx.variables();
    for (const [path, t] of Object.entries(fx.truth.paths)) {
      if (!isPlainComplex(t)) continue;
      it(`${fx.file}: ${path} = ${t.mat2str}`, () => {
        const pinned = pinnedAt(fx.file, path);
        if (pinned) {
          expect(nodeAt(variables, path).displayValue, `${path}: ${pinned[3]}`).toBe(pinned[2]);
          return;
        }
        expectValueNode(nodeAt(variables, path), t as ValueTruth, path);
      });
    }
  }
});

describe('every nested object presents exactly as its top-level twin', () => {
  for (const fx of FIXTURES) {
    const variables = fx.variables();
    it(`${fx.file} pairs a twin with every nested object it holds`, () => {
      expect(fx.truth.twins.length).toBeGreaterThan(0);
      for (const { nested, twin } of fx.truth.twins) {
        expect(fx.truth.paths[nested], nested).toBeDefined();
        expect(fx.truth.paths[twin], twin).toBeDefined();
      }
    });
    for (const { nested, twin } of fx.truth.twins) {
      it(`${fx.file}: ${nested} is ${twin}`, () => {
        const a = nodeAt(variables, nested);
        const b = nodeAt(variables, twin);
        expect(a.constructor, 'node class').toBe(b.constructor);
        expect(presentation(a, a.displayName)).toEqual(presentation(b, b.displayName));
      });
    }
  }
});

// ---- Venues ------------------------------------------------------------------------
//
// Every object and plain value the .mat holds presents identically wherever else the
// generator put it: the model workspace, the text dictionary and the binary one, apart
// from the cells presentation() leaves out because they belong to a node's position.
// A container is left to the summaries below: how a struct or a cell of objects
// summarizes itself differs by venue for reasons that are not about complex numbers. A
// value PINNED in either venue is compared through its pins instead.
describe('every value presents the same in the .mat as in each other venue that holds it', () => {
  const mat = MAT.variables();
  for (const fx of FIXTURES.slice(1)) {
    const variables = fx.variables();
    const shared = Object.keys(fx.truth.paths).filter((p) => {
      const here = fx.truth.paths[p];
      return MAT.truth.paths[p] !== undefined && !isContainer(here);
    });
    it(`${fx.file} shares values with the .mat`, () => {
      expect(shared.length).toBeGreaterThan(0);
    });
    for (const path of shared) {
      const pins = [pinnedAt(MAT.file, path), pinnedAt(fx.file, path)];
      it(`${fx.file}: ${path}${pins.some(Boolean) ? ', as pinned' : ''}`, () => {
        // The same value in both: MATLAB's own records agree before ours are compared.
        const readsBack = MATLAB_READS_BACK.find(([f, p]) => f === fx.file && p === path);
        if (readsBack) {
          expect(fx.truth.paths[path].Value?.mat2str, `${path}: what MATLAB reads back`).toBe(readsBack[2]);
          expect(MAT.truth.paths[path].Value?.mat2str).not.toBe(readsBack[2]);
        } else {
          const strip = (t: TruthRecord) => ({ ...t, disp: undefined, properties: undefined });
          expect(strip(fx.truth.paths[path]), `${path}: MATLAB's two records`).toEqual(strip(MAT.truth.paths[path]));
        }
        const a = nodeAt(mat, path);
        const b = nodeAt(variables, path);
        if (pins.some(Boolean)) {
          // A pinned venue is held to its pin, and an unpinned one has been graded against
          // MATLAB above; what is left to say is that the pin is still needed.
          [a, b].forEach((n, i) => pins[i] && expect(n.displayValue, path).toBe(pins[i]![2]));
          expect(presentation(b, b.displayName), `${path}: pinned, and no longer different`).not.toEqual(
            presentation(a, a.displayName),
          );
          return;
        }
        expect(presentation(b, b.displayName)).toEqual(presentation(a, a.displayName));
      });
    }
  }
});

// ---- What is not a Parameter -----------------------------------------------------
//
// A LookupTable's numbers are a property of its Table object, one level further down,
// and LookupTableNode shows none of its Table in any venue — its own cell is empty and it
// has no rows — so there is nothing complex here to spell. Pinned so that is seen to stay
// true, and to stay the same in every venue.
describe('a LookupTable with a complex Table presents as it does everywhere', () => {
  for (const fx of FIXTURES) {
    const variables = fx.variables();
    for (const [path, t] of Object.entries(fx.truth.paths)) {
      if (t.class !== 'Simulink.LookupTable') continue;
      it(`${fx.file}: ${path}`, () => {
        const node = nodeAt(variables, path);
        expect(node.displayValue).toBe('');
        expect(node.children).toHaveLength(0);
        const a = nodeAt(MAT.variables(), path);
        expect(presentation(node, node.displayName)).toEqual(presentation(a, a.displayName));
      });
    }
  }
});

// A container's own summary, by venue, as it is today. Not changed by this work: the
// .mat and workspace venues print an object element of a cell as `<1x1 Class>`
// (nestedMcosFixtures pins the rule), and a dictionary prints its elements' values.
const SUMMARIES: [file: string, path: string, shows: string][] = [
  ['complex_objects.mat', 's', '<1x1 struct>'],
  ['complex_objects.mat', 'c', '{<1x1 Simulink.Parameter>, <1x1 Simulink.Parameter>}'],
  ['complex_ws.slx', 'cfg', '<1x1 struct>'],
  ['complex.sldd', 's', '<1x1 struct>'],
  ['complex.sldd', 'c', '{9+10i, [0.5+1.5i; 2.5-3.5i]}'],
  ['complex_binary.sldd', 's', '<1x1 struct>'],
  ['complex_binary.sldd', 'c', '{9+10i, [0.5+1.5i; 2.5-3.5i]}'],
];

describe('container summaries are today\'s', () => {
  for (const [file, path, shows] of SUMMARIES) {
    it(`${file}: ${path} shows ${shows}`, () => {
      const fx = FIXTURES.find((f) => f.file === file)!;
      expect(nodeAt(fx.variables(), path).displayValue).toBe(shows);
    });
  }

  it('pins every container the truth files record, and nothing else', () => {
    const recorded = FIXTURES.flatMap((fx) =>
      Object.entries(fx.truth.paths)
        .filter(([, t]) => isContainer(t))
        .map(([path]) => `${fx.file} ${path}`),
    );
    expect(SUMMARIES.map(([file, path]) => `${file} ${path}`).sort()).toEqual(recorded.sort());
  });
});

describe('no path in a truth file goes unchecked', () => {
  for (const fx of FIXTURES) {
    it(`${fx.file}: every path is a Parameter, a custom object, a LookupTable, a container or a plain complex value`, () => {
      const unchecked = Object.entries(fx.truth.paths)
        .filter(
          ([, t]) =>
            !isParameter(t) &&
            !isCustomObject(t) &&
            t.class !== 'Simulink.LookupTable' &&
            !isContainer(t) &&
            !isPlainComplex(t),
        )
        .map(([path]) => path);
      expect(unchecked).toEqual([]);
    });
  }

  it('pins only values that exist', () => {
    for (const [file, path] of [...PINNED, ...MATLAB_READS_BACK]) {
      const fx = FIXTURES.find((f) => f.file === file)!;
      expect(fx.truth.paths[path], `${file} ${path}`).toBeDefined();
    }
  });
});
