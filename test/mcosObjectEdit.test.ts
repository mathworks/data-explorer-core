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

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { subsystemElementOf, variableDifference } from '../src/datamodel/parser/MatFileWriter.js';
import { cellValueAt, objectIdOf, readMcosSubsystem } from '../src/datamodel/parser/McosSubsystemEdit.js';
import type { McosSubsystem } from '../src/datamodel/parser/McosSubsystemEdit.js';
import { checkMatFile } from '../src/datamodel/parser/MatFileCheck.js';
import { readSubsystem } from '../src/datamodel/parser/McosSubsystemCodec.js';
import { ruleObjectOf, writeObjectEdits } from '../src/datamodel/parser/McosObjectWrite.js';
import { planPropertyEdits, type McosRuleTarget } from '../src/datamodel/parser/McosPropertyRules.js';
import { mcosPlaceOf } from '../src/datamodel/node/mcosPlace.js';
import { sourceEditRefusal } from '../src/datamodel/node/BaseNode.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';

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

/**
 * Where `ours`, a subsystem a save wrote, holds other objects than `theirs` (MATLAB's own save of the
 * same edit), or null: every object of either the other's, of the same class, holding the same
 * saved names, each held the same way and holding the same value (the save's own comparison,
 * MatFileWriter.variableDifference; an object reference by the objects it names). Where in its
 * list a triple sits, and where its cell does, is MATLAB's to choose and not compared.
 */
function recordsDiffer(ours: Uint8Array, theirs: Uint8Array): string | null {
  const a = readSubsystem(ours);
  const b = readSubsystem(theirs);
  if (!a.ok || !b.ok || a.subsystem.blob.objects.length !== b.subsystem.blob.objects.length) {
    return 'not one table of objects';
  }
  for (let id = 1; id < a.subsystem.blob.objects.length; id++) {
    const x = ruleObjectOf(a.subsystem, id);
    const y = ruleObjectOf(b.subsystem, id);
    if (x.className !== y.className || [...x.held.keys()].sort().join(',') !== [...y.held.keys()].sort().join(',')) {
      return 'object ' + id + ' holds ' + [...x.held.keys()].join(', ') + ' where MATLAB holds ' + [...y.held.keys()].join(', ');
    }
    for (const [name, h] of x.held) {
      const o = y.held.get(name)!;
      const differs = h.kind !== o.kind
        || (h.kind === 'cell' && variableDifference((o as { value: MatVariable | null }).value, h.value, name) !== null)
        || (h.kind === 'str' && h.text !== (o as { text: string }).text)
        || (h.kind === 'int' && h.value !== (o as { value: number }).value);
      if (differs) {
        return 'object ' + id + "'s " + name + ' holds another value than MATLAB\'s';
      }
    }
  }
  return null;
}

// ---- The cell-swap probe -------------------------------------------------------------------------

interface CellswapCase {
  name: string;
  original: string;
  mutant: string;
  path: string;
  edits: { savedName: string }[];
  matlab: string | null;
  rules?: RulesWritten;
}

