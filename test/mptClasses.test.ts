// Copyright 2026 The MathWorks, Inc.
//
// `mpt.Parameter` and `mpt.Signal` — the Embedded Coder subclasses of
// `Simulink.Parameter` and `Simulink.Signal` — are KNOWN classes (TODO item 12).
// They carry every property their superclass does plus a handful of
// code-generation ones, so the fix is dispatch, not a second node class: each
// routes to the superclass's typed node and inherits its Kind, its Data Type
// column, its schema-projected columns and its Property Inspector layout, while
// still reporting `mpt.Parameter` / `mpt.Signal` as its OWN class identity.
//
// Before the fix an `mpt.*` entry fell through the class map to the generic
// ObjectNode: the right Class column, and nothing else — no Kind, an empty Data
// Type, no typed columns, and a property bag expanded as anonymous child rows.
//
// ON THE EVIDENCE, because rule 2 of docs/TODO.md forbids inventing a MATLAB
// expectation. There is no MATLAB-authored `mpt.*` fixture in this repo and none
// can be authored here, so every input below is a MATLAB-authored
// `Simulink.Parameter` / `Simulink.Signal` — `params.sldd`'s own `gravity` and
// `sig1` entries, written by MATLAB — with the class name on its `<Element>`
// changed and NOTHING else. That is a legitimate synthesis for exactly this item:
// the only thing under test is class-name DISPATCH, and the property shape an
// `mpt.*` object presents is its superclass's, which the corpus already pins.
// What such a fixture cannot tell us is what the mpt-only code-generation
// properties look like on disk — see `mpt.Parameter.md` for what is therefore
// left unclaimed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import DataModel from '../src/core/DataModel.js';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import SignalNode from '../src/datamodel/node/data/SignalNode.js';
import ObjectNode from '../src/datamodel/node/data/ObjectNode.js';
import SlddNode from '../src/datamodel/node/container/SlddNode.js';
import type DataNode from '../src/datamodel/node/DataNode.js';
import type BaseNode from '../src/datamodel/node/BaseNode.js';
import * as NodeClassMap from '../src/datamodel/node/NodeClassMap.js';
import { buildTypedNodeFromMcos } from '../src/datamodel/node/data/mcosTypedNode.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { buildDataChunkXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { kindForClass } from '../src/index.js';

// The value-object shape both .sldd paths and the MCOS decoder converge on: the
// class name on `_array_class`, the on-disk property bag on the single element.
function rawVal(className: string, properties: Record<string, unknown>): Record<string, unknown> {
  return {
    _array_class: className,
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: properties }],
  };
}

// The CoderInfo sub-object every Simulink data object carries, copied from
// params.sldd's `gravity` (MATLAB-authored). The schema-projected Code Generation
// columns read through it, so a node that does not reach it renders them blank.
function coderInfo(parameterOrSignal: string): Record<string, unknown> {
  return {
    _object_class: 'Simulink.CoderInfo',
    _properties: {
      HasCoderInfo: true,
      StorageClass: 'ExportedGlobal',
      Alignment: { _type: 'int32', _value: '-1' },
      CSCPackageName: 'Simulink',
      ParameterOrSignal: parameterOrSignal,
      CustomStorageClass: 'Default',
      CustomAttributes: { _object_class: 'SimulinkCSC.AttribClass_Simulink_Default', _properties: {} },
    },
  };
}

const PARAM_PROPS: Record<string, unknown> = {
  Value: 9.81,
  Complexity: 'real',
  Dimensions: [1, 1],
  CoderInfo: coderInfo('Parameter'),
  Description: 'gravity accel',
  DataType: 'double',
  Min: 0,
  Max: 100,
  DocUnits: 'm/s^2',
};

const SIGNAL_PROPS: Record<string, unknown> = {
  Dimensions: -1,
  DimensionsMode: 'auto',
  Complexity: 'auto',
  SampleTime: -1,
  SamplingMode: 'auto',
  CoderInfo: coderInfo('Signal'),
  Description: 'wheel speed',
  DataType: 'single',
  Min: -10,
  Max: 10,
  DocUnits: 'm/s',
};

const parse = (className: string, props: Record<string, unknown>): DataNode =>
  NodeClassMap.parseValue(rawVal(className, props), 'e', null);

