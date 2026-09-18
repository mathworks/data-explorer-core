// Copyright 2026 The MathWorks, Inc.
//
// A struct's field list is read from the ELEMENT BAG, not trusted from `_fields`.
//
// MATLAB changed its answer. Build `27.1.0.3353139` wrote a `"_fields": ["a","b"]`
// array beside `_elements` in a text (JSON) dictionary; build `27.1.0.3393633` writes
// none at all, and the field names live only as the keys of `_elements[i]`.
// `StructNode.parse` built a struct's children from `_fields` alone, so on current
// MATLAB every struct in every text `.sldd` came up with NO field rows — invisible and
// uneditable — and, because `serializeElement` iterates the same list, a struct that was
// then modified re-serialized as `_elements: [{}]` and every field was deleted from the
// saved file.
//
// Four parsers build this envelope and three of them already DERIVED the list
// (`BinarySlddParser`'s `_fields: Object.keys(parsed[0])`, `McosParser`,
// `MatlabVariableNode`); only the text channel passed MATLAB's JSON straight through.
// So the channel that derived from structure survived the format change and the channel
// that trusted the spelling broke — which is why the fix is to derive in the one place
// all four channels funnel through, rather than to teach the text parser to synthesize
// the key MATLAB dropped.
//
// Both builds' bytes are asserted here on purpose: a fix that reads the element bag must
// also still honour an explicit `_fields`, which is the only thing that states field
// ORDER for a bag whose keys a reader might reorder, and must not start writing `_fields`
// into a file MATLAB left it out of.
import { describe, it, expect } from 'vitest';
import StructNode from '../src/datamodel/node/data/StructNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import { loadFile, findEntry } from './parity/loadFile.js';

// Every struct MATLAB wrote into these fixtures, with the fields it wrote, keyed by the
// build that wrote them. The point of the table is that the two halves are the SAME
// assertion — the reader is not allowed to care which build it is reading.
const WITH_FIELDS: Array<[string, string, string[]]> = [
  ['typed_text.sldd', 'sTyped', ['a', 'b', 'c', 'd']],
  ['typed_text.sldd', 'sCharMat', ['m', 'r']],
  ['nd_nested.sldd', 'ndInStruct', ['flat', 'deep']],
  ['nd_nested.sldd', 'ndTwoLevel', ['inner']],
  ['object_props_text.sldd', 'a', ['b', 'c']],
];

const WITHOUT_FIELDS: Array<[string, string, string[]]> = [
  ['cellarr_text.sldd', 'sStructArr', ['f']],
  ['cellarr_text.sldd', 'sObjArr', ['f']],
  ['cellstr_text.sldd', 'sStr', ['f']],
];

describe('a struct read from MATLAB text bytes shows its fields, in either build', () => {
  for (const [fixture, entry, fields] of [...WITH_FIELDS, ...WITHOUT_FIELDS]) {
    it(fixture + ' / ' + entry + ' has fields ' + fields.join(','), () => {
      const node = findEntry(loadFile('../fixtures/' + fixture, fixture), entry);
      expect(node.children.map((c: any) => c.name)).toEqual(fields);
    });
  }

  it('reaches the fields of every element of a struct array, and of a struct in a cell', () => {
    // Nesting is where the blast radius actually is: `_fields` was threaded down to each
    // element node, so an empty list at the top emptied every element too. A struct inside
    // a CELL reaches StructNode.parse by a third route again.
    const root = loadFile('../fixtures/cellarr_text.sldd', 'cellarr_text.sldd');
    const arr = findEntry(root, 'cStructArr').children[0];
    expect(String(arr.displayValue)).toBe('<1x2 struct>');
    expect(arr.children.map((e: any) => e.children.map((c: any) => c.name))).toEqual([['a'], ['a']]);
    const scalar = findEntry(root, 'cStruct').children[0];
    expect(scalar.children.map((c: any) => c.name)).toEqual(['a']);
  });

  it('reads a struct the same way the binary channel does, all the way down', () => {
    // The invariant stated BETWEEN the channels rather than inside either one — this
    // repo's recurring defect class. The binary channel is the oracle precisely because
    // it already derived the list; before the fix the two disagreed about every struct,
    // and `binaryWriteBackGate` had to stop its cross-channel walk at a scalar struct to
    // avoid the disagreement. Nothing stops it now.
    const bin = loadFile('../fixtures/cellarr_binary.sldd', 'cellarr_binary.sldd');
    const txt = loadFile('../fixtures/cellarr_text.sldd', 'cellarr_text.sldd');
    const shown = (root: any, name: string): string[] => {
      const out: string[] = [];
      const walk = (n: any, path: string): void => {
        out.push(path + '  ' + String(n.displayValue) + ' | ' + String(n.dataType ?? ''));
        for (const c of n.children ?? []) { walk(c, path + '/' + c.name); }
      };
      walk(findEntry(root, name), name);
      return out;
    };
    for (const name of ['sStructArr', 'cStruct', 'cStructArr', 'cStructArr2D']) {
      expect(shown(bin, name), name).toEqual(shown(txt, name));
    }
  });
});

