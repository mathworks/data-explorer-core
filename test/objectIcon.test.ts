// Copyright 2026 The MathWorks, Inc.
//
// One rule, five paths: an OBJECT whose class this data model has no icon of its
// own for presents with the object glyph, whoever built the node.
//
// The paths reach that conclusion in five different files, and before OBJECT_ICON
// existed they had drifted — four returned `wsDefault`, which is the PLAIN-VARIABLE
// icon, so a customer class was indistinguishable in the tree from a double; the
// fifth named an `object` icon no repository ships an SVG for, so the one entry
// whose whole job was to read as an object rendered as a broken image. Each of the
// five has its own unit test for its own icon rule; none of them could catch a
// divergence BETWEEN the five, because each asserted a literal of its own. This
// file asserts the agreement, so adding a sixth path (or rebranding the glyph)
// cannot quietly leave one behind.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Importing the class map registers the NodeRegistry these paths dispatch through.
import '../src/datamodel/node/NodeClassMap.js';
import { OBJECT_ICON } from '../src/datamodel/node/icons.js';
import ObjectNode from '../src/datamodel/node/data/ObjectNode.js';
import MatNode from '../src/datamodel/node/container/MatNode.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import CustomObjectNode from '../src/datamodel/node/data/CustomObjectNode.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import type { MatVariable } from '../src/datamodel/node/data/MatlabVariableNode.js';
import { buildTypedNodeFromMcos } from '../src/datamodel/node/data/mcosTypedNode.js';

// A class no entry in CLASS_MAP and no entry in MCOS_ICON_MAP claims — which is
// what "unknown class" means to every path below.
const UNKNOWN = 'Acme.Thing';

function matVar(over: Partial<MatVariable>): MatVariable {
  return {
    name: 'v',
    className: UNKNOWN,
    dimensions: [1, 1],
    isComplex: false,
    isLogical: false,
    value: null,
    fields: null,
    ...over,
  };
}

// Each entry names the channel a user would have opened to reach that node.
const PATHS: [string, () => string][] = [
  [
    'a dictionary value object of an unknown class',
    () => (ObjectNode.parse(
      {
        _array_class: UNKNOWN,
        _array_type: 'MATLABArray',
        _dimensions: [1, 1],
        _mw_element_type: 'MATLABArray',
        _elements: [{ _properties: { A: 1 } }],
      },
      'obj',
      null,
    ) as unknown as { icon: string }).icon,
  ],
  [
    'a nested object property, which carries no _elements wrapper',
    () => (ObjectNode.parse(
      { _object_class: UNKNOWN, _properties: { A: 1 } },
      'obj',
      null,
    ) as unknown as { icon: string }).icon,
  ],
  [
    'an MCOS object out of a .mat the decoder recovered properties for',
    () => (buildTypedNodeFromMcos(UNKNOWN, 'obj', null, { A: 1 }) as unknown as { icon: string }).icon,
  ],
  [
    'an MCOS object out of a .mat the decoder recovered nothing for',
    () => MatlabVariableNode.parseMatVariable(matVar({ isOpaque: true }), 'obj', null).icon,
  ],
  [
    'a pre-MCOS class-3 object, recorded without being decoded',
    () =>
      MatlabVariableNode.parseMatVariable(
        matVar({ className: 'object', value: '<1x1 object, not decoded>', undecoded: 'no fixture pins its layout' }),
        'obj',
        null,
      ).icon,
  ],
  ['the generic CustomObject entry', () => CustomObjectNode.createDefault('co', null).icon],
];

describe('the object icon is one answer across every path that builds an object', () => {
  it.each(PATHS)('%s', (_label, iconOf) => {
    expect(iconOf()).toBe(OBJECT_ICON);
  });

  it('is ws3d, the workspace-browser glyph for a class instance', () => {
    // Spelled out rather than compared to itself: the consuming host resolves this
    // id to `media/icons/<id>.svg`, so the literal is the contract with the asset
    // and a rename that ships no matching file must fail here.
    expect(OBJECT_ICON).toBe('ws3d');
  });

  it('does not displace an icon a class HAS earned', () => {
    // The rule is a fallback, not a takeover: a branded Simulink class keeps its own
    // glyph on the same paths, and a derived ServiceBus stays Architectural Data.
    expect(MatlabVariableNode.parseMatVariable(
      matVar({ className: 'Simulink.Parameter', isOpaque: true }), 'p', null,
    ).icon).toBe('wsParameters');
    const bus = ObjectNode.parse(
      { _object_class: 'Simulink.ServiceBus', _properties: {} }, 'b', null,
    ) as unknown as { icon: string; metadata: unknown };
    bus.metadata = { isderived: '1' };
    expect(bus.icon).toBe('serviceInterfaces');
  });

  it('does not claim an ARRAY of a branded class either', () => {
    // The array container is an ObjectNode whatever the class, so the fallback used
    // to swallow the class here even though every element row below it showed the
    // class icon. An array of a branded class is still that class.
    const arr = ObjectNode.parse(
      {
        _array_class: 'Simulink.Parameter',
        _array_type: 'MATLABArray',
        _dimensions: [3, 1],
        _mw_element_type: 'MATLABArray',
        _elements: [{ _properties: { Value: 1 } }, { _properties: { Value: 2 } }, { _properties: { Value: 3 } }],
      },
      'p',
      null,
    ) as unknown as { icon: string };
    expect(arr.icon).toBe('wsParameters');
  });
});

// The .mat/MCOS path, on a file MATLAB wrote. The synthetic cases above pin the
// rule on the value-object shape; this pins that a real file actually reaches it,
// since the binary decoder builds its array container through a different entry
// point (buildTypedNodeFromMcos) than the dictionary JSON does.
describe('an object array out of a real .mat', () => {
  it('draws the container and its element rows with one icon', () => {
    const path = fileURLToPath(new URL('./fixtures/mcos/paramArray.mat', import.meta.url));
    const buf = readFileSync(path);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const root = MatNode.fromParsed(parseMat(bytes), 'paramArray.mat') as unknown as {
      children: { icon: string; className: string; displayValue: string; children: { icon: string }[] }[];
    };
    // `arr` is a 1x3 Simulink.Parameter — the container row plus three element rows.
    const arr = root.children[0];
    expect([arr.className, arr.displayValue]).toEqual(['Simulink.Parameter', '<1x3 Simulink.Parameter>']);
    expect([arr.icon, ...arr.children.map((c) => c.icon)])
      .toEqual(['wsParameters', 'wsParameters', 'wsParameters', 'wsParameters']);
  });
});
