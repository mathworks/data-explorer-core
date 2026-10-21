// Copyright 2026 The MathWorks, Inc.
//
// An edit of a MAT-file object's property, made through the session as a host makes one (its
// editProperty on the object's typed node) and saved (serializeSource), is written into the value
// cells of the subsystem that hold it, and nowhere else: held to edits MATLAB R2027a judged.
//
//   - test/fixtures/mat-cellswap: the originals and their swapped mutants of the cell-swap probe
//     (cellswap.truth.json). Each edit the session can make is the mutant's subsystem, byte for byte.
//   - test/fixtures/mat-allowlist: the allow-list probe's 257 cases (allowlist.truth.json). Each a
//     host can type is, where MATLAB passed the swap, the subsystem MATLAB passed, byte for byte, and
//     where MATLAB warned or refused, an edit the session refuses. Each one only a value of a typed
//     class makes (`int16(-4)`, which no editor of this package types) is held to the same bytes
//     through the rules and the editor beneath the session.
//   - then each refusal in its words, and every placement: a struct field, a cell, an object
//     array's element, a handle two variables share, the variable's own record as it was read.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { subsystemElementOf, variableDifference } from '../src/datamodel/parser/MatFileWriter.js';
import { cellValueAt, editMcosObjects, objectIdOf, readMcosSubsystem, storedProperties, valueCellOf } from '../src/datamodel/parser/McosSubsystemEdit.js';
import type { McosSubsystem } from '../src/datamodel/parser/McosSubsystemEdit.js';
import { objectEditCells, type McosHeld } from '../src/datamodel/parser/McosEditRules.js';
import { checkMatFile } from '../src/datamodel/parser/MatFileCheck.js';
import { mcosPlaceOf } from '../src/datamodel/node/mcosPlace.js';

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));
const CELLSWAP = join(TEST_ROOT, 'fixtures', 'mat-cellswap');
const ALLOWLIST = join(TEST_ROOT, 'fixtures', 'mat-allowlist');

const bufferOf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const read = (dir: string, file: string) => new Uint8Array(readFileSync(join(dir, file)));
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A MAT-file opened through the session, as a host opens one, and what a host does to it. */
function opened(bytes: Uint8Array, name = 'f.mat') {
  const session = createSession();
  const root: any = session.addMatSource(name, bufferOf(bytes));
  const by = (n: string) => root.children.find((c: any) => c.name === n);
  const all = (): any[] => {
    const out: any[] = [];
    const walk = (n: any) => {
      out.push(n);
      n.children.forEach(walk);
    };
    walk(root);
    return out;
  };
  // The node of the object at a MATLAB path (`s.p`, `c{1}`, `arr(2)`).
  const object = (path: string) => all().find((n) => mcosPlaceOf(n) && n.matlabPath === path);
  const edit = (node: any, prop: string, value: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, prop, value);
  };
  const save = (): Uint8Array => (session.serializeSource(name) as { bytes: Uint8Array }).bytes;
  return { session, root, by, object, edit, save };
}

/** The subsystem element of a MAT-file's bytes, inflated. */
function subsystemOf(bytes: Uint8Array): Uint8Array {
  const parsed = parseMat(bufferOf(bytes));
  return subsystemElementOf(parsed.records.find((r) => r.offset === parsed.subsystemOffset)!)!;
}

/** Every record but the subsystem, as its bytes, by name. */
function variableRecords(bytes: Uint8Array): [string | null, Uint8Array][] {
  const parsed = parseMat(bufferOf(bytes));
  return parsed.records.filter((r) => r.offset !== parsed.subsystemOffset).map((r) => [r.name, r.bytes]);
}

function thrownBy(fn: () => unknown): Error | null {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  return null;
}

/**
 * What a save of an edit must keep: every variable's record the bytes it was read as, the
 * subsystem's compression, and nothing the strict checker finds that the original did not hold.
 */
function expectOnlyTheSubsystemChanged(original: Uint8Array, saved: Uint8Array, label: string) {
  const was = variableRecords(original);
  const is = variableRecords(saved);
  expect(is.map(([n]) => n), label).toEqual(was.map(([n]) => n));
  is.forEach(([n, bytes], i) => expect(sameBytes(bytes, was[i][1]), label + ': ' + n + "'s record").toBe(true));
  const compressed = (b: Uint8Array) => parseMat(bufferOf(b)).records.map((r) => r.compressed);
  expect(compressed(saved), label).toEqual(compressed(original));
  expect(checkMatFile(saved).length, label).toBe(checkMatFile(original).length);
}

