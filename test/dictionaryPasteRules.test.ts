// Copyright 2026 The MathWorks, Inc.
//
// The rules a paste into a dictionary's section runs (src/edit/dictionaryPaste.ts), copied from
// data-explorer-vscode at c73da3c, held to what that extension's own unit tests assert of them.
// Ported from its test/foldPasteEntries.test.ts, structuralEdit.test.ts, constantNode.test.ts and
// pasteNonFiniteJson.test.ts: where those drive the rules through the extension's JSON text paste
// (pasteEntry), the same assertion is made of the rule called on core's own section here, and
// through the session's paste in dictionaryPasteSession.test.ts; the classless-paste case also runs
// core's own copy of pasteEntry (src/edit/structuralEdit.ts), as the extension's case did.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession, getSectionMetadata } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import {
  TransferRefused,
  assertConstantValueAllowed,
  assertTypeAllowed,
  cloneForPaste,
  foldPasteEntries,
  prepareEntryForPaste,
  refuseDisallowedPaste,
  refuseUnwrittenNumber,
  type StructuralResult,
} from '../src/edit/dictionaryPaste.js';
// The two entryOps helpers the rules use, entryOps.ts's since step 6a C3.
import { findEntryBySelector, recordCopy } from '../src/edit/entryOps.js';
import { pasteEntry } from '../src/edit/structuralEdit.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const fixture = (path: string) => new Uint8Array(readFileSync(path));
// vscode's test-integration/fixtures/workspace/data.sldd, test/fixtures/arch.sldd and
// test-integration/fixtures/workspace/params.sldd, byte for byte.
const DATA = 'test/fixtures/numeric_json.sldd';
const ARCH = 'test/fixtures/arch.sldd';
const PARAMS = 'test/parity/artifacts/text/params.sldd';

function opened(path: string, filename = path.split('/').pop()!) {
  const session = createSession();
  const root: Any = ingest(session, ab(fixture(path)), { filename });
  const section = (name: string): Any => root.children.find((s: Any) => s.name === name);
  const entry = (name: string): Any => (root.children as Any[]).flatMap((s) => s.children).find((e: Any) => e.name === name);
  return { session, root, section, entry };
}

const NS_DESIGN = getSectionMetadata('design').namespace;

describe('foldPasteEntries: steps that do not chain fold to no patch, and the text is still every step’s', () => {
  // A single paste that inserts `text` at `at` (or reports `patch` as given).
  const step =
    (at: (text: string) => number, insert: string, override?: (offset: number) => StructuralResult['patch']) =>
    (text: string): StructuralResult => {
      const offset = at(text);
      const patch = override ? override(offset) : { offset, length: 0, text: insert };
      return { newText: text.slice(0, offset) + insert + text.slice(offset), selectId: `id-${insert}`, patch };
    };
  const run = (steps: ((text: string) => StructuralResult)[]) => {
    let i = 0;
    const payloads = steps.map(() => ({ name: 'p' }));
    const section = { allowsType: () => true, name: 'design' };
    return foldPasteEntries('0123456789', section, payloads, (text) => steps[i++](text));
  };

  it('(control) appends at the end of the one before fold into one', () => {
    const out = run([step(() => 5, 'A'), step(() => 6, 'B'), step(() => 7, 'C')]);
    expect(out.newText).toBe('01234ABC56789');
    expect(out.patch).toEqual({ offset: 5, length: 0, text: 'ABC' });
    expect(out.selectIds).toEqual(['id-A', 'id-B', 'id-C']);
  });

  it('a step that lands somewhere else', () => {
    const out = run([step(() => 5, 'A'), step(() => 0, 'B')]);
    expect(out.newText).toBe('B01234A56789');
    expect(out.patch).toBeUndefined();
  });

  it('a step that replaces rather than inserts', () => {
    const out = run([step(() => 5, 'A'), step(() => 6, 'B', (offset) => ({ offset, length: 1, text: 'B' }))]);
    expect(out.patch).toBeUndefined();
  });

  it('a step that reports no patch (the XML paste), first or later', () => {
    expect(run([step(() => 5, 'A', () => undefined), step(() => 6, 'B')]).patch).toBeUndefined();
    expect(run([step(() => 5, 'A'), step(() => 6, 'B', () => undefined)]).patch).toBeUndefined();
  });

  it('and once it cannot fold, a later step that would chain does not revive it', () => {
    const out = run([step(() => 5, 'A'), step(() => 0, 'B'), step(() => 1, 'C')]);
    expect(out.patch).toBeUndefined();
    expect(out.newText).toBe('BC01234A56789');
  });

  it('nothing to paste is no patch and no selection', () => {
    const out = run([]);
    expect(out).toEqual({ newText: '0123456789', selectIds: [], patch: undefined });
  });

  it('judges every payload by the allow-list before the first step runs', () => {
    let steps = 0;
    const section = { allowsType: (t: string) => t !== 'Simulink.ServiceBus', name: 'design', displayName: 'Design Data' };
    const pasteOne = (text: string): StructuralResult => (steps++, { newText: text + 'x', selectId: null });
    expect(() => foldPasteEntries('', section, [{ name: 'a', value: 1 }, { name: 's', value: { _array_class: 'Simulink.ServiceBus' } }], pasteOne)).toThrow(
      'A "Simulink.ServiceBus" entry is not allowed in Design Data.',
    );
    expect(steps).toBe(0);
  });
});