/** Where the property rules write a probe's case otherwise than its swap: their subsystem, and MATLAB's verdict on it per release. */
interface RulesWritten {
  subsystemSha256: string;
  by: 'session' | 'rules';
  matlab: Record<string, string>;
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
      const ours = subsystemOf(saved);
      if (c.rules) {
        // The rules write it otherwise than the swap: the subsystem MATLAB passed in each release,
        // and record for record MATLAB's own save of the edit.
        expect(sha(ours)).toBe(c.rules.subsystemSha256);
        expect(recordsDiffer(ours, subsystemOf(read(CELLSWAP, c.mutant.replace(/^mut_/, 'exp_'))))).toBeNull();
      } else {
        expect(sameBytes(ours, subsystemOf(read(CELLSWAP, c.mutant))), c.name).toBe(true);
      }
      expectOnlyTheSubsystemChanged(original, saved, c.name);
      // And what this package reads of it again is the edit.
      const again = opened(saved).object(c.path);
      expect(typed[0] === 'Value' ? again.displayValue : again.getPropInfo(again.getProperties().find((p: any) => p.key === typed[0])).displayValue).toBe(
        object(c.path).getPropInfo(object(c.path).getProperties().find((p: any) => p.key === typed[0])).displayValue,
      );
    });
  }

  it('the edits it does not take: an InitialValue MATLAB would trim, a DataType over a Value not double; and a Value at its default, which it does', () => {
    const signal = opened(read(CELLSWAP, 'pv_signal.mat'));
    expect(signal.edit(signal.object('sig'), 'initialValue', ' 4')).toMatchObject({ error: true, reason: expect.stringMatching(/sig\.InitialValue would be ' 4', which MATLAB would load as '4'/) });
    const typed = opened(read(CELLSWAP, 'pv_typed.mat'));
    expect(typed.edit(typed.object('t'), 'DataType', 'double')).toMatchObject({
      error: true,
      reason: expect.stringMatching(/^Cannot edit "t": t\.DataType follows its Value, of class \w+: set to another, MATLAB converts the Value to double, with a warning on every load\.$/),
    });
    for (const { root, save } of [signal, typed]) {
      expect(root.dirty).toBe(false);
      expect(thrownBy(save)).toBeNull();
    }
    // A Value at its default, which MATLAB saves no triple for: the save inserts one (McosPropertyRules).
    const atDefault = opened(read(CELLSWAP, 'pv_default.mat'));
    expect(atDefault.edit(atDefault.object('d'), 'Value', '5')).toBe(true);
    const saved = atDefault.save();
    expectOnlyTheSubsystemChanged(read(CELLSWAP, 'pv_default.mat'), saved, 'pv_default');
    expect(opened(saved).object('d').displayValue).toBe('5');
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
  // The subsystem the property rules write instead of the swap, and each release's verdict on it.
  rules?: RulesWritten;
}
// How many cases each way: held to the probe's bytes, or to the rules' own (named in the truth file).
const COUNTS = { sessionBytes: 91, sessionRules: 56, rulesBytes: 0, rulesOwn: 71, refusedAtEdit: 31, refusedByRules: 5 };
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
  // What a host types for a logical or a char Value, as the session makes it.
  if (expr === 'true' || expr === 'false') {
    return mat('uint8', expr === 'true' ? 1 : 0, [1, 1], { isLogical: true });
  }
  const text = /^'((?:[^']|'')*)'$/.exec(expr);
  if (text) {
    const t = text[1].replace(/''/g, "'");
    return mat('char', t, t === '' ? [0, 0] : [1, t.length]);
  }
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

/**
 * The subsystem the property rules and the writer beneath the session write for `edits`, or the
 * first refusal: what a save writes for the same edits, made by a host that could type their values.
 */
