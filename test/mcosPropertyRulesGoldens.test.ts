// Copyright 2026 The MathWorks, Inc.
//
// The property rules (McosPropertyRules), written through the codec (McosObjectWrite), held to
// edits MATLAB R2027a judged: test/fixtures/mcos-rules, a sample of the rules probe's cases over
// every class the rules cover. Each original and the value each edit gives were saved by MATLAB;
// each mutant was written by the probe's allow-list from the original and the value alone, and
// MATLAB loaded it equal to its own `x.Prop = v` on a fresh load of the original, with no warning,
// and a MATLAB re-save of it reloaded equal (cases.json says which). For each case this package's
// rules write, from the same original and value, every edited object's triples are the mutant's:
// the same saved names, each held the same way and holding the same value. Where the two differ in
// bytes is where a value cell or a triple sits (the probe put an inserted one in MATLAB's own slot,
// and dropped a removed one's cell; this package appends, and leaves it), which MATLAB loads the
// same. And each case the probe refused, the rules refuse.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import type { MatVariable, ParsedMat } from '../src/datamodel/parser/MatParser.js';
import { subsystemElementOf } from '../src/datamodel/parser/MatFileWriter.js';
import { McosValueKind, propertiesOf, readSubsystem, verifySubsystem, type McosSubsystemRecords } from '../src/datamodel/parser/McosSubsystemCodec.js';
import { elementValue, heldObjectIds, ruleObjectOf, writeObjectEdits } from '../src/datamodel/parser/McosObjectWrite.js';
import { planPropertyEdits, type McosRuleTarget } from '../src/datamodel/parser/McosPropertyRules.js';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mcos-rules');

interface Case {
  name: string;
  original: string;
  rhs: string[];
  edits: [string, string][];
  verdict: 'write' | 'REFUSE';
  mutant: string | null;
  matlab: 'PASS' | null;
}
const CASES: Case[] = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8')).cases;

