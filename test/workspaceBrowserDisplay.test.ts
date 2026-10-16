// Copyright 2026 The MathWorks, Inc.
//
// The Value and Class columns against MATLAB's Workspace browser, the authority the
// 2026-10-15 display ruling names ("follow matlab style for Value display and Class
// display"). The expected texts are MATLAB's own, read from what the browser's column code
// (ClassCol, ValueCol, ObjectValueSummary) answered for the same values in R2027a
// (test/fixtures/display/browser_short.truth.json), wherever this package's spelling of a
// text is MATLAB's. The values are read from the files MATLAB wrote them into
// (dispcat.mat, dispcat_text.sldd, dispcat_bin.sldd), by test/parity/matlab/probe_display.m.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { regenerateEntryXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import PropClass from '../src/datamodel/prop/PropClass.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import MatlabValueParser from '../src/datamodel/parser/MatlabValueParser.js';

const here = (name: string): string => fileURLToPath(new URL(`./fixtures/display/${name}`, import.meta.url));
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(here(name)));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const chunkOf = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)['data/chunk0.xml']);

interface BrowserRow { Name: string; Size: string; Class: string; Value: string; IsSummary: boolean }
interface MetaEntry { name: string; class: string; size: number[]; isreal: boolean; issparse: boolean; paramValue: unknown }

const BROWSER = new Map((JSON.parse(readFileSync(here('browser_short.truth.json'), 'utf8')) as BrowserRow[]).map((r) => [r.Name, r]));
const META = new Map((JSON.parse(readFileSync(here('meta.truth.json'), 'utf8')).entries as MetaEntry[]).map((e) => [e.name, e]));

/** MATLAB's row for `name`: what the Workspace browser shows. */
function browser(name: string): BrowserRow {
  const row = BROWSER.get(name);
  expect(row, `${name} is in the truth`).toBeDefined();
  return row!;
}

/** What MATLAB's class(), size() and isreal() say `name` is. */
function meta(name: string): MetaEntry {
  const m = META.get(name);
  expect(m, `${name} is in the truth`).toBeDefined();
  return m!;
}

function open(file: string): { session: any; root: any } {
  const session = createSession();
  const root: any = ingest(session, buffer(bytes(file)), { filename: file });
  return { session, root };
}

/** Every entry (or .mat variable) of a file. */
function entriesOf(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any): void => {
    if (n.isEntry) {
      out.push(n);
    } else {
      (n.children || []).forEach(walk);
    }
  };
  walk(root);
  return out;
}

/** The entry (or .mat variable) called `name`, wherever its section put it. */
function entry(root: any, name: string): any {
  const found: any[] = [];
  const walk = (n: any): void => {
    if (n !== root && n.name === name && (n.isEntry || n.parent === root)) {
      found.push(n);
    }
    if (!n.isEntry) {
      (n.children || []).forEach(walk);
    }
  };
  walk(root);
  expect(found.length, `${name} in ${root.name}`).toBe(1);
  return found[0];
}

// C-040. MATLAB writes a complex empty into a binary dictionary as a property with no text,
// `<P Name="Value" Class="int16" IsComplex="1" Dimension="1*0"/>`, and it was read as the
// char '' (MatlabVariableNode.parseCdata's char arm), class char. The browser shows `[ ]`,
// as it shows every numeric empty.
describe("a binary dictionary's complex empty is the empty it is", () => {
  const COMPLEX_EMPTY = ['dx_complex_0x0', 'dx_complex_1x0', 'dx_complex_int16_1x0', 'e_single_complex_1x0'];

  for (const name of COMPLEX_EMPTY) {
    it(name, () => {
      const { root } = open('dispcat_bin.sldd');
      const m = meta(name);
      expect([m.isreal, m.size.includes(0)], 'MATLAB holds a complex empty').toEqual([false, true]);
      const node = entry(root, name);
      expect(node.toRow().Value).toBe(browser(name).Value);
      expect([node.className, node.dims, node.children.length]).toEqual([m.class, m.size, 0]);
    });
  }

  it("dx_param_complex_1x0: a Parameter's complex empty Value shows the same", () => {
    // The Parameter's own row is its Value (H1 of the display study, not ruled), and its
    // Value is MATLAB's complex(zeros(1,0)), shown as dx_complex_1x0 is.
    const { root } = open('dispcat_bin.sldd');
    expect(meta('dx_param_complex_1x0').paramValue).toMatchObject({ class: 'double', size: [1, 0], isreal: false });
    const param = entry(root, 'dx_param_complex_1x0');
    expect(param.toRow().Value).toBe(browser('dx_complex_1x0').Value);
  });

  it('written back as MATLAB wrote it, untouched and rebuilt from the model', () => {
    const { session, root } = open('dispcat_bin.sldd');
    const matlab = chunkOf(bytes('dispcat_bin.sldd'));
    expect(chunkOf(session.serializeSource(root.name).bytes)).toBe(matlab);
    for (const name of COMPLEX_EMPTY) {
      const tag = new RegExp(`<P Name="Name" Class="char">${name}</P>[\\s\\S]*?(<P Name="Value"[^>]*/>)`).exec(matlab)![1];
      expect(tag, name).toContain('IsComplex="1"');
      expect(regenerateEntryXml(entry(root, name)), name).toContain(tag);
    }
  });
});

