// Copyright 2026 The MathWorks, Inc.
//
// The rarer values a binary dictionary's reader holds, pasted into a text dictionary
// (MatWriter.textDictionaryForm), each held as what a save writes and a reopen reads.
//
// test/textEmptyReadback.test.ts and test/cellEnumElement.test.ts hold the spellings MATLAB was
// asked about. Left over are the values the text form spells by rule rather than by measurement,
// each one a branch of heldTextSpelling or enumTextForm that nothing reached:
//
//   - an object array's empty of rank >= 3, which MATLAB reads back right in no spelling: as an
//     entry's value `[]`, at a property or a field '', in a cell the header as read, less the
//     binary reader's own key; and the same of a struct's or a cell's header, which no reader
//     holds so but a host may hand in;
//   - an empty enumeration whose size is no count, spelled by place as an object array's is;
//   - an extent too long to be a count at all, which no spelling states: `[]` at an entry;
//   - an enumeration value with no text spelling (an underlying class that is not an integer or
//     logical, enumerals of two classes, a size that is not their count): the bag less the two keys
//     a text dictionary has no reader for, at every depth of its elements, and refused by a paste;
//   - an N-D enumeration value, one element holding the MAT stream of its numbers in MATLAB's
//     column-major order;
//   - a string's empty under the binary reader's bare header, which is MATLAB's String bag holding
//     no element at every place; an object array's of rank 2 at an object array's element, the
//     header as read; a char's whose literal states no size, '';
//   - and one with an extent past an int32 at rank 2, which MATLAB reads back with the extent
//     wrapped (measured against MATLAB R2027a: `Matrix(0,2147483648)` reopens as a
//     0x18446744071562067968): no spelling in a text dictionary, refused, said where it stands, and
//     at the save naming the entry, where a binary dictionary holds it as read.
//
// Each is pasted into test/fixtures/sparse/sparse_text.sldd as a host pastes an entry, and the
// entry as pasted is the entry the saved file reopens with: what it shows is what the save wrote.

import { describe, it, expect } from 'vitest';
import { BINARY, copyOf, pasted, pasteSaveReopen, TEXT, thrownBy } from './tools/pasteVenues.js';
import { MatBudgetError, textDictionaryForm } from '../src/datamodel/parser/MatWriter.js';
import { decodeMatStream } from '../src/datamodel/parser/MatParser.js';
import { uudecode } from '../src/datamodel/parser/CdataCodec.js';
import { BINARY_EMPTY_KEY, ENUM_KEY, ENUMERATION_KEY } from '../src/datamodel/parser/XmlUtils.js';

/** A binary dictionary's classed or shaped empty, as its reader holds one (BinarySlddParser.emptyOf). */
const emptyOf = (cls: string, header: string) => ({ _type: cls, _value: header, [BINARY_EMPTY_KEY]: true });

/** `v` at each place a value stands in a text dictionary. */
const places = (v: unknown) => ({
  entry: v,
  cell: { _array_type: 'Cell', _dimensions: [1, 1], _elements: [v] },
  field: { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: v }] },
  property: { _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _properties: { Value: v } }] },
  element: { _array_class: 'WidgetPart', _dimensions: [1, 1], _elements: [v] },
});

/** What stands at the place `places` put it, in `form`. */
function at(place: keyof ReturnType<typeof places>, form: any): unknown {
  switch (place) {
    case 'entry':
      return form;
    case 'cell':
    case 'element':
      return form._elements[0];
    case 'field':
      return form._elements[0].f;
    case 'property':
      return form._elements[0]._properties.Value;
  }
}

/** An enumeration value as a binary dictionary's reader holds one: an enumeral per element, column-major. */
function enumBag(dims: number[], enumerals: { type?: string; value?: string }[]) {
  return {
    _array_class: 'GearMode',
    _dimensions: dims,
    _mw_element_type: 'MATLABArray',
    _elements: enumerals.map((e) => ({ _properties: {}, [ENUMERATION_KEY]: { name: 'Drive', ...e } })),
    [ENUM_KEY]: '1',
  };
}

/** The paste of `value` holds what the saved file reopens with. */
function heldAsReopened(value: unknown): unknown {
  const held = copyOf(pasted(TEXT, value));
  const { entry } = pasteSaveReopen(TEXT, value);
  expect(entry, 'the pasted entry reopens').toBeDefined();
  expect(copyOf(entry)).toEqual(held);
  return held;
}

