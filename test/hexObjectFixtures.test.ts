// Copyright 2026 The MathWorks, Inc.
//
// Hex values whose decoded tree is more than arrays, against MATLAB's own files:
// test/fixtures/sparse/make_hex_object_fixtures.m writes, into a binary dictionary, its
// text twin and a .mat,
//
//   anonAlias  an AliasType subclass whose function-handle property is ANONYMOUS;
//   holder     one holding @sin and a struct, so a StructNode sits under the hex value;
//   objs       a struct holding a sparse array (so it is hex) and a Simulink.Signal, Bus,
//              ValueType, VariantControl, EnumTypeDefinition and Parameter, each decoded
//              into the node its class has;
//   objsCell   the same seven values in a cell;
//   control    a plain double, which MATLAB writes as XML.
//
// What the binary dictionary holds as hex is written back as it was read, so everything
// under it is read-only. These are the nodes under a hex value that no fixture reached
// before, and whose read-only gates nothing exercised: the add/remove-child gates of a
// StructNode, a bus and an enum type, the setProperty overrides of SignalNode, BusNode,
// ValueTypeNode and VariantControlNode, and the names of a struct's fields and of an
// object inside a struct.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const FIXTURES = new URL('./fixtures/sparse/', import.meta.url);
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(name, FIXTURES))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const TRUTH = JSON.parse(new TextDecoder().decode(fixture('hexobj.truth.json')));
const MATLAB_CHUNK = new TextDecoder().decode(unzipSync(fixture('hexobj_binary.sldd'))['data/chunk0.xml']);

function open(file: string, session = createSession()): any {
  return ingest(session, buffer(fixture(file)), { filename: file });
}
const variablesOf = (file: string, session?: any): any =>
  file.endsWith('.mat') ? open(file, session) : open(file, session).getSection('design');
const subtree = (node: any): any[] => [node, ...node.children.flatMap(subtree)];

/** An entry's Value element, exactly as written. */
function valueTag(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const from = xml.indexOf('<P Name="Value"', at);
  return xml.slice(from, xml.indexOf('</P>', from) + 4);
}

const HEX: string[] = TRUTH.binary.valueTags.filter((t: any) => t.isHex).map((t: any) => t.name);
const ENCODED_REASON = /is stored as an encoded MATLAB value that this editor can show but not write/;

describe('the fixture is what these tests need', () => {
  it('MATLAB accepted every value, and wrote the six that hold a handle or a sparse array as hex', () => {
    for (const venue of [TRUTH.binary, TRUTH.text]) {
      expect(venue.refused ?? []).toEqual([]);
    }
    expect(HEX.sort()).toEqual(['anonAlias', 'cTall', 'holder', 'objs', 'objsCell', 'pTall']);
    expect(TRUTH.values.anonAlias.FhType).toBe('anonymous');
  });

  it('the binary dictionary decodes every class these tests are about under a hex value', () => {
    const design = variablesOf('hexobj_binary.sldd');
    const classes = new Set(HEX.flatMap((n) => subtree(design.children.find((e: any) => e.name === n)).slice(1).map((x: any) => x.constructor.name)));
    for (const cls of ['StructNode', 'SignalNode', 'BusNode', 'BusElementNode', 'ValueTypeNode', 'VariantControlNode', 'EnumTypeNode', 'ParameterNode', 'MatlabVariableNode']) {
      expect(classes.has(cls), cls).toBe(true);
    }
  });
});

describe('a function handle shows as func2str says, in every venue', () => {
  // An anonymous handle's stored text carries the prefix of the scope it was made in,
  // `sf%0@(y)y*2`, and showed as `@sf%0@(y)y*2` in the binary dictionary and the .mat,
  // where MATLAB, and this package's text twin, show `@(y)y*2`.
  for (const [venue, file] of [['binary', 'hexobj_binary.sldd'], ['text', 'hexobj_text.sldd'], ['mat', 'hexobj_values.mat']] as const) {
    it(venue, () => {
      const variables = variablesOf(file);
      // A text dictionary writes only what differs from the class default (as
      // make_sparse_fixtures.m records), and holder's Fh is its default.
      for (const name of venue === 'text' ? ['anonAlias'] : ['anonAlias', 'holder']) {
        const truth = TRUTH[venue].readBack[name].Fh as string;
        const fh = variables.children.find((v: any) => v.name === name).children.find((c: any) => c.name === 'Fh');
        expect([fh.className, fh.displayValue], `${venue} ${name}`).toEqual(['function_handle', truth.startsWith('@') ? truth : '@' + truth]);
      }
    });
  }
});