// C-060, under the same ruling: the Class column, and the Property Inspector's Class, read as
// the browser's ClassCol does. class() itself for most values, and what the browser adds to
// it: `int16 (complex)`, `double (sparse)`, `logical (sparse)`,
// `logical (matlab.lang.OnOffSwitchState)`. A complex scalar of a non-double class, and each
// element of a complex array, is its own class (it was 'double'), and a .mat's empty logical is
// a logical (it was 'uint8', its MAT storage class).
describe("the Class column reads as MATLAB's Workspace browser does", () => {
  const FILES = ['dispcat.mat', 'dispcat_text.sldd', 'dispcat_bin.sldd'];
  // Values a file does not hold as MATLAB does, so their Class there is the file's: a text
  // dictionary writes a sparse scalar and a sparse empty as a bare number or [], and a complex
  // empty as [] (no MAT stream, so no complexity), and both flavours write a 1x1 sparse as the
  // plain scalar. Pinned as the file's below.
  const NOT_HELD: Record<string, string[]> = {
    'dispcat.mat': [],
    'dispcat_text.sldd': ['dx_complex_0x0', 'dx_complex_1x0', 'dx_complex_int16_1x0', 'e_single_complex_1x0',
      'dx_sparse_0x0', 'dx_sparse_2x0', 'e_sparse_logical_0x0', 'sp_scalar', 'sp_logical_scalar'],
    'dispcat_bin.sldd': ['sp_scalar', 'sp_logical_scalar'],
  };

  for (const file of FILES) {
    it(`${file}: every value MATLAB's file holds as MATLAB does`, () => {
      const { root } = open(file);
      const held = entriesOf(root).filter((n) => BROWSER.has(n.name) && !NOT_HELD[file].includes(n.name));
      expect(held.length, file).toBeGreaterThan(30);
      const ours = held.map((n) => [n.name, n.toRow().Class, n.getPropInfo(PropClass).displayValue]);
      expect(ours).toEqual(held.map((n) => [n.name, browser(n.name).Class, browser(n.name).Class]));
    });
  }

  it("class() of a complex scalar, and of an element of a complex array, is MATLAB's", () => {
    for (const file of FILES) {
      const { root } = open(file);
      for (const name of ['z_scalar', 'z_single', 'z_int16', 'z_uint8', 'dx_complex_int16']) {
        expect([file, name, entry(root, name).className]).toEqual([file, name, meta(name).class]);
      }
      for (const name of ['z_int16_vec', 'z_int8_vec']) {
        const elements = entry(root, name).children;
        expect(elements.length, name).toBe(2);
        expect(elements.map((e: any) => [e.className, e.toRow().Class]), `${file} ${name}`).toEqual(
          elements.map(() => [meta(name).class, browser(name).Class]),
        );
      }
    }
  });

  it("and where a file does not hold the attribute, the Class is the file's", () => {
    // MATLAB's own spelling of each, which says nothing of sparse or complex.
    const text = JSON.parse(readFileSync(here('dispcat_text.sldd'), 'utf8'));
    const entries = text.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const valueOf = (name: string): unknown => entries.find((e: any) => e.name === name).value;
    expect(NOT_HELD['dispcat_text.sldd'].map((name) => [name, valueOf(name)])).toEqual([
      ['dx_complex_0x0', []],
      ['dx_complex_1x0', []],
      ['dx_complex_int16_1x0', { _type: 'int16', _value: '[]' }],
      ['e_single_complex_1x0', { _type: 'single', _value: '[]' }],
      ['dx_sparse_0x0', []],
      ['dx_sparse_2x0', []],
      ['e_sparse_logical_0x0', { _type: 'logical', _value: '[]' }],
      ['sp_scalar', 5],
      ['sp_logical_scalar', true],
    ]);
    const binary = chunkOf(bytes('dispcat_bin.sldd'));
    const tagOf = (name: string): string =>
      new RegExp(`<P Name="Name" Class="char">${name}</P>[\\s\\S]*?(<P Name="Value"[^\\n]*)`).exec(binary)![1];
    expect(NOT_HELD['dispcat_bin.sldd'].map(tagOf)).toEqual([
      '<P Name="Value" Class="double">5.0</P>',
      '<P Name="Value" Class="logical">1</P>',
    ]);
  });
});