describe('mpt.Parameter is the Simulink.Parameter treatment under its own name', () => {
  it('routes to the typed ParameterNode rather than the generic object node', () => {
    const node = parse('mpt.Parameter', PARAM_PROPS);
    expect(node).toBeInstanceOf(ParameterNode);
    expect(node).not.toBeInstanceOf(ObjectNode);
    // The registry is the single gate every format goes through — the two .sldd
    // flavours via parseValue, and .mat/.slx via buildTypedNodeFromMcos, which asks
    // it the same question — so being in it is what makes the class known
    // everywhere at once.
    expect(NodeClassMap.getRegisteredClasses()).toContain('mpt.Parameter');
  });

  it('reports its OWN class, not the superclass whose treatment it borrows', () => {
    // The whole point of the item: a user must still see what is actually in their
    // file. Rewriting the identity to the superclass would be worse than the
    // untyped fall-through it replaces.
    const node = parse('mpt.Parameter', PARAM_PROPS);
    expect(node.className).toBe('mpt.Parameter');
    expect((node.toRow() as Record<string, unknown>).Class).toBe('mpt.Parameter');
  });

  it('takes the Simulink.Parameter Kind, so it groups with what it is', () => {
    expect(parse('mpt.Parameter', PARAM_PROPS).kind).toBe('Simulink Parameter');
  });

  it('reads its value and its declared data type through the typed node', () => {
    const node = parse('mpt.Parameter', PARAM_PROPS);
    expect(node.displayValue).toBe('9.81');
    expect(node.dataType).toBe('double');
    expect((node as ParameterNode).Min).toBe(0);
    expect((node as ParameterNode).Max).toBe(100);
    expect((node as ParameterNode).Unit).toBe('m/s^2');
  });

  it('gets the schema-projected typed columns', () => {
    const row = parse('mpt.Parameter', PARAM_PROPS).toRow() as Record<string, any>;
    expect(row.dimensions).toBe('[1 1]');
    expect(row.complexity).toBe('real');
    expect(row.storageClass.text).toBe('ExportedGlobal');
    expect(row.alignment).toBe('-1');
  });

  it('opens the Simulink.Parameter Property Inspector layout', () => {
    // Resolved through the schema alias, so the PI groups are the superclass's own
    // authored layout rather than a copy that can drift from it.
    const layout = parse('mpt.Parameter', PARAM_PROPS).getPILayout()!;
    expect(layout.map((g) => g.group)).toEqual([
      'General',
      'Value Properties',
      'Code Generation',
      'Custom Attributes',
    ]);
  });

  it('resolves the same Kind without a live node, so the tooltip matches the column', () => {
    // kindForClass is the model-free mirror the webview drag/drop tooltip uses. It
    // and DataNode.kind read the same table; a class added to one and not the other
    // is a label that disagrees with itself.
    expect(kindForClass('mpt.Parameter')).toBe('Simulink Parameter');
  });
});

describe('mpt.Signal is the Simulink.Signal treatment under its own name', () => {
  it('routes to the typed SignalNode rather than the generic object node', () => {
    const node = parse('mpt.Signal', SIGNAL_PROPS);
    expect(node).toBeInstanceOf(SignalNode);
    expect(node).not.toBeInstanceOf(ObjectNode);
    expect(NodeClassMap.getRegisteredClasses()).toContain('mpt.Signal');
  });

  it('reports its OWN class, not the superclass whose treatment it borrows', () => {
    const node = parse('mpt.Signal', SIGNAL_PROPS);
    expect(node.className).toBe('mpt.Signal');
    expect((node.toRow() as Record<string, unknown>).Class).toBe('mpt.Signal');
  });

  it('takes the Simulink.Signal Kind, so it groups with what it is', () => {
    expect(parse('mpt.Signal', SIGNAL_PROPS).kind).toBe('Simulink Signal');
  });

  it('reads its declared data type, and stays value-less like its superclass', () => {
    const node = parse('mpt.Signal', SIGNAL_PROPS);
    expect(node.dataType).toBe('single');
    // A Signal has no scalar value in either class; the generic object node it used
    // to fall to renders a `<1x1 mpt.Signal>` summary there instead.
    expect(node.displayValue).toBe('');
    expect(node.valueEditable).toBe(false);
  });

  it('gets the schema-projected typed columns', () => {
    const row = parse('mpt.Signal', SIGNAL_PROPS).toRow() as Record<string, any>;
    expect(row.dimensions).toBe('-1');
    expect(row.complexity).toBe('auto');
    expect(row.dimensionsMode).toBe('auto');
    expect(row.storageClass.text).toBe('ExportedGlobal');
  });

  it('opens the Simulink.Signal Property Inspector layout', () => {
    const layout = parse('mpt.Signal', SIGNAL_PROPS).getPILayout()!;
    expect(layout.map((g) => g.group)).toEqual([
      'General',
      'Value Properties',
      'Code Generation',
      'Custom Attributes',
    ]);
  });

  it('resolves the same Kind without a live node, so the tooltip matches the column', () => {
    expect(kindForClass('mpt.Signal')).toBe('Simulink Signal');
  });
});

