// Copyright 2026 The MathWorks, Inc.
//
// Nested MCOS objects against MATLAB's own answers, on the two fixtures
// test/fixtures/mcos/make_nested_fixtures.m writes: nested_objects.mat, and
// nested_ws.slx, whose MODEL WORKSPACE holds the same kind of struct. Each nested object
// has a TOP-LEVEL TWIN of equal value in the same file, built separately (a Parameter is
// a handle, so a twin made by assignment would share the nested object's heap entry and
// prove nothing), and each truth file records both.
//
// Everything here is driven by the truth files, so an object, a twin or a container
// added to the generator is covered without editing this file:
//
//   * every `twins` pair presents identically, apart from the node's own name;
//   * every object in `paths` has MATLAB's values;
//   * every container in `paths` shows today's summary, pinned beside MATLAB's `disp`;
//   * and every path is one of those three or a plain value, so none goes unchecked.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFile } from './parity/loadFile.js';
import { presentation } from './tools/nodePresentation.js';

interface TruthRecord {
  class: string;
  size: number[];
  numel: number;
  isobject: boolean;
  disp: string;
  mat2str?: string;
  // An object array.
  elements?: TruthRecord[];
  // A string.
  text?: (string | null)[];
  // The object classes' own fields, as make_nested_fixtures.m's `object_record` writes.
  Value?: unknown;
  DataType?: string;
  Min?: number | number[];
  Max?: number | number[];
  Unit?: string;
  Description?: string;
  Dimensions?: number | number[];
  Complexity?: string;
  BaseType?: string;
  busElements?: { Name: string; DataType: string; Dimensions: number | number[]; Complexity: string }[];
  properties?: Record<string, { mat2str?: string }>;
}

interface Truth {
  paths: Record<string, TruthRecord>;
  twins: { nested: string; twin: string }[];
}