// Under the same ruling: every empty shows as the browser shows it. Every numeric empty, of
// any class, shape and complexity, is `[ ]`, and so is an int-backed enumeration's; a char
// empty is `''` and a `""` scalar `""`; a 0x0 cell is `{}`. A cell of any other empty shape, an
// empty string array, an empty logical and an empty OnOffSwitchState show the browser's
// size-and-class summary, in this package's angle form (`{0×3 cell}` is `<0x3 cell>`,
// `0×0 string` is `<0x0 string>`; MATLAB's own spelling of a summary is not ruled).
describe("an empty shows as MATLAB's Workspace browser shows it", () => {
  /** MATLAB's Value text in this package's spelling: a summary in angle brackets, with an x. */
  const ours = (row: BrowserRow): string =>
    row.IsSummary ? '<' + row.Value.replace(/^\{(.*)\}$/, '$1').replace(/×/g, 'x') + '>' : row.Value;
  const isEmpty = (name: string): boolean => META.get(name)!.size.includes(0) || name === 'dx_string_empty_1x1';

  // Not compared, each for a reason of its own:
  //  - a text dictionary writes every shaped empty as [] and MATLAB reads it back 0x0, so the
  //    1x0 and 0x3 ones and the sparse logical are 0x0 and dense in that file (pinned below);
  //  - a sparse double's empty, `[ ]` in the browser, is `<0x0 sparse double>` here: the sparse
  //    summary at every size is pinned by tests this change does not overturn;
  //  - a binary dictionary's OnOffSwitchState is an MCOS stream whose size is not decoded
  //    (`<1x1 …>`), and its int-backed enumerations' empties are enumeration values
  //    (ObjectNode), shown `<0x0 DispColor>` where the browser shows `[ ]`.
  const NOT_COMPARED: Record<string, string[]> = {
    'dispcat.mat': ['dx_sparse_0x0', 'dx_sparse_2x0'],
    'dispcat_text.sldd': ['dx_enum_1x0', 'dx_logical_1x0', 'dx_struct_1x0', 'e_logical_0x3', 'e_sparse_logical_0x0'],
    'dispcat_bin.sldd': ['dx_sparse_0x0', 'dx_sparse_2x0', 'dx_enum_0x0', 'dx_enum_1x0', 'en_sl_empty', 'en_i32_empty'],
  };

  for (const file of ['dispcat.mat', 'dispcat_text.sldd', 'dispcat_bin.sldd']) {
    it(file, () => {
      const { root } = open(file);
      const names = [...BROWSER.keys()].filter((n) => isEmpty(n) && !NOT_COMPARED[file].includes(n));
      const inFile = new Set(entriesOf(root).map((n) => n.name));
      const held = names.filter((n) => inFile.has(n));
      expect(held.length, file).toBeGreaterThan(18);
      expect(held.map((n) => [n, entry(root, n).toRow().Value])).toEqual(held.map((n) => [n, ours(browser(n))]));
    });
  }

  it("and a text dictionary's shaped empty is the 0x0 the file holds", () => {
    const text = JSON.parse(readFileSync(here('dispcat_text.sldd'), 'utf8'));
    const entries = text.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const valueOf = (name: string): unknown => entries.find((e: any) => e.name === name).value;
    expect(['dx_logical_1x0', 'e_logical_0x3', 'e_sparse_logical_0x0'].map(valueOf)).toEqual(
      Array(3).fill({ _type: 'logical', _value: '[]' }),
    );
    const { root } = open('dispcat_text.sldd');
    expect(['dx_logical_1x0', 'e_logical_0x3', 'e_sparse_logical_0x0', 'dx_enum_1x0', 'dx_struct_1x0'].map((n) => entry(root, n).toRow().Value)).toEqual([
      '<0x0 logical>', '<0x0 logical>', '<0x0 logical>', '<0x0 OnOffSwitchState>', '<0x0 struct>',
    ]);
  });

  it("a binary dictionary's empty string array is the array, written back as MATLAB wrote it", () => {
    const { session, root } = open('dispcat_bin.sldd');
    for (const name of ['dx_string_0x0', 'dx_string_1x0', 'str_0x3']) {
      const node = entry(root, name);
      expect([name, node.className, node.dims, node.children.length]).toEqual([name, 'string', meta(name).size, 0]);
    }
    expect(chunkOf(session.serializeSource(root.name).bytes)).toBe(chunkOf(bytes('dispcat_bin.sldd')));
  });
});

