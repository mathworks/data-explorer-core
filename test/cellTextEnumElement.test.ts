// Copyright 2026 The MathWorks, Inc.
//
// An enumeration value in a cell of a text dictionary keeps its enumeral in the cell's text, as
// it does in its own row.
//
// A text dictionary spells an enumeration value as one element holding the numbers its
// enumerals stand for, under `_enum_value` (XmlUtils.textEnumValueOf), and its row shows `on`,
// `DispColor(1)`, `<1x3 matlab.lang.OnOffSwitchState>` (test/workspaceBrowserDisplay.test.ts).
// In a cell, MatlabVariableNode._cellLiteralElement kept an element's own text only for the
// binary reader's enumeration (isEnumBag), so the same values in a cell read `{<1x1
// matlab.lang.OnOffSwitchState>, <1x1 DispColor>, <1x3 matlab.lang.OnOffSwitchState>, 7}`: the
// summary of an object, where the element's own row showed the enumeral.
//
// The values are dispcat_text.sldd's own en_on, en_sl_red and en_onoff_vec, as MATLAB wrote
// them, moved into a copy of one of its cells. No dictionary MATLAB wrote holds an enumeration
// in a cell (test/cellEnumElement.test.ts, which has the binary reader's form).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const FILE = fileURLToPath(new URL('./fixtures/display/dispcat_text.sldd', import.meta.url));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The fixture's entries, as MATLAB wrote them. */
function entriesOf(text: any): any[] {
  return text.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
}

/**
 * The value MATLAB wrote for entry `name`, or, for `name{k}`, the k-th element of that cell. A
 * number is a double as cell_1 holds its own, a bare JSON number.
 */
function written(entries: any[], name: string | number): any {
  if (typeof name === 'number') {
    return name;
  }
  const [, base, k] = /^([^{]+)(?:\{(\d+)\})?$/.exec(name)!;
  const e = entries.find((x) => x.name === base);
  expect(e, `${base} is in the fixture`).toBeDefined();
  return copy(k === undefined ? e.value : e.value._elements[Number(k) - 1]);
}

/**
 * The root of dispcat_text.sldd with one more entry, `cell`: a copy of the fixture's cell_1
 * holding, in order, the values `from` names (see written).
 */
function withCell(from: (string | number)[]): any {
  const text = JSON.parse(readFileSync(FILE, 'utf8'));
  const entries = entriesOf(text);
  const cell = copy(entries.find((e) => e.name === 'cell_1'));
  expect(cell.value).toEqual({ _array_type: 'Cell', _dimensions: [1, 1], _elements: [1], _mw_element_type: 'MATLABArray' });
  cell.name = 'cell';
  cell.metadata.uuid = '00000000-0000-4000-8000-0000000000aa';
  cell.value._elements = from.map((n) => written(entries, n));
  cell.value._dimensions = [1, from.length];
  entries.push(cell);
  const bytes = new TextEncoder().encode(JSON.stringify(text));
  return ingest(createSession(), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
    filename: 'dispcat_text.sldd',
  });
}

/** The entry called `name`. */
function entry(root: any, name: string): any {
  const found: any[] = [];
  const walk = (n: any): void => {
    if (n !== root && n.isEntry && n.name === name) {
      found.push(n);
    }
    if (!n.isEntry) {
      (n.children || []).forEach(walk);
    }
  };
  walk(root);
  expect(found.length, name).toBe(1);
  return found[0];
}

/** What a node and every row under it show, less their labels: Value, class, size, editable. */
const shown = (n: any): unknown[] => [[n.toRow().Value, n.className, n.dims, n.valueEditable], ...(n.children || []).flatMap(shown)];

const ENUMS = ['en_on', 'en_sl_red', 'en_onoff_vec'];
const CELL = [...ENUMS, 7];

describe("a text dictionary's enumeration value in a cell", () => {
  it("is its enumeral in the cell's text, as in its own row", () => {
    const root = withCell(CELL);
    const cell = entry(root, 'cell');
    expect(cell.children.map((c: any) => c.className)).toEqual(['matlab.lang.OnOffSwitchState', 'DispColor', 'matlab.lang.OnOffSwitchState', 'double']);
    expect(cell.toRow().Value).toBe('{on, DispColor(1), <1x3 matlab.lang.OnOffSwitchState>, 7}');
    expect(cell.displayValue).toBe(cell.toRow().Value);
    // The grid spells each element as the literal does.
    expect(cell.displayElements().map((e: any) => e.value)).toEqual(['on', 'DispColor(1)', '<1x3 matlab.lang.OnOffSwitchState>', '7']);
    // `{on, DispColor(1), ...}` read back would be text: the cell takes no editor.
    expect(cell.valueEditable).toBe(false);
  });

  it('and each element, its row and the rows under it, shows what the entry it came from shows', () => {
    const root = withCell(CELL);
    const cell = entry(root, 'cell');
    ENUMS.forEach((name, k) => {
      expect(shown(cell.children[k]), name).toEqual(shown(entry(root, name)));
      expect(cell.displayElements()[k].value, name).toBe(entry(root, name).toRow().Value);
    });
  });

  it("and a row of a user enumeration's values is its numbers there, as in its own row", () => {
    const root = withCell(['en_sl_vec']);
    const cell = entry(root, 'cell');
    expect(cell.toRow().Value).toBe('{DispColor([1 3])}');
    expect(shown(cell.children[0])).toEqual(shown(entry(root, 'en_sl_vec')));
  });

  it('while an object that is no enumeration is still its summary beside one', () => {
    const root = withCell(['en_sl_red', 'cell_of_param{1}']);
    const cell = entry(root, 'cell');
    expect(cell.children.map((c: any) => c.className)).toEqual(['DispColor', 'Simulink.Parameter']);
    expect(cell.toRow().Value).toBe('{DispColor(1), <1x1 Simulink.Parameter>}');
  });
});