const truthOf = (name: string): Truth =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/mcos/${name}`, import.meta.url)), 'utf8'));

// Each fixture, the node its MATLAB top-level variables sit under, and its truth. A
// .mat's variables are the MatNode's own children; a model's are its workspace's.
const FIXTURES = [
  {
    file: 'nested_objects.mat',
    truth: truthOf('nested_objects.truth.json'),
    variables: (): any => loadFile('../fixtures/mcos/nested_objects.mat'),
  },
  {
    file: 'nested_ws.slx',
    truth: truthOf('nested_ws.truth.json'),
    variables: (): any => loadFile('../fixtures/mcos/nested_ws.slx').getSection('workspace'),
  },
];

// The node a MATLAB path names: `s.sub.q`, `c{4}{1}`, `sa(2).p`. A struct field is the
// child of that name; a cell element `{i}` and a struct-array element `(i)` are the
// i-th child, which is how both containers lay their elements out (MATLAB's linear
// index, column-major).
function nodeAt(variables: any, path: string): any {
  const head = /^[A-Za-z]\w*/.exec(path);
  if (!head) throw new Error(`not a MATLAB path: ${path}`);
  const pick = (parent: any, test: (c: any, i: number) => boolean, what: string) => {
    const hit = parent.children.find(test);
    if (!hit) {
      throw new Error(`${path}: no ${what} under ${parent.name}; have ${parent.children.map((c: any) => c.name).join(', ')}`);
    }
    return hit;
  };
  let node = pick(variables, (c) => c.name === head[0], `variable ${head[0]}`);
  let rest = path.slice(head[0].length);
  while (rest) {
    const seg = /^(?:\.(\w+)|\{(\d+)\}|\((\d+)\))/.exec(rest);
    if (!seg) throw new Error(`cannot read "${rest}" in ${path}`);
    if (seg[1] !== undefined) {
      node = pick(node, (c) => c.name === seg[1], `field ${seg[1]}`);
    } else {
      const at = Number(seg[2] ?? seg[3]) - 1;
      node = pick(node, (_c, i) => i === at, `element ${at + 1}`);
    }
    rest = rest.slice(seg[0].length);
  }
  return node;
}


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

describe('a nested object takes the name rules of the place it sits', () => {
  // The one part of a node the comparison above leaves out is its Name cell, which
  // belongs to its position: a field is not an entry, and a field's name is fixed in
  // this reader. A decoded object is no exception to that. It used to be one — a field
  // built as a ParameterNode or a BusNode offered a rename none of its sibling fields
  // did, because MatlabVariableNode stated the rule only for children of its own class
  // — and the rename could not reach the file, since it leaves the struct's `_var`
  // describing the field by its old name.
  for (const fx of FIXTURES) {
    const containers = Object.entries(fx.truth.paths).filter(([, t]) => isContainer(t));
    for (const [path] of containers) {
      it(`${fx.file}: every element of ${path} shows its name the same way, whatever its class`, () => {
        const flags = nodeAt(fx.variables(), path).children.map((c: any) => {
          const { disabled, editable, element } = c.toRow().Name;
          return { disabled, editable, element, nameEditable: c.nameEditable };
        });
        expect(flags.length, path).toBeGreaterThan(0);
        for (const f of flags) expect(f, path).toEqual(flags[0]);
        expect(flags[0].editable, path).toBe(false);
      });
    }
    for (const { nested, twin } of fx.truth.twins) {
      it(`${fx.file}: ${nested} refuses a rename that ${twin} accepts`, () => {
        const variables = fx.variables();
        const a = nodeAt(variables, nested);
        const before = a.name;
        expect(a.setProperty('Name', 'renamed')).not.toBe(true);
        expect(a.name).toBe(before);
        expect(nodeAt(variables, twin).setProperty('Name', 'renamed')).toBe(true);
      });
    }
  }
});

// ---- MATLAB's values -----------------------------------------------------------
//
// Read off the row a host renders, because that is the one channel every class shares:
// a Parameter with no Min answers `undefined` from its getter where a Signal answers
// `[]`, and both show an empty cell. A cell is a plain string or an editor object
// carrying `text`.
const cellText = (cell: unknown): string =>
  cell !== null && typeof cell === 'object' ? String((cell as { text: unknown }).text) : String(cell ?? '');
// MATLAB's empty `[]` is an empty cell; anything else prints as mat2str would.
const shown = (v: number | number[] | undefined): string =>
  Array.isArray(v) ? (v.length === 0 ? '' : v.length === 1 ? String(v[0]) : '[' + v.join(' ') + ']') : String(v);

function expectScalarProps(node: any, t: TruthRecord, path: string, names: (keyof TruthRecord)[]): void {
  const row = node.toRow();
  for (const name of names) {
    const label = `${path}.${String(name)}`;
    switch (name) {
      case 'Value':
        // The number, and the text it shows as, which is MATLAB's own mat2str.
        expect(node.Value, label).toEqual(t.Value);
        expect(row.Value, label).toBe(t.properties!.Value.mat2str);
        break;
      case 'DataType':
        expect(row.DataType, label).toBe(t.DataType);
        break;
      case 'Min':
      case 'Max':
        expect(cellText(row[name]), label).toBe(shown(t[name] as number | number[]));
        break;
      case 'Unit':
      case 'Description':
        expect(row[name], label).toBe(t[name]);
        break;
      case 'Dimensions':
        expect(cellText(row.dimensions), label).toBe(shown(t.Dimensions));
        break;
      case 'Complexity':
        expect(cellText(row.complexity), label).toBe(t.Complexity);
        break;
      default:
        throw new Error(`no check for ${String(name)}`);
    }
  }
}

const PARAMETER: (keyof TruthRecord)[] = ['Value', 'DataType', 'Min', 'Max', 'Unit', 'Description', 'Dimensions', 'Complexity'];
const SIGNAL: (keyof TruthRecord)[] = ['DataType', 'Min', 'Max', 'Unit', 'Description', 'Dimensions', 'Complexity'];
const VALUE_TYPE: (keyof TruthRecord)[] = ['DataType', 'Min', 'Max', 'Unit', 'Description', 'Dimensions', 'Complexity'];

function expectMatlabValues(node: any, t: TruthRecord, path: string): void {
  expect(node.className, path).toBe(t.class);
  if (t.class === 'string') {
    // The text, column-major, a `missing` as null — the decoder's own spelling of it.
    expect(node.dims, path).toEqual(t.size);
    expect(node.elements, path).toEqual(t.text);
    // And as each element is SHOWN: quoted, or `<missing>` for a missing one, which is
    // how a top-level missing string already presents (strings.mat's sMissing).
    const display = t.text!.map((s) => (s === null ? '<missing>' : `"${s}"`));
    if (t.numel === 1) {
      expect(node.displayValue, path).toBe(display[0]);
    } else {
      expect(node.children.map((c: any) => c.displayValue), path).toEqual(display);
    }
    return;
  }
  if (t.elements) {
    // An object array: MATLAB's shape, then each element as the scalar it is.
    expect(node.dims, path).toEqual(t.size);
    expect(node.children, path).toHaveLength(t.numel);
    t.elements.forEach((e, i) => expectMatlabValues(node.children[i], e, `${path}(${i + 1})`));
    return;
  }
  switch (t.class) {
    case 'Simulink.Parameter':
      expectScalarProps(node, t, path, PARAMETER);
      return;
    case 'Simulink.Signal':
      expectScalarProps(node, t, path, SIGNAL);
      return;
    case 'Simulink.ValueType':
      expectScalarProps(node, t, path, VALUE_TYPE);
      return;
    case 'Simulink.AliasType':
      expect(node.BaseType, path).toBe(t.BaseType);
      expect(node.toRow().Description, path).toBe(t.Description);
      return;
    case 'Simulink.Bus': {
      expect(node.toRow().Description, path).toBe(t.Description);
      const elems = t.busElements!;
      expect(node.children.map((c: any) => c.name), path).toEqual(elems.map((e) => e.Name));
      elems.forEach((e, i) => {
        const row = node.children[i].toRow();
        const label = `${path}.Elements(${i + 1})`;
        expect(row.DataType, label).toBe(e.DataType);
        expect(cellText(row.dimensions), label).toBe(shown(e.Dimensions));
        expect(cellText(row.complexity), label).toBe(e.Complexity);
      });
      return;
    }
    default:
      // A class the generator added and this file has no rule for: say so, rather than
      // let a new object through unchecked.
      throw new Error(`${path}: no value check for class ${t.class}`);
  }
}

const isContainer = (t: TruthRecord) => t.class === 'struct' || t.class === 'cell';

describe('every object has MATLAB\'s values, nested or top-level', () => {
  for (const fx of FIXTURES) {
    const variables = fx.variables();
    for (const [path, t] of Object.entries(fx.truth.paths)) {
      if (!t.isobject) continue;
      it(`${fx.file}: ${path} (${t.class})`, () => {
        expectMatlabValues(nodeAt(variables, path), t, path);
      });
    }
  }
});

describe('the model-workspace route', () => {
  // The .slx venue is ModelNode, a different container from MatNode with its own
  // trailing-element blob; the loops above already compare cfg.k and cfg.label with
  // their twins and with MATLAB. This pins that they really came through the workspace,
  // as decoded nodes rather than as the opaque shells they used to be.
  const workspace = FIXTURES[1].variables();

  it('decodes a struct field of the workspace into the node its twin is', () => {
    expect(workspace.children.map((c: any) => c.name).sort()).toEqual(['cfg', 'kTop', 'labelTop']);
    const k = nodeAt(workspace, 'cfg.k');
    expect(k.constructor.name).toBe('ParameterNode');
    expect(k.displayValue).toBe(String(FIXTURES[1].truth.paths['cfg.k'].Value));
    expect(k.parent).toBe(nodeAt(workspace, 'cfg'));
    const label = nodeAt(workspace, 'cfg.label');
    expect(label.displayValue).toBe(`"${FIXTURES[1].truth.paths['cfg.label'].text![0]}"`);
    expect(label.displayValue).toBe(nodeAt(workspace, 'labelTop').displayValue);
  });
});

// ---- Containers: what we show, beside what MATLAB shows -------------------------
//
// Deliberately NOT changed by decoding nested objects: a container's own one-line
// summary still spells an object element as `<1x1 Class>`, and a struct as `<1x1
// struct>`. What it should say is a later decision, and MATLAB's own `disp` of each is
// recorded in the truth files for it. Each row pins today's answer; the MATLAB column is
// the truth file's `disp`, copied here so both are in view in one place (the test checks
// the copy against the file).
const SUMMARIES: [file: string, path: string, ours: string, matlabDisp: string][] = [
  [
    'nested_objects.mat',
    's',
    '<1x1 struct>',
    'p: [1×1 Simulink.Parameter]\n       sub: [1×1 struct]\n       str: "hello"\n      strs: [2×2 string]\n      miss: <missing>\n       bus: [1×1 Simulink.Bus]\n        vt: [1×1 Simulink.ValueType]\n     alias: [1×1 Simulink.AliasType]\n       sig: [1×1 Simulink.Signal]\n    objArr: [1×2 Simulink.Parameter]',
  ],
  ['nested_objects.mat', 's.sub', '<1x1 struct>', 'q: [1×1 Simulink.Parameter]'],
  [
    'nested_objects.mat',
    'c',
    '{<1x1 Simulink.Parameter>, <1x1 string>, 42, {<1x1 Simulink.Parameter>}}',
    '{1×1 Simulink.Parameter}    {["txt"]}    {[42]}    {1×1 cell}',
  ],
  ['nested_objects.mat', 'c{4}', '{<1x1 Simulink.Parameter>}', '{1×1 Simulink.Parameter}'],
  ['nested_objects.mat', 'sa', '<1x2 struct>', '1×2 struct array with fields:\n\n    p'],
  ['nested_objects.mat', 'sa(1)', '<1x1 struct>', 'p: [1×1 Simulink.Parameter]'],
  ['nested_objects.mat', 'sa(2)', '<1x1 struct>', 'p: [1×1 Simulink.Parameter]'],
  // The non-scalar elements: a 1x3 string, a 1x2 Parameter array and a 0x0 string are
  // `<1x1 Class>` here, because that is what the literal printed before nested objects
  // were decoded — an undecoded opaque was never told its shape, so the token had none.
  // Each `ours` below is the parent commit's own output on this file, not a prediction.
  // MATLAB's disp of cArr wraps at its 80-column batch display, and is recorded as it is.
  [
    'nested_objects.mat',
    'cArr',
    '{<1x1 string>, <1x1 Simulink.Parameter>, <1x1 string>, <1x1 Simulink.Parameter>}',
    'Columns 1 through 3\n\n    {["a"    "b"    "c"]}    {1×2 Simulink.Parameter}    {0×0 string}\n\n  Column 4\n\n    {1×1 Simulink.Parameter}',
  ],
  ['nested_objects.mat', 'cNest', '{{<1x1 string>}, {<1x1 Simulink.Parameter>}}', '{1×1 cell}    {1×1 cell}'],
  ['nested_objects.mat', 'cNest{1}', '{<1x1 string>}', '{["p"    "q"]}'],
  ['nested_objects.mat', 'cNest{2}', '{<1x1 Simulink.Parameter>}', '{1×1 Simulink.Parameter}'],
  ['nested_objects.mat', 's2', '<1x1 struct>', 'cs: {["x"    "y"]}'],
  ['nested_objects.mat', 's2.cs', '{<1x1 string>}', '{["x"    "y"]}'],
  ['nested_ws.slx', 'cfg', '<1x1 struct>', 'k: [1×1 Simulink.Parameter]\n    label: "ws text"'],
];