// ---- The cell-swap probe -------------------------------------------------------------------------

interface CellswapCase {
  name: string;
  original: string;
  mutant: string;
  path: string;
  edits: { savedName: string }[];
  matlab: string | null;
}
const CELLSWAP_TRUTH: { cases: CellswapCase[] } = JSON.parse(readFileSync(join(CELLSWAP, 'cellswap.truth.json'), 'utf8'));

// What a host types for each case whose edit this package's editor makes: the property and text.
// The others are a Value of a typed class, which no editor types (`int16(-4)`, `single(3.5)`), or a
// pair of cells a single edit makes neither of (the Value alone, resized, with no Dimensions; a
// DataType on its own).
const CELLSWAP_EDITS: Record<string, [string, string]> = {
  basic_same_class: ['Value', '7'],
  basic_v6: ['Value', '7'],
  resize_value_and_dims: ['Value', '[1 2 3; 4 5 6]'],
  class_logical: ['Value', 'true'],
  complex_value_only: ['Value', '1+2i'],
  typed_description: ['Description', 'new description'],
  typed_max: ['Max', '100'],
  typed_unit: ['Unit', 'km'],
  nested_struct: ['Value', '9'],
  nested_cell: ['Value', '9'],
  nested_array: ['Value', '22'],
  shared_handle: ['Value', '7'],
  zero_value: ['Value', '5'],
};

describe('the cell-swap probe: an edit through the session is the subsystem MATLAB judged', () => {
  for (const c of CELLSWAP_TRUTH.cases) {
    const typed = CELLSWAP_EDITS[c.name];
    if (!typed) {
      continue;
    }
    it(`${c.name}: ${c.path}.${typed[0]} = ${typed[1]}`, () => {
      expect(c.matlab).toBe('PASS');
      const original = read(CELLSWAP, c.original);
      const { object, edit, save } = opened(original);
      expect(edit(object(c.path), typed[0], typed[1])).toBe(true);
      const saved = save();
      expect(sameBytes(subsystemOf(saved), subsystemOf(read(CELLSWAP, c.mutant)))).toBe(true);
      expectOnlyTheSubsystemChanged(original, saved, c.name);
      // And what this package reads of it again is the edit.
      const again = opened(saved).object(c.path);
      expect(typed[0] === 'Value' ? again.displayValue : again.getPropInfo(again.getProperties().find((p: any) => p.key === typed[0])).displayValue).toBe(
        object(c.path).getPropInfo(object(c.path).getProperties().find((p: any) => p.key === typed[0])).displayValue,
      );
    });
  }

  it('the edits it does not take: a Signal InitialValue (no editor), a Value at its default, a DataType', () => {
    const signal = opened(read(CELLSWAP, 'pv_signal.mat'));
    expect(signal.edit(signal.object('sig'), 'InitialValue', '4')).toMatchObject({ error: true, reason: 'Cannot edit "sig": sig.InitialValue is not one this package edits in a Simulink.Signal.' });
    const atDefault = opened(read(CELLSWAP, 'pv_default.mat'));
    expect(atDefault.edit(atDefault.object('d'), 'Value', '5')).toMatchObject({
      error: true,
      reason: 'Cannot edit "d": d.Value is at its class default: the file holds no value for it, and a save can replace only a value the file holds.',
    });
    const typed = opened(read(CELLSWAP, 'pv_typed.mat'));
    expect(typed.edit(typed.object('t'), 'DataType', 'double')).toMatchObject({
      error: true,
      reason: 'Cannot edit "t": t.DataType follows its Value, and is written only with it: set on its own, MATLAB converts a Value that is not double to double on every load.',
    });
    for (const { root, save } of [signal, atDefault, typed]) {
      expect(root.dirty).toBe(false);
      expect(thrownBy(save)).toBeNull();
    }
  });
});

// ---- The allow-list probe ------------------------------------------------------------------------

interface AllowlistCase {
  name: string;
  original: string;
  edits: { path: string; prop: string; expr: string }[];
  variant: string;
  matlab: 'PASS' | 'FAIL' | 'INFO' | 'NOSWAP';
  subsystemSha256: string | null;
}
const ALLOWLIST_TRUTH: { cases: AllowlistCase[] } = JSON.parse(readFileSync(join(ALLOWLIST, 'allowlist.truth.json'), 'utf8'));

