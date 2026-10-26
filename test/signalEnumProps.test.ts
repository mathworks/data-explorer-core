// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Signal's Complexity and DimensionsMode are dropdowns over the Signal's own sets, in
// the table and in the Property Inspector, and an edit is saved the way MATLAB saves it.
//
// Measured in R2027a (27.1.0.3409468): `set(Simulink.Signal, 'Complexity')` is auto|real|complex
// and `set(Simulink.Signal, 'DimensionsMode')` is auto|Fixed|Variable, both defaulting to 'auto',
// and mpt.Signal has the same two sets. Anything else is refused with "There is no enumerated
// value named 'X'." A text dictionary MATLAB writes holds a non-default value as a top-level key
// and leaves the key out at 'auto' (sigA: set to 'complex' and back to 'auto', no key); a binary
// one always holds the key, as `<P Name="Complexity" Class="char">auto</P>`.
//
// Both used to be read-only labels, though BusElement and ValueType already offered the same two
// properties as dropdowns over their own sets. Worse, `setProperty('complexity', 'complex')`
// answered true: the label descriptor has no node field, so the generic tail wrote the text onto
// a stray lowercase `complexity` field that nothing shows and nothing saves. The ruling
// (2026-10-16, group E, theme 2: follow MATLAB; C-030) is BusElement's and ValueType's mechanism
// with the Signal's own sets. Dimensions stays a label.
//
// Driven through the session API a host uses (`ingest`, `editProperty`, `undo`,
// `serializeSource`) and through the node's own `setProperty`, `toRow` and `toPIObject`, over
// Signals MATLAB wrote: sigC (complex, Variable), sigR (real, Fixed), sigA and sigNo (both 'auto')
// in test/fixtures/classes_r2027a_{text,binary}.sldd (test/fixtures/make_classes_r2027a.m), and
// sig1 in test/parity/artifacts/{text,binary}/params.sldd. Also over an mpt.Signal and over
// `createDefault`, which is what a new entry starts as.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { createSession, ingest, type SerializedSource } from '../src/index.js';
import SignalNode from '../src/datamodel/node/data/SignalNode.js';
import * as NodeClassMap from '../src/datamodel/node/data/NodeClassMap.js';
import { buildPILayout } from '../src/datamodel/node/schemaBridge.js';
import type DataNode from '../src/datamodel/node/DataNode.js';

type Format = 'text' | 'binary';
const FORMATS: Format[] = ['text', 'binary'];

// The two properties, each with MATLAB's set and a value from the other set, which MATLAB refuses.
const ENUMS = [
  { prop: 'complexity', key: 'Complexity', options: ['auto', 'real', 'complex'], to: 'complex', foreign: 'Fixed' },
  { prop: 'dimensionsMode', key: 'DimensionsMode', options: ['auto', 'Fixed', 'Variable'], to: 'Variable', foreign: 'real' },
] as const;

function classesFixture(format: Format): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/classes_r2027a_${format}.sldd`, import.meta.url))));
}
function paramsFixture(format: Format): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./parity/artifacts/${format}/params.sldd`, import.meta.url))));
}

function open(content: Uint8Array | string, filename = 'classes.sldd') {
  const session = createSession();
  const source: any = ingest(session, content, { filename });
  return { session, source };
}

function saved(session: any, source: any): Uint8Array | string {
  const out = session.serializeSource(source.name) as SerializedSource;
  return out.kind === 'binary' ? out.bytes : out.text;
}

function entryIn(root: any, name: string): DataNode {
  const stack = [root];
  while (stack.length) {
    const n = stack.shift();
    if (n?.name === name && n.className && !String(n.id ?? '').startsWith('section:')) {
      return n as DataNode;
    }
    stack.push(...(n?.children ?? []));
  }
  throw new Error(`no entry "${name}"`);
}

// A text dictionary's entry value, and a binary one's `<Element Class="Simulink.Signal">` XML.
function textValue(text: string, entry: string): any {
  const entries = JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries as any[];
  return entries.find((e) => e.name === entry).value;
}
function signalXml(bytes: Uint8Array, entry: string): string {
  const xml = strFromU8(unzipSync(bytes)['data/chunk0.xml']);
  const at = xml.indexOf(`<P Name="Name" Class="char">${entry}</P>`);
  expect(at, `no entry ${entry} in the chunk`).toBeGreaterThan(-1);
  const open = xml.indexOf('<Element Class="Simulink.Signal">', at);
  const close = xml.indexOf('</Object>', at);
  expect(open > at && open < close, `${entry} is not a Simulink.Signal`).toBe(true);
  return xml.slice(open, close);
}
// The entry as a save spelled it: the text entry's top-level property bag, or the binary entry's XML.
function spelled(content: Uint8Array | string, entry: string): Record<string, unknown> | string {
  return typeof content === 'string' ? textValue(content, entry)._elements[0]._properties : signalXml(content, entry);
}
function topLevelEnums(content: Uint8Array | string, entry: string): Record<string, unknown> {
  if (typeof content === 'string') {
    const bag = spelled(content, entry) as Record<string, unknown>;
    return Object.fromEntries(['Complexity', 'DimensionsMode'].filter((k) => k in bag).map((k) => [k, bag[k]]));
  }
  const xml = signalXml(content, entry);
  const out: Record<string, unknown> = {};
  for (const k of ['Complexity', 'DimensionsMode']) {
    const m = xml.match(new RegExp(`<P Name="${k}" Class="char">([^<]*)</P>`));
    if (m) {
      out[k] = m[1];
    }
  }
  return out;
}

