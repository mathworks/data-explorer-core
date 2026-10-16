// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Parameter's or Simulink.Signal's Alignment (CoderInfo.Alignment) is edited in its
// table cell, by MATLAB's rule, and saved the way MATLAB saves it.
//
// Measured in R2027a (27.1.0.3409468, 2026-10-16):
//   - The value is -1, or a power of two from 1 to 2^30. The input is converted as int32 first:
//     1.5 becomes 2 and is accepted, 2.5 becomes 3 and is refused, 2^31 saturates to 2147483647
//     and is refused, and true is 1. Anything else is refused with "<n> is not a valid alignment
//     boundary. The alignment boundary must be either -1 or a power of two no more than 128."
//     The "no more than 128" is not what MATLAB does (256 through 2^30 are all accepted), so the
//     refusal here leaves it out. A char value is refused with "Value must be numeric or
//     logical."
//   - Under StorageClass 'Auto' every value but -1 is refused, AFTER the value check: "Cannot
//     set Alignment when StorageClass is 'Auto'." Setting StorageClass back to 'Auto' resets
//     Alignment to -1.
//   - A text dictionary holds a non-default Alignment as {"_type": "int32", "_value": "8"}, the
//     first key of CoderInfo's _properties, and leaves the key out at -1 (pAlM1: set to 8, then
//     back to -1). A binary one always holds <P Name="Alignment" Class="int32">…</P>.
//   - Read back: a typed int32, a typed double and a bare number all load. A STRING "16" loads
//     as -1, silently, so a string is never written.
//
// The ruling (2026-10-16, group E, theme 2: follow MATLAB; C-086) makes the read-only label an
// editable text cell wherever MATLAB takes an edit. Driven through the session API a host uses
// (`ingest`, `editProperty`, `undo`, `serializeSource`) and through the node's own
// `setProperty` and `toRow`, over entries MATLAB wrote in
// test/fixtures/classes_r2027a_{text,binary}.sldd (test/fixtures/make_classes_r2027a.m):
// pAl8 (ExportedGlobal, 8), pAlM1 (ExportedGlobal, 8 then -1), pSC (ExportedGlobal), pNo
// (Auto), all Simulink.Parameter(1), and sAl16 (a Simulink.Signal, ExportedGlobal, 16).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { createSession, ingest, type SerializedSource } from '../src/index.js';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import SignalNode from '../src/datamodel/node/data/SignalNode.js';
import * as NodeClassMap from '../src/datamodel/node/data/NodeClassMap.js';
import type DataNode from '../src/datamodel/node/DataNode.js';

type Format = 'text' | 'binary';
const FORMATS: Format[] = ['text', 'binary'];

const AUTO = "Cannot set Alignment when StorageClass is 'Auto'.";
const NUMERIC = 'Value must be numeric or logical.';
const invalid = (n: number) =>
  `${n} is not a valid alignment boundary. The alignment boundary must be either -1 or a power of two.`;