const TEXT_PROPERTIES = new Set(['Description', 'Unit', 'InitialValue', 'DataType']);

/** MATLAB's text `expr` as the string it is: `'it''s'`, or `char([codes])`. */
function textOf(expr: string): string | null {
  const quoted = /^'((?:[^']|'')*)'$/.exec(expr);
  if (quoted) {
    return quoted[1].replace(/''/g, "'");
  }
  const codes = /^char\(\[([\d ]+)\]\)$/.exec(expr);
  return codes ? String.fromCharCode(...codes[1].trim().split(/\s+/).map(Number)) : null;
}

/** What a host types for MATLAB's `prop = expr`, or null where no editor of this package types it. */
function typedText(prop: string, expr: string): string | null {
  if (TEXT_PROPERTIES.has(prop)) {
    return textOf(expr);
  }
  return /^(?:u?int\d+|single|logical|zeros|reshape|struct)\(/.test(expr) ? null : expr;
}

// ---- MATLAB's typed literals, as the variables they are, for the cases no editor types ----

const mat = (className: string, value: unknown, dimensions: number[], more: Partial<MatVariable> = {}): MatVariable => ({
  name: '',
  className,
  dimensions,
  isComplex: false,
  isLogical: false,
  value,
  fields: null,
  ...more,
});

/** Column-major values as a variable holds them: row-major within each page. */
function rowMajor(values: unknown[], dims: number[]): unknown[] {
  const [rows, cols] = dims;
  const page = rows * cols;
  const out: unknown[] = [];
  for (let p = 0; p < values.length / page; p++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push(values[p * page + c * rows + r]);
      }
    }
  }
  return out;
}

/** The numbers of a MATLAB literal: `5`, `1+2i`, `[1 2 3]`, `[1 3;2 4]`, `[]`, `reshape(1:N, d…)`, `zeros(1,0)`. */
function literal(text: string): { values: unknown[]; dims: number[]; complex: boolean } {
  const reshape = /^reshape\(1:(\d+),([\d,]+)\)$/.exec(text);
  if (reshape) {
    const dims = reshape[2].split(',').map(Number);
    return { values: rowMajor(Array.from({ length: Number(reshape[1]) }, (_, i) => i + 1), dims), dims, complex: false };
  }
  if (text === 'zeros(1,0)') {
    return { values: [], dims: [1, 0], complex: false };
  }
  const rows = text.startsWith('[') ? (text.slice(1, -1).trim() === '' ? [] : text.slice(1, -1).split(';').map((r) => r.trim().split(/\s+/))) : [[text]];
  const tokens = rows.flat();
  const complex = tokens.some((t) => t.endsWith('i'));
  // An element `a+bi`, `a-bi`; of a complex array, a real one is `a+0i`.
  const element = (t: string) => {
    const parts = /^(-?[\d.]+)([+-][\d.]+)i$/.exec(t);
    return !complex ? Number(t) : parts ? { re: Number(parts[1]), im: Number(parts[2]) } : { re: Number(t), im: 0 };
  };
  return { values: tokens.map(element), dims: rows.length === 0 ? [0, 0] : [rows.length, rows[0].length], complex };
}

/** The variable MATLAB's `expr` makes, of the typed forms the allow-list probe uses. */
function variableOf(expr: string): MatVariable {
  const struct = /^struct\((.*)\)$/.exec(expr);
  if (struct) {
    const fields: Record<string, MatVariable> = {};
    const parts = struct[1].match(/'[^']*'|[^,[]+\([^)]*\)|\[[^\]]*\]|[^,]+/g)!;
    for (let i = 0; i < parts.length; i += 2) {
      fields[parts[i].slice(1, -1)] = variableOf(parts[i + 1].trim());
    }
    return mat('struct', null, [1, 1], { fields });
  }
  const typed = /^(u?int\d+|single|logical)\((.*)\)$/.exec(expr);
  const cls = typed ? typed[1] : 'double';
  const { values, dims, complex } = literal(typed ? typed[2] : expr);
  const value = values.length === 1 ? values[0] : values;
  return cls === 'logical' ? mat('uint8', value, dims, { isLogical: true }) : mat(cls, value, dims, { isComplex: complex });
}