function writtenByTheRules(original: Uint8Array, edits: AllowlistCase['edits']): Uint8Array | string {
  const read = readSubsystem(subsystemOf(original));
  if (!read.ok) {
    throw new Error(read.message);
  }
  const ids = new Map<string, number>();
  const targets: McosRuleTarget[] = [];
  for (const path of [...new Set(edits.map((e) => e.path))]) {
    const place = mcosPlaceOf(opened(original).object(path))!;
    const objectId = objectIdOf(place.variable.mcosHandle, place.index)!;
    ids.set(path, objectId);
    const mine = edits
      .filter((e) => e.path === path)
      .map((e) => {
        const text = TEXT_PROPERTIES.has(e.prop) ? textOf(e.expr) : null;
        return { property: e.prop, value: text !== null ? mat('char', text, text === '' ? [0, 0] : [1, text.length]) : variableOf(e.expr) };
      });
    targets.push({ key: path, object: ruleObjectOf(read.subsystem, objectId), edits: mine });
  }
  const plan = planPropertyEdits(targets);
  if (!plan.ok) {
    return plan.message;
  }
  const written = writeObjectEdits(read.subsystem, plan.objects.map((o) => ({ objectId: ids.get(o.key)!, ops: o.ops })).filter((o) => o.ops.length > 0));
  return written.ok ? written.element : written.message;
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

/**
 * Where an object of `ours` holds other triples than the same object of `theirs`, or null: the same
 * saved names, each held the same way, a value cell holding the same value (the save's own
 * comparison, MatFileWriter.variableDifference), a text and an integer the same. Of every object:
 * the metadata blob, which cellsReadDifferently does not look at.
 */
function triplesDiffer(ours: Uint8Array, theirs: Uint8Array): string | null {
  const a = readSubsystem(ours);
  const b = readSubsystem(theirs);
  if (!a.ok || !b.ok || a.subsystem.blob.objects.length !== b.subsystem.blob.objects.length) {
    return 'not one table of objects';
  }
  for (let id = 1; id < a.subsystem.blob.objects.length; id++) {
    const x = ruleObjectOf(a.subsystem, id).held;
    const y = ruleObjectOf(b.subsystem, id).held;
    if ([...x.keys()].join(',') !== [...y.keys()].join(',')) {
      return 'object ' + id + ' holds ' + [...x.keys()].join(', ') + ' where the mutant holds ' + [...y.keys()].join(', ');
    }
    for (const [name, h] of x) {
      const o = y.get(name)!;
      const differs = h.kind !== o.kind
        || (h.kind === 'cell' && variableDifference((o as { value: MatVariable | null }).value, h.value, name) !== null)
        || (h.kind === 'str' && h.text !== (o as { text: string }).text)
        || (h.kind === 'int' && h.value !== (o as { value: number }).value);
      if (differs) {
        return 'object ' + id + "'s " + name + ' holds another value';
      }
    }
  }
  return null;
}

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
  // Each PASS case is held to one subsystem, byte for byte: the probe's swap, which MATLAB passed;
  // or, for the cases named `rules` in allowlist.truth.json, the one the property rules write
  // instead (a triple at its default removed, a Parameter's Complexity and DataType written as
  // MATLAB derives them), which MATLAB R2027a, R2023b and R2024b each passed in its own right.
  const counts = { sessionBytes: 0, sessionRules: 0, insertedAtDefault: 0, rulesBytes: 0, rulesOwn: 0, refusedAtEdit: 0, refusedByRules: 0 };
  for (const c of ALLOWLIST_TRUTH.cases) {
    const texts = c.edits.map((e) => typedText(e.prop, e.expr));
    const label = c.name + ': ' + c.edits.map((e) => `${e.path}.${e.prop} = ${e.expr}`).join(', ') + ' (MATLAB: ' + c.matlab + ')';
    // A Signal's InitialValue and Dimensions have no editor in this package (SignalNode); a complex
    // matrix is no literal its parser reads. Their subsystems are the rules', written beneath the session.
    const typedByHost =
      texts.every((t) => t !== null) &&
      !c.edits.some((e) => e.prop === 'InitialValue' || e.prop === 'Dimensions' || (/i/.test(e.expr) && e.expr.startsWith('[')));
    const pinned = c.rules?.subsystemSha256 ?? c.subsystemSha256;
    it(label, () => {
      const original = read(ALLOWLIST, c.original);
      if (typedByHost) {
        const { object, edit, save } = opened(original);
        const answers = c.edits.map((e, i) => edit(object(e.path), e.prop, texts[i]!));
        if (c.matlab === 'PASS' || c.matlab === 'NOSWAP') {
          expect(answers).toEqual(c.edits.map(() => true));
          const saved = save();
          expect(sha(subsystemOf(saved))).toBe(pinned);
          expectOnlyTheSubsystemChanged(original, saved, c.name);
          if (c.matlab === 'NOSWAP') {
            // A property at its default, which no cell held to swap: the rules insert its triple.
            const again = opened(saved).object(c.edits[0].path);
            expect(again.getPropInfo(again.getProperties().find((p: any) => p.key === c.edits[0].prop)).displayValue).toBe(texts[0]);
            counts.insertedAtDefault++;
          } else {
            counts[c.rules ? 'sessionRules' : 'sessionBytes']++;
          }
        } else if (answers.every((a) => a === true)) {
          // MATLAB's one FAIL that is no edit: the value the object already holds, typed again.
          expect(c.name).toBe('g2_tB_lgc');
          expect(sameBytes(save(), original)).toBe(true);
        } else {
          // Refused before it is made: the file is as it was read.
          expect(answers.find((a) => a !== true)).toMatchObject({ error: true });
          expect(sameBytes(save(), original)).toBe(true);
          counts.refusedAtEdit++;
        }
        return;
      }
      const written = writtenByTheRules(original, c.edits);
      if (c.matlab === 'PASS') {
        expect(typeof written === 'string' ? written : null).toBeNull();
        expect(sha(written as Uint8Array)).toBe(pinned);
        if (DECODED_ONLY[c.name] && !c.rules) {
          // And what the probe's swap held, which MATLAB passed too: the same values in the same triples.
          expect(cellsReadDifferently(written as Uint8Array, subsystemOf(read(ALLOWLIST, 'mut_' + c.name + '.mat')))).toBeNull();
          expect(triplesDiffer(written as Uint8Array, subsystemOf(read(ALLOWLIST, 'mut_' + c.name + '.mat')))).toBeNull();
        }
        counts[c.rules ? 'rulesOwn' : 'rulesBytes']++;
      } else {
        expect(typeof written, 'refused by the rules').toBe('string');
        counts.refusedByRules++;
      }
    });
  }

  it('holds every case so, the ones the rules write otherwise named in the truth file', () => {
    expect(counts).toEqual({ sessionBytes: COUNTS.sessionBytes, sessionRules: COUNTS.sessionRules, insertedAtDefault: 2, rulesBytes: COUNTS.rulesBytes, rulesOwn: COUNTS.rulesOwn, refusedAtEdit: COUNTS.refusedAtEdit, refusedByRules: COUNTS.refusedByRules });
    // Every case the rules write otherwise was judged by MATLAB in each release.
    for (const c of ALLOWLIST_TRUTH.cases.filter((x) => x.rules)) {
      expect(c.rules!.matlab, c.name).toEqual({ R2027a: 'PASS', R2023b: 'PASS', R2024b: 'PASS' });
    }
  });
});