describe('the superclasses are untouched by sharing their node', () => {
  it('a Simulink.Parameter still reports Simulink.Parameter', () => {
    // The className getter now reads the parsed value, so the class it reports for
    // the ordinary case has to keep coming out of the file unchanged.
    expect(parse('Simulink.Parameter', PARAM_PROPS).className).toBe('Simulink.Parameter');
    expect(parse('Simulink.Signal', SIGNAL_PROPS).className).toBe('Simulink.Signal');
  });

  it('a freshly created entry reports the class it was created as', () => {
    // createDefault builds its own `_array_val` rather than reading one, so this is
    // the path where a getter that trusts the parsed value could return undefined.
    expect(ParameterNode.createDefault('p', null).className).toBe('Simulink.Parameter');
    expect(SignalNode.createDefault('s', null).className).toBe('Simulink.Signal');
    expect(ParameterNode.createDefault('p', null).kind).toBe('Simulink Parameter');
  });

  it('a node built with no parsed value at all falls back to its declared class', () => {
    // Belt and braces for the same getter: a node constructed directly (as several
    // suites here do) has an empty `serial`, and must not report an empty Class.
    const bare = new ParameterNode('p', null as unknown as BaseNode, {}, {});
    expect(bare.className).toBe('Simulink.Parameter');
    expect(new SignalNode('s', null as unknown as BaseNode, {}, {}).className).toBe('Simulink.Signal');
  });
});

// The write path is the risk this item carries: `.sldd` is the only writable
// format, and a known class that serialized through its node's declared class name
// would rewrite every `mpt.Parameter` in a production dictionary to
// `Simulink.Parameter` on the first save — silent data loss, and a strictly worse
// outcome than the untyped read it replaced.
//
// Both flavours are driven off params.sldd itself: the entry is MATLAB's, cloned
// and re-classed in place (see the file header), so the round trip runs through the
// real binary reader, the real section placement and the real serializer.
function chunk0(): { xml: string; meta: Record<string, Uint8Array> } {
  const p = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
  const zip = unzipSync(new Uint8Array(readFileSync(p)));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) {
    if (k !== 'data/chunk0.xml') meta[k] = v;
  }
  return { xml, meta };
}

const ENTRY_OPEN = '<Object Class="DD.ENTRY">';

// Append a copy of the MATLAB-authored entry `from`, renamed to `to` and re-classed
// from `superClass` to `mptClass`. The original entry stays in the file, so every
// assertion below has its own control sitting next to it.
function withMptClone(xml: string, from: string, to: string, superClass: string, mptClass: string): string {
  const src = xml.split(ENTRY_OPEN).find((e) => e.includes('>' + from + '</P>'));
  expect(src, 'params.sldd no longer has an entry named ' + from).toBeDefined();
  const body = src!.slice(0, src!.indexOf('</Object>') + '</Object>'.length);
  const clone = (ENTRY_OPEN + body)
    .replace('>' + from + '</P>', '>' + to + '</P>')
    // A fresh UUID: the clone is a different entry, and two entries sharing one
    // would be a defect in the fixture rather than in the reader.
    .replace(/<P Name="UUID" Class="char">[^<]*<\/P>/, '<P Name="UUID" Class="char">2b0f5c14-0000-4000-8000-00000000mpt</P>')
    .replace('Class="' + superClass + '"', 'Class="' + mptClass + '"');
  expect(clone).toContain('Class="' + mptClass + '"');
  return xml.replace('    <Object Class="DD.Dictionary">', clone + '\n    <Object Class="DD.Dictionary">');
}