/** What the subsystem holds of the object at `path` of `bytes`, as the rules read it. */
function heldAt(bytes: Uint8Array, subsystem: McosSubsystem, path: string) {
  const node = opened(bytes).object(path);
  const place = mcosPlaceOf(node)!;
  const objectId = objectIdOf(place.variable.mcosHandle, place.index)!;
  const stored = storedProperties(subsystem, objectId);
  if (!stored.ok) {
    throw new Error(stored.message);
  }
  const map = new Map<string, McosHeld>();
  for (const p of stored.properties) {
    map.set(p.savedName, { refusal: p.refusal, value: p.cellIndex === null ? null : cellValueAt(subsystem, p.cellIndex) });
  }
  return { objectId, held: { className: stored.className, stored: map } };
}

/**
 * The subsystem the rules and the editor beneath the session write for `edits`, or the first
 * refusal: what a save writes for the same edits, made by a host that could type their values.
 */
function writtenBeneath(original: Uint8Array, edits: AllowlistCase['edits']): Uint8Array | string {
  const read = readMcosSubsystem(subsystemOf(original));
  if (!read.ok) {
    throw new Error(read.message);
  }
  const objects: { objectId: number; edits: { savedName: string; cell: Uint8Array }[] }[] = [];
  for (const path of [...new Set(edits.map((e) => e.path))]) {
    const { objectId, held } = heldAt(original, read.subsystem, path);
    const mine = edits
      .filter((e) => e.path === path)
      .map((e) => {
        const text = TEXT_PROPERTIES.has(e.prop) ? textOf(e.expr) : null;
        return { property: e.prop, value: text !== null ? mat('char', text, text === '' ? [0, 0] : [1, text.length]) : variableOf(e.expr) };
      });
    const ruled = objectEditCells(held, mine, path);
    if (!ruled.ok) {
      return ruled.message;
    }
    objects.push({ objectId, edits: ruled.cells.map((c) => ({ savedName: c.savedName, cell: valueCellOf(c.value) })) });
  }
  const written = editMcosObjects(read.subsystem, objects);
  return written.ok ? written.bytes : written.message;
}

// Where this package's cells are not the probe's bytes, and load as them all the same, by case: a
// struct's field-name table (MatWriter pads a name to 5 bytes, the probe's writer to 2, MATLAB to
// 3; all load) and text MATLAB writes as miUTF16, which this package writes as miUTF8 (both load,
// the probe measured). Each is compared by what its cells read as, against the swapped file MATLAB
// passed, kept beside its original.
const DECODED_ONLY: Record<string, string> = {
  g3_struct_leaf: "a struct's field names",
  g3_struct_resize_field: "a struct's field names",
  g3_struct_typed_field: "a struct's field names",
  g3_struct_from_numeric: "a struct's field names",
  r2_struct_into_typed: "a struct's field names",
  r2_signal_unit_nonascii: 'miUTF16 text',
};

/** Where the cells of `ours` read as other values than those of `theirs`, or null. */
function cellsReadDifferently(ours: Uint8Array, theirs: Uint8Array): string | null {
  const a = readMcosSubsystem(ours);
  const b = readMcosSubsystem(theirs);
  if (!a.ok || !b.ok || a.subsystem.cells.length !== b.subsystem.cells.length) {
    return 'not one table of cells';
  }
  for (let i = 0; i < a.subsystem.cells.length; i++) {
    const difference = variableDifference(cellValueAt(b.subsystem, i), cellValueAt(a.subsystem, i), 'cell ' + i);
    if (difference) {
      return difference;
    }
  }
  return null;
}