describe('under a hex value, every node is read-only, whatever its class', () => {
  const design = variablesOf('hexobj_binary.sldd');
  // Every property each class edits through an override of its own before DataNode's —
  // Min and Max (SignalNode, BusNode, ValueTypeNode), the enumerals (BusNode,
  // ValueTypeNode), Value (VariantControlNode, MatlabVariableNode) — and the generic ones.
  const PROPS = ['Value', 'Min', 'Max', 'DataType', 'Description', 'Unit', 'Complexity', 'Dimensions', 'DimensionsMode', 'SampleTime', 'Name'];

  for (const name of HEX) {
    it(name, () => {
      const entry = design.children.find((e: any) => e.name === name);
      for (const node of subtree(entry).slice(1)) {
        const label = `${name}: ${node.id} (${node.constructor.name})`;
        expect(node.nameEditable, label).toBe(false);
        expect(typeof node.canAddChild === 'function' ? node.canAddChild() : false, label).toBe(false);
        expect(typeof node.canRemoveChild === 'function' ? node.canRemoveChild() : false, label).toBe(false);
        const keys = new Set([...PROPS, ...(node.getProperties?.() ?? []).map((p: any) => p.key)]);
        for (const prop of keys) {
          for (const text of ['1', '[]', 'single']) {
            const result = node.setProperty(prop, text);
            expect(result, `${label} ${prop}=${text}`).toMatchObject({ error: true, reason: expect.stringMatching(ENCODED_REASON) });
          }
        }
      }
      // And none of that changed what is written.
      expect(valueTag(serializeEntryToXml(entry), name)).toBe(valueTag(MATLAB_CHUNK, name));
    });
  }
});

describe('a save writes every hex value back byte for byte', () => {
  it('after editing nothing, and after editing the entry beside them', () => {
    const session = createSession();
    const root = open('hexobj_binary.sldd', session);
    const noop = new TextDecoder().decode(unzipSync(session.serializeSource(root.name)!.bytes)['data/chunk0.xml']);
    const control = root.getSection('design').children.find((e: any) => e.name === 'control');
    expect(control.setProperty('Value', '6')).toBe(true);
    const edited = new TextDecoder().decode(unzipSync(session.serializeSource(root.name)!.bytes)['data/chunk0.xml']);
    expect(valueTag(edited, 'control')).toBe('<P Name="Value" Class="double">6.0</P>');
    for (const name of HEX) {
      expect(valueTag(noop, name), name).toBe(valueTag(MATLAB_CHUNK, name));
      expect(valueTag(edited, name), name).toBe(valueTag(MATLAB_CHUNK, name));
    }
  });
});

describe('a struct-array property of an MCOS object keeps every element', () => {
  // The MCOS decoder read a struct-array property as its first element alone, while still
  // reporting the array's size: an EnumTypeDefinition holds its enumerals that way, and
  // the one make_hex_object_fixtures.m builds (enum1 = 0, then appendEnumeral('Red', 2))
  // showed enum1 alone out of the .mat and, once hex values decoded, out of the binary
  // dictionary — where its text twin, and MATLAB, have both.
  const enumerals = (file: string, path: (root: any) => any): string[] =>
    path(variablesOf(file)).children.map((c: any) => `${c.name}=${c.displayValue}`);
  const inStruct = (root: any) => root.children.find((e: any) => e.name === 'objs').children.find((c: any) => c.name === 'et');
  const inCell = (root: any) => root.children.find((e: any) => e.name === 'objsCell').children[5];

  for (const file of ['hexobj_text.sldd', 'hexobj_binary.sldd', 'hexobj_values.mat']) {
    it(file, () => {
      expect(enumerals(file, inStruct), 'objs.et').toEqual(['enum1=0', 'Red=2']);
      expect(enumerals(file, inCell), 'objsCell{6}').toEqual(['enum1=0', 'Red=2']);
    });
  }
});