function parsedOf(file: string): ParsedMat {
  const b = readFileSync(join(DIR, file));
  return parseMat(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

/** A MAT-file of the fixtures, parsed, and its subsystem read into records. */
function opened(file: string): { parsed: ParsedMat; sub: McosSubsystemRecords } {
  const parsed = parsedOf(file);
  const record = parsed.records.find((r) => r.offset === parsed.subsystemOffset)!;
  const read = readSubsystem(subsystemElementOf(record)!);
  if (!read.ok) {
    throw new Error(file + ': ' + read.message);
  }
  return { parsed, sub: read.subsystem };
}

// The saved name a nested object's property is held under.
const NESTED_SAVED: Record<string, string> = { Elements: 'Elements_internal' };

/**
 * The object at a probe path, and for one nested in another the objects beside it there: 'p',
 * 's.b', 'c{1}', 'arr(2)' name a variable's object; '/Prop(i)' then the i-th object a property of
 * it holds ('b/Elements(2)', 'lt/Table', 'p/CoderInfo').
 */
function objectAt(m: { parsed: ParsedMat; sub: McosSubsystemRecords }, path: string): { id: number; siblings: number[] | null; index: number } {
  const [head, ...rest] = path.split('/');
  const tokens = head.match(/^[A-Za-z]\w*|\.\w+|\{\d+\}|\(\d+\)/g)!;
  let v: MatVariable = m.parsed.variables.find((x) => x.name === tokens[0])!;
  let index = 1;
  for (const tk of tokens.slice(1)) {
    if (tk.startsWith('.')) {
      v = v.fields![tk.slice(1)] as MatVariable;
    } else if (tk.startsWith('{')) {
      v = (v.value as MatVariable[])[Number(tk.slice(1, -1)) - 1];
    } else {
      index = Number(tk.slice(1, -1));
    }
  }
  let id = v.mcosHandle!.ids[index - 1];
  let siblings: number[] | null = null;
  let at = 0;
  for (const segment of rest) {
    const [, prop, k] = /^(\w+)(?:\((\d+)\))?$/.exec(segment)!;
    siblings = heldObjectIds(m.sub, id, NESTED_SAVED[prop] ?? prop)!;
    at = Number(k ?? 1) - 1;
    id = siblings[at];
  }
  return { id, siblings, index: at };
}

/** An object's triples, by saved name: how each is held, and what it holds. */
function triplesOf(sub: McosSubsystemRecords, id: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of propertiesOf(sub, id)) {
    if (p.flag === McosValueKind.string) {
      out[p.savedName] = 'str ' + JSON.stringify(sub.blob.strings[p.value]);
    } else if (p.flag === McosValueKind.integer) {
      out[p.savedName] = 'int ' + p.value;
    } else if (p.flag === McosValueKind.cell) {
      const value = elementValue(sub.values[p.value]);
      out[p.savedName] = 'cell ' + (value ? said(value) : 'unread');
    } else {
      out[p.savedName] = 'object ' + p.value;
    }
  }
  return out;
}

function said(v: MatVariable): string {
  const cls = v.isLogical ? 'logical' : v.className;
  const dims = (v.dimensions ?? []).join('x');
  if (cls === 'struct') {
    const fields = Object.entries(v.fields ?? {}).map(([k, f]) => k + '=' + (Array.isArray(f) ? f.map(said).join(';') : said(f)));
    return 'struct ' + dims + ' {' + fields.join(', ') + '}';
  }
  const value = JSON.stringify(v.value ?? null, (_k, x) =>
    typeof x === 'bigint' ? String(x) : typeof x === 'number' && !Number.isFinite(x) ? String(x) : Object.is(x, -0) ? '-0' : x,
  );
  return cls + (v.isComplex ? ' complex ' : ' ') + dims + ' ' + value;
}

/** The targets of a case's edits, one per object, a bus element with its bus. */
function targetsOf(c: Case, m: { parsed: ParsedMat; sub: McosSubsystemRecords }): { targets: McosRuleTarget[]; ids: Map<string, number> } {
  const byPath = new Map<string, McosRuleTarget>();
  const ids = new Map<string, number>();
  c.edits.forEach(([path, property], i) => {
    const at = objectAt(m, path);
    const value = parsedOf(c.rhs[i]).variables.find((x) => x.name === 'v')!;
    let target = byPath.get(path);
    if (!target) {
      target = { key: path, object: ruleObjectOf(m.sub, at.id), edits: [] };
      if (target.object.className === 'Simulink.BusElement' && at.siblings) {
        target.bus = { key: path.split('/')[0], elements: at.siblings.map((id) => ruleObjectOf(m.sub, id)), index: at.index };
      }
      byPath.set(path, target);
      ids.set(path, at.id);
    }
    (target.edits as { property: string; value: MatVariable }[]).push({ property, value });
  });
  return { targets: [...byPath.values()], ids };
}

// The cases whose subsystem this package writes byte for byte as the probe's mutant: every edit a
// swap in place, or an insertion where MATLAB's own slot is the end. The others differ only in where
// an inserted triple or cell sits, or in a removed triple's cell, which this package leaves.
const BYTE_FOR_BYTE = new Set([
  'p0_dt_0', 'r3_ssc_0', 'r3_psc_6', 'b2_scope_0', 'b2_pres_0', 'be_name_0', 'r2_be_swap3', 'lt_tv_1', 'lt_bv_1',
  'lt_tunable_0', 'lt_sti_name_0', 'r2_nest_lt', 'nt0_mode_2', 'nts_slope_1', 'nts_mode_1', 'r2_nest_arr', 'at_base_0', 'at_scope_0',
]);

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

describe('the rules probe: each case MATLAB judged, as these rules write it', () => {
  it('holds a case of every class the rules cover, written and refused', () => {
    const written = CASES.filter((c) => c.verdict === 'write');
    expect(written.length).toBeGreaterThanOrEqual(30);
    expect(CASES.length - written.length).toBeGreaterThanOrEqual(10);
    expect(written.every((c) => c.matlab === 'PASS' && c.mutant)).toBe(true);
    const classes = new Set<string>();
    for (const c of written) {
      const m = opened(c.original);
      for (const [path] of c.edits) classes.add(ruleObjectOf(m.sub, objectAt(m, path).id).className);
    }
    expect([...classes].sort()).toEqual([
      'Simulink.AliasType',
      'Simulink.Breakpoint',
      'Simulink.Bus',
      'Simulink.BusElement',
      'Simulink.CoderInfo',
      'Simulink.LookupTable',
      'Simulink.NumericType',
      'Simulink.Parameter',
      'Simulink.Signal',
      'Simulink.ValueType',
      'Simulink.lookuptable.Breakpoint',
      'Simulink.lookuptable.StructTypeInfo',
      'Simulink.lookuptable.Table',
    ]);
  });

  for (const c of CASES) {
    const label = c.name + ': ' + c.edits.map(([p, prop]) => p + '.' + prop).join(', ') + ' (' + (c.verdict === 'write' ? 'MATLAB: PASS' : 'refused') + ')';
    it(label, () => {
      const m = opened(c.original);
      const { targets, ids } = targetsOf(c, m);
      const plan = planPropertyEdits(targets);
      if (c.verdict === 'REFUSE') {
        expect(plan.ok).toBe(false);
        if (!plan.ok) {
          expect(plan.message.length).toBeGreaterThan(0);
          expect(c.edits.some(([p]) => p === plan.key)).toBe(true);
        }
        return;
      }
      if (!plan.ok) {
        throw new Error(plan.message);
      }
      const written = writeObjectEdits(m.sub, plan.objects.map((o) => ({ objectId: ids.get(o.key)!, ops: o.ops })));
      if (!written.ok) {
        throw new Error(written.message);
      }
      // The subsystem written reads back whole, as the records meant.
      const back = readSubsystem(written.element);
      expect(back.ok).toBe(true);
      expect(verifySubsystem(written.element, written.records)).toEqual({ ok: true });
      // Every object edited holds the mutant's triples; and some are the mutant's bytes.
      const mutant = opened(c.mutant!);
      const mutantRecord = mutant.parsed.records.find((r) => r.offset === mutant.parsed.subsystemOffset)!;
      expect(sameBytes(written.element, subsystemElementOf(mutantRecord)!), 'byte for byte').toBe(BYTE_FOR_BYTE.has(c.name));
      for (const path of ids.keys()) {
        expect(triplesOf(written.records, ids.get(path)!), path).toEqual(triplesOf(mutant.sub, objectAt(mutant, path).id));
      }
      // And nothing of the original was moved: its strings, class rows, objects and value cells
      // are where they were, and a cell it held is the bytes it was unless an edit swapped it.
      const was = m.sub;
      const is = written.records;
      expect(is.blob.strings.slice(0, was.blob.strings.length)).toEqual(was.blob.strings);
      expect(is.blob.classes.length).toBe(was.blob.classes.length);
      expect(is.blob.objects).toEqual(was.blob.objects);
      expect(is.values.length).toBeGreaterThanOrEqual(was.values.length);
    });
  }
});