describe("the allow-list probe: each case MATLAB judged, as a save writes it", () => {
  let sessionBytes = 0;
  let beneathBytes = 0;
  let refusedAtEdit = 0;
  for (const c of ALLOWLIST_TRUTH.cases) {
    const texts = c.edits.map((e) => typedText(e.prop, e.expr));
    const label = c.name + ': ' + c.edits.map((e) => `${e.path}.${e.prop} = ${e.expr}`).join(', ') + ' (MATLAB: ' + c.matlab + ')';
    // A Signal's InitialValue and Dimensions have no editor in this package (SignalNode); a complex
    // matrix is no literal its parser reads. Their cells are the rules', held below.
    const typedByHost =
      texts.every((t) => t !== null) &&
      !c.edits.some((e) => e.prop === 'InitialValue' || e.prop === 'Dimensions' || (/i/.test(e.expr) && e.expr.startsWith('[')));
    it(label, () => {
      const original = read(ALLOWLIST, c.original);
      if (typedByHost) {
        const { object, edit, save } = opened(original);
        const answers = c.edits.map((e, i) => edit(object(e.path), e.prop, texts[i]!));
        if (c.matlab === 'PASS') {
          expect(answers).toEqual(c.edits.map(() => true));
          const saved = save();
          const ours = subsystemOf(saved);
          if (DECODED_ONLY[c.name]) {
            expect(cellsReadDifferently(ours, subsystemOf(read(ALLOWLIST, 'mut_' + c.name + '.mat')))).toBeNull();
          } else {
            expect(sha(ours)).toBe(c.subsystemSha256);
          }
          expectOnlyTheSubsystemChanged(original, saved, c.name);
          sessionBytes++;
        } else if (answers.every((a) => a === true)) {
          // MATLAB's one FAIL that is no edit: the value the object already holds, typed again.
          expect(c.name).toBe('g2_tB_lgc');
          expect(sameBytes(save(), original)).toBe(true);
        } else {
          // Refused before it is made: the file is as it was read.
          expect(answers.find((a) => a !== true)).toMatchObject({ error: true });
          expect(sameBytes(save(), original)).toBe(true);
          refusedAtEdit++;
        }
        return;
      }
      const written = writtenBeneath(original, c.edits);
      if (c.matlab === 'PASS') {
        expect(typeof written === 'string' ? written : null).toBeNull();
        if (DECODED_ONLY[c.name]) {
          expect(cellsReadDifferently(written as Uint8Array, subsystemOf(read(ALLOWLIST, 'mut_' + c.name + '.mat')))).toBeNull();
        } else {
          expect(sha(written as Uint8Array)).toBe(c.subsystemSha256);
        }
        beneathBytes++;
      } else {
        expect(typeof written, 'refused by the rules').toBe('string');
      }
    });
  }

  it('holds most cases to the bytes, through the session where a host can type the edit', () => {
    expect([sessionBytes, beneathBytes, refusedAtEdit]).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
    expect(sessionBytes).toBeGreaterThanOrEqual(140);
    expect(sessionBytes + beneathBytes).toBeGreaterThanOrEqual(210);
    expect(refusedAtEdit).toBeGreaterThanOrEqual(30);
  });
});

// ---- Each refusal, in its words, through the session --------------------------------------------

