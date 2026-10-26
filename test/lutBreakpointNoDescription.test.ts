// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.LookupTable and a Simulink.Breakpoint have no Description, so neither offers one.
//
// Measured in R2027a (27.1.0.3409468): `isprop(Simulink.LookupTable, 'Description')` is 0, and
// the same for `Simulink.Breakpoint`. Setting one fails with MATLAB:noPublicFieldForClass,
// "Unrecognized property 'Description' for class 'Simulink.LookupTable'." The class properties
// are Table, BreakpointsSpecification, Breakpoints, AllowMultipleInstancesOf..., SupportTunable-
// Size, CoderInfo and StructTypeInfo, and a Breakpoint has four of them. A dictionary MATLAB
// writes carries no top-level Description key for either class, in either format.
//
// Both nodes used to list one anyway, so the table and the Property Inspector offered an
// editor, `setProperty('Description', …)` returned true, and both save paths wrote the text as
// a top-level key. MATLAB opens such a file without a warning and ignores the key, so the edit
// was accepted, saved, and had no effect. The ruling (2026-10-16, group E, theme 2: follow
// MATLAB) is what Simulink.FunctionElement already does (ServiceBusNode.ts): no Description
// property, an edit to one refused, and a key the file already has written back as it was read.
//
// Driven through the session API a host uses — `ingest`, the node's own `setProperty`, `toRow`
// and `toPIObject`, and `serializeSource` — over the MATLAB-written parity dictionaries in both
// formats, and over `createDefault`, which is what a new entry starts as.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest, type SerializedSource } from '../src/index.js';
import LookupTableNode from '../src/datamodel/node/data/LookupTableNode.js';
import BreakpointNode from '../src/datamodel/node/data/BreakpointNode.js';
import type DataNode from '../src/datamodel/node/DataNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Format = 'text' | 'binary';

const CLASSES = [
  { className: 'Simulink.LookupTable', entry: 'MyLUT', make: (n: string) => LookupTableNode.createDefault(n, null) },
  { className: 'Simulink.Breakpoint', entry: 'MyBkpt', make: (n: string) => BreakpointNode.createDefault(n, null) },
];
const FORMATS: Format[] = ['text', 'binary'];

const GENERAL = ['Name', 'Value', 'DataType', 'Kind', 'Class'];