describe("an object array's empty of rank >= 3, which MATLAB reads back right in no spelling", () => {
  const empty = emptyOf('WidgetPart', 'Matrix(0,2,3)');
  const header = { _type: 'WidgetPart', _value: 'Matrix(0,2,3)' };
  const expected = { entry: [], cell: header, field: '', property: '', element: header };

  for (const [place, value] of Object.entries(places(empty)) as [keyof typeof expected, unknown][]) {
    it(`is spelled at ${place === 'entry' ? 'an entry' : 'a ' + place} as it was before, with no key a text dictionary has no reader for`, () => {
      expect(at(place, textDictionaryForm(value))).toEqual(expected[place]);
    });
  }

  it('and a pasted entry holding one is the entry its saved file reopens with', () => {
    for (const value of [empty, places(empty).cell, places(empty).field]) {
      heldAsReopened(value);
    }
    expect(heldAsReopened(empty)).toEqual([]);
  });
});

describe("a struct's or a cell's empty under a bare header, which no reader holds but a host may hand in", () => {
  for (const cls of ['struct', 'cell']) {
    it(`a ${cls}'s is spelled as an object array's of no class MATLAB gives an object of its own`, () => {
      const p = places(emptyOf(cls, 'Matrix(0,2)'));
      expect(textDictionaryForm(p.entry)).toEqual([]);
      expect(at('field', textDictionaryForm(p.field))).toBe('');
      expect(at('property', textDictionaryForm(p.property))).toBe('');
      expect(at('cell', textDictionaryForm(p.cell))).toEqual({ _type: cls, _value: 'Matrix(0,2)' });
    });
  }
});

describe('an empty whose size is no count', () => {
  it('an empty enumeration of such a size is spelled by place, as an object array is', () => {
    const p = places(enumBag([0, 1.5], []));
    expect(textDictionaryForm(p.entry)).toEqual([]);
    expect(at('field', textDictionaryForm(p.field))).toBe('');
    expect(at('property', textDictionaryForm(p.property))).toBe('');
    // In a cell it has no spelling of its own: the bag, less the binary reader's key.
    expect(at('cell', textDictionaryForm(p.cell))).toEqual({ _array_class: 'GearMode', _dimensions: [0, 1.5], _mw_element_type: 'MATLABArray', _elements: [] });
  });

  it('an extent too long to be a count is no size any spelling states: the double 0x0 at an entry, which a reopen reads', () => {
    const empty = emptyOf('int8', 'Matrix(0,' + '9'.repeat(400) + ')');
    expect(textDictionaryForm(empty)).toEqual([]);
    expect(heldAsReopened(empty)).toEqual([]);
  });
});

describe('an enumeration value a text dictionary has no spelling of', () => {
  const unspelled = {
    'its enumerals are of a class that is not an integer': enumBag([1, 1], [{ type: 'double', value: '1' }]),
    'its enumerals are of two classes': enumBag([1, 2], [{ type: 'int32', value: '1' }, { type: 'int8', value: '-1' }]),
    'its size is not the count of its enumerals': enumBag([1, 2], [{ type: 'int32', value: '1' }]),
    'an enumeral holds no number': enumBag([1, 1], [{ type: 'int32' }]),
    'an enumeral holds a number that is not a whole one': enumBag([1, 1], [{ type: 'int32', value: '1.5' }]),
    'its size is no size': enumBag([1, 'x' as unknown as number], [{ type: 'int32', value: '1' }]),
  };

  for (const [why, bag] of Object.entries(unspelled)) {
    it(`is the bag less the two keys a text dictionary has no reader for, where ${why}`, () => {
      const form = textDictionaryForm(bag) as Record<string, unknown>;
      const { [ENUM_KEY]: _, ...rest } = bag;
      expect(form).toEqual({ ...rest, _elements: bag._elements.map(() => ({ _properties: {} })) });
      // The bag handed in is not changed: the binary reader's node still replays it.
      expect(bag[ENUM_KEY]).toBe('1');
      expect((bag._elements[0] as Record<string, unknown>)[ENUMERATION_KEY]).toBeDefined();
    });
  }

  it('an element that is no object is kept as it is', () => {
    const bag = { ...enumBag([1, 2], [{ type: 'double', value: '1' }]), _elements: [null, { _properties: {}, [ENUMERATION_KEY]: { name: 'Drive', type: 'double', value: '1' } }] };
    expect((textDictionaryForm(bag) as { _elements: unknown[] })._elements).toEqual([null, { _properties: {} }]);
  });

  // Written so, MATLAB fails to read it ("Invalid or deleted object", R2027a, an OnOffSwitchState in
  // a cell before it had a spelling here), so a paste refuses one, at any depth, naming where it is
  // (open-questions 14, B). The text form above is still what a save of anything else writes.
  it('and pasted, it is refused, naming where it is', () => {
    const bag = unspelled['its enumerals are of a class that is not an integer'];
    for (const [value, where] of [[bag, 'pasted'], [places(bag).cell, 'pasted{1}'], [places(bag).field, 'pasted.f'], [places(bag).property, 'pasted.Value']] as const) {
      expect(() => pasted(TEXT, value)).toThrow('Cannot write "pasted": ' + where + ' holds a 1x1 GearMode, which this editor cannot write into a text dictionary as MATLAB does. Nothing was written.');
    }
  });
});