function fixture(format: Format): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/classes_r2027a_${format}.sldd`, import.meta.url))));
}
const asRead = (format: Format): Uint8Array | string => (format === 'binary' ? fixture(format) : strFromU8(fixture(format)));

function open(content: Uint8Array | string) {
  const session = createSession();
  const source: any = ingest(session, content, { filename: 'classes.sldd' });
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

// A text dictionary's entry value.
function textValue(text: string, entry: string): any {
  const entries = JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries as any[];
  return entries.find((e) => e.name === entry).value;
}
const textCoderInfo = (text: string, entry: string): Record<string, unknown> =>
  textValue(text, entry)._elements[0]._properties.CoderInfo._properties;

// A binary dictionary entry's whole <Element Class="Simulink.CoderInfo">…</Element>, nesting counted.
function coderInfoXml(bytes: Uint8Array, entry: string): string {
  const xml = strFromU8(unzipSync(bytes)['data/chunk0.xml']);
  const at = xml.indexOf(`<P Name="Name" Class="char">${entry}</P>`);
  expect(at, `no entry ${entry} in the chunk`).toBeGreaterThan(-1);
  const start = xml.indexOf('<Element Class="Simulink.CoderInfo">', at);
  expect(start, `${entry} has no CoderInfo`).toBeGreaterThan(at);
  const tag = /<Element\b[^>]*?(\/?)>|<\/Element>/g;
  tag.lastIndex = start;
  let depth = 0;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    if (m[0] === '</Element>') {
      depth--;
    } else if (m[1] !== '/') {
      depth++;
    }
    if (depth === 0) {
      return xml.slice(start, m.index + m[0].length);
    }
  }
  throw new Error(`${entry}: CoderInfo element is not closed`);
}

// The entry's CoderInfo as a save spelled it: the text bag (compared as JSON, so key order counts), or the XML.
function coderInfo(content: Uint8Array | string, entry: string): string {
  return typeof content === 'string' ? JSON.stringify(textCoderInfo(content, entry)) : coderInfoXml(content, entry);
}
// What the save holds for Alignment: the text leaf (undefined when the key is left out), or the XML <P>.
function alignmentSpelled(content: Uint8Array | string, entry: string): unknown {
  if (typeof content === 'string') {
    return textCoderInfo(content, entry).Alignment;
  }
  const m = coderInfoXml(content, entry).match(/<P Name="Alignment"[^>]*>[^<]*<\/P>/g);
  expect(m, `${entry}: one Alignment`).toHaveLength(1);
  return m![0];
}
const int32Spelled = (format: Format, n: number) =>
  format === 'text' ? { _type: 'int32', _value: String(n) } : `<P Name="Alignment" Class="int32">${n}</P>`;

const cell = (node: DataNode, column = 'alignment') => (node.toRow() as Record<string, any>)[column];
const cellText = (node: DataNode, column = 'alignment'): string => {
  const c = cell(node, column);
  return typeof c === 'string' ? c : c.text;
};
const editableCell = (text: string) => ({ text, editable: true, editor: 'text' });
function piRow(node: DataNode, key: string) {
  const pi = node.toPIObject()!;
  const item = (pi.propertySheet.properties as any[]).find((p) => p.name === key);
  return { shown: (pi.objects[0] as Record<string, unknown>)[key], editable: item?.editable };
}
const refusal = (reason: string, invalidValue: string, validValue: string) => ({ error: true, reason, invalidValue, validValue });

describe("Alignment is edited in its table cell by MATLAB's rule, and saved as MATLAB saves it", () => {
  for (const format of FORMATS) {
    describe(`MATLAB-written entries, ${format} dictionary`, () => {
      it('is an editable text cell where StorageClass is not Auto, and a plain string under Auto', () => {
        const { source } = open(fixture(format));
        for (const [entry, shown] of [['pSC', '-1'], ['pAl8', '8'], ['pAlM1', '-1'], ['sAl16', '16']] as const) {
          const node = entryIn(source, entry);
          expect(cell(node), entry).toEqual(editableCell(shown));
          // The Property Inspector shows the same value; it has no edit channel for the
          // schema's Code Generation rows, Storage Class's included, and stays read-only.
          expect(piRow(node, 'alignment'), entry).toEqual({ shown, editable: false });
        }
        const pNo = entryIn(source, 'pNo');
        expect(cell(pNo)).toBe('-1');
        expect(cell(pNo, 'storageClass').text).toBe('Auto');
      });

      it('saves an edit as MATLAB wrote pAl8, a typed int32 and never a string, and reads it back', () => {
        const { session, source } = open(fixture(format));
        const node = entryIn(source, 'pSC');
        expect(node.setProperty('alignment', '8')).toBe(true);
        expect(cell(node)).toEqual(editableCell('8'));
        expect(node.status).toBe('Modified');

        const out = saved(session, source);
        expect(alignmentSpelled(out, 'pSC')).toEqual(int32Spelled(format, 8));
        // The whole CoderInfo, key order included: pSC edited is what MATLAB wrote for pAl8.
        expect(coderInfo(out, 'pSC')).toBe(coderInfo(asRead(format), 'pAl8'));
        expect(cellText(entryIn(open(out).source, 'pSC'))).toBe('8');
      });

      it('accepts -1 and every power of two from 1 to 2^30, converting the text as int32 does', () => {
        const { session, source } = open(fixture(format));
        const node = entryIn(source, 'pSC');
        for (let k = 0; k <= 30; k++) {
          expect(node.setProperty('alignment', String(2 ** k)), `2^${k}`).toBe(true);
          expect(cellText(node), `2^${k}`).toBe(String(2 ** k));
        }
        // Rounded half away from zero (1.5 → 2, -1.4 → -1), true is 1, and surrounding blanks go.
        for (const [typed, stored] of [['1.5', '2'], ['-1.4', '-1'], ['true', '1'], [' 64 ', '64'], ['+16', '16'], ['3.2e1', '32']]) {
          expect(node.setProperty('alignment', typed), typed).toBe(true);
          expect(cellText(node), typed).toBe(stored);
        }
        expect(node.setProperty('alignment', '1073741824')).toBe(true);
        const out = saved(session, source);
        expect(alignmentSpelled(out, 'pSC')).toEqual(int32Spelled(format, 1073741824));
        expect(cellText(entryIn(open(out).source, 'pSC'))).toBe('1073741824');
      });

      it("refuses what MATLAB refuses, in MATLAB's words, and changes nothing", () => {
        const { session, source } = open(fixture(format));
        const node = entryIn(source, 'pAl8');
        const before = saved(session, source);
        for (const [typed, reason] of [
          ['3', invalid(3)],
          ['0', invalid(0)],
          ['-2', invalid(-2)],
          ['2.5', invalid(3)],
          ['false', invalid(0)],
          ['2147483648', invalid(2147483647)],
          ['2147483647', invalid(2147483647)],
          ['-3000000000', invalid(-2147483648)],
          ['Inf', invalid(2147483647)],
          ['NaN', invalid(0)],
          ['abc', NUMERIC],
          ['8 8', NUMERIC],
          ['0x8', NUMERIC],
          ['', NUMERIC],
          ['  ', NUMERIC],
        ] as const) {
          expect(node.setProperty('alignment', typed), JSON.stringify(typed)).toEqual(refusal(reason, typed, '8'));
          expect(cellText(node)).toBe('8');
        }
        expect(node.status).not.toBe('Modified');
        expect(saved(session, source)).toEqual(before);
      });

      it('under StorageClass Auto, refuses an edit as MATLAB does, after checking the value', () => {
        const { session, source } = open(fixture(format));
        const node = entryIn(source, 'pNo');
        const before = saved(session, source);
        expect(node.setProperty('alignment', '8')).toEqual(refusal(AUTO, '8', '-1'));
        expect(node.setProperty('alignment', '1.5')).toEqual(refusal(AUTO, '1.5', '-1'));
        // MATLAB checks the value before the storage class: 3 under Auto is refused as 3.
        expect(node.setProperty('alignment', '3')).toEqual(refusal(invalid(3), '3', '-1'));
        // -1 is accepted under Auto, as MATLAB accepts it, and it is already the value.
        expect(node.setProperty('alignment', '-1')).toBe(true);
        expect(cell(node)).toBe('-1');
        expect(node.status).not.toBe('Modified');
        expect(saved(session, source)).toEqual(before);
      });

      it("set back to -1, saves what MATLAB wrote for pAlM1: no key in text, int32 -1 in binary", () => {
        const { session, source } = open(fixture(format));
        const node = entryIn(source, 'pAl8');
        expect(node.setProperty('alignment', '-1')).toBe(true);
        expect(cell(node)).toEqual(editableCell('-1'));
        const out = saved(session, source);
        expect(alignmentSpelled(out, 'pAl8')).toEqual(format === 'text' ? undefined : int32Spelled(format, -1));
        expect(alignmentSpelled(asRead(format), 'pAlM1')).toEqual(format === 'text' ? undefined : int32Spelled(format, -1));
        expect(coderInfo(out, 'pAl8')).toBe(coderInfo(asRead(format), 'pAlM1'));

        // A Signal the same way.
        const sig = entryIn(source, 'sAl16');
        expect(sig.className).toBe('Simulink.Signal');
        expect(sig.setProperty('alignment', '-1')).toBe(true);
        expect(alignmentSpelled(saved(session, source), 'sAl16')).toEqual(format === 'text' ? undefined : int32Spelled(format, -1));
      });

      it('setting StorageClass to Auto resets Alignment to -1, as MATLAB does; another class keeps it', () => {
        const { session, source } = open(fixture(format));
        const node = entryIn(source, 'pAl8');
        expect(node.setProperty('storageClass', 'ImportedExtern')).toBe(true);
        expect(cell(node)).toEqual(editableCell('8'));
        expect(node.setProperty('storageClass', 'ExportedGlobal')).toBe(true);
        expect(node.setProperty('storageClass', 'Auto')).toBe(true);
        expect(cell(node)).toBe('-1');
        const out = saved(session, source);
        expect(alignmentSpelled(out, 'pAl8')).toEqual(format === 'text' ? undefined : int32Spelled(format, -1));
        // pAl8 is then what MATLAB wrote for pNo, a default Simulink.Parameter(1).
        expect(coderInfo(out, 'pAl8')).toBe(coderInfo(asRead(format), 'pNo'));
      });

      it('a Parameter added to the dictionary takes an Alignment once its StorageClass allows one', () => {
        const { session, source } = open(fixture(format));
        const node = source.addEntry('Simulink.Parameter', 'pNew', 'design') as DataNode;
        expect(cell(node)).toBe('-1');
        expect(node.setProperty('alignment', '8')).toEqual(refusal(AUTO, '8', '-1'));
        expect(node.setProperty('storageClass', 'ExportedGlobal')).toBe(true);
        expect(cell(node)).toEqual(editableCell('-1'));
        expect(node.setProperty('alignment', '8')).toBe(true);
        const out = saved(session, source);
        expect(alignmentSpelled(out, 'pNew')).toEqual(int32Spelled(format, 8));
        if (typeof out === 'string') {
          // A new key goes where MATLAB's sorted text puts it, first in CoderInfo.
          expect(Object.keys(textCoderInfo(out, 'pNew'))[0]).toBe('Alignment');
        }
        expect(cell(entryIn(open(out).source, 'pNew'))).toEqual(editableCell('8'));
      });

      it('an edit through the session is one undo step, and its undo leaves the entry as it was read', () => {
        const { session, source } = open(fixture(format));
        const node = entryIn(source, 'pSC');
        const before = coderInfo(saved(session, source), 'pSC');
        session.setActiveContext(source);
        session.setActive(source, node);
        expect(session.editProperty(node.id, 'alignment', '16')).toBe(true);
        expect(alignmentSpelled(saved(session, source), 'pSC')).toEqual(int32Spelled(format, 16));
        session.undo();
        expect(cell(node)).toEqual(editableCell('-1'));
        expect(coderInfo(saved(session, source), 'pSC')).toBe(before);
        session.redo();
        expect(cell(node)).toEqual(editableCell('16'));
      });
    });
  }

  describe('the form a text dictionary already holds Alignment in is kept, and a string is replaced', () => {
    // pSC with an Alignment of 16 put in by hand, in the forms MATLAB read back
    // (inj_pscAl{Bare,Typed,Dbl}.sldd: all 16) and the string form, which MATLAB reads as -1.
    function withAlignment(leaf: unknown) {
      const json = JSON.parse(strFromU8(fixture('text')));
      const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries as any[];
      const props = entries.find((e) => e.name === 'pSC').value._elements[0]._properties.CoderInfo._properties;
      props.Alignment = leaf;
      return open(JSON.stringify(json, null, '\t'));
    }
    for (const [form, leaf, after] of [
      ['a bare number', 16, 32],
      ['a typed int32', { _type: 'int32', _value: '16' }, { _type: 'int32', _value: '32' }],
      ['a typed double', { _type: 'double', _value: '16' }, { _type: 'double', _value: '32' }],
      ['a string', '16', { _type: 'int32', _value: '32' }],
    ] as const) {
      it(`${form}`, () => {
        const { session, source } = withAlignment(leaf);
        const node = entryIn(source, 'pSC');
        expect(node.setProperty('alignment', '32')).toBe(true);
        expect(alignmentSpelled(saved(session, source), 'pSC')).toEqual(after);
      });
    }
  });

  describe('a Parameter or Signal that is in no file yet', () => {
    for (const [cls, make] of [
      ['Simulink.Parameter', () => ParameterNode.createDefault('p', null)],
      ['Simulink.Signal', () => SignalNode.createDefault('s', null)],
    ] as const) {
      it(`${cls}: refused under Auto, then written first in CoderInfo, as MATLAB orders it`, () => {
        const node = make() as unknown as DataNode;
        expect(cell(node)).toBe('-1');
        expect(node.setProperty('alignment', '8')).toEqual(refusal(AUTO, '8', '-1'));
        expect(node.setProperty('storageClass', 'ExportedGlobal')).toBe(true);
        expect(cell(node)).toEqual(editableCell('-1'));
        expect(node.setProperty('alignment', '8')).toBe(true);
        const bag = (node as any).serial._properties.CoderInfo._properties;
        expect(Object.keys(bag)[0]).toBe('Alignment');
        expect(bag.Alignment).toEqual({ _type: 'int32', _value: '8' });
        expect(node.setProperty('storageClass', 'Auto')).toBe(true);
        expect(cell(node)).toBe('-1');
      });
    }

    it('an mpt.Parameter, which shares the Simulink.Parameter schema', () => {
      const node = NodeClassMap.parseValue(
        {
          _array_class: 'mpt.Parameter',
          _dimensions: [1, 1],
          _mw_element_type: 'MATLABArray',
          _elements: [
            {
              _properties: {
                Value: 1,
                CoderInfo: {
                  _object_class: 'Simulink.CoderInfo',
                  _properties: { Alignment: { _type: 'int32', _value: '-1' }, StorageClass: 'ExportedGlobal' },
                },
              },
            },
          ],
        },
        'mPar',
        null,
      ) as DataNode;
      expect(cell(node)).toEqual(editableCell('-1'));
      expect(node.setProperty('alignment', '4')).toBe(true);
      expect((node as any).serial._properties.CoderInfo._properties.Alignment).toEqual({ _type: 'int32', _value: '4' });
      expect(node.setProperty('alignment', '5')).toEqual(refusal(invalid(5), '5', '4'));
    });
  });
});