describe('the shared refusals, for sections shaped other than core’s', () => {
  it('a section with no allow-list takes anything', () => {
    expect(() => assertTypeAllowed({ name: 'design' }, { name: 'x', value: { _array_class: 'Anything' } })).not.toThrow();
  });

  it('names a section by its display name, or by its name when it has none', () => {
    const refusing = { allowsType: () => false, name: 'design' };
    expect(() => assertTypeAllowed(refusing, { name: 'b', value: { _array_class: 'Simulink.Bus' } })).toThrow(
      'A "Simulink.Bus" entry is not allowed in design.',
    );
    expect(() => assertTypeAllowed({ ...refusing, displayName: 'Design Data' }, { name: 'v', value: 1 })).toThrow(
      'A MATLAB variable is not allowed in Design Data.',
    );
  });
});

describe('the allow-list of core’s own sections', () => {
  it('names both the class and the section when the class has no home there', () => {
    const d = opened(ARCH);
    const payload = { name: 'Svc', metadata: { uuid: 'u' }, value: { _array_class: 'Simulink.ServiceBus', _elements: [{ _properties: {} }] } };
    expect(() => assertTypeAllowed(d.section('design'), payload)).toThrow('A "Simulink.ServiceBus" entry is not allowed in Design Data.');
  });

  it('judges a classless payload by what it becomes: a MATLAB variable, or in Architectural Data a Constant', () => {
    const d = opened(DATA);
    const number = d.entry('Number').serialize();
    const struct = d.entry('Struct').serialize();
    expect(() => assertTypeAllowed(d.section('config'), number)).toThrow('A MATLAB variable is not allowed in Configurations.');
    expect(() => assertTypeAllowed(d.section('config'), struct)).toThrow('A MATLAB variable is not allowed in Configurations.');
    for (const name of ['design', 'other', 'arch']) expect(() => assertTypeAllowed(d.section(name), number), name).not.toThrow();
    // And the whole paste, as vscode's structuralEdit.test.ts held it ("still accepts a plain
    // MATLAB variable in Design Data and in Other Data", restored ahead of vscode's V4): the
    // sections whose allow-lists name MatlabVariable take it.
    const fixtureText = readFileSync(DATA, 'utf8');
    for (const section of ['design', 'other']) {
      const fresh = opened(DATA);
      const payload = fresh.entry('Number').serialize();
      expect(() => pasteEntry(fixtureText, fresh.section(section), payload), section).not.toThrow();
    }
  });

  it('refuseDisallowedPaste refuses a class the section does not allow as a TransferRefused, in the words the paste always used', () => {
    const d = opened(ARCH);
    const svc = d.entry('ServiceInterface').serialize();
    const di = d.entry('DataInterface').serialize();
    let thrown: unknown;
    try {
      refuseDisallowedPaste(d.section('design'), [di, svc]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TransferRefused);
    expect((thrown as Error).name).toBe('TransferRefused');
    expect((thrown as Error).message).toBe('Failed to apply edit: A "Simulink.ServiceBus" entry is not allowed in Design Data.');
    expect(() => refuseDisallowedPaste(d.section('design'), [di])).not.toThrow();
    // A classless payload into Configurations, as vscode's structuralEdit.test.ts pinned it ("a
    // dictionary transfer target", restored ahead of vscode's V4): the full text, prefix and all.
    const data = opened(DATA);
    const payload = data.entry('Number').serialize() as Record<string, unknown>;
    let refused: unknown;
    try {
      refuseDisallowedPaste(data.section('config'), [payload]);
    } catch (err) {
      refused = err;
    }
    expect(refused).toBeInstanceOf(TransferRefused);
    expect((refused as Error).message).toBe('Failed to apply edit: A MATLAB variable is not allowed in Configurations.');
    expect(() => refuseDisallowedPaste(data.section('other'), [payload]), 'and takes what it allows').not.toThrow();
  });
});

describe('prepareEntryForPaste', () => {
  it('pastes a uniquely-named copy, attached to the live section', () => {
    const d = opened(DATA);
    const src = d.entry('Number');
    const design = src.parent;
    const node = prepareEntryForPaste(design, src.serialize());
    expect(node.name).toBe('Number1');
    expect(design.children).toContain(node);
    expect(design.children).toContain(src);
  });

  it('cross-section paste rewrites the namespace and isderived to the target section’s', () => {
    const d = opened(DATA);
    const node = prepareEntryForPaste(d.section('other'), d.entry('Number').serialize());
    expect(node.metadata.namespace).toBe(getSectionMetadata('other').namespace);
    expect(node.metadata.isderived).toBe(getSectionMetadata('other').isderived);
    // A new name in another namespace: Other Data's own.
    expect(node.name).toBe('Number');
  });

  it('rebinds the section even when the payload declares no metadata at all', () => {
    const d = opened(DATA);
    const node = prepareEntryForPaste(d.section('other'), { name: 'Hand', value: 5 });
    expect(node.metadata).toMatchObject({ namespace: getSectionMetadata('other').namespace, isderived: '0' });
    expect(node.parent.name).toBe('other');
  });

  it('gives the pasted copy a fresh unique uuid, not the source uuid', () => {
    const d = opened(DATA);
    const payload = d.entry('Number').serialize();
    const sourceUuid = payload.metadata.uuid;
    const node = prepareEntryForPaste(d.section('design'), payload);
    expect(node.metadata.uuid).not.toBe(sourceUuid);
    expect(node.metadata.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // The payload handed in is not changed.
    expect(payload.metadata.uuid).toBe(sourceUuid);
  });

  it('names the entry when a non-scalar variable would become an invalid Constant', () => {
    const d = opened(ARCH);
    expect(() => prepareEntryForPaste(d.section('arch'), { name: 'Arr', metadata: { uuid: 'u' }, value: [1, 2, 3] })).toThrow(
      "The value for constant 'Arr' must be scalar and numeric.",
    );
  });

  it('refuses a MATLAB struct in Architectural Data, and still converts a scalar-numeric variable into a Constant there', () => {
    const d = opened(DATA);
    expect(() => prepareEntryForPaste(d.section('arch'), d.entry('Struct').serialize())).toThrow(/must be scalar and numeric/);
    const k = prepareEntryForPaste(d.section('arch'), d.entry('Number').serialize());
    expect(k.constructor.name).toBe('ConstantNode');
  });

  it('the SAME non-scalar variable pastes fine into design (stays a Variable)', () => {
    const d = opened(ARCH);
    const node = prepareEntryForPaste(d.section('design'), { name: 'Vec', metadata: { uuid: 'seed', namespace: NS_DESIGN, isderived: '0' }, value: [1, 2, 3] });
    expect(node.constructor.name).toBe('MatlabVariableNode');
  });

  // C-180. A paste copies an mpt object MATLAB already wrote, so core admits an mpt.Parameter or
  // mpt.Signal into Design Data, while creating one from scratch stays refused.
  for (const [name, from, cls] of [['gravity', 'Simulink.Parameter', 'mpt.Parameter'], ['sig1', 'Simulink.Signal', 'mpt.Signal']] as const) {
    const reclassed = (): Any => {
      const text = readFileSync(PARAMS, 'utf8');
      const at = text.indexOf(`"name": "${name}"`);
      const c = text.indexOf(`"_array_class": "${from}"`, at);
      const mpt = text.slice(0, c) + `"_array_class": "${cls}"` + text.slice(c + `"_array_class": "${from}"`.length);
      const session = createSession();
      return ingest(session, ab(new TextEncoder().encode(mpt)), { filename: 'params.sldd' });
    };
    it(`pastes a copy of an ${cls} into Design Data, and the copy keeps its class; refuses it in Architectural Data`, () => {
      const root = reclassed();
      const source = (root.children as Any[]).flatMap((s) => s.children).find((e: Any) => e.name === name);
      const payload = source.serialize();
      expect(payload.value._array_class).toBe(cls);
      const copy = prepareEntryForPaste(root.getSection('design'), payload);
      expect([copy.className, copy.parent.name]).toEqual([cls, 'design']);
      expect(() => prepareEntryForPaste(root.getSection('arch'), payload)).toThrow(`A "${cls}" entry is not allowed in Architectural Data.`);
    });
  }
});

describe('assertConstantValueAllowed', () => {
  it('holds a node a derived section made a Constant of to scalar and numeric, and passes others by', () => {
    const arch = { name: 'arch' };
    expect(() => assertConstantValueAllowed(arch, { name: 'v', isScalarNumeric: false })).toThrow("The value for constant 'v' must be scalar and numeric.");
    expect(() => assertConstantValueAllowed(arch, { name: 'v', isScalarNumeric: true })).not.toThrow();
    // An object entry exposes no flag, and is exempt; a classless one must prove it.
    expect(() => assertConstantValueAllowed(arch, { name: 'bus' })).not.toThrow();
    expect(() => assertConstantValueAllowed(arch, { name: 's' }, true)).toThrow("The value for constant 's' must be scalar and numeric.");
    // Not a derived section: nothing to hold.
    expect(() => assertConstantValueAllowed({ name: 'design' }, { name: 'v', isScalarNumeric: false }, true)).not.toThrow();
  });
});

describe('cloneForPaste and recordCopy', () => {
  it('cloneForPaste produces an independent copy', () => {
    const original = { name: 'X', metadata: { uuid: '1' }, value: { a: 1 } };
    const clone = cloneForPaste(original);
    (clone.metadata as Any).uuid = '2';
    expect((original.metadata as Any).uuid).toBe('1');
  });

  it('keeps an Inf, a -Inf, a NaN and a -0 as the numbers they are, where a JSON round trip does not', () => {
    const copy = recordCopy({ value: [Infinity, -Infinity, NaN, -0], s: { a: Infinity } }) as Any;
    expect(copy.value[0]).toBe(Infinity);
    expect(copy.value[1]).toBe(-Infinity);
    expect(Number.isNaN(copy.value[2])).toBe(true);
    expect(Object.is(copy.value[3], -0)).toBe(true);
    expect(copy.s.a).toBe(Infinity);
  });

  it('is the round trip otherwise: undefined dropped (null in an array), toJSON asked, __proto__ a key, BigInt refused naming where', () => {
    const copy = recordCopy({ u: undefined, f: () => 1, arr: [undefined, 1], d: { toJSON: () => 'T' }, ['__proto__']: { x: 1 } }) as Any;
    expect(Object.keys(copy)).toEqual(['arr', 'd', '__proto__']);
    expect(copy.arr).toEqual([null, 1]);
    expect(copy.d).toBe('T');
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(() => recordCopy({ a: [1, 2n] })).toThrow('Do not know how to serialize a BigInt (at a[1])');
  });
});

describe('findEntryBySelector', () => {
  const model = {
    children: [
      { children: [{ name: 'A', metadata: { uuid: 'u1' } }, { name: 'B', metadata: { uuid: 'u2' } }] },
      { children: [{ name: 'A', metadata: { uuid: 'u3' } }] },
    ],
  };
  it('finds a name answered once, and consults the uuid only when the name answers more than once', () => {
    expect(findEntryBySelector(model, 'B')).toBe(model.children[0].children[1]);
    expect(findEntryBySelector(model, { name: 'B', uuid: 'other' })).toBe(model.children[0].children[1]);
    expect(findEntryBySelector(model, { name: 'A', uuid: 'u3' })).toBe(model.children[1].children[0]);
  });
  it('answers null rather than guessing', () => {
    expect(findEntryBySelector(model, 'A')).toBeNull();
    expect(findEntryBySelector(model, { name: 'A', uuid: 'nope' })).toBeNull();
    expect(findEntryBySelector(model, 'Z')).toBeNull();
  });
});

describe('refuseUnwrittenNumber: the safety net for a record still holding a bare non-finite number', () => {
  it('is refused, naming the entry and where in it the number is', () => {
    const struct = { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ gain: Infinity }], _fields: ['gain'], _mw_element_type: 'MATLABArray' };
    expect(() => refuseUnwrittenNumber({ name: 'held' }, { value: struct })).toThrow(
      'Cannot paste "held" into a text dictionary: it holds Inf (in gain), which would be written there as null. Nothing was pasted.',
    );
    expect(() => refuseUnwrittenNumber({ name: 'bare' }, { value: NaN })).toThrow(
      'Cannot paste "bare" into a text dictionary: it holds NaN, which would be written there as null. Nothing was pasted.',
    );
    expect(() => refuseUnwrittenNumber({ name: 'neg' }, { value: [1, -Infinity] })).toThrow('it holds -Inf, which');
  });

  it("passes a text dictionary's own overflowing extent, which its save writes as it always has", () => {
    const value = { _array_type: 'Cell', _dimensions: [1, Infinity], _elements: [], _mw_element_type: 'MATLABArray' };
    expect(() => refuseUnwrittenNumber({ name: 'dims' }, { value })).not.toThrow();
    expect(() => refuseUnwrittenNumber({ name: 'fine' }, { value: { _type: 'double', _value: 'Inf' } })).not.toThrow();
  });
});
