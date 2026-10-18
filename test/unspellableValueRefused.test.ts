// Copyright 2026 The MathWorks, Inc.
//
// A raw value the binary dictionary's XML writers have no spelling for is refused, naming the
// entry and the path to it, and nothing is written (the maintainer's group F ruling,
// 2026-10-18: a save the writer cannot spell is refused rather than written wrong; C-205).
//
// The property writer (DataNode.serializePropertyXml) and the cell-element writer
// (DataNode._serializeCellElementXml) are each a dispatch over the shapes the readers hand
// back, and each ended in `Class="char"` around String() of whatever was left: an object of no
// recognised shape went into the .sldd as the text `[object Object]`, a null cell element as
// `null`, a bigint as its digits, a function as its source. MATLAB reads each back as a char,
// which is not the value, and nothing said so.
//
// One value the fixtures hold reached that tail: typeLink.sldd's avtEngSt, an
// EnumTypeDefinition written with no Enumerals. EnumTypeNode made one up, `{_elements: [],
// _dimensions: [1, 0]}`, with no `_array_type`, so a paste into a binary dictionary wrote
// `<P Name="Enumerals" Class="char">[object Object]</P>`, and every text save, untouched or
// edited, added the made-up key to the file. An enum that holds no Enumerals is written with
// none, as it was read; one given an enumeral since is written as a struct array, as MATLAB
// writes its Enumerals.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { MatBudgetError, MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { BINARY, copyOf, pasteSaveReopen, sparseFixture, thrownBy } from './tools/pasteVenues.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const widget = (props: Record<string, unknown>) => ({
  _array_class: 'Widget',
  _dimensions: [1, 1],
  _elements: [{ _properties: props }],
  _mw_element_type: 'MATLABArray',
});
const cellOf = (element: unknown) => ({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, element] });

let seq = 0;
/** `value` pasted into a fresh sparse_binary.sldd as the entry `pasted`: the session, the dictionary and the entry. */
function pasteIntoBinary(value: unknown): { session: Any; root: Any; entry: Any } {
  const session = createSession();
  const root: Any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
  const entry = root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: `00000000-0000-4000-e205-${String(++seq).padStart(12, '0')}` }, value });
  return { session, root, entry };
}

/** What a save of the binary dictionary refused, or null. */
const saveRefusal = (session: Any, root: Any) => thrownBy(() => session.serializeSource(root.name))[0];

// Each value no arm of the writers has a spelling for, where it stands, and what the refusal
// says stands there.
const CELL_ELEMENTS: [label: string, element: unknown, said: RegExp][] = [
  ['null', null, /is null,/],
  ['undefined', undefined, /is undefined,/],
  ['a bigint', 1n, /is a bigint,/],
  ['a function', () => 1, /is a function,/],
  ['a symbol', Symbol('s'), /is a symbol,/],
  ['an object of no recognised shape', { unknown: true }, /is an object holding "unknown",/],
];
const PROPERTIES: [label: string, value: unknown, said: RegExp][] = [
  ['an empty object', {}, /is an object holding no key,/],
  ['an object of no recognised shape', { nothing: 'matches' }, /is an object holding "nothing",/],
  ['a typed literal with no _value', { _type: 'double' }, /is an object holding "_type",/],
  ['a symbol', Symbol('s'), /is a symbol,/],
  ['a bigint', 2n, /is a bigint,/],
  ['a function', () => 1, /is a function,/],
];

describe('a raw value no XML writer can spell, pasted into a binary dictionary', () => {
  for (const [label, element, said] of CELL_ELEMENTS) {
    it(`a cell element that is ${label}: the entry's XML and the save are refused, naming the entry and the element`, () => {
      const { session, root, entry } = pasteIntoBinary(widget({ P: cellOf(element), x: 1 }));
      const [thrown] = thrownBy(() => serializeEntryToXml(entry));
      expect(thrown).toBeInstanceOf(MatWriteError);
      // No spelling, which is not the budget's final refusal.
      expect(thrown).not.toBeInstanceOf(MatBudgetError);
      expect(thrown!.message).toMatch(/^Cannot write "pasted": pasted\.P\{2\} /);
      expect(thrown!.message).toMatch(said);
      expect(thrown!.message).toMatch(/Nothing was written\.$/);
      expect(saveRefusal(session, root)?.message).toBe(thrown!.message);
    });
  }

  for (const [label, value, said] of PROPERTIES) {
    it(`a property that is ${label}: the entry's XML and the save are refused, naming the entry and the property`, () => {
      const { session, root, entry } = pasteIntoBinary(widget({ P: value, x: 1 }));
      const [thrown] = thrownBy(() => serializeEntryToXml(entry));
      expect(thrown).toBeInstanceOf(MatWriteError);
      expect(thrown).not.toBeInstanceOf(MatBudgetError);
      expect(thrown!.message).toMatch(/^Cannot write "pasted": pasted\.P /);
      expect(thrown!.message).toMatch(said);
      expect(thrown!.message).toMatch(/Nothing was written\.$/);
      expect(saveRefusal(session, root)?.message).toBe(thrown!.message);
    });
  }

  it('controls: the same paste of values the writers spell is written, and saved', () => {
    for (const value of [widget({ P: cellOf('txt'), x: 1 }), widget({ P: 'txt', x: 1 }), widget({ P: null, x: 1 })]) {
      const { session, root, entry } = pasteIntoBinary(value);
      expect(serializeEntryToXml(entry)).toContain('<P Name="P" Class="');
      expect(saveRefusal(session, root)).toBeNull();
    }
  });
});