describe('a sparse array too large to decode, inside an MCOS property or a cell element', () => {
  // pTall is a Simulink.Parameter whose Value is sparse(…, 10000000, 2) with two
  // non-zeros, past what MatParser materializes; cTall holds the same array as a cell
  // element. A bare one shows the reader's placeholder in every venue. Inside a property
  // it showed `[ ]` out of the .mat and the binary dictionary, with no warning — the MCOS
  // decoder spelled it as an empty array — where its text twin showed the placeholder;
  // and copied into a dictionary, either was written as `[]` or as the placeholder's text.
  const PLACEHOLDER = '<10000000x2 sparse double, not decoded>';
  // The Parameter's value node, which is its Value row when it has one.
  const valueOf = (root: any) => root.children.find((e: any) => e.name === 'pTall')._valueNode;
  const cellOf = (root: any) => root.children.find((e: any) => e.name === 'cTall').children[0];

  for (const file of ['hexobj_text.sldd', 'hexobj_binary.sldd', 'hexobj_values.mat']) {
    it(`${file}: the placeholder, read-only, with no rows`, () => {
      const root = variablesOf(file);
      for (const [what, node] of [['pTall.Value', valueOf(root)], ['cTall{1}', cellOf(root)]] as const) {
        expect([node.className, node.displayValue, node.children.length, node.valueEditable, node._isSparse], `${file} ${what}`).toEqual([
          'double',
          PLACEHOLDER,
          0,
          false,
          true,
        ]);
      }
      const pTall = root.children.find((e: any) => e.name === 'pTall');
      expect(pTall.displayValue, file).toBe(PLACEHOLDER);
      // No Value row: it has no element rows, and no grid to offer (ParameterNode._needsValueRow).
      expect(pTall.children, file).toEqual([]);
    });
  }

  it('the .mat says so, for the property as for the cell element', () => {
    const root: any = open('hexobj_values.mat');
    const parts = root.warnings.map((w: any) => w.part).sort();
    expect(parts).toEqual(['cTall{1}', 'pTall.Value']);
    expect(root.warnings.find((w: any) => w.part === 'pTall.Value').message).toContain('larger than this reader materializes');
  });

  it('copied out of the .mat into either dictionary, it is the stream MATLAB wrote for it', () => {
    // There is no value here to write it from but the bytes it was read from, re-framed as
    // a stream: what MATLAB's own text dictionary holds for the same value.
    const session = createSession();
    const mat = open('hexobj_values.mat', session);
    const text = open('hexobj_text.sldd', session);
    const binary = open('hexobj_binary.sldd', session);
    const twin = (name: string) =>
      JSON.parse(new TextDecoder().decode(fixture('hexobj_text.sldd'))).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find(
        (e: any) => e.name === name,
      ).value;
    let seq = 0;
    for (const name of ['pTall', 'cTall']) {
      const value = JSON.parse(JSON.stringify(mat.children.find((e: any) => e.name === name).serializeValue()));
      const stream = name === 'pTall' ? value._elements[0]._properties.Value : value._elements[0];
      const twinStream = name === 'pTall' ? twin(name)._elements[0]._properties.Value : twin(name)._elements[0];
      expect(stream, name).toEqual(twinStream);
      for (const root of [text, binary]) {
        const pasted = root.getSection('design').parseEntry({ name: name + 'Copy', metadata: { uuid: `00000000-0000-4000-f000-${String(++seq).padStart(12, '0')}` }, value });
        const node = name === 'pTall' ? pasted._valueNode : pasted.children[0];
        expect(node.displayValue, `${name} in ${root.name}`).toBe(PLACEHOLDER);
      }
    }
    const xml = serializeEntryToXml(binary.getSection('design').children.find((e: any) => e.name === 'pTallCopy'));
    expect(xml).toMatch(/<P Name="Value" Class="double" Encoding="hex" EncodedLength="\d+">/);
    expect(xml).not.toContain('not decoded');
    const cell = serializeEntryToXml(binary.getSection('design').children.find((e: any) => e.name === 'cTallCopy'));
    expect(cell).toMatch(/<Element Class="double" Encoding="hex" EncodedLength="\d+">/);
    expect(cell).not.toContain('not decoded');
  });
});