describe('an N-D enumeration value', () => {
  // A 2x2x2 of distinct numbers, so that an order other than MATLAB's shows.
  const numbers = [1, 2, 3, 4, 5, 6, 7, -8];
  const bag = enumBag([2, 2, 2], numbers.map((n) => ({ type: 'int16', value: String(n) })));

  it('is one element holding the MAT stream of its numbers, in their class and in MATLAB\'s order, in a 1x1 bag', () => {
    const form = textDictionaryForm(bag) as { _dimensions: number[]; _elements: { _enum_value: { _type: string; _value: string } }[] };
    expect(form._dimensions).toEqual([1, 1]);
    expect(form._elements).toHaveLength(1);
    expect(form._elements[0]._enum_value._type).toBe('cdata');
    const read = decodeMatStream(uudecode(form._elements[0]._enum_value._value));
    expect(read.ok).toBe(true);
    const v = (read as { variable: { className: string; dimensions: number[]; value: number[] } }).variable;
    expect([v.className, v.dimensions]).toEqual(['int16', [2, 2, 2]]);
    // The reader holds each page row by row; the enumerals were column-major.
    expect(v.value).toEqual([1, 3, 2, 4, 5, 7, 6, -8]);
  });

  it('and pasted, alone or in a cell, it is the entry its saved file reopens with', () => {
    heldAsReopened(bag);
    heldAsReopened(places(bag).cell);
  });
});

describe('the other empties under the binary reader\'s bare header', () => {
  it("a string's is MATLAB's String bag holding no element, at every place", () => {
    const bag = { _array_type: 'String', _dimensions: [0, 3], _elements: [], _mw_element_type: 'MATLABArray' };
    const p = places(emptyOf('string', 'Matrix(0,3)'));
    for (const place of Object.keys(p) as (keyof typeof p)[]) {
      expect(at(place, textDictionaryForm(p[place])), place).toEqual(bag);
    }
    expect(heldAsReopened(p.entry)).toEqual(bag);
  });

  it("an object array's of rank 2 at an object array's element is the header as read", () => {
    expect(at('element', textDictionaryForm(places(emptyOf('WidgetPart', 'Matrix(0,2)')).element))).toEqual({ _type: 'WidgetPart', _value: 'Matrix(0,2)' });
  });

  it("a char's whose literal states no size is '' at every place", () => {
    const p = places(emptyOf('mxchar', 'not a literal'));
    for (const place of Object.keys(p) as (keyof typeof p)[]) {
      expect(at(place, textDictionaryForm(p[place])), place).toBe('');
    }
  });
});

describe('an empty of rank 2 with an extent past an int32', () => {
  const wide = emptyOf('int8', 'Matrix(0,2147483648)');

  it('has no spelling in a text dictionary: refused at every place, said where it stands', () => {
    const p = places(wide);
    const where = { entry: '', cell: '{1}', field: '.f', property: '.Value', element: '' };
    for (const place of Object.keys(p) as (keyof typeof p)[]) {
      const [e] = thrownBy(() => textDictionaryForm(p[place]));
      expect(e, place).toBeInstanceOf(MatBudgetError);
      expect([(e as MatBudgetError).reason, (e as MatBudgetError).at, (e as MatBudgetError).what], place).toEqual(['past-int32', where[place], 'a 0x2147483648 int8']);
    }
  });

  it('pasted into a text dictionary, the save refuses it naming the entry; a binary dictionary holds it as read', () => {
    const [e] = thrownBy(() => pasteSaveReopen(TEXT, wide));
    expect(e).toBeInstanceOf(MatBudgetError);
    expect(e!.message).toBe(
      'Cannot write "pasted": pasted is a 0x2147483648 int8, an extent past 2147483647, the most a MAT stream\'s dimensions can say, and it has no other spelling here. Nothing was written.',
    );
    expect(copyOf(pasteSaveReopen(BINARY, wide).entry)).toEqual(wide);
  });
});