describe('what the session refuses of an object in a MAT-file, before the edit is made', () => {
  const refusal = (name: string, why: string) => ({ error: true, reason: 'Cannot edit "' + name + '": ' + why + '.' });
  const WARNS = ', which MATLAB loads with a warning on every load';

  it('a property at its class default, which the file holds no value for', () => {
    const { object, edit, root } = opened(read(ALLOWLIST, 'al_text.mat'));
    expect(edit(object('xe'), 'Description', 'abc')).toMatchObject(
      refusal('xe', 'xe.Description is at its class default: the file holds no value for it, and a save can replace only a value the file holds'),
    );
    expect(object('xe').getPropInfo(object('xe').getProperties().find((p: any) => p.key === 'Description')).editable).toBe(false);
    expect(root.dirty).toBe(false);
  });

  it('a Complexity, a StorageClass, a Dimensions, a DataType on its own', () => {
    const { object, edit, root } = opened(read(ALLOWLIST, 'al_dtype.mat'));
    const p = object('tS');
    expect(edit(p, 'complexity', 'complex')).toMatchObject(
      refusal('tS', "tS.Complexity is held as an index into the file's text, not as a value, and MATLAB derives it from the Value as it loads"),
    );
    expect(edit(p, 'storageClass', 'ExportedGlobal')).toMatchObject(refusal('tS', 'tS.StorageClass belongs to its CoderInfo, an object of its own, which a save does not rewrite'));
    expect(edit(p, 'dimensions', '[2 3]')).toMatchObject(refusal('tS', 'tS.Dimensions follows its Value, and is written only with it'));
    expect(edit(p, 'DataType', 'int8')).toMatchObject(
      refusal('tS', 'tS.DataType follows its Value, and is written only with it: set on its own, MATLAB converts a Value that is not double to double on every load'),
    );
    expect([p.status, root.dirty]).toEqual(['', false]);
  });

  it('a Value out of the range of the DataType it keeps, typed whole or into one element', () => {
    const { object, edit, save, root } = opened(read(ALLOWLIST, 'al_dtype.mat'));
    const p = object('tUd');
    expect(edit(p, 'Value', '300')).toMatchObject(refusal('tUd', "tUd.Value would hold 300, outside the range [0, 255] of its DataType 'uint8'" + WARNS));
    expect(edit(object('tD'), 'Value', 'NaN')).toMatchObject(refusal('tD', "tD.Value would hold NaN, outside the range [-Inf, Inf] of its DataType 'double'" + WARNS));
    expect(edit(object('tBd'), 'Value', '2')).toMatchObject(refusal('tBd', "tBd.Value would hold 2, and a DataType of 'boolean' takes only 0 and 1" + WARNS));
    expect(root.dirty).toBe(false);
    // An element of a Value the DataType is kept over is held to it as well.
    expect(edit(p, 'Value', '[1 2 3]')).toBe(true);
    const element = p._valueNode.children[1];
    expect(edit(element, 'Value', '300')).toMatchObject(refusal('tUd', "tUd.Value would hold 300, outside the range [0, 255] of its DataType 'uint8'" + WARNS));
    expect(edit(element, 'Value', '200')).toBe(true);
    const again = opened(save()).object('tUd');
    expect([again.displayValue, again.DataType]).toEqual(['[1 200 3]', 'uint8']);
  });

  it('a double typed over a Value of another class makes the DataType auto, as MATLAB does, and is not held to the old one', () => {
    const { object, edit, save } = opened(read(ALLOWLIST, 'al_dtype.mat'));
    expect(edit(object('tU'), 'Value', '300')).toBe(true);
    const again = opened(save()).object('tU');
    expect([again.displayValue, again.DataType, again._valueNode?.className ?? 'double']).toEqual(['300', 'auto', 'double']);
  });

  it('a Min above its Max, a bound outside the DataType, a bound that is no finite double scalar', () => {
    const { object, edit, root } = opened(read(ALLOWLIST, 'al_minmax.mat'));
    expect(edit(object('pm'), 'Min', '20')).toEqual({ ...refusal('pm', 'pm.Min (20) would be greater than its Max (10)' + WARNS), invalidValue: '20', validValue: '0' });
    expect(edit(object('pm'), 'Max', '-5')).toMatchObject(refusal('pm', 'pm.Min (0) would be greater than its Max (-5)' + WARNS));
    expect(edit(object('pmi'), 'Max', '40000')).toMatchObject(refusal('pmi', "pmi.Max (40000) would be outside the range [-32768, 32767] of its DataType 'int16'" + WARNS));
    // The node's own rule, which mirrors MATLAB's, says the rest first.
    expect(edit(object('pm'), 'Min', '-Inf')).toMatchObject({ error: true, reason: 'Minimum must be a finite real double scalar value' });
    expect(root.dirty).toBe(false);
    // Min = Max is fine, and so is clearing one.
    expect([edit(object('pm'), 'Min', '10'), edit(object('pm'), 'Max', '')]).toEqual([true, true]);
  });

  it("a Signal's DataType a host sets: boolean under a Max of 10, a bus with bounds, what was not measured", () => {
    const { object, edit, save } = opened(read(ALLOWLIST, 'al_signal.mat'));
    const sg = object('sg');
    expect(edit(sg, 'DataType', 'boolean')).toMatchObject(refusal('sg', "sg.Max (10) would be outside the range [0, 1] of its DataType 'boolean'" + WARNS));
    expect(edit(sg, 'DataType', 'Bus: MyBus')).toMatchObject(
      refusal('sg', "sg.Min would be set while its DataType is 'Bus: MyBus', and MATLAB ignores a minimum and a maximum for a bus" + WARNS),
    );
    expect(edit(sg, 'DataType', 'auto')).toMatchObject(refusal('sg', "sg.DataType would be 'auto', which is not a data type this package writes into a Simulink.Signal"));
    expect(edit(sg, 'DataType', 'single')).toBe(true);
    expect(opened(save()).object('sg').DataType).toBe('single');
  });

  it('a part of an object no property of which it is: a bus element, an object in a struct by its name', () => {
    const cases = opened(read(TEST_ROOT, 'parity/artifacts/mat/cases.mat'));
    const element = cases.by('aBus').children[0];
    expect(cases.edit(element, 'Name', 'renamed')).toMatchObject(refusal('aBus', 'aBus is a Simulink.Bus, whose properties this package does not write into a MAT-file'));
    const nested = opened(read(ALLOWLIST, 'al_nested.mat'));
    expect(nested.object('s.p').nameEditable).toBe(false);
    expect(nested.object('s.p').setProperty('Name', 'q')).toMatchObject({ error: true });
  });

  it('two variables of one handle, edited to two values around the session', () => {
    // Through the session an edit of one is shown by both, and the other takes none of its own
    // (test/mcosObjectTwins.test.ts); one made on a node's fields asks nobody, and the save will not
    // choose between the two.
    const { object, edit, save } = opened(read(CELLSWAP, 'pv_shared.mat'));
    expect(edit(object('h'), 'Value', '7')).toBe(true);
    object('r').Value = 8;
    object('r')._markModified();
    expect([object('h').displayValue, object('r').displayValue]).toEqual(['7', '8']);
    const thrown = thrownBy(save);
    expect([thrown instanceof MatWriteError, thrown?.message]).toEqual([
      true,
      'Cannot write "r": r and h are one object, whose Value they were edited to two values of. Nothing was written.',
    ]);
  });
});