describe('an EnumTypeDefinition read with no Enumerals (typeLink.sldd avtEngSt)', () => {
  const TYPE_LINK = fileURLToPath(new URL('./fixtures/typeLink.sldd', import.meta.url));
  const entriesOf = (text: string) => JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  const openTypeLink = () => {
    const session = createSession();
    const text = readFileSync(TYPE_LINK, 'utf8');
    const root: Any = ingest(session, text, { filename: 'typeLink.sldd' });
    const entry = root.getSection('design').children.find((e: Any) => e.name === 'avtEngSt');
    expect(entry.className).toBe('Simulink.data.dictionary.EnumTypeDefinition');
    expect(entry.children).toHaveLength(0);
    const asRead = entriesOf(text).find((e: Any) => e.name === 'avtEngSt').value;
    expect(asRead._elements[0]._properties).not.toHaveProperty('Enumerals');
    const saved = () => entriesOf(session.serializeSource(root.name).text).find((e: Any) => e.name === 'avtEngSt').value;
    return { session, root, entry, asRead, saved };
  };

  it('is copied, and saved untouched, as read: with no Enumerals', () => {
    const { entry, asRead, saved } = openTypeLink();
    expect(copyOf(entry)).toEqual(asRead);
    expect(saved()).toEqual(asRead);
  });

  it('an edited text save holds no Enumerals key', () => {
    const { entry, asRead, saved } = openTypeLink();
    expect(entry.setProperty('Description', 'edited')).toBe(true);
    expect(saved()._elements[0]._properties).toEqual({ ...asRead._elements[0]._properties, Description: 'edited' });
  });

  it('pasted into a binary dictionary, is written with no Enumerals and no [object Object], and reopens with none', () => {
    const { entry } = openTypeLink();
    const value = copyOf(entry);
    const { entry: pasted } = pasteIntoBinary(value);
    const xml = serializeEntryToXml(pasted);
    expect(xml).not.toContain('[object Object]');
    expect(xml).not.toContain('Name="Enumerals"');
    expect(xml).toContain('<P Name="DefaultValue" Class="char">OFF</P>');
    const { written, entry: reopened } = pasteSaveReopen(BINARY, value);
    expect(written).toContain('<P Name="Value"');
    expect(reopened.className).toBe('Simulink.data.dictionary.EnumTypeDefinition');
    expect(reopened.children).toHaveLength(0);
    expect(reopened.DefaultValue).toBe('OFF');
  });

  it('given an enumeral, is written as a struct array of them, in a text save and as XML', () => {
    const { entry, saved } = openTypeLink();
    entry.addChildNode();
    expect(saved()._elements[0]._properties.Enumerals).toEqual({
      _array_type: 'Struct',
      _dimensions: [1, 1],
      _elements: [{ Name: 'enum1', Value: '0', Description: '' }],
      _fields: ['Name', 'Value', 'Description'],
    });
    const xml = serializeEntryToXml(entry);
    expect(xml).not.toContain('[object Object]');
    expect(xml).toMatch(
      /<P Name="Enumerals" Class="struct">\s*<Element>\s*<P Name="Name" Class="char">enum1<\/P>\s*<P Name="Value" Class="char">0<\/P>\s*<P Name="Description" Class="char"\/>\s*<\/Element>\s*<\/P>/,
    );
    // And pasted into a binary dictionary, saved and opened again, it holds that enumeral.
    const { entry: reopened } = pasteSaveReopen(BINARY, copyOf(entry));
    expect(reopened.children.map((c: Any) => [c.name, c.Value])).toEqual([['enum1', '0']]);
  });

  it('a binary save holding the paste writes the chunk with no [object Object]', () => {
    const { entry } = openTypeLink();
    const { session, root } = pasteIntoBinary(copyOf(entry));
    const out = session.serializeSource(root.name);
    expect(strFromU8(unzipSync(out.bytes)['data/chunk0.xml'])).not.toContain('[object Object]');
  });
});