function loadWithClone(uri: string, from: string, to: string, superClass: string, mptClass: string): SlddNode {
  const { xml, meta } = chunk0();
  DataModel.removeDataSource(uri);
  const content = parseBinarySlddParts(withMptClone(xml, from, to, superClass, mptClass), meta);
  return DataModel.addDataSource(uri, content as Record<string, unknown>, {
    path: 'params.sldd',
  }) as unknown as SlddNode;
}

const entryNamed = (root: SlddNode, name: string): DataNode =>
  root.children.flatMap((s) => s.children).find((e) => e.name === name) as unknown as DataNode;

describe('mpt.* survive the .sldd write path with their class intact', () => {
  it('reads an mpt.Parameter out of a real binary dictionary as a typed entry', () => {
    const root = loadWithClone('mem://mpt1', 'gravity', 'mptGravity', 'Simulink.Parameter', 'mpt.Parameter');
    const entry = entryNamed(root, 'mptGravity');
    expect(entry).toBeInstanceOf(ParameterNode);
    expect(entry.className).toBe('mpt.Parameter');
    expect(entry.kind).toBe('Simulink Parameter');
    expect(entry.dataType).toBe('double');
    expect(entry.displayValue).toBe('9.81');
    // Placed by its metadata namespace, not by its class — which is why the section
    // tables need no mpt entry of their own.
    expect(entry.parent!.name).toBe('design');
  });

  it('writes an mpt.Parameter back as mpt.Parameter, not as its superclass', () => {
    const root = loadWithClone('mem://mpt2', 'gravity', 'mptGravity', 'Simulink.Parameter', 'mpt.Parameter');
    const xml = buildDataChunkXml(root);
    expect(xml).toContain('<Element Class="mpt.Parameter">');
    // And the entry that was ALWAYS a Simulink.Parameter still is: the count is the
    // control, since a serializer that resolved the class through the node's
    // declared name would push this to three.
    expect(xml.match(/<Element Class="Simulink\.Parameter">/g)!.length).toBe(2);
  });

  it('re-reads the written mpt.Parameter as the same class and value', () => {
    // The full loop, because "contains the right string" is not the same claim as
    // "reopens as the same entry".
    const root = loadWithClone('mem://mpt3', 'gravity', 'mptGravity', 'Simulink.Parameter', 'mpt.Parameter');
    const { meta } = chunk0();
    DataModel.removeDataSource('mem://mpt3b');
    const reread = DataModel.addDataSource(
      'mem://mpt3b',
      parseBinarySlddParts(buildDataChunkXml(root), meta) as Record<string, unknown>,
      { path: 'params.sldd' },
    ) as unknown as SlddNode;
    const entry = entryNamed(reread, 'mptGravity');
    expect(entry.className).toBe('mpt.Parameter');
    expect(entry.displayValue).toBe('9.81');
    expect(entry.dataType).toBe('double');
  });

  it('keeps the class through an EDIT, which is the save a user actually makes', () => {
    const root = loadWithClone('mem://mpt4', 'gravity', 'mptGravity', 'Simulink.Parameter', 'mpt.Parameter');
    const entry = entryNamed(root, 'mptGravity');
    expect(entry.setProperty('Value', '42')).toBe(true);
    const xml = buildDataChunkXml(root);
    expect(xml).toContain('<Element Class="mpt.Parameter">');
    const { meta } = chunk0();
    DataModel.removeDataSource('mem://mpt4b');
    const reread = DataModel.addDataSource(
      'mem://mpt4b',
      parseBinarySlddParts(xml, meta) as Record<string, unknown>,
      { path: 'params.sldd' },
    ) as unknown as SlddNode;
    expect(entryNamed(reread, 'mptGravity').className).toBe('mpt.Parameter');
    expect(entryNamed(reread, 'mptGravity').displayValue).toBe('42');
  });

  it('reads and rewrites an mpt.Signal the same way', () => {
    const root = loadWithClone('mem://mpt5', 'sig1', 'mptSig', 'Simulink.Signal', 'mpt.Signal');
    const entry = entryNamed(root, 'mptSig');
    expect(entry).toBeInstanceOf(SignalNode);
    expect(entry.className).toBe('mpt.Signal');
    expect(entry.kind).toBe('Simulink Signal');
    expect(entry.dataType).toBe('single');
    const xml = buildDataChunkXml(root);
    expect(xml).toContain('<Element Class="mpt.Signal">');
    expect(xml.match(/<Element Class="Simulink\.Signal">/g)!.length).toBe(1);
  });

  it('keeps the class through the TEXT dictionary write path too', () => {
    // The other writable flavour: serializeJson rebuilds each entry from its node,
    // so the class name has to come off the parsed value there as well.
    const root = loadWithClone('mem://mpt6', 'gravity', 'mptGravity', 'Simulink.Parameter', 'mpt.Parameter');
    const json = root.serializeJson() as any;
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const written = entries.find((e: any) => e.name === 'mptGravity');
    expect(written.value._array_class).toBe('mpt.Parameter');
  });
});