// ---- Each refusal, in its words, through the session --------------------------------------------

describe('what the session refuses of an object in a MAT-file, before the edit is made', () => {
  const refusal = (name: string, why: string) => ({ error: true, reason: 'Cannot edit "' + name + '": ' + why + '.' });
  const WARNS = ', which MATLAB loads with a warning on every load';

  it('a property at its class default, which the file holds no value for, is taken: the save inserts its triple', () => {
    const original = read(ALLOWLIST, 'al_text.mat');
    const { object, edit, save } = opened(original);
    expect(object('xe').getPropInfo(object('xe').getProperties().find((p: any) => p.key === 'Description')).editable).toBe(true);
    expect(edit(object('xe'), 'Description', 'abc')).toBe(true);
    const saved = save();
    expectOnlyTheSubsystemChanged(original, saved, 'al_text');
    expect(opened(saved).object('xe').Description).toBe('abc');
  });

  it('a Complexity, a Dimensions, a DataType over a Value not double; and a StorageClass, which it takes', () => {
    const { object, edit, root, save } = opened(read(ALLOWLIST, 'al_dtype.mat'));
    const p = object('tS');
    expect(edit(p, 'complexity', 'complex')).toMatchObject(refusal('tS', 'tS.Complexity follows its Value, and is written only with it'));
    expect(edit(p, 'dimensions', '[2 3]')).toMatchObject(refusal('tS', 'tS.Dimensions follows its Value, and is written only with it'));
    expect(edit(p, 'DataType', 'int8')).toMatchObject(
      refusal('tS', 'tS.DataType follows its Value, of class single: set to another, MATLAB converts the Value to double, with a warning on every load'),
    );
    expect([p.status, root.dirty]).toEqual(['', false]);
    // Its CoderInfo's StorageClass, one index into the file's text of an object of its own.
    expect(edit(p, 'storageClass', 'ExportedGlobal')).toBe(true);
    expect(opened(save()).object('tS').getPropInfo(p.getProperties().find((q: any) => q.key === 'storageClass')).displayValue).toBe('ExportedGlobal');
  });

  it('a Value out of the range of the DataType it keeps, typed whole or into one element', () => {
    const { object, edit, save, root } = opened(read(ALLOWLIST, 'al_dtype.mat'));
    const p = object('tUd');
    expect(edit(p, 'Value', '300')).toMatchObject(refusal('tUd', "tUd.Value would hold 300, outside the range [0, 255] of its DataType 'uint8'" + WARNS));
    expect(edit(object('tD'), 'Value', 'NaN')).toMatchObject(refusal('tD', "tD.Value would hold NaN, where a DataType of 'double' takes finite values only" + WARNS));
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
    expect(edit(sg, 'DataType', 'half')).toMatchObject(refusal('sg', "sg.Min would be set under a DataType of 'half', whose range this editor does not check"));
    expect(edit(sg, 'DataType', 'auto')).toBe(true);
    expect(edit(sg, 'DataType', 'single')).toBe(true);
    expect(opened(save()).object('sg').DataType).toBe('single');
  });

  it('a bus element\'s Dimensions and Name, each a property of its own; an object in a struct, by its name, its struct\'s field', () => {
    const cases = opened(read(TEST_ROOT, 'parity/artifacts/mat/cases.mat'));
    const element = cases.by('aBus').children[0];
    expect(cases.edit(element, 'dimensions', '[2 3]')).toBe(true);
    expect(opened(cases.save()).by('aBus').children[0].getPropInfo(element.getProperties().find((p: any) => p.key === 'dimensions')).displayValue).toBe('[2 3]');
    // Its Name is a property of its own, which the save writes.
    expect(cases.edit(element, 'Name', 'renamed')).toBe(true);
    expect(opened(cases.save()).by('aBus').children[0].name).toBe('renamed');
    // An object in a struct is named by the struct's field, which a rename of it renames: the
    // struct written fresh, the object as the element it was read as (test/matFieldRename.test.ts).
    const nested = opened(read(ALLOWLIST, 'al_nested.mat'));
    expect(nested.object('s.p').nameEditable).toBe(true);
    expect(nested.object('s.p').setProperty('Name', 'q')).toBe(true);
    expect(opened(nested.save()).object('s.q').className).toBe('Simulink.Parameter');
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
        reason: 'Cannot edit "spB": spB.Value.a would be ' + what + ", which this editor does not write into a Simulink.Parameter's Value.",
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
    // Two cells swapped, as the cell swap writes them: its own check holds it, and the codec's.
    const o = opened(read(CELLSWAP, 'pv_typed.mat'));
    expect([o.edit(o.object('t'), 'Max', '20'), o.edit(o.object('t'), 'Description', 'zz')]).toEqual([true, true]);
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
      const value = cells.find((c) => c.savedName === 'Max');
      value.value = { ...value.value, value: 8 };
    });
    expect([thrown instanceof MatWriteError, thrown?.message]).toEqual([
      true,
      expect.stringMatching(/^Cannot save "f\.mat": the file written for it did not read back as written: object \d+'s Max.* Nothing was written\.$/),
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

  it('a byte the rewrite copies as it read it, changed: the preamble of the payload', () => {
    const thrown = tampered((written) => {
      const data = (readMcosSubsystem(written.element) as { subsystem: McosSubsystem }).subsystem.outer.subs[3];
      written.element = written.element.slice();
      written.element[data.data + 4] = 0xab;
    });
    expect([thrown instanceof MatWriteError, thrown?.message]).toEqual([
      true,
      "Cannot save \"f.mat\": the file written for it did not read back as written: the file's objects read back with the preamble of their payload, which no edit wrote, changed. Nothing was written.",
    ]);
  });

  it('a cell said written that is no value cell, which the cells compared would pass over', () => {
    const thrown = tampered((written) => {
      written.cells = [...written.cells, { ...written.cells[0], cellIndex: 0 }];
    });
    expect([thrown instanceof MatWriteError, thrown?.message]).toEqual([
      true,
      expect.stringMatching(/^Cannot save "f\.mat": the file written for it did not read back as written: the file's objects were written with cell 0, which is not one of their \d+ value cells\. Nothing was written\.$/),
    ]);
  });

  it('a subsystem planned that is not the record the file holds its objects in', () => {
    const thrown = tampered((written: any) => {
      written.record = { ...written.record };
    });
    expect([thrown instanceof MatWriteError, thrown?.message]).toEqual([
      true,
      'Cannot save "f.mat": the file\'s objects are not among the records it writes, so an edit of one could not be written. Nothing was written.',
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

describe('a subsystem the rules add to is read again through the codec, and held to the records it was written from', () => {
  // `d` of pv_default.mat, whose Value was at its default: the save inserts its triple and cell.
  function tampered(tamper: (written: { element: Uint8Array; records: any; cells: any[]; swapOnly: boolean }) => void) {
    const o = opened(read(CELLSWAP, 'pv_default.mat'));
    expect(o.edit(o.object('d'), 'Value', '5')).toBe(true);
    const plan = o.root._objectSubsystemEdit.bind(o.root);
    o.root._objectSubsystemEdit = (entries: any) => {
      const written = plan(entries);
      expect(written.swapOnly).toBe(false);
      tamper(written);
      return written;
    };
    return thrownBy(o.save);
  }

  it('as written, it is saved', () => {
    expect(tampered(() => {})).toBeNull();
  });

  it('an element other than the records say', () => {
    const thrown = tampered((written) => {
      written.records = { ...written.records, blob: { ...written.records.blob, strings: [...written.records.blob.strings, 'never written'] } };
    });
    expect(thrown?.message).toMatch(/^Cannot save "f\.mat": the file written for it did not read back as written: the file's objects do not read back as the records written \(the written subsystem reads back with blob\.strings .*\)\. Nothing was written\.$/);
  });

  it('a cell that reads back as another value than the one planned for it', () => {
    const thrown = tampered(({ cells }) => {
      const value = cells.find((c) => c.savedName === 'Value');
      value.value = { ...value.value, value: 8 };
    });
    expect(thrown?.message).toMatch(/^Cannot save "f\.mat": the file written for it did not read back as written: object \d+'s Value: .* Nothing was written\.$/);
  });

  it('a cell said written that is no value cell', () => {
    const thrown = tampered((written) => {
      written.cells = [...written.cells, { ...written.cells[0], cellIndex: 1 }];
    });
    expect(thrown?.message).toMatch(/the file's objects were written with cell 1, which is not one of their \d+ value cells\. Nothing was written\.$/);
  });

  it('an edit that reaches an object no edit was for', () => {
    // Its edit said to be of no object: every object of the file is then held as it was read.
    const thrown = tampered((written: any) => {
      written.edited = [];
    });
    expect(thrown?.message).toMatch(/^Cannot save "f\.mat": the file written for it did not read back as written: the file's objects do not read back as the records written \(the edits changed the property list of object \d+, which no edit was for\)\. Nothing was written\.$/);
  });
});

describe('what the gate finds of an object is kept until an edit of it', () => {
  it("an edited Value of 400 elements is read as the variable a save writes once, and not once a row, by the rows' editability", () => {
    const o = opened(read(CELLSWAP, 'pv_typed.mat'));
    const t = o.object('t');
    expect(o.edit(t, 'Value', '[' + Array.from({ length: 400 }, (_, i) => i + 1).join(' ') + ']')).toBe(true);
    // An element edited: the Value's variable is built from its rows now, at every ask.
    expect(o.edit(t._valueNode.children[7], 'Value', '-1')).toBe(true);
    const build = vi.spyOn(MatlabVariableNode.prototype, '_buildVarObject');
    try {
      const editable = t._valueNode.children.map((row: any) => row.valueEditable);
      expect(editable.every((e: boolean) => e)).toBe(true);
      expect(build.mock.calls.length).toBeLessThanOrEqual(2);
      // Asked again after another edit, once again.
      expect(o.edit(t._valueNode.children[9], 'Value', '-2')).toBe(true);
      build.mockClear();
      t._valueNode.children.forEach((row: any) => row.valueEditable);
      expect(build.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      build.mockRestore();
    }
    expect(opened(o.save()).object('t').displayValue).toBe(t.displayValue);
  });

  it('an edit of the node forgets what was found of it: a Max made what no save writes is refused once the node says it changed', () => {
    const o = opened(read(ALLOWLIST, 'al_minmax.mat'));
    const pm = o.object('pm');
    expect(sourceEditRefusal(pm, 'Max')).toBeNull();
    // Around every setter, as no editor does; the node told of it as every setter tells it.
    pm.Max = 'ten';
    expect(sourceEditRefusal(pm, 'Max')).toBeNull();
    pm._markModified();
    expect(sourceEditRefusal(pm, 'Max')).toBe('Cannot edit "pm": pm.Max is not held as a number.');
  });
});

describe('text MATLAB would load as other text is refused at the edit, saying what it would load', () => {
  it('a Description of white space alone, in a MAT-file; one ending in a space, taken and loaded so', () => {
    const o = opened(read(ALLOWLIST, 'al_text.mat'));
    const xa = o.object('xa');
    expect(o.edit(xa, 'Description', '   ')).toMatchObject({
      error: true,
      reason: "Cannot edit \"xa\": xa.Description would be '   ', which MATLAB would load as '': it loads text of white space alone as empty.",
    });
    expect([xa.Description, o.root.dirty]).toEqual(['short', false]);
    expect([o.edit(xa, 'Description', 'two  spaces, and one '), o.edit(xa, 'Unit', ' m')]).toEqual([true, true]);
    const again = opened(o.save()).object('xa');
    expect([again.Description, again.Unit]).toEqual(['two  spaces, and one ', ' m']);
  });
});
