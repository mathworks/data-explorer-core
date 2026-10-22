// Copyright 2026 The MathWorks, Inc.
//
// The template merge against files MATLAB judged (test/fixtures/mcos-templates, cases.json):
// the R2023b templates merged into files MATLAB R2023b and R2027a wrote — every class into a
// file with objects, one with objects of other classes only, one with no subsystem; a new Bus
// with one and two elements; elements added to and removed from a Bus the file holds — each of
// which MATLAB R2023b, R2024b and R2027a loaded equal to its own save of the same code. Where
// that save was an append of new objects, the merge was its bytes (cases.json `bytes`).
//
// Per case, McosTemplateMerge on the target writes the judged file's subsystem byte for byte,
// and its new variables' elements; the self-check passes, held to the target's own subsystem
// (append only); and the target's own records are kept as they were, every one in its place.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzlibSync } from 'fflate';
import {
  addBusElements,
  createAppendSession,
  createTemplateSubsystem,
  mergeTemplateObject,
  newObjectVariable,
  removeBusElement,
} from '../src/datamodel/parser/McosTemplateMerge.js';
import { cloneSubsystem, readDescriptor, readSubsystem, verifySubsystem, writeSubsystem, type McosSubsystemRecords } from '../src/datamodel/parser/McosSubsystemCodec.js';

const DIR = fileURLToPath(new URL('./fixtures/mcos-templates/', import.meta.url));

type Op =
  | { op: 'new'; var: string; tpl: string; elements: string[] }
  | { op: 'add'; var: string; names: string[] }
  | { op: 'remove'; var: string; index: number };

interface Case {
  name: string;
  into: 'r2023b' | 'r2027a';
  target: string;
  matlab: string;
  ops: Op[];
  verdicts: Record<string, string>;
  bytes: string;
}

const DOC = JSON.parse(readFileSync(DIR + 'cases.json', 'utf8')) as { judgedBy: string[]; cases: Case[] };

interface MatRecord {
  // The record as the file holds it, tag included, and its element inflated.
  raw: Uint8Array;
  element: Uint8Array;
  subsystem: boolean;
  name: string;
}

/** A Level-5 file's records, after the 128-byte header; the subsystem is the one its header names. */
function records(bytes: Uint8Array): MatRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at0 = Number(view.getBigUint64(116, true));
  const out: MatRecord[] = [];
  for (let at = 128; at + 8 <= bytes.length; ) {
    const type = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (type === 15 ? 0 : (8 - (size % 8)) % 8);
    const element = type === 15 ? unzlibSync(bytes.subarray(at + 8, at + 8 + size)) : bytes.subarray(at, at + 8 + size);
    out.push({ raw: bytes.subarray(at, end), element, subsystem: at === at0, name: elementName(element) });
    at = end;
  }
  return out;
}

/** An miMATRIX element's name: after the flags, and the dims a class-17 element does not have. */
function elementName(e: Uint8Array): string {
  const view = new DataView(e.buffer, e.byteOffset, e.byteLength);
  let p = 24;
  if (view.getUint8(16) !== 17) {
    const n = view.getUint32(p + 4, true);
    p += view.getUint32(p, true) >>> 16 ? 8 : 8 + n + ((8 - (n % 8)) % 8);
  }
  const word = view.getUint32(p, true);
  const [from, n] = word >>> 16 ? [p + 4, word >>> 16] : [p + 8, view.getUint32(p + 4, true)];
  return Buffer.from(e.subarray(from, from + n)).toString('latin1');
}

const file = (path: string): Uint8Array => new Uint8Array(readFileSync(DIR + path));
const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

/** The case's ops on its target: the subsystem written, and each new variable's element. */
function merged(c: Case, target: MatRecord[]): { sub: McosSubsystemRecords; original: McosSubsystemRecords; vars: Map<string, Uint8Array> } {
  const own = target.find((r) => r.subsystem);
  let sub: McosSubsystemRecords;
  if (own) {
    const r = readSubsystem(own.element);
    if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
    sub = r.subsystem;
  } else {
    sub = createTemplateSubsystem((c.ops.find((o) => o.op === 'new') as { tpl: string }).tpl);
  }
  const original = cloneSubsystem(sub);
  const session = createAppendSession();
  const vars = new Map<string, Uint8Array>();
  for (const op of c.ops) {
    if (op.op === 'new') {
      const obj = mergeTemplateObject(sub, op.tpl, { session, ...(op.elements.length ? { elements: op.elements } : {}) });
      vars.set(op.var, newObjectVariable(op.var, obj));
      continue;
    }
    const busId = readDescriptor(target.find((r) => r.name === op.var)!.element)!.ids[0];
    if (op.op === 'add') addBusElements(sub, busId, op.names, { session });
    else removeBusElement(sub, busId, op.index - 1);
  }
  return { sub, original, vars };
}

describe('the MATLAB-judged template merges', () => {
  it('are every case, each passed by MATLAB R2023b, R2024b and R2027a', () => {
    expect(DOC.cases).toHaveLength(86);
    expect(DOC.judgedBy).toHaveLength(3);
    for (const c of DOC.cases) expect(c.verdicts, c.name).toEqual({ R2023b: 'PASS', R2024b: 'PASS', R2027a: 'PASS' });
    const identical = DOC.cases.filter((c) => c.bytes === 'identical' || c.bytes.startsWith('identical but for the file header'));
    expect(identical).toHaveLength(70);
  });

  for (const c of DOC.cases) {
    it(`${c.into}/${c.name}: ${c.matlab}`, () => {
      const target = records(file(`targets/${c.into}/${c.target}.mat`));
      const judged = records(file(`merged/${c.into}/${c.name}.mat`));
      const { sub, original, vars } = merged(c, target);
      const written = writeSubsystem(sub);
      expect(verifySubsystem(written, sub, original)).toEqual({ ok: true });
      expect(same(written, judged.find((r) => r.subsystem)!.element)).toBe(true);
      for (const [name, element] of vars) {
        expect(same(element, judged.find((r) => r.name === name)!.element), name).toBe(true);
      }
      // The target's records are the judged file's first ones, byte for byte, as they were.
      const kept = target.filter((r) => !r.subsystem);
      expect(judged.filter((r) => !r.subsystem).slice(0, kept.length).every((r, i) => same(r.raw, kept[i].raw))).toBe(true);
      // And nothing of the target's subsystem was renumbered: every record it held is in its place.
      const own = target.find((r) => r.subsystem);
      if (own) {
        const before = readSubsystem(own.element);
        if (!before.ok) throw new Error(before.message);
        const b = before.subsystem.blob;
        expect(sub.blob.strings.slice(0, b.strings.length)).toEqual(b.strings);
        expect(sub.blob.classes.slice(0, b.classes.length)).toEqual(b.classes);
        expect(sub.blob.objects.slice(0, b.objects.length)).toEqual(b.objects);
      }
    });
  }
});