// P1 of the 2026-10-16 list ("a text `Vector(N)` row reads as one `0`/`false`. MATLAB reads it
// as 1×N"). A text dictionary writes a row of ten or more elements under a `Vector(N)` header,
// `{"_type": "int8", "_value": "Vector(10)\n[1, 2, …, 10]"}`, and it was read as one scalar of
// its class: the header is no number, so i8_1x10 showed `0` and l_1x10 `false`, at 1x1, with no
// element rows, and was editable as that scalar. MATLAB reads the file back as the 1xN row it
// saved (text_readback.truth.json), and the .mat and the binary dictionary read the same value
// as that row.
describe("a text dictionary's Vector(N) row is the 1xN row MATLAB reads back", () => {
  const VECTOR = ['i8_1x10', 'i8_1x11', 'l_1x10', 'l_1x11'];
  interface Readback { name: string; equal: boolean; classAfter: string; sizeAfter: number[] }
  const READBACK = new Map((JSON.parse(readFileSync(here('text_readback.truth.json'), 'utf8')) as Readback[]).map((r) => [r.name, r]));
  const textEntries = (): any[] =>
    JSON.parse(readFileSync(here('dispcat_text.sldd'), 'utf8')).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;

  it('the file holds each under a Vector(N) header', () => {
    const held = VECTOR.map((name) => textEntries().find((e: any) => e.name === name).value._value.split('\n')[0]);
    expect(held).toEqual(VECTOR.map((name) => `Vector(${meta(name).size[1]})`));
  });

  for (const name of VECTOR) {
    it(`${name}: its class, size and elements, as MATLAB reads the file back and as the other files hold it`, () => {
      const rb = READBACK.get(name)!;
      expect([rb.equal, rb.classAfter, rb.sizeAfter], 'MATLAB reads back the value it saved').toEqual([true, meta(name).class, meta(name).size]);
      const text = entry(open('dispcat_text.sldd').root, name);
      expect([text.className, text.dims, text.children.length]).toEqual([rb.classAfter, rb.sizeAfter, rb.sizeAfter[1]]);
      for (const file of ['dispcat.mat', 'dispcat_bin.sldd']) {
        const other = entry(open(file).root, name);
        expect([file, text.toRow().Value, text.valueEditable]).toEqual([file, other.toRow().Value, other.valueEditable]);
        expect(text.children.map((c: any) => c.displayValue), file).toEqual(other.children.map((c: any) => c.displayValue));
      }
    });
  }

  it('written back as the file holds it, untouched, and as a row once an element is edited', () => {
    const { session, root } = open('dispcat_text.sldd');
    const saved = (s: any): any[] =>
      JSON.parse(s.serializeSource(root.name).text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const valueOf = (entries: any[], name: string): unknown => entries.find((e: any) => e.name === name).value;
    for (const name of VECTOR) {
      expect(valueOf(saved(session), name), name).toEqual(valueOf(textEntries(), name));
    }
    const node = entry(root, 'i8_1x10');
    session.setActive(root, node.children[2]);
    expect(session.editProperty(node.children[2].id, 'Value', '30')).toBe(true);
    const reopened = createSession();
    const again = ingest(reopened, buffer(new TextEncoder().encode(session.serializeSource(root.name).text)), { filename: 'dispcat_text.sldd' });
    const back = entry(again, 'i8_1x10');
    expect([back.className, back.dims, back.toRow().Value]).toEqual(['int8', [1, 10], '[1 2 30 4 5 6 7 8 9 10]']);
  });
});

// P5 of the 2026-10-16 list ("a dictionary cell holding an object shows the object's Value
// (`{1}`), and editing it silently replaces the object"). A cell's literal spelled each element
// by its own displayValue, and a Simulink.Parameter's is its Value (the kept H1 ruling: its row
// shows its value), so {Simulink.Parameter(1)} showed `{1}`, as {1} does, and took an editor
// seeded with that text: `{2}` committed became a cell holding the double 2, the Parameter gone.
// MATLAB's browser shows `[1×1 Simulink.Parameter]` for it; here the element is spelled as every
// object is, by its size-and-class summary, and a cell showing a summary is not edited whole.
describe('a dictionary cell holding an object spells the object, not its Value', () => {
  /** MATLAB's text for the one element of a 1x1 cell, in this package's summary spelling. */
  const element = (row: BrowserRow): string => row.Value.replace(/^\[(.*)\]$/, '<$1>').replace(/×/g, 'x');

  for (const file of ['dispcat_text.sldd', 'dispcat_bin.sldd']) {
    it(`${file}: cell_of_param shows its Parameter, and cell_1 its double`, () => {
      const { root } = open(file);
      const param = entry(root, 'cell_of_param');
      expect(param.children.map((c: any) => c.className)).toEqual(['Simulink.Parameter']);
      expect(element(browser('cell_of_param'))).toBe('<1x1 Simulink.Parameter>');
      expect([param.toRow().Value, param.valueEditable]).toEqual(['{' + element(browser('cell_of_param')) + '}', false]);
      expect(param.displayElements()).toEqual([{ label: param.children[0].displayName, value: '<1x1 Simulink.Parameter>' }]);
      // The cell of the double the Parameter's Value is shows that double, editable, as before.
      const one = entry(root, 'cell_1');
      expect([one.toRow().Value, one.valueEditable]).toEqual(['{' + browser('cell_1').Value + '}', true]);
    });

    it(`${file}: an edit of the whole cell is refused and the Parameter stays`, () => {
      const { session, root } = open(file);
      const before = session.serializeSource(root.name).bytes;
      const param = entry(root, 'cell_of_param');
      session.setActive(root, param);
      expect(session.editProperty(param.id, 'Value', '{2}')).toMatchObject({ error: true });
      expect(param.setProperty('Value', '{2}')).toMatchObject({ error: true });
      expect(param.children.map((c: any) => [c.className, c.toRow().Value])).toEqual([['Simulink.Parameter', '1']]);
      expect(session.canUndo()).toBe(false);
      expect(session.serializeSource(root.name).bytes).toEqual(before);
    });
  }
});

// P7 of the 2026-10-16 list ("control characters reach the cell raw (`'a<LF>b'` reads as
// `'a b'`)"). The Value of a char or string holding a newline, a tab or a NUL put the raw
// character between the quotes, and the host draws a one-line cell (white-space: nowrap), so
// 'a<LF>b' and 'a<TAB>b' looked like 'a b' and 'a<NUL>b' like 'ab'. MATLAB's browser is lossy
// too ('ab', 'a\tb', 'a b'). Each is spelled as the concatenation MATLAB evaluates to it, and
// that text, which seeds the editor, reads back as the value.
describe('a char or string holding a control character shows it as MATLAB spells one', () => {
  const SHOWN: Record<string, string> = {
    c_newline: "['a' newline 'b']",
    c_tab: "['a' char(9) 'b']",
    c_nul: "['a' char(0) 'b']",
    str_newline: '"a" + newline + "b"',
  };
  // What MATLAB holds: class() and size(), and the text, from mat2str (a char) or disp (a string).
  const held = (name: string): string =>
    meta(name).class === 'char' ? (MatlabValueParser.parse((meta(name) as any).mat2str)!.value as string) : (meta(name) as any).disp;

  for (const file of ['dispcat.mat', 'dispcat_text.sldd', 'dispcat_bin.sldd']) {
    const names = Object.keys(SHOWN).filter((n) => file !== 'dispcat.mat' || meta(n).class === 'char');
    it(`${file}: ${names.join(', ')}`, () => {
      const { root } = open(file);
      expect(names.map(held)).toEqual(names.map((n) => (n === 'c_tab' ? 'a\tb' : n === 'c_nul' ? 'a\u0000b' : 'a\nb')));
      for (const name of names) {
        const node = entry(root, name);
        const shown = node.toRow().Value;
        expect([name, node.className, node.dims, shown]).toEqual([name, meta(name).class, meta(name).size, SHOWN[name]]);
        expect(/[\u0000-\u001f\u007f-\u009f]/.test(shown), name).toBe(false);
        expect(MatlabValueParser.parse(shown), name).toEqual({ type: meta(name).class, value: held(name) });
      }
    });
  }

  it('the text it shows commits as no edit, and an edit of it is the value edited', () => {
    for (const file of ['dispcat_text.sldd', 'dispcat_bin.sldd']) {
      const { session, root } = open(file);
      for (const name of Object.keys(SHOWN)) {
        const node = entry(root, name);
        session.setActive(root, node);
        expect(session.editProperty(node.id, 'Value', SHOWN[name]), `${file} ${name}`).toBe(true);
        expect(session.canUndo(), `${file} ${name}`).toBe(false);
      }
      const c = entry(root, 'c_newline');
      session.setActive(root, c);
      expect(session.editProperty(c.id, 'Value', "['a' newline 'c' char(9)]")).toBe(true);
      const s = entry(root, 'str_newline');
      session.setActive(root, s);
      expect(session.editProperty(s.id, 'Value', '"x" + newline + "y"')).toBe(true);
      const saved = session.serializeSource(root.name);
      const again = ingest(createSession(), buffer(saved.bytes ?? new TextEncoder().encode(saved.text)), { filename: file });
      expect([entry(again, 'c_newline').toRow().Value, entry(again, 'str_newline').toRow().Value], file).toEqual([
        "['a' newline 'c' char(9)]",
        '"x" + newline + "y"',
      ]);
    }
  });
});

// P8 of the 2026-10-16 list ("a text `null` value reads as `0`"). MATLAB could not save
// str_2x2x2, a 2x2x2 string, into a text dictionary ("Cannot save the value of parameter
// "MxData" because it uses an unsupported data format") and wrote `"value": null`, which it
// reads back as a 1x0 double (text_readback.truth.json). MatlabVariableNode.parseScalar read the
// null as the double 0, a value the file does not hold, shown `0` and editable. The entry, as
// MATLAB wrote it, is dispcat_text.null.json, put back into the dictionary here (see
// trim-display-fixtures.mjs's TEXT_NULL for why it is kept beside it).
describe("a text dictionary's null value is the empty MATLAB reads back, and says so", () => {
  interface Readback { name: string; equal: boolean; classAfter: string; sizeAfter: number[] }
  const rb = (JSON.parse(readFileSync(here('text_readback.truth.json'), 'utf8')) as Readback[]).find((r) => r.name === 'str_2x2x2')!;
  const withNull = (): { session: any; root: any; written: any[] } => {
    const text = JSON.parse(readFileSync(here('dispcat_text.sldd'), 'utf8'));
    const written = JSON.parse(readFileSync(here('dispcat_text.null.json'), 'utf8'));
    text.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.push(...written);
    const session = createSession();
    const root: any = ingest(session, buffer(new TextEncoder().encode(JSON.stringify(text, null, '\t'))), { filename: 'dispcat_text.sldd' });
    return { session, root, written };
  };

  it('str_2x2x2 reads as a 1x0 double, shown as every numeric empty is, with a warning', () => {
    const { root, written } = withNull();
    expect(written.map((e: any) => [e.name, e.value])).toEqual([['str_2x2x2', null]]);
    expect([rb.equal, rb.classAfter, rb.sizeAfter]).toEqual([false, 'double', [1, 0]]);
    const node = entry(root, 'str_2x2x2');
    expect([node.className, node.dims, node.children.length, node.toRow().Value]).toEqual([rb.classAfter, rb.sizeAfter, 0, '[ ]']);
    expect(node.toRow().Value).toBe(browser('dx_double_1x0').Value);
    // One warning, for the one null in the file, and none for the dictionary without it.
    expect((root.warnings || []).map((w: any) => [w.code, w.part])).toEqual([['part-unreadable', 'str_2x2x2']]);
    expect(root.warnings[0].message).toContain('has no value in the file');
    expect(open('dispcat_text.sldd').root.warnings).toBeUndefined();
  });

  it('written back as the null the file holds, untouched', () => {
    const { session, root } = withNull();
    const saved = JSON.parse(session.serializeSource(root.name).text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    expect(saved.find((e: any) => e.name === 'str_2x2x2').value).toBeNull();
  });
});