// ---- Placement ------------------------------------------------------------------------------------

describe("where the object is: an edit writes the subsystem, and the record that holds it is as it was read", () => {
  it('a struct field, a cell element, an object array element, at once, and the struct renamed', () => {
    const original = read(ALLOWLIST, 'al_nested.mat');
    const { by, object, edit, save } = opened(original);
    expect([edit(object('s.p'), 'Value', '9'), edit(object('c{3}'), 'Value', '4.5'), edit(object('arr(3)'), 'Value', '[1 2]'), edit(object('arr(3)'), 'Description', 'third')]).toEqual([
      true, true, true, true,
    ]);
    expect(edit(by('s'), 'Name', 's2')).toBe(true);
    const saved = save();
    const was = new Map(variableRecords(original));
    const is = new Map(variableRecords(saved));
    expect([...is.keys()]).toEqual([...was.keys()].map((n) => (n === 's' ? 's2' : n)));
    // The cell and the array, as read; the struct, its name replaced and nothing else.
    expect([sameBytes(is.get('c')!, was.get('c')!), sameBytes(is.get('arr')!, was.get('arr')!), sameBytes(is.get('s2')!, was.get('s')!)]).toEqual([true, true, false]);
    const again = opened(saved);
    expect(['s2.p', 'c{3}', 'arr(3)'].map((p) => again.object(p).displayValue)).toEqual(['9', '4.5', '[1 2]']);
    expect([again.object('arr(3)').Description, again.object('arr(1)').displayValue, again.object('c{1}').displayValue]).toEqual(['third', '1', '6']);
    // Each element's DataType as MATLAB's own edit leaves it: auto under a double over an int16 or a single.
    expect([again.object('s2.p').DataType, again.object('c{3}').DataType, again.object('arr(2)').DataType]).toEqual(['auto', 'auto', 'single']);
  });

  it('a handle two variables share: both load the edited object', () => {
    const original = read(CELLSWAP, 'pv_shared.mat');
    const { object, edit, save } = opened(original);
    expect(edit(object('h'), 'Value', '7')).toBe(true);
    const saved = save();
    expectOnlyTheSubsystemChanged(original, saved, 'pv_shared');
    const again = opened(saved);
    expect([again.object('h').displayValue, again.object('r').displayValue]).toEqual(['7', '7']);
  });

  it("a struct Value's field, edited where it shows, and not to text", () => {
    const original = read(ALLOWLIST, 'al_shape.mat');
    const { object, edit, save } = opened(original);
    const field = object('spB')._valueNode.children.find((c: any) => c.name === 'a');
    for (const [typed, what] of [["'x'", 'a char'], ['"x"', 'a string']]) {
      expect(edit(field, 'Value', typed), typed).toMatchObject({
        error: true,
        reason: 'Cannot edit "spB": spB.Value.a would be ' + what + ", which this package does not write into a Simulink.Parameter's Value.",
      });
    }
    expect(edit(field, 'Value', '5')).toBe(true);
    const saved = save();
    expect(cellsReadDifferently(subsystemOf(saved), subsystemOf(read(ALLOWLIST, 'mut_g3_struct_leaf.mat')))).toBeNull();
    expectOnlyTheSubsystemChanged(original, saved, 'al_shape');
  });

  it('an uncompressed (-v6) file stays uncompressed', () => {
    const original = read(CELLSWAP, 'pv_basic_v6.mat');
    const { object, edit, save } = opened(original);
    expect(edit(object('p'), 'Value', '[]')).toBe(true);
    const saved = save();
    expect(parseMat(bufferOf(saved)).records.map((r) => r.compressed)).toEqual([false, false, false, false, false]);
    expect(opened(saved).object('p').displayValue).toBe('[ ]');
  });

  it('every edit undone: the file as it was read', () => {
    const original = read(CELLSWAP, 'pv_typed.mat');
    const { session, object, edit, save } = opened(original);
    const t = object('t');
    expect([edit(t, 'Value', '7'), edit(t, 'Description', 'zz'), edit(t, 'Max', '20'), edit(t, 'Unit', 'km')]).toEqual([true, true, true, true]);
    for (let i = 0; i < 4; i++) {
      session.undo();
    }
    expect(t.status).toBe('Modified');
    expect(sameBytes(save(), original)).toBe(true);
  });

  it('an edit, its variable renamed and another deleted', () => {
    const original = read(CELLSWAP, 'pv_basic.mat');
    const { session, root, by, object, edit, save } = opened(original);
    expect([edit(object('p'), 'Value', '7'), edit(by('p'), 'Name', 'p2')]).toEqual([true, true]);
    session.setActive(root, by('q'));
    expect(session.deleteNodeById(by('q').id)).toBe(true);
    const again = opened(save());
    expect(again.root.children.map((c: any) => c.name + '=' + c.displayValue)).toEqual(['p2=7', 'str="hello"', 'x=[1 2 3]']);
  });

  it("every other object's every property reads back as it was read", () => {
    const original = read(ALLOWLIST, 'al_dtype.mat');
    const { root, object, edit, save } = opened(original);
    expect(edit(object('tI'), 'Value', '8')).toBe(true);
    const props = (n: any) => n.getProperties().map((p: any) => p.key + '=' + n.getPropInfo(p).displayValue);
    const before = opened(original).root.children.map(props);
    const after = opened(save()).root.children.map(props);
    root.children.forEach((c: any, i: number) => {
      if (c.name === 'tI') {
        expect(after[i]).not.toEqual(before[i]);
      } else {
        expect(after[i], c.name).toEqual(before[i]);
      }
    });
  });
});

