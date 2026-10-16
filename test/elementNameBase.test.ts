// Copyright 2026 The MathWorks, Inc.
//
// AN ARRAY ELEMENT IS NAMED BY ITS 1-BASED SLOT, IN EVERY FLAVOUR (C-058).
//
// A struct-array or object-array element has no name of its own. Its row's label is a
// subscript into the array, `structNd(2,1,1)`, which BaseNode._labelUnder derives from
// `_subscript`, and that was always the same in every flavour. Its `name`, and so its node id
// (BaseNode.id is the parent's id, '/', the name), was not. MatlabVariableNode, which builds a
// text dictionary's cdata struct array and every `.mat` and model-workspace struct array,
// stamps `String(ei + 1)`. StructNode (a binary dictionary's struct array), ObjectNode's
// object arrays (both dictionary flavours, and a `.mat` object array) and ObjectNode's text
// enumeration arrays stamped `String(ei)`. So the one MATLAB value `structNd` had the element
// ids `structNd/1` … `structNd/12` read from the text dictionary and `structNd/0` …
// `structNd/11` read from the binary one, and BaseNode._slotAmongSiblings, which reads a name
// as its 1-based slot, missed on every 0-based element and fell back to a scan.
//
// The ruling (group E, 2026-10-16) takes the 1-based convention everywhere. The label does not
// change. Only the 0-based names and ids do, each by one.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import StructNode from '../src/datamodel/node/data/StructNode.js';
import ObjectNode from '../src/datamodel/node/data/ObjectNode.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const subtree = (node: Any): Any[] => [node, ...node.children.flatMap(subtree)];

/** Open a fixture through ingest, the entry point a host calls, in a session of its own. */
function open(rel: string): { session: Any; root: Any } {
  const bytes = readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
  const filename = rel.split('/').pop()!;
  // A text dictionary is JSON; a binary one is a zip, whose first byte is 'P'.
  const content = filename.endsWith('.sldd') && bytes[0] !== 0x50
    ? bytes.toString('utf8')
    : (new Uint8Array(bytes).buffer as ArrayBuffer);
  const session = createSession();
  return { session, root: ingest(session, content, { filename }) };
}

/** The node at `path` under the root, found by its id. */
function nodeAt(root: Any, path: string): Any {
  const id = `${root.id}/${path}`;
  const node = subtree(root).find((n: Any) => n.id === id);
  expect(node, id).toBeDefined();
  return node;
}

/** `count` names, '1' to String(count). */
const oneBased = (count: number): string[] => Array.from({ length: count }, (_, i) => String(i + 1));

/** Each element's id with its array's id taken off the front. */
const relativeIds = (array: Any): string[] => array.children.map((c: Any) => c.id.slice(array.id.length));

// structNd is MATLAB's 2x3x2 struct (truth.json). It is stored in all four of these, and built
// by StructNode from the binary dictionary and by MatlabVariableNode from the other three.
const STRUCT_ND: [flavour: string, file: string, path: string, builder: Any][] = [
  ['text dictionary', './parity/artifacts/text/cases.sldd', 'design/structNd', MatlabVariableNode],
  ['binary dictionary', './parity/artifacts/binary/cases.sldd', 'design/structNd', StructNode],
  ['.mat file', './parity/artifacts/mat/cases.mat', 'structNd', MatlabVariableNode],
  ['model workspace', './parity/artifacts/slx/cases.slx', 'workspace/structNd', MatlabVariableNode],
];

// MATLAB's column-major subscripts of a 2x3x2 array, in storage order: the labels.
const ND_SUBSCRIPTS = [
  '(1,1,1)', '(2,1,1)', '(1,2,1)', '(2,2,1)', '(1,3,1)', '(2,3,1)',
  '(1,1,2)', '(2,1,2)', '(1,2,2)', '(2,2,2)', '(1,3,2)', '(2,3,2)',
];

describe('a struct array element is named by its 1-based slot, in every flavour', () => {
  for (const [flavour, file, path, builder] of STRUCT_ND) {
    it(`structNd's twelve elements are named 1 to 12: ${flavour}`, () => {
      const { root } = open(file);
      const array = nodeAt(root, path);
      expect(array.children.length).toBe(12);
      // The builder this case is here for, so a reader that changed which node it builds
      // cannot make the case pass by moving it to the other builder.
      for (const element of array.children) {
        expect(element).toBeInstanceOf(builder);
      }
      expect(array.children.map((c: Any) => c.name)).toEqual(oneBased(12));
      // The label is the subscript, and was before: this half is the control.
      expect(array.children.map((c: Any) => c.displayName)).toEqual(ND_SUBSCRIPTS.map((s) => 'structNd' + s));
    });
  }

  it('gives structNd the same element ids in all four flavours, and the session finds each by it', () => {
    const ids = STRUCT_ND.map(([, file, path]) => {
      const { session, root } = open(file);
      const array = nodeAt(root, path);
      for (const element of array.children) {
        expect(session.findNodeById(element.id), element.id).toBe(element);
      }
      return relativeIds(array);
    });
    expect(ids[0]).toEqual(oneBased(12).map((n) => '/' + n));
    expect(ids[1]).toEqual(ids[0]);
    expect(ids[2]).toEqual(ids[0]);
    expect(ids[3]).toEqual(ids[0]);
  });
});