const cell = (node: DataNode, column: string) => (node.toRow() as Record<string, any>)[column];
// What the cell shows, whether it is a select (`{text, …}`) or a label (a plain string).
const cellText = (node: DataNode, column: string): string => {
  const c = cell(node, column);
  return typeof c === 'string' ? c : c.text;
};
function piRow(node: DataNode, key: string) {
  const pi = node.toPIObject()!;
  const item = (pi.propertySheet.properties as any[]).find((p) => p.name === key);
  return { shown: (pi.objects[0] as Record<string, unknown>)[key], editable: item?.editable };
}
const piGroupKeys = (node: DataNode, group: string): string[] =>
  ((node.toPIObject()!.propertySheet.groups as any[]).find((g) => g.displayName === group)?.items ?? []).map((it: any) => it.name);
const piGroups = (node: DataNode): string[] => (node.toPIObject()!.propertySheet.groups as any[]).map((g) => g.displayName);

function mptSignal(props: Record<string, unknown>): DataNode {
  const rawVal = {
    _array_class: 'mpt.Signal',
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: props }],
  };
  return NodeClassMap.parseValue(rawVal, 'mSig', null) as DataNode;
}
const textBag = (node: DataNode) =>
  JSON.parse(JSON.stringify((node.serializeValue() as any)._elements[0]._properties)) as Record<string, unknown>;

