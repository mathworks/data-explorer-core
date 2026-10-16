// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.VariantBank has no Value, and neither has a Simulink.VariantBankCoderInfo, so the
// entry offers none, takes none, and writes none.
//
// Measured in R2027a (27.1.0.3409468): `properties(Simulink.VariantBank)` is Name, Description,
// VariantConditions, AllChoicesCoderInfo and ActiveChoiceCoderInfo (the saveobj envelope adds
// BankCoderInfo), `isprop(Simulink.VariantBank, 'Value')` is 0, and `vb.Value = 'x'` fails with
// "Unrecognized property 'Value' for class 'Simulink.VariantBank'." A dictionary MATLAB writes
// holds the bank as that envelope alone, in both formats. `properties(Simulink.VariantBankCoderInfo)`
// is HeaderFile, DefinitionFile, PreStatement, PostStatement and Qualifier, all char ('' but for
// Qualifier, 'None'), and the same two answers hold: `isprop(…, 'Value')` is 0, and setting one
// fails with "Unrecognized property 'Value' for class 'Simulink.VariantBankCoderInfo'."
//
// The node used to offer a Value anyway: the cell took an editor, `setProperty('Value', …)`
// returned true, and both save paths wrote the text next to the envelope (`_properties.Value` in
// a text dictionary, `<P Name="Value" Class="char">` in a binary one). MATLAB opens such a file
// without an error or a warning, the object it builds has no Value, and a MATLAB re-save drops
// the key; so the edit was accepted, saved, and had no effect. Every MATLAB-written bank showed
// `''`, a char value the class does not have. The ruling (2026-10-16, group E, theme 2: follow
// MATLAB; C-168 for the bank, C-169 for its coder info) is what #113 did for a bus element
// (BaseBusElementNode): no editor, a Value edit refused, and a Value key the file already carries
// (only ever this package's) shown and written back as it was read.
//
// Driven through the session API a host uses — `ingest`, the node's own `setProperty`, `toRow`
// and `toPIObject`, and `serializeSource` — over vbD and vbciD, a bank and a bank coder info
// MATLAB wrote into test/fixtures/classes_r2027a_{text,binary}.sldd
// (test/fixtures/make_classes_r2027a.m), and over `createDefault`, which is what a new entry
// starts as.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest, type SerializedSource } from '../src/index.js';
import VariantBankNode from '../src/datamodel/node/data/VariantBankNode.js';
import VariantBankCoderInfoNode from '../src/datamodel/node/data/VariantBankCoderInfoNode.js';
import type DataNode from '../src/datamodel/node/DataNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Format = 'text' | 'binary';
const FORMATS: Format[] = ['text', 'binary'];

// Each class, the entry MATLAB wrote of it, the name a rename gives that entry, and the last
// lines of its saveobj `P` in the binary file (where this package's old writer put a Value after).
const CASES = [
  {
    CLASS: 'Simulink.VariantBank',
    Node: VariantBankNode,
    what: 'the bank',
    ENTRY: 'vbD',
    RENAMED: 'vbE',
    envelopeEnd: '<P Name="BankCoderInfo" Class="char"/>\n                    </Element>\n                </P>',
  },
  {
    CLASS: 'Simulink.VariantBankCoderInfo',
    Node: VariantBankCoderInfoNode,
    what: 'the bank coder info',
    ENTRY: 'vbciD',
    RENAMED: 'vbciE',
    envelopeEnd: '<P Name="Qualifier" Class="char">None</P>\n                    </Element>\n                </P>',
  },
] as const;
type Case = (typeof CASES)[number];