// A .mat file and an .slx model workspace reach the same typed nodes through
// buildTypedNodeFromMcos, which asks NodeRegistry the one question the .sldd paths
// ask it. Asserted rather than assumed: "registered in the class map" is the claim
// that the fix lands in every format at once, and this is the other format.
describe('mpt.* are known on the MCOS path too', () => {
  it('routes a decoded mpt object to the typed node, under its own class', () => {
    const p = buildTypedNodeFromMcos('mpt.Parameter', 'Kp', null, PARAM_PROPS)!;
    expect(p).toBeInstanceOf(ParameterNode);
    expect(p.className).toBe('mpt.Parameter');
    expect(p.kind).toBe('Simulink Parameter');
    expect(p.dataType).toBe('double');
    expect(p.displayValue).toBe('9.81');

    const s = buildTypedNodeFromMcos('mpt.Signal', 'sp', null, SIGNAL_PROPS)!;
    expect(s).toBeInstanceOf(SignalNode);
    expect(s.className).toBe('mpt.Signal');
    expect(s.kind).toBe('Simulink Signal');
    expect(s.dataType).toBe('single');
  });

  it('builds a known mpt class as a shell even with nothing decoded', () => {
    // The knowledge is what matters here: an UNKNOWN class with no recovered
    // properties returns null and stays an opaque variable, so this asserts the
    // class is now on the other side of that gate.
    const p = buildTypedNodeFromMcos('mpt.Parameter', 'Kp', null);
    expect(p).toBeInstanceOf(ParameterNode);
    expect(p!.className).toBe('mpt.Parameter');
    expect(buildTypedNodeFromMcos('mpt.NotAThing', 'x', null)).toBeNull();
  });
});

describe('mpt.* are classes we READ, not classes we offer to create', () => {
  it('no section offers an mpt class in its allowed types', () => {
    // Deliberate, and the reason is the write path rather than the read one: the
    // live MATLAB gate has never seen a dictionary in which WE created an mpt entry
    // from scratch, so offering "Add mpt.Parameter" would claim more than item 12
    // does. Reading a production dictionary that already contains one — which is
    // what the item is about — needs nothing from this list, because an entry's
    // section comes from its metadata namespace and allowsType gates addEntry only.
    const root = new SlddNode('d.sldd');
    for (const key of ['design', 'arch', 'config', 'other']) {
      const section = root.getSection(key)!;
      expect(section.getAllowedTypes(), key).not.toContain('mpt.Parameter');
      expect(section.getAllowedTypes(), key).not.toContain('mpt.Signal');
      expect(section.allowsType('mpt.Parameter'), key).toBe(false);
      expect(section.allowsType('mpt.Signal'), key).toBe(false);
    }
  });

  it('addEntry refuses an mpt class even though the registry now knows it', () => {
    const root = new SlddNode('d.sldd');
    expect(root.getSection('design')!.addEntry('mpt.Parameter', 'Kp')).toBeNull();
    expect(root.getSection('design')!.children.length).toBe(0);
  });
});