describe("a Signal's Complexity and DimensionsMode are dropdowns over the Signal's own sets", () => {
  for (const format of FORMATS) {
    describe(`MATLAB-written Signals, ${format} dictionary`, () => {
      it('shows each value in an editable select cell, and the same value in the Property Inspector', () => {
        const { source } = open(classesFixture(format));
        for (const [entry, shown] of [
          ['sigNo', { complexity: 'auto', dimensionsMode: 'auto' }],
          ['sigA', { complexity: 'auto', dimensionsMode: 'auto' }],
          ['sigC', { complexity: 'complex', dimensionsMode: 'Variable' }],
          ['sigR', { complexity: 'real', dimensionsMode: 'Fixed' }],
        ] as const) {
          const node = entryIn(source, entry);
          expect(node.className).toBe('Simulink.Signal');
          for (const e of ENUMS) {
            expect(cell(node, e.prop), `${entry} ${e.prop}`).toEqual({
              text: shown[e.prop],
              editable: true,
              editor: 'select',
              options: e.options,
            });
            expect(piRow(node, e.prop), `${entry} ${e.prop}`).toEqual({ shown: shown[e.prop], editable: true });
          }
        }
      });

      it('saves an edit under the key and spelling MATLAB wrote for sigC', () => {
        const { session, source } = open(classesFixture(format));
        const node = entryIn(source, 'sigNo');
        for (const e of ENUMS) {
          expect(node.setProperty(e.prop, e.to)).toBe(true);
          expect(cellText(node, e.prop)).toBe(e.to);
          expect(piRow(node, e.prop).shown).toBe(e.to);
        }
        expect(node.status).toBe('Modified');

        const out = saved(session, source);
        const matlab = classesFixture(format);
        const asMatlab = format === 'binary' ? matlab : strFromU8(matlab);
        expect(topLevelEnums(out, 'sigNo')).toEqual({ Complexity: 'complex', DimensionsMode: 'Variable' });
        // The whole Signal, not just the two keys: sigNo edited is what MATLAB wrote for sigC (the
        // text bag as a value, its keys in any order; the binary element character for character).
        expect(spelled(out, 'sigNo')).toEqual(spelled(asMatlab, 'sigC'));

        // And the saved file reads back as what was set.
        const again = entryIn(open(out).source, 'sigNo') as any;
        expect(again.Complexity).toBe('complex');
        expect(again.DimensionsMode).toBe('Variable');
        expect(cellText(again, 'complexity')).toBe('complex');
        expect(cellText(again, 'dimensionsMode')).toBe('Variable');
      });

      it("refuses the other property's values in MATLAB's words, and changes nothing", () => {
        const { session, source } = open(classesFixture(format));
        const node = entryIn(source, 'sigC') as any;
        const before = saved(session, source);
        for (const e of ENUMS) {
          const was = cellText(node, e.prop);
          expect(node.setProperty(e.prop, e.foreign)).toEqual({
            error: true,
            reason: `There is no enumerated value named '${e.foreign}'.`,
            invalidValue: e.foreign,
            validValue: was,
          });
          expect(node[e.key]).toBe(was);
          expect(cellText(node, e.prop)).toBe(was);
        }
        expect(node.status).not.toBe('Modified');
        expect(saved(session, source)).toEqual(before);
      });

      it("set back to 'auto', a text Signal writes what MATLAB wrote for sigA, and a binary one writes auto", () => {
        const { session, source } = open(classesFixture(format));
        const node = entryIn(source, 'sigNo');
        const untouched = spelled(saved(session, source), 'sigNo');
        for (const e of ENUMS) {
          expect(node.setProperty(e.prop, e.to)).toBe(true);
        }
        expect(topLevelEnums(saved(session, source), 'sigNo')).toEqual({ Complexity: 'complex', DimensionsMode: 'Variable' });
        for (const e of ENUMS) {
          expect(node.setProperty(e.prop, 'auto')).toBe(true);
          expect(cellText(node, e.prop)).toBe('auto');
        }
        const out = saved(session, source);
        if (format === 'text') {
          // No key, as MATLAB left none for sigA, and the entry is the one an untouched save wrote.
          expect(topLevelEnums(out, 'sigNo')).toEqual({});
          expect(topLevelEnums(strFromU8(classesFixture('text')), 'sigA')).toEqual({});
          expect(spelled(out, 'sigNo')).toEqual(untouched);
        } else {
          expect(topLevelEnums(out, 'sigNo')).toEqual({ Complexity: 'auto', DimensionsMode: 'auto' });
          expect(topLevelEnums(out, 'sigNo')).toEqual(topLevelEnums(classesFixture('binary'), 'sigA'));
        }
      });

      it("a cleared cell shows 'auto' and is saved as 'auto', never as an empty char", () => {
        const { session, source } = open(classesFixture(format));
        const node = entryIn(source, 'sigC');
        for (const e of ENUMS) {
          expect(node.setProperty(e.prop, '')).toBe(true);
          expect(cellText(node, e.prop)).toBe('auto');
          expect(piRow(node, e.prop).shown).toBe('auto');
        }
        const out = saved(session, source);
        // sigC carried both keys, so both stay, at MATLAB's default; '' is a value neither has.
        expect(topLevelEnums(out, 'sigC')).toEqual({ Complexity: 'auto', DimensionsMode: 'auto' });
        const again = entryIn(open(out).source, 'sigC') as any;
        expect(cellText(again, 'complexity')).toBe('auto');
        expect(cellText(again, 'dimensionsMode')).toBe('auto');
      });

      it('an edit through the session is one undo step each, and the undo puts the shown value back', () => {
        const { session, source } = open(classesFixture(format));
        const node = entryIn(source, 'sigR');
        session.setActiveContext(source);
        session.setActive(source, node);
        expect(session.editProperty(node.id, 'complexity', 'complex')).toBe(true);
        expect(session.editProperty(node.id, 'dimensionsMode', 'auto')).toBe(true);
        expect(cellText(node, 'complexity')).toBe('complex');
        expect(cellText(node, 'dimensionsMode')).toBe('auto');
        session.undo();
        expect(cellText(node, 'dimensionsMode')).toBe('Fixed');
        session.undo();
        expect(cellText(node, 'complexity')).toBe('real');
      });

      it('keeps the Property Inspector layout the schema authored, and lists neither key under "Other"', () => {
        const { source } = open(classesFixture(format));
        const node = entryIn(source, 'sigC');
        expect(node.setProperty('complexity', 'real')).toBe(true);
        expect(piRow(node, 'complexity')).toEqual({ shown: 'real', editable: true });
        // The same groups and the same rows, in the same order, as the schema's own route.
        for (const g of buildPILayout('Simulink.Signal')!) {
          expect(piGroupKeys(node, g.group), g.group).toEqual(g.items.map((pc) => pc.key));
        }
        // The catch-all lists what no row shows (LoggingInfo, spelled as it spells a key), and
        // neither enum, which the rows above show. LoggingInfo is one row or seven by what the
        // file holds: MATLAB's text writer gives it no properties, so it is the object by its
        // class, and its binary writer states all seven, which the group flattens one level
        // (C-032, #123: a binary 1x1 object is the same object as out of a .mat).
        expect(piGroups(node)).toEqual([...buildPILayout('Simulink.Signal')!.map((g) => g.group), 'Other']);
        expect(piGroupKeys(node, 'Other')).toEqual(
          format === 'text'
            ? ['Other.LoggingInfo']
            : [
                'Other.LoggingInfo.DataLogging',
                'Other.LoggingInfo.NameMode',
                'Other.LoggingInfo.LoggingName',
                'Other.LoggingInfo.DecimateData',
                'Other.LoggingInfo.Decimation',
                'Other.LoggingInfo.LimitDataPoints',
                'Other.LoggingInfo.MaxPoints',
              ],
        );
        // Dimensions is not part of the ruling: a text box, as a MAT-file's (dictObjectEdit).
        expect(cell(node, 'dimensions')).toMatchObject({ text: '-1', editable: true, editor: 'text' });
        expect(piRow(node, 'dimensions').editable).toBe(true);
      });
    });

    it(`sig1 in params.sldd (${format}) round-trips an edit, and an untouched save writes no new key`, () => {
      const { session, source } = open(paramsFixture(format), 'params.sldd');
      const untouched = topLevelEnums(saved(session, source), 'sig1');
      // MATLAB wrote no key into the text file (the value is 'auto') and both into the binary one.
      expect(untouched).toEqual(format === 'text' ? {} : { Complexity: 'auto', DimensionsMode: 'auto' });

      const node = entryIn(source, 'sig1');
      for (const e of ENUMS) {
        expect(cell(node, e.prop)).toEqual({ text: 'auto', editable: true, editor: 'select', options: e.options });
        expect(node.setProperty(e.prop, e.to)).toBe(true);
      }
      const out = saved(session, source);
      expect(topLevelEnums(out, 'sig1')).toEqual({ Complexity: 'complex', DimensionsMode: 'Variable' });
      const again = entryIn(open(out, 'params.sldd').source, 'sig1') as any;
      expect(again.Complexity).toBe('complex');
      expect(again.DimensionsMode).toBe('Variable');
      // The rest of the Signal is as it was.
      expect(again.Min).toBe(-10);
      expect(again.Max).toBe(10);
      expect(again.DataType).toBe('single');
    });
  }

  it('an mpt.Signal takes the same two sets, on both save paths', () => {
    const node = mptSignal({ DataType: 'single', DocUnits: 'm/s' }) as any;
    expect(node.className).toBe('mpt.Signal');
    for (const e of ENUMS) {
      expect(cell(node, e.prop)).toEqual({ text: 'auto', editable: true, editor: 'select', options: e.options });
      expect(node.setProperty(e.prop, e.foreign)).toMatchObject({
        error: true,
        reason: `There is no enumerated value named '${e.foreign}'.`,
      });
      expect(node.setProperty(e.prop, e.to)).toBe(true);
      expect(piRow(node, e.prop).shown).toBe(e.to);
    }
    expect(node._getSerializedProperties()).toMatchObject({ Complexity: 'complex', DimensionsMode: 'Variable' });
    expect(textBag(node)).toMatchObject({ Complexity: 'complex', DimensionsMode: 'Variable' });
    const again = NodeClassMap.parseValue(JSON.parse(JSON.stringify(node.serializeValue())), 'mSig', null) as any;
    expect(again.className).toBe('mpt.Signal');
    expect(cellText(again, 'complexity')).toBe('complex');
    expect(cellText(again, 'dimensionsMode')).toBe('Variable');
  });

  it('a new Signal starts at auto, writes an edit, and writes nothing once it is back at auto', () => {
    const node = SignalNode.createDefault('s', null) as any;
    for (const e of ENUMS) {
      expect(cell(node, e.prop)).toEqual({ text: 'auto', editable: true, editor: 'select', options: e.options });
    }
    // MATLAB's own default Signal has neither key (createDefault's comment), and saves none.
    expect(textBag(node)).not.toHaveProperty('Complexity');
    expect(node._getSerializedProperties()).not.toHaveProperty('DimensionsMode');
    expect(node.setProperty('complexity', 'complex')).toBe(true);
    expect(node.setProperty('dimensionsMode', 'Fixed')).toBe(true);
    expect(textBag(node)).toMatchObject({ Complexity: 'complex', DimensionsMode: 'Fixed' });
    expect(node._getSerializedProperties()).toMatchObject({ Complexity: 'complex', DimensionsMode: 'Fixed' });
    expect(node.setProperty('complexity', 'auto')).toBe(true);
    expect(node.setProperty('dimensionsMode', 'auto')).toBe(true);
    expect(textBag(node)).not.toHaveProperty('Complexity');
    expect(textBag(node)).not.toHaveProperty('DimensionsMode');
    expect(node._getSerializedProperties()).not.toHaveProperty('Complexity');
    expect(node._getSerializedProperties()).not.toHaveProperty('DimensionsMode');
  });
});