function fixture(format: Format): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./parity/artifacts/${format}/params.sldd`, import.meta.url))));
}

// The same dictionary with a top-level `Description` key added to one entry's bag, as some
// other writer (or this package, before this change) leaves it. Added to the bytes, so the
// reader is what puts it in the node's bag.
function withDescription(format: Format, entry: string, className: string, text: string): Uint8Array | string {
  const bytes = fixture(format);
  if (format === 'text') {
    const json = JSON.parse(strFromU8(bytes));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries as any[];
    const hit = entries.find((e) => e.name === entry);
    expect(hit, `no ${entry} in the text fixture`).toBeDefined();
    const bag = hit.value._elements[0]._properties as Record<string, unknown>;
    expect(bag).not.toHaveProperty('Description');
    bag.Description = text;
    return JSON.stringify(json, null, '\t');
  }
  const parts = unzipSync(bytes);
  const xml = strFromU8(parts['data/chunk0.xml']);
  const open = `<Element Class="${className}">`;
  expect(xml.split(open).length - 1, `one ${className} in the binary fixture`).toBe(1);
  parts['data/chunk0.xml'] = strToU8(xml.replace(open, `${open}\n<P Name="Description" Class="char">${text}</P>`));
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
  const source: any = ingest(session, content, { filename: 'params.sldd' });
  return { session, source };
}

function saved(session: any, source: any): Uint8Array | string {
  const out = session.serializeSource(source.name) as SerializedSource;
  return out.kind === 'binary' ? out.bytes : out.text;
}

// The entry's top-level property bag as the saved file carries it, read back by the reader.
function savedBag(content: Uint8Array | string, entry: string): Record<string, unknown> {
  return (entryIn(open(content).source, entry) as any).serial._properties as Record<string, unknown>;
}

// The two save paths, each reduced to the bag it puts in the file.
const binaryPath = (node: DataNode) => node._getSerializedProperties();
const textPath = (node: DataNode) =>
  JSON.parse(JSON.stringify((node.serializeValue() as any)._elements[0]._properties)) as Record<string, unknown>;

function generalItems(node: DataNode): string[] {
  const groups = node.toPIObject()!.propertySheet.groups as any[];
  return groups.find((g) => g.displayName === 'General').items.map((i: any) => i.name);
}

function expectRefused(node: DataNode, className: string, text: string) {
  const result = node.setProperty('Description', text);
  expect(result).not.toBe(true);
  expect(result).toMatchObject({ error: true, invalidValue: text });
  expect((result as { reason: string }).reason).toContain(
    `Unrecognized property 'Description' for class '${className}'.`,
  );
}

for (const c of CLASSES) {
  describe(`${c.className} has no Description`, () => {
    for (const format of FORMATS) {
      describe(`${c.entry}, ${format} dictionary`, () => {
        it('refuses a Description edit, and no save writes one', () => {
          const { session, source } = open(fixture(format));
          const node = entryIn(source, c.entry);
          expect(node.className).toBe(c.className);

          expectRefused(node, c.className, 'throttle map');
          expect(node.status).not.toBe('Modified');
          expect(binaryPath(node)).not.toHaveProperty('Description');
          expect(textPath(node)).not.toHaveProperty('Description');

          // An unrelated edit rewrites the entry from the node, so the save reaches the writer
          // (a binary entry nobody edited is written as the bytes it was read from): a rename, as
          // the class's Storage Class is shown read-only, and so takes no edit (DataNode._offerRefusal).
          expect(node.setProperty('Name', c.entry + 'Renamed')).toBe(true);
          const bag = savedBag(saved(session, source), c.entry + 'Renamed');
          expect(bag).not.toHaveProperty('Description');
        });

        it('offers no Description editor in the table or the Property Inspector', () => {
          const node = entryIn(open(fixture(format)).source, c.entry);
          expect(node.getProperties().map((p) => p.key)).not.toContain('Description');
          expect(node.toRow()!._descriptionEditable).toBe(false);
          expect(generalItems(node)).toEqual(GENERAL);
          const piProps = node.toPIObject()!.propertySheet.properties as any[];
          expect(piProps.filter((p) => p.editable && /Description/.test(p.name))).toEqual([]);
        });

        it('keeps a Description the file already has, as read and read-only, on both save paths', () => {
          const { session, source } = open(withDescription(format, c.entry, c.className, 'kept'));
          const node = entryIn(source, c.entry);

          // The class has no Description, so the row shows none (BaseNode.descriptionApplies); the
          // key the file holds is shown, read-only, among the Property Inspector's other keys.
          const row = node.toRow()!;
          expect([row.Description, row._descriptionEditable, row._descriptionApplies]).toEqual(['', false, false]);
          const pi = node.toPIObject()!;
          expect((pi.objects[0] as Record<string, unknown>)['Other.Description']).toBe('kept');
          const other = (pi.propertySheet.properties as any[]).find((p) => p.name === 'Other.Description');
          expect(other.editable).toBe(false);

          expectRefused(node, c.className, 'changed');
          expect(node.setProperty('Name', c.entry + 'Renamed')).toBe(true);
          expect(binaryPath(node).Description).toBe('kept');
          expect(textPath(node).Description).toBe('kept');

          const bag = savedBag(saved(session, source), c.entry + 'Renamed');
          expect(bag.Description).toBe('kept');
        });
      });
    }

    it('a new entry (createDefault) refuses one and saves none', () => {
      const node = c.make('n');
      expectRefused(node, c.className, 'x');
      expect(node.toRow()!._descriptionEditable).toBe(false);
      expect(generalItems(node)).toEqual(GENERAL);
      expect(binaryPath(node)).not.toHaveProperty('Description');
      expect(textPath(node)).not.toHaveProperty('Description');
    });
  });
}