describe('container summaries are today\'s, with MATLAB\'s disp beside them', () => {
  for (const [file, path, ours, matlabDisp] of SUMMARIES) {
    const fx = FIXTURES.find((f) => f.file === file)!;
    it(`${file}: ${path} shows ${ours} — MATLAB: ${matlabDisp.replace(/\s+/g, ' ')}`, () => {
      expect(fx.truth.paths[path].disp, 'the MATLAB column is the truth file\'s').toBe(matlabDisp);
      expect(nodeAt(fx.variables(), path).displayValue).toBe(ours);
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

// The Variable Editor grid of each cell (displayElements), which is the same
// presentation as the literal and was held to the same rule: an MCOS element is
// `<1x1 Class>` there too, exactly as the parent commit 16d8edc showed it, whatever the
// object's shape. Each row below is 16d8edc's own output on this file.
const GRIDS: [path: string, grid: [label: string, value: string][]][] = [
  ['c', [['c{1}', '<1x1 Simulink.Parameter>'], ['c{2}', '<1x1 string>'], ['c{3}', '42'], ['c{4}', '{<1x1 Simulink.Parameter>}']]],
  ['c{4}', [['c{4}{1}', '<1x1 Simulink.Parameter>']]],
  ['cArr', [['cArr{1}', '<1x1 string>'], ['cArr{2}', '<1x1 Simulink.Parameter>'], ['cArr{3}', '<1x1 string>'], ['cArr{4}', '<1x1 Simulink.Parameter>']]],
  ['cNest', [['cNest{1}', '{<1x1 string>}'], ['cNest{2}', '{<1x1 Simulink.Parameter>}']]],
  ['cNest{1}', [['cNest{1}{1}', '<1x1 string>']]],
  ['cNest{2}', [['cNest{2}{1}', '<1x1 Simulink.Parameter>']]],
  ['s2.cs', [['cs{1}', '<1x1 string>']]],
];

describe('each cell\'s Variable Editor grid is today\'s, and agrees with its literal', () => {
  const fx = FIXTURES[0];
  for (const [path, grid] of GRIDS) {
    it(`nested_objects.mat: ${path}`, () => {
      const node = nodeAt(fx.variables(), path);
      expect(node.displayElements()).toEqual(grid.map(([label, value]) => ({ label, value })));
      // Every one of these is 1xN, so its literal is its grid's values in a row.
      expect(node.displayValue).toBe('{' + grid.map(([, value]) => value).join(', ') + '}');
    });
  }

  it('pins every cell nested_objects.mat\'s truth records', () => {
    const cells = Object.entries(fx.truth.paths)
      .filter(([, t]) => t.class === 'cell')
      .map(([path]) => path);
    expect(GRIDS.map(([path]) => path).sort()).toEqual(cells.sort());
  });
});

describe('no path in a truth file goes unchecked', () => {
  for (const fx of FIXTURES) {
    it(`${fx.file}: every path is an object, a container or a plain value`, () => {
      const variables = fx.variables();
      for (const [path, t] of Object.entries(fx.truth.paths)) {
        if (t.isobject || isContainer(t)) continue;
        // A plain value beside the objects (c{3} = 42): MATLAB's mat2str, as shown.
        expect(t.mat2str, path).toBeDefined();
        expect(nodeAt(variables, path).displayValue, path).toBe(t.mat2str);
      }
    });
  }
});