describe('the subsystem a save writes anew is read again, alone, and held to what was planned', () => {
  // `t` of pv_typed.mat with its Value and Description edited, and the subsystem the save writes for
  // them handed on as `tamper` leaves it: a writer that wrote what it did not plan, standing in for one.
  function tampered(tamper: (written: { element: Uint8Array; cells: any[] }) => void) {
    const o = opened(read(CELLSWAP, 'pv_typed.mat'));
    expect([o.edit(o.object('t'), 'Value', '7'), o.edit(o.object('t'), 'Description', 'zz')]).toEqual([true, true]);
    const plan = o.root._objectSubsystemEdit.bind(o.root);
    o.root._objectSubsystemEdit = (entries: any) => {
      const written = plan(entries);
      tamper(written);
      return written;
    };
    return thrownBy(o.save);
  }

  it('as written, it is saved', () => {
    expect(tampered(() => {})).toBeNull();
  });

  it('a cell that reads back as another value than the one planned for it', () => {
    const thrown = tampered(({ cells }) => {
      const value = cells.find((c) => c.savedName === 'Value');
      value.value = { ...value.value, value: 8 };
    });
    expect([thrown instanceof MatWriteError, thrown?.message]).toEqual([
      true,
      expect.stringMatching(/^Cannot save "f\.mat": the file written for it did not read back as written: object \d+'s Value.* Nothing was written\.$/),
    ]);
  });

  it('a cell written that no edit planned', () => {
    const thrown = tampered((written) => {
      written.cells = written.cells.filter((c) => c.savedName !== 'Description');
    });
    expect([thrown instanceof MatWriteError, thrown?.message]).toEqual([
      true,
      expect.stringMatching(/^Cannot save "f\.mat": the file written for it did not read back as written: the file's objects read back with value cell \d+, which no edit wrote, changed\. Nothing was written\.$/),
    ]);
  });

  it('a subsystem that does not read as one', () => {
    const thrown = tampered((written) => {
      // Its cell array's dims [N 1] said [N-1 1]: one cell more than it says it holds.
      const read = readMcosSubsystem(written.element);
      const dims = (read as { subsystem: McosSubsystem }).subsystem.cellArray.subs[1];
      written.element = written.element.slice();
      const view = new DataView(written.element.buffer);
      view.setInt32(dims.data, view.getInt32(dims.data, true) - 1, true);
    });
    expect([thrown instanceof MatWriteError, thrown?.message]).toEqual([
      true,
      expect.stringMatching(/^Cannot save "f\.mat": the file written for it did not read back as written: the file's objects do not read back as a subsystem \(.+\)\. Nothing was written\.$/),
    ]);
  });
});