describe('writing a struct back keeps its fields, and keeps the file MATLAB-shaped', () => {
  // The silent half. `serializeValue` replays `_rawInput` verbatim until something is
  // modified, so the loss needed no edit to the fields themselves — any edit under the
  // entry was enough to drop the raw bytes and re-serialize from an empty field list.
  const serializeModified = (fixture: string, entry: string): Record<string, unknown> => {
    const node: any = findEntry(loadFile('../fixtures/' + fixture, fixture), entry);
    node._markModified();
    return node.serializeValue() as Record<string, unknown>;
  };

  it('keeps every field of a struct MATLAB wrote without _fields', () => {
    const out = serializeModified('cellarr_text.sldd', 'sStructArr');
    const elements = out._elements as Record<string, unknown>[];
    expect(Object.keys(elements[0])).toEqual(['f']);
    // The field's own value has to survive too, not just its name: a 1x2 struct array.
    expect((elements[0].f as Record<string, unknown>)._dimensions).toEqual([1, 2]);
  });

  it('does not invent _fields in a file MATLAB left it out of', () => {
    // Faithfulness is not cosmetic here: the whole reason the reader may not depend on
    // `_fields` is that MATLAB's own writer dropped it, so writing it back would make our
    // saves diverge from MATLAB's for every struct in every dictionary.
    expect(serializeModified('cellarr_text.sldd', 'sStructArr')).not.toHaveProperty('_fields');
  });

  it('keeps _fields in a file that had it, in MATLAB\'s own order', () => {
    expect(serializeModified('typed_text.sldd', 'sTyped')._fields).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('StructNode.parse derives the field list', () => {
  it('prefers an explicit _fields, which is the only statement of field ORDER', () => {
    // An element bag's key order is a JSON object's key order. Where MATLAB stated the
    // order outright, that statement wins — deriving would be a silent reordering of the
    // user's struct.
    const node = StructNode.parse({
      _array_type: 'Struct', _dimensions: [1, 1],
      _fields: ['b', 'a'], _elements: [{ a: 1, b: 2 }],
    }, 'S', null);
    expect(node.children.map((c) => c.name)).toEqual(['b', 'a']);
  });

  it('derives from the element bag when _fields is absent', () => {
    const node = StructNode.parse({
      _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ a: 1, b: 2 }],
    }, 'S', null);
    expect(node.children.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('derives a struct array\'s shared list from its first element, as the binary parser does', () => {
    const node = StructNode.parse({
      _array_type: 'Struct', _dimensions: [1, 2], _elements: [{ a: 1 }, { a: 2 }],
    }, 'S', null);
    expect(node.children.map((e) => e.children.map((c) => c.name))).toEqual([['a'], ['a']]);
  });

  it('adds a field to a derived list without dropping the ones MATLAB wrote', () => {
    // The latent second bug: addChildNode's `if (!this.serial._fields) { = [] }` built a
    // list holding ONLY the new field. Unreachable while the fields were invisible —
    // there was no struct row to add to — and a field-deleting edit the moment they
    // became visible again.
    const node = StructNode.parse({
      _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ a: 1, b: 2 }],
    }, 'S', null);
    (node as any).addChildNode();
    expect(node.children.map((c) => c.name)).toEqual(['a', 'b', 'field']);
    expect(Object.keys((node as any).serializeElement())).toEqual(['a', 'b', 'field']);
  });
});
