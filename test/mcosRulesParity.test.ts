// Copyright 2026 The MathWorks, Inc.
//
// The property rules (McosPropertyRules.planPropertyEdits) held, op for op, to their reference
// implementation on every research case of the rules: test/fixtures/mcos-rules-parity/cases.json.
// Each case is an edit of an object of a file MATLAB R2027a, R2023b or R2024b saved, of one merged
// from the R2023b templates, or of a CoderInfo in either layout (the research sets r27, r23, r24, mx
// and ci23/ci24/ci27), its right-hand side as MATLAB saved it; with the verdict (written or refused)
// and the triple ops the reference implementation gives, which the research live gates verified
// against MATLAB. Here core's rules, on core's reading of the same file, must give the same verdict
// and the same ops: each set or remove, its saved name, its encoding, and each value by class, size
// and each element's bits.
//
// test/mcosPropertyRulesGoldens.test.ts holds 45 of these to the bytes MATLAB saved; this holds all
// of them to the rule.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMat, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { subsystemElementOf } from '../src/datamodel/parser/MatFileWriter.js';
import { McosValueKind, isHandleOpaque, propertiesOf, readSubsystem, type McosSubsystemRecords } from '../src/datamodel/parser/McosSubsystemCodec.js';
import { handleRuleObjectOf, heldObjectIds, ruleObjectOf } from '../src/datamodel/parser/McosObjectWrite.js';
import { planPropertyEdits, type McosRuleTarget, type McosTripleOp } from '../src/datamodel/parser/McosPropertyRules.js';

const TEST = fileURLToPath(new URL('.', import.meta.url));

type Case = [name: string, set: string, original: number, edits: [path: string, property: string, value: number][], ops?: string[]];
const DOC = JSON.parse(readFileSync(TEST + 'fixtures/mcos-rules-parity/cases.json', 'utf8')) as { originals: string[]; values: string[]; cases: Case[] };

const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

// A Level-5 header, little-endian, with no subsystem: what a value's element is read in.
const HEADER = (() => {
  const h = new Uint8Array(128).fill(0x20);
  h.set(Buffer.from('MATLAB 5.0 MAT-file', 'latin1'), 0);
  h.fill(0, 116, 124);
  h.set([0x00, 0x01, 0x49, 0x4d], 124);
  return h;
})();

/** The value `i` of the table, the variable its element is, as the reader reads it from a file. */
const valueOf = (() => {
  const read = new Map<number, MatVariable>();
  return (i: number): MatVariable => {
    let v = read.get(i);
    if (!v) {
      const element = Buffer.from(DOC.values[i], 'base64');
      const file = new Uint8Array(HEADER.length + element.length);
      file.set(HEADER);
      file.set(element, HEADER.length);
      v = parseMat(bufferOf(file)).variables.find((x) => x.name === 'v')!;
      read.set(i, v);
    }
    return v;
  };
})();

interface Opened {
  variables: MatVariable[];
  sub: McosSubsystemRecords;
}

/** The original `i`, read, and its subsystem as the rules read one. */
const originalOf = (() => {
  const read = new Map<number, Opened>();
  return (i: number): Opened => {
    let m = read.get(i);
    if (!m) {
      const parsed = parseMat(bufferOf(new Uint8Array(readFileSync(TEST + DOC.originals[i]))));
      const record = parsed.records.find((r) => r.offset === parsed.subsystemOffset)!;
      const r = readSubsystem(subsystemElementOf(record)!);
      if (!r.ok) {
        throw new Error(DOC.originals[i] + ': ' + r.message);
      }
      m = { variables: parsed.variables, sub: r.subsystem };
      read.set(i, m);
    }
    return m;
  };
})();

const NESTED_SAVED: Record<string, string> = { Elements: 'Elements_internal' };

/** The object a case names: `p`, `s.b`, `c{2}`, `b/Elements(2)`, `p/CoderInfo` (a 'handle' opaque). */
function objectAt(m: Opened, path: string): { id?: number; handle?: Uint8Array; parent?: { ids: number[]; index: number } } {
  const [head, ...rest] = path.split('/');
  const toks = head.match(/^[A-Za-z]\w*|\.\w+|\{\d+\}|\(\d+\)/g)!;
  let v: MatVariable = m.variables.find((x) => x.name === toks[0])!;
  let idx = 1;
  for (const tk of toks.slice(1)) {
    if (tk.startsWith('.')) {
      v = (v.fields as unknown as Record<string, MatVariable>)[tk.slice(1)];
    } else if (tk.startsWith('{')) {
      v = (v.value as MatVariable[])[Number(tk.slice(1, -1)) - 1];
    } else {
      idx = Number(tk.slice(1, -1));
    }
  }
  let id = v.mcosHandle!.ids[idx - 1];
  let parent: { ids: number[]; index: number } | undefined;
  for (let s = 0; s < rest.length; s++) {
    const mm = /^(\w+)(?:\((\d+)\))?$/.exec(rest[s])!;
    const saved = NESTED_SAVED[mm[1]] ?? mm[1];
    const ids = heldObjectIds(m.sub, id, saved);
    if (!ids) {
      const t = propertiesOf(m.sub, id).find((p) => p.savedName === saved && p.flag === McosValueKind.cell);
      if (t && isHandleOpaque(m.sub.values[t.value]) && s === rest.length - 1) {
        return { handle: m.sub.values[t.value] };
      }
      throw new Error('no object at ' + path);
    }
    parent = { ids, index: Number(mm[2] ?? 1) - 1 };
    id = ids[parent.index];
  }
  return { id, parent };
}