function fixture(format: Format): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/classes_r2027a_${format}.sldd`, import.meta.url))));
}

// The text dictionary's entry list, and the binary one's chunk XML, of whatever bytes a save gave.
function textEntries(text: string): any[] {
  return JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries as any[];
}
function chunkXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['data/chunk0.xml']);
}
// The `<Element Class="…">` of one entry, as the binary file spells it.
function bankXml(xml: string, entry: string, CLASS: string): string {
  const at = xml.indexOf(`<P Name="Name" Class="char">${entry}</P>`);
  expect(at, `no entry ${entry} in the chunk`).toBeGreaterThan(-1);
  const open = xml.indexOf(`<Element Class="${CLASS}">`, at);
  const close = xml.indexOf('</Object>', at);
  expect(open > at && open < close, `${entry} is not a ${CLASS}`).toBe(true);
  return xml.slice(open, close);
}

// The entry with a sibling Value 'b1' added to its bytes, in the place and the spelling this
// package's old writer put one (MATLAB, given that file, opened it without a warning). Added to
// the bytes, so the reader is what puts it in the node's bag.
function withValue({ CLASS, ENTRY, envelopeEnd }: Case, format: Format, text: string): Uint8Array | string {
  const bytes = fixture(format);
  if (format === 'text') {
    const json = JSON.parse(strFromU8(bytes));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries as any[];
    const elem = entries.find((e) => e.name === ENTRY).value._elements[0] as Record<string, unknown>;
    expect(elem).not.toHaveProperty('_properties');
    expect(elem).toHaveProperty('_custom_save');
    elem._properties = { Value: text };
    return JSON.stringify(json, null, '\t');
  }
  const parts = unzipSync(bytes);
  const xml = strFromU8(parts['data/chunk0.xml']);
  expect(xml.split(envelopeEnd).length - 1, `one ${CLASS} envelope in the binary fixture`).toBe(1);
  parts['data/chunk0.xml'] = strToU8(
    xml.replace(envelopeEnd, `${envelopeEnd}\n                <P Name="Value" Class="char">${text}</P>`),
  );
  return zipSync(parts);
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

function open(content: Uint8Array | string) {
  const session = createSession();
  const source: any = ingest(session, content, { filename: 'classes.sldd' });
  return { session, source };
}

function saved(session: any, source: any): Uint8Array | string {
  const out = session.serializeSource(source.name) as SerializedSource;
  return out.kind === 'binary' ? out.bytes : out.text;
}

// What a save wrote for the entry: its bag as the reader reads the saved file back, and the
// entry's own spelling in that file (the text entry's element, or the binary entry's XML).
function savedEntry(content: Uint8Array | string, entry: string, CLASS: string) {
  const bag = (entryIn(open(content).source, entry) as any).serial._properties as Record<string, unknown>;
  const spelled =
    typeof content === 'string'
      ? JSON.stringify(textEntries(content).find((e) => e.name === entry).value)
      : bankXml(chunkXml(content), entry, CLASS);
  return { bag, spelled };
}

// The two save paths, each reduced to the bag it puts in the file.
const binaryPath = (node: DataNode) => node._getSerializedProperties();
const textElem = (node: DataNode) => JSON.parse(JSON.stringify((node.serializeValue() as any)._elements[0])) as Record<string, any>;

function piValue(node: DataNode) {
  const pi = node.toPIObject()!;
  const item = (pi.propertySheet.properties as any[]).find((p) => p.name === 'Value');
  return { shown: (pi.objects[0] as Record<string, unknown>).Value, editable: item.editable };
}

function expectRefused(CLASS: string, node: DataNode, text: string) {
  const result = node.setProperty('Value', text);
  expect(result).not.toBe(true);
  expect(result).toMatchObject({
    error: true,
    reason: `'${node.name}' is a ${CLASS}, which has no Value, so none can be set on it.`,
    invalidValue: text,
    validValue: node.displayValue,
  });
}

for (const c of CASES) {
  const { CLASS, Node, what, ENTRY, RENAMED } = c;
  describe(`${CLASS} has no Value`, () => {
    for (const format of FORMATS) {
      describe(`${ENTRY}, ${what} MATLAB wrote, ${format} dictionary`, () => {
        it('shows no Value, and offers no editor in the table or the Property Inspector', () => {
          const node = entryIn(open(fixture(format)).source, ENTRY);
          expect(node.className).toBe(CLASS);
          // Not `''`, which is a char value the class does not have.
          expect(node.displayValue).toBe('');
          expect(node.valueEditable).toBe(false);
          const row = node.toRow()!;
          expect(row.Value).toBe('');
          expect(row._valueEditable).toBe(false);
          expect(piValue(node)).toEqual({ shown: '', editable: false });
        });

        it('refuses a Value edit, and no save writes one', () => {
          const { session, source } = open(fixture(format));
          const node = entryIn(source, ENTRY);

          expectRefused(CLASS, node, 'x');
          // The quoted form the cell would have been seeded with, and the empty text it shows.
          expectRefused(CLASS, node, "'x'");
          expectRefused(CLASS, node, '');
          expect(node.status).not.toBe('Modified');
          expect(node.displayValue).toBe('');
          expect(binaryPath(node)).not.toHaveProperty('Value');
          expect(textElem(node)).not.toHaveProperty('_properties');

          // A rename rewrites the entry from the node, so the save reaches the writer (a binary
          // entry nobody edited is written as the bytes it was read from).
          expect(node.setProperty('Name', RENAMED)).toBe(true);
          const { bag, spelled } = savedEntry(saved(session, source), RENAMED, CLASS);
          expect(bag).not.toHaveProperty('Value');
          expect(spelled).not.toContain('"Value"');
          expect(spelled).not.toContain('<P Name="Value"');
          expect(entryIn(open(saved(session, source)).source, RENAMED).displayValue).toBe('');
        });

        it(`a save writes ${what} back as MATLAB wrote it`, () => {
          // A guard: this held before the ruling too, because an EMPTY Value was never written
          // under an envelope (DataNode._mergeProps). It pins that the change keeps it so.
          const read = open(fixture(format));
          const before = JSON.parse(JSON.stringify((entryIn(read.source, ENTRY) as any).serial._properties));
          const untouched = saved(read.session, read.source);
          if (format === 'text') {
            expect(untouched).toBe(strFromU8(fixture('text')));
          }
          expect(savedEntry(untouched, ENTRY, CLASS).bag).toEqual(before);

          expect(entryIn(read.source, ENTRY).setProperty('Name', RENAMED)).toBe(true);
          const renamed = saved(read.session, read.source);
          expect(savedEntry(renamed, RENAMED, CLASS).bag).toEqual(before);
          const ownSpelling = savedEntry(renamed, RENAMED, CLASS).spelled;
          if (format === 'text') {
            const original = textEntries(strFromU8(fixture('text'))).find((e) => e.name === ENTRY).value;
            expect(JSON.parse(ownSpelling)).toEqual(original);
          } else {
            // The writer's own XML spelling of the envelope (an empty cell as an open and a close
            // tag, say) is not this item's; what is, is that nothing beside the envelope is added.
            expect(ownSpelling).toContain('<P Source="saveobj"');
            expect(ownSpelling).not.toContain('<P Name="Value"');
          }
        });

        it('keeps a Value the file already carries, as read and read-only, on both save paths', () => {
          const { session, source } = open(withValue(c, format, 'b1'));
          const node = entryIn(source, ENTRY);

          expect(node.displayValue).toBe("'b1'");
          expect(node.valueEditable).toBe(false);
          const row = node.toRow()!;
          expect(row.Value).toBe("'b1'");
          expect(row._valueEditable).toBe(false);
          expect(piValue(node)).toEqual({ shown: "'b1'", editable: false });

          expectRefused(CLASS, node, 'changed');
          expectRefused(CLASS, node, "'b1'");
          expect(node.status).not.toBe('Modified');
          expect(binaryPath(node).Value).toBe('b1');
          expect(textElem(node)._properties).toEqual({ Value: 'b1' });

          expect(node.setProperty('Name', RENAMED)).toBe(true);
          const out = saved(session, source);
          const { bag, spelled } = savedEntry(out, RENAMED, CLASS);
          expect(bag.Value).toBe('b1');
          expect(spelled).toContain(format === 'text' ? '"_properties":{"Value":"b1"}' : '<P Name="Value" Class="char">b1</P>');
          expect(entryIn(open(out).source, RENAMED).displayValue).toBe("'b1'");
        });
      });
    }

    it('a new entry (createDefault) shows none, refuses one and saves none', () => {
      const node = Node.createDefault('n', null);
      expect(node.displayValue).toBe('');
      expect(node.valueEditable).toBe(false);
      expect(node.toRow()!._valueEditable).toBe(false);
      expect(piValue(node)).toEqual({ shown: '', editable: false });
      expectRefused(CLASS, node, 'x');
      expect(binaryPath(node)).not.toHaveProperty('Value');
      expect(textElem(node)).not.toHaveProperty('_properties');
      expect(node.serializeXml('P', { Name: 'Value' }, 0)).not.toContain('<P Name="Value" Class="char"');
    });
  });
}