// Every object array the fixtures hold, built by ObjectNode.parse's element loop: dictionary
// object arrays in both flavours (elements of a known class become ParameterNodes, of a custom
// class ObjectNodes), MCOS object arrays in a .mat file, and a binary dictionary's enumeration
// array, which the binary reader delivers as an object array.
const OBJECT_ARRAYS: [file: string, path: string, count: number][] = [
  ['./fixtures/object_array_binary.sldd', 'design/paramArray', 3],
  ['./fixtures/object_array_binary.sldd', 'other/usageArray', 2],
  ['./fixtures/object_array_text.sldd', 'design/paramArray', 3],
  ['./fixtures/object_array_text.sldd', 'other/usageArray', 2],
  ['./fixtures/custom_object_binary.sldd', 'other/widget/Parts', 3],
  ['./fixtures/custom_object_text.sldd', 'other/widget/Parts', 3],
  ['./parity/artifacts/mat/cases.mat', 'objRow', 3],
  ['./parity/artifacts/mat/cases.mat', 'obj2x3x2', 12],
  ['./fixtures/mcos/busArray.mat', 'buses', 3],
  ['./fixtures/display/dispcat_bin.sldd', 'design/en_onoff_vec', 3],
];

describe('an object array element is named by its 1-based slot', () => {
  for (const [file, path, count] of OBJECT_ARRAYS) {
    it(`${file.split('/').pop()} ${path}: elements 1 to ${count}`, () => {
      const { root } = open(file);
      const array = nodeAt(root, path);
      expect(array).toBeInstanceOf(ObjectNode);
      expect(array.children.length).toBe(count);
      expect(array.children.map((c: Any) => c.name)).toEqual(oneBased(count));
      // Each label is still the element's subscript, from the index it was always given.
      array.children.forEach((c: Any, i: number) => expect(c._subscript.index).toBe(i));
    });
  }

  it('names a text enumeration array\'s elements 1 to n, as the binary dictionary names the same value\'s', () => {
    // en_onoff_vec is MATLAB's 1x3 matlab.lang.OnOffSwitchState, written by MATLAB into both
    // flavours. The text one's rows come from ObjectNode._addTextEnumElements, the binary
    // one's from the object-array loop above.
    const text = nodeAt(open('./fixtures/display/dispcat_text.sldd').root, 'design/en_onoff_vec');
    const binary = nodeAt(open('./fixtures/display/dispcat_bin.sldd').root, 'design/en_onoff_vec');
    expect(text.children.length).toBe(3);
    expect(text.children.map((c: Any) => c.name)).toEqual(['1', '2', '3']);
    expect(relativeIds(text)).toEqual(relativeIds(binary));
    // The control: the rows show the same labels and enumerals in both.
    expect(text.children.map((c: Any) => [c.displayName, c.displayValue]))
      .toEqual(binary.children.map((c: Any) => [c.displayName, c.displayValue]));
  });
});

// BaseNode._slotAmongSiblings reads an element's name as its 1-based slot and checks it. A name
// that is not its slot is answered correctly, by a scan, so this is the rule written down there
// and not a wrong label. These fixtures hold every builder of a subscripted element: struct
// arrays (StructNode and MatlabVariableNode), object arrays, enumeration arrays in both
// flavours, sparse elements, and struct and object arrays held inside a cell.
const ALL_BUILDERS = [
  './parity/artifacts/text/cases.sldd',
  './parity/artifacts/binary/cases.sldd',
  './parity/artifacts/mat/cases.mat',
  './parity/artifacts/slx/cases.slx',
  './fixtures/object_array_binary.sldd',
  './fixtures/object_array_text.sldd',
  './fixtures/custom_object_binary.sldd',
  './fixtures/custom_object_text.sldd',
  './fixtures/cellarr_binary.sldd',
  './fixtures/mcos/busArray.mat',
  './fixtures/display/dispcat_bin.sldd',
  './fixtures/display/dispcat_text.sldd',
  './fixtures/sparse/sparse_binary.sldd',
];

describe('every subscripted element\'s name is its 1-based slot among its siblings', () => {
  for (const file of ALL_BUILDERS) {
    it(file.split('/').slice(-2).join('/'), () => {
      const { root } = open(file);
      const elements = subtree(root).filter((n: Any) => n._subscript);
      expect(elements.length).toBeGreaterThan(0);
      const misnamed = elements
        .filter((n: Any) => n.parent.children[Number(n.name) - 1] !== n)
        .map((n: Any) => `${n.id} (${n.constructor.name})`);
      expect(misnamed).toEqual([]);
    });
  }
});