const bits = new DataView(new ArrayBuffer(8));
function numberText(x: unknown): string {
  const n = Number(x);
  if (Number.isNaN(n)) {
    return 'NaN';
  }
  bits.setFloat64(0, n, true);
  return [...new Uint8Array(bits.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A value cell's value as the table spells it: class, size, and each element's bits, column-major.
function cellText(v: MatVariable): string {
  const cls = v.isLogical || v.className === 'logical' ? 'logical' : v.className;
  const d = v.dimensions ?? [1, 1];
  const dims = d.join('x');
  if (cls === 'char') {
    return 'cell:char:' + dims + ':' + JSON.stringify(typeof v.value === 'string' ? v.value : '');
  }
  if (cls === 'struct' || cls === 'cell') {
    return 'cell:' + cls + ':' + dims;
  }
  let flat: unknown[] = v.value === null || v.value === undefined ? [] : Array.isArray(v.value) ? (v.value as unknown[]) : [v.value];
  // The reader holds a matrix row-major; the file, and the table, column-major.
  if (d.length === 2 && d[0] > 1 && d[1] > 1 && flat.length === d[0] * d[1]) {
    const cm: unknown[] = [];
    for (let j = 0; j < d[1]; j++) {
      for (let i = 0; i < d[0]; i++) {
        cm.push(flat[i * d[1] + j]);
      }
    }
    flat = cm;
  }
  const re = flat.map((x) => (x !== null && typeof x === 'object' ? (x as { re: unknown }).re : x));
  const im = v.isComplex ? flat.map((x) => (x !== null && typeof x === 'object' ? (x as { im: unknown }).im : 0)) : null;
  return 'cell:' + cls + ':' + dims + ':' + re.map(numberText).join(',') + ':' + (im ? im.map(numberText).join(',') : '-');
}

function opText(key: string, op: McosTripleOp): string {
  if (op.op === 'remove') {
    return 'remove:' + key + ':' + op.savedName;
  }
  const v = op.kind === 'str' ? 'str:' + op.text : op.kind === 'int' ? 'int:' + op.value : cellText(op.value);
  return 'set:' + key + ':' + op.savedName + ':' + v;
}

/** What core's rules give for case `c`: its ops, sorted, or null where they refuse it. */
function planned(c: Case): string[] | null {
  const m = originalOf(c[2]);
  const targets = new Map<string, McosRuleTarget>();
  for (const [path, property, value] of c[3]) {
    let target = targets.get(path);
    if (!target) {
      const at = objectAt(m, path);
      let object;
      if (at.handle) {
        const read = handleRuleObjectOf(at.handle);
        if (typeof read === 'string') {
          throw new Error(c[0] + ': ' + read);
        }
        object = read;
      } else {
        object = ruleObjectOf(m.sub, at.id!);
      }
      target = { key: path, object, edits: [] };
      if (!at.handle && object.className === 'Simulink.BusElement' && at.parent) {
        target.bus = { key: path.slice(0, path.lastIndexOf('/')), elements: at.parent.ids.map((id) => ruleObjectOf(m.sub, id)), index: at.parent.index };
      }
      targets.set(path, target);
    }
    (target.edits as { property: string; value: MatVariable }[]).push({ property, value: valueOf(value) });
  }
  const plan = planPropertyEdits([...targets.values()]);
  return plan.ok ? plan.objects.flatMap((o) => o.ops.map((op) => opText(o.key, op))).sort() : null;
}

describe("the property rules agree with their reference implementation on every research case", () => {
  const SETS = ['r27', 'r23', 'r24', 'mx', 'ci23', 'ci24', 'ci27'];

  it('are every case of every set, written and refused', () => {
    const count = (set: string) => DOC.cases.filter((c) => c[1] === set).length;
    expect(SETS.map(count)).toEqual([814, 814, 813, 282, 234, 234, 234]);
    expect(DOC.cases.filter((c) => c[4]).length).toBe(2293);
  });

  for (const set of SETS) {
    it(set, () => {
      const differ: string[] = [];
      for (const c of DOC.cases.filter((x) => x[1] === set)) {
        const ours = planned(c);
        const theirs = c[4] ?? null;
        if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
          differ.push(`${c[0]}: core ${ours ? JSON.stringify(ours) : 'refuses'}, the reference ${theirs ? JSON.stringify(theirs) : 'refuses'}`);
        }
      }
      expect(differ.slice(0, 10), differ.length + ' cases differ').toEqual([]);
    });
  }
});
