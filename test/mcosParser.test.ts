// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeMcosBlob, NOT_AVAILABLE, type McosObjectData, type OpaqueVarRef } from '../src/datamodel/parser/McosParser.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { parseMxArray } from '../src/datamodel/parser/MxArrayParser.js';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import type { MatVariable } from '../src/datamodel/node/data/MatlabVariableNode.js';

// Direct unit tests for the MCOS decoder's OWN contract. mcosCrossFormat.test.ts
// exercises decodeMcosBlob transitively (asserting the resulting typed-node
// signature); here we call it directly and assert the raw McosObjectData it
// returns — the SLDD-shaped `_properties` bag, the Matrix(r,c) value form, the
// per-object linkage, and the confidence gate that skips (never guesses) an object
// whose located class disagrees with the declared class.
//
// The decoder takes the same two inputs both real callers build: the anonymous
// FileWrapper element's raw bytes (the blob), and one OpaqueVarRef per named opaque
// workspace variable. The helpers below reconstruct those inputs exactly as
// MatNode.fromParsed (.mat) and ModelNode.fromParsed (.slx) do.

function fixture(name: string): ArrayBuffer {
  const path = fileURLToPath(new URL(`./fixtures/mcos/${name}`, import.meta.url));
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ---- .mat: one object per file. Mirrors MatNode.fromParsed's decode setup. ------
function decodeMat(name: string): Map<string, McosObjectData> {
  const { variables } = parseMat(fixture(`${name}.mat`));
  const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous);
  const opaque = variables.filter((v) => v.isOpaque && v.name);
  if (!anon?._rawBytes) return new Map();
  return decodeMcosBlob(
    anon._rawBytes,
    opaque.map((v): OpaqueVarRef => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })),
  );
}

// The two inputs decodeMcosBlob takes, pulled out of a .mat fixture separately so a
// test can damage one of them and leave the other intact.
function blobParts(file: string): { raw: Uint8Array; vars: OpaqueVarRef[] } {
  const { variables } = parseMat(fixture(file));
  const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous);
  const opaque = variables.filter((v) => v.isOpaque && v.name);
  return {
    raw: anon!._rawBytes!,
    vars: opaque.map((v): OpaqueVarRef => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })),
  };
}

const MCOS_HANDLE_MAGIC = 3707764736; // 0xDD000000

/**
 * Overwrite one word of the object handle inside a variable's raw bytes, addressed
 * by its index past the magic: word 1 is ndims, 2.. are the dimensions, and the
 * ids follow. Returns a copy, so the caller's bytes stay usable.
 */
function patchHandle(rawBytes: Uint8Array, wordIndex: number, value: number): Uint8Array {
  const copy = rawBytes.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  for (let o = 0; o + 8 <= copy.length; o += 4) {
    if (view.getUint32(o, true) !== MCOS_HANDLE_MAGIC) continue;
    view.setUint32(o + wordIndex * 4, value, true);
    return copy;
  }
  throw new Error('no object handle in these raw bytes');
}

// ---- .slx: all objects share one blob. Mirrors ModelNode.fromParsed's setup. ----
function decodeSlx(): Map<string, McosObjectData> {
  const { workspace } = parseSlx(fixture('mcosfix.slx'), 'mcosfix.slx');
  const trailing = (workspace as unknown as { _trailingElements?: Uint8Array[] })._trailingElements;
  const opaque = (workspace as MatVariable[]).filter((v) => v.isOpaque && v.name);
  if (!trailing || trailing.length === 0) return new Map();
  return decodeMcosBlob(
    trailing[0],
    opaque.map((v): OpaqueVarRef => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })),
  );
}

// Expected raw property values per entry, keyed as the decoder emits them. Note the
// binary path exposes `DocUnits` (the typed node maps it to Unit) — the decoder is
// NOT responsible for that rename, so we assert the raw name here.
interface Expected {
  className: string;
  props: Record<string, unknown>;
}
const EXPECTED: Record<string, Expected> = {
  Param: {
    className: 'Simulink.Parameter',
    props: { Value: 42, Min: -1, Max: 100, DataType: 'int32', DocUnits: 'm/s', Description: 'hello' },
  },
  ParamMat: {
    className: 'Simulink.Parameter',
    props: {
      Value: { _type: 'double', _value: 'Matrix(2,3)\n[1, 2, 3]\n[4, 5, 6]' },
      Description: 'matrix',
    },
  },
  Sig: {
    className: 'Simulink.Signal',
    props: { Min: -5, Max: 5, DataType: 'single', DocUnits: 'V', Description: 'sigdesc' },
  },
  Numeric: { className: 'Simulink.NumericType', props: { Description: 'numdesc' } },
  Alias: { className: 'Simulink.AliasType', props: { Description: 'aliasdesc' } },
  Bp: { className: 'Simulink.Breakpoint', props: {} },
  Lut: { className: 'Simulink.LookupTable', props: {} },
};
const ENTRY_NAMES = Object.keys(EXPECTED);

// The decoded object must carry the declared class + package/short split, dimensions,
// and every expected property with the exact value the manifest specifies. Extra
// default props (CoderInfo/Complexity/etc.) are allowed — we assert a superset match
// on the ones with known non-default values, plus the class/name identity.
function assertObject(name: string, obj: McosObjectData | undefined): void {
  const exp = EXPECTED[name];
  expect(obj, `decoder returned nothing for ${name}`).toBeDefined();
  expect(obj!.name).toBe(name);
  expect(obj!.className).toBe(exp.className);
  const lastDot = exp.className.lastIndexOf('.');
  expect(obj!.packageName).toBe(exp.className.slice(0, lastDot));
  expect(obj!.shortClassName).toBe(exp.className.slice(lastDot + 1));
  expect(obj!.dimensions).toEqual([1, 1]);
  for (const [k, v] of Object.entries(exp.props)) {
    expect(obj!.properties[k], `${name}.${k}`).toEqual(v);
  }
  // The `value` convenience mirror must equal properties.Value.
  expect(obj!.value).toEqual(obj!.properties.Value);
}

describe('decodeMcosBlob — direct decoder contract (.mat, one object per file)', () => {
  it.each(ENTRY_NAMES)('%s decodes to the expected McosObjectData', (name) => {
    const data = decodeMat(name);
    assertObject(name, data.get(name));
  });

  it('emits a matrix Value as the SLDD Matrix(r,c) string form (row-major)', () => {
    const obj = decodeMat('ParamMat').get('ParamMat')!;
    expect(obj.properties.Value).toEqual({
      _type: 'double',
      _value: 'Matrix(2,3)\n[1, 2, 3]\n[4, 5, 6]',
    });
  });

  it('leaves properties with no confidently-resolved value out of the bag', () => {
    // Bp/Lut carry no known non-default scalar props in the manifest; the decoder
    // must not fabricate Value/Min/Max for them.
    const bp = decodeMat('Bp').get('Bp')!;
    expect(bp.properties.Min).toBeUndefined();
    expect(bp.properties.Max).toBeUndefined();
  });
});

describe('decodeMcosBlob — direct decoder contract (.slx, all objects share one blob)', () => {
  const slx = decodeSlx();

  it('decodes every named workspace object from the shared blob', () => {
    // Multi-object linkage: each named var must map to its OWN root object id, so
    // all seven come back distinctly from one metadata table.
    expect(new Set(slx.keys())).toEqual(new Set(ENTRY_NAMES));
  });

  it.each(ENTRY_NAMES)('%s decodes to the expected McosObjectData', (name) => {
    assertObject(name, slx.get(name));
  });
});

describe('decodeMcosBlob — .mat and .slx paths agree on the meaningful values', () => {
  // Both formats must decode the SAME class and the SAME known non-default values.
  // Their FULL property bags are NOT byte-identical: the two binary encodings
  // represent some *default* nested props differently (e.g. .slx carries
  // CoderInfo.CustomAttributes as [] plus HasCoderInfo:false, while .mat carries
  // CustomAttributes as a default object handle). Those defaults never surface in
  // the typed-node columns, so display parity holds regardless — asserting them
  // equal would lock down an encoding accident, not the contract.
  const slx = decodeSlx();
  it.each(ENTRY_NAMES)('%s agrees on class + known values across formats', (name) => {
    const fromMat = decodeMat(name).get(name)!;
    const fromSlx = slx.get(name)!;
    expect(fromSlx.className).toBe(fromMat.className);
    for (const k of Object.keys(EXPECTED[name].props)) {
      expect(fromSlx.properties[k], `${name}.${k}`).toEqual(fromMat.properties[k]);
    }
    expect(fromSlx.value).toEqual(fromMat.value);
  });
});

describe('decodeMcosBlob — custom class objects (multi-object graph, .mat)', () => {
  // object_props.mat holds two customer-defined classes with no known schema:
  //   v = Vehicle{ Name="Model-X" (string), Wheels=6, Engine=Engine{...},
  //                Specs=struct{mass,color}, Tags={'suv','electric'} }
  //   f = Fleet{ FleetName="east" (string), Count=3, Lead=Garage{...}, Notes=struct }
  // It exercises the object->block indirection (word4), the class-defaults merge
  // (Fleet.Notes lives in defaults, not the instance block), struct/cell value
  // resolution, nested handle recursion, and the string sentinel.
  const decoded = decodeMat('object_props');
  const v = decoded.get('v');
  const f = decoded.get('f');

  it('decodes both custom objects from the shared blob', () => {
    expect(v).toBeDefined();
    expect(f).toBeDefined();
    expect(v!.className).toBe('Vehicle');
    expect(f!.className).toBe('Fleet');
  });

  it('resolves numeric, struct, cell, and nested-object property values', () => {
    expect(v!.properties.Wheels).toBe(6);
    // nested object -> { _object_class, _properties }
    const engine = v!.properties.Engine as Record<string, unknown>;
    expect(engine._object_class).toBe('Engine');
    expect((engine._properties as Record<string, unknown>).Cylinders).toBe(8);
    // struct -> SLDD Struct shape
    const specs = v!.properties.Specs as Record<string, unknown>;
    expect(specs._array_type).toBe('Struct');
    expect((specs._elements as Record<string, unknown>[])[0].mass).toBe(2200);
    // cell -> SLDD Cell shape with char elements
    const tags = v!.properties.Tags as Record<string, unknown>;
    expect(tags._array_type).toBe('Cell');
    expect(tags._elements).toEqual(['suv', 'electric']);
  });

  it('decodes a MATLAB string-typed property value out of its own payload cell', () => {
    // This used to be the honest sentinel: the property NAME was present and its value
    // was '<not available>'. The payload layout is measured now (test/parity/matlab/
    // STRING_MCOS.md), so a string PROPERTY decodes exactly as a string VARIABLE does —
    // and this fixture is the corpus's only artifact that reaches it, because a Simulink
    // class converts a string assigned to a property into a char.
    //
    // The value is the dimensioned envelope the dictionary formats use for a string
    // array, so the node layer renders a property-held string through the same path.
    expect('Name' in v!.properties).toBe(true);
    expect(v!.properties.Name).toEqual({
      _array_type: 'String',
      _dimensions: [1, 1],
      _elements: ['Model-X'],
      _mw_element_type: 'MATLABArray',
    });
    expect(f!.properties.FleetName).toEqual({
      _array_type: 'String',
      _dimensions: [1, 1],
      _elements: ['east'],
      _mw_element_type: 'MATLABArray',
    });
  });

  it('still has a sentinel to fall back on', () => {
    // Kept as the answer for a payload whose words do not account for the text: a shape
    // with no characters, never characters we invented. Nothing in the corpus produces
    // one, so this is the contract, asserted at the unit it is defined at.
    expect(NOT_AVAILABLE).toBe('<not available>');
  });

  it('merges class defaults so a default-valued property (Fleet.Notes) still appears', () => {
    // Notes was left at its class default and is absent from the instance block; it
    // must still surface (by name and value) from the per-class defaults cell.
    expect('Notes' in f!.properties).toBe(true);
    const notes = f!.properties.Notes as Record<string, unknown>;
    expect(notes._array_type).toBe('Struct');
  });

  it('recurses a nested handle-object property to the correct class (Fleet.Lead=Garage)', () => {
    const lead = f!.properties.Lead as Record<string, unknown>;
    expect(lead._object_class).toBe('Garage');
    expect((lead._properties as Record<string, unknown>).Capacity).toBe(25);
  });
});

describe('decodeMcosBlob — refuses to guess (confidence gate + defensive returns)', () => {
  it('returns an empty map when no opaque vars are requested', () => {
    const { variables } = parseMat(fixture('Param.mat'));
    const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous);
    expect(decodeMcosBlob(anon!._rawBytes!, []).size).toBe(0);
  });

  it('returns an empty map for empty/garbage blob bytes', () => {
    expect(decodeMcosBlob(new Uint8Array(0), [{ name: 'x', className: 'Simulink.Parameter' }]).size).toBe(0);
    expect(decodeMcosBlob(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), [
      { name: 'x', className: 'Simulink.Parameter' },
    ]).size).toBe(0);
  });

  it('skips a var whose declared class disagrees with the located object (never guesses)', () => {
    // The blob genuinely contains a Simulink.Parameter at Param's root id, but we
    // lie about the class. The confidence gate must refuse it rather than return a
    // mislabeled object — a wrong value is worse than an absent one.
    const { variables } = parseMat(fixture('Param.mat'));
    const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous);
    const real = variables.filter((v) => v.isOpaque && v.name);
    const lied = real.map((v): OpaqueVarRef => ({ name: v.name, className: 'Simulink.Signal', rawBytes: v._rawBytes }));
    expect(decodeMcosBlob(anon!._rawBytes!, lied).size).toBe(0);
  });

  it('drops a var whose raw bytes carry no object handle (no root id)', () => {
    const { variables } = parseMat(fixture('Param.mat'));
    const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous);
    const orphan: OpaqueVarRef = { name: 'Param', className: 'Simulink.Parameter', rawBytes: new Uint8Array(64) };
    expect(decodeMcosBlob(anon!._rawBytes!, [orphan]).has('Param')).toBe(false);
  });

  it('drops a var whose handle declares an object id the table does not hold', () => {
    // The id has to be in range before meta.objects[id] can be read for the class
    // check; an out-of-range id is a blob we mis-located, not an object to guess at.
    const { raw, vars } = blobParts('Param.mat');
    expect(decodeMcosBlob(raw, [{ ...vars[0], rawBytes: patchHandle(vars[0].rawBytes!, 4, 99999) }]).size).toBe(0);
  });

  it('drops a var whose handle declares an impossible shape', () => {
    const { raw, vars } = blobParts('Param.mat');
    const rawBytes = vars[0].rawBytes!;
    // ndims beyond the 1..8 a real handle carries.
    expect(decodeMcosBlob(raw, [{ ...vars[0], rawBytes: patchHandle(rawBytes, 1, 99) }]).size).toBe(0);
    // A zero dimension means zero objects, so there is nothing to build.
    expect(decodeMcosBlob(raw, [{ ...vars[0], rawBytes: patchHandle(rawBytes, 2, 0) }]).size).toBe(0);
    // An element count whose ids would run off the end of the handle's own bytes.
    expect(decodeMcosBlob(raw, [{ ...vars[0], rawBytes: patchHandle(rawBytes, 2, 100000) }]).size).toBe(0);
  });
});

// REGRESSION. Every offset the decoder walks comes from a length the FILE declared,
// so a damaged blob can point past the bytes present. DataView answers that with a
// RangeError, and nothing between here and the host catches it: a .slx whose
// modelWorkspace.mxarray was truncated threw out of ModelNode.fromParsed and the
// file would not open AT ALL, rather than opening with the object left unresolved.
//
// MxArrayParser is what makes such a blob reachable — it deliberately hands over a
// SHORT trailing element rather than a fabricated one (see its own comment), which
// is the honest choice and puts the burden here.
//
// The sweep below is the point of these tests: a single hand-picked truncation only
// proves one offset was guarded, whereas the failure was at 13 specific lengths out
// of ~3700. Walking every 4-byte boundary is what shows the whole navigation path is
// bounded rather than one branch of it.
describe('decodeMcosBlob — a truncated blob must not throw', () => {
  function sweep(raw: Uint8Array, vars: OpaqueVarRef[]): { threw: number[]; decoded: number } {
    const threw: number[] = [];
    let decoded = 0;
    for (let len = 8; len <= raw.length; len += 4) {
      try {
        if (decodeMcosBlob(raw.slice(0, len), vars).size > 0) decoded++;
      } catch {
        threw.push(len);
      }
    }
    return { threw, decoded };
  }

  it('survives every truncation of a .mat blob, and still decodes the whole one', () => {
    const { raw, vars } = blobParts('Param.mat');
    const { threw, decoded } = sweep(raw, vars);
    expect(threw).toEqual([]);
    // The guards must not have turned the decoder off: a mostly-intact blob still
    // resolves, so this is a bounds fix rather than a bail-out-early one.
    expect(decoded).toBeGreaterThan(0);
    expect(decodeMcosBlob(raw, vars).get('Param')!.properties.Value).toBe(42);
  });

  it('survives every truncation of the multi-object .mat blob', () => {
    const { raw, vars } = blobParts('object_props.mat');
    expect(sweep(raw, vars).threw).toEqual([]);
    expect(decodeMcosBlob(raw, vars).size).toBe(2);
  });

  it('survives a truncated .slx model workspace, the case that actually failed', () => {
    // Walk it exactly as ModelNode.fromParsed does — parseMxArray on the truncated
    // mxarray part, then decodeMcosBlob on the trailing element it yields — because
    // the blob that broke this was one parseMxArray had already clamped.
    const { zipEntries } = parseSlx(fixture('mcosfix.slx'), 'mcosfix.slx');
    const part = zipEntries['simulink/modelWorkspace.mxarray'];
    const full = part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer;

    const threw: number[] = [];
    for (let len = 16; len <= part.length; len += 4) {
      const ws = parseMxArray(full.slice(0, len));
      const opaque = ws.filter((v) => v.isOpaque && v.name);
      const trailing = ws._trailingElements;
      if (opaque.length === 0 || !trailing?.length) continue;
      try {
        decodeMcosBlob(
          trailing[0],
          opaque.map((v): OpaqueVarRef => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })),
        );
      } catch {
        threw.push(len);
      }
    }
    expect(threw).toEqual([]);
  });

  it('opens a .slx whose model workspace was cut short, leaving the object a shell', () => {
    // The host-visible contract: a damaged workspace costs you the decoded property
    // values, not the file. 1348 is one of the lengths that used to throw.
    const { zipEntries } = parseSlx(fixture('mcosfix.slx'), 'mcosfix.slx');
    const part = zipEntries['simulink/modelWorkspace.mxarray'];
    const cut = (part.buffer as ArrayBuffer).slice(part.byteOffset, part.byteOffset + 1348);

    const ws = parseMxArray(cut);
    const opaque = ws.filter((v) => v.isOpaque && v.name);
    expect(opaque.length).toBeGreaterThan(0);
    const decoded = decodeMcosBlob(
      ws._trailingElements[0],
      opaque.map((v): OpaqueVarRef => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })),
    );
    // Names survive (they come from the mxarray struct, not the blob); the property
    // values do not, which is the honest outcome for bytes that are not there.
    expect(decoded.size).toBe(0);
  });
});

describe('decodeMcosBlob — object arrays (all elements, real dimensions)', () => {
  // variableUsageArray.mat is a 20x1 Simulink.VariableUsage — the object handle in
  // the variable's raw bytes encodes [magic, ndims=2, 20, 1, id0..id19]. The decoder
  // must return one element bag per object id and the real [20, 1] shape, not just
  // the first object as a [1, 1] scalar.
  const decoded = decodeMat('variableUsageArray').get('variables')!;

  it('reports the true array dimensions', () => {
    expect(decoded).toBeDefined();
    expect(decoded.dimensions).toEqual([20, 1]);
  });

  it('returns one element property bag per array element (20)', () => {
    expect(decoded.elements).toHaveLength(20);
    expect(decoded.elements[0].Name).toBe('Ka');
    expect(decoded.elements[19].Name).toBe('g');
  });

  it('mirrors elements[0] into the scalar-compat properties/value fields', () => {
    expect(decoded.properties).toEqual(decoded.elements[0]);
    expect(decoded.value).toEqual(decoded.elements[0].Value);
  });

  it('decodes distinct data per element (Name + Source)', () => {
    for (const el of decoded.elements) {
      expect(typeof el.Name).toBe('string');
      expect(el.Source).toBe('f14');
      expect(el.SourceType).toBe('model workspace');
    }
    const names = decoded.elements.map((e) => e.Name);
    expect(new Set(names).size).toBe(20); // all distinct
  });
});

describe('decodeMcosBlob — nested object arrays (Elements_internal in a Bus)', () => {
  // busArray.mat is a 1x3 Simulink.Bus where each element has a differently-sized
  // Elements_internal property: bus[0] has 1 BusElement (scalar handle → the
  // resolveValue scalar path), bus[1] has 2 (object array → the _elements map at
  // line 344), bus[2] has 3. This is the only case where a PROPERTY (not the root
  // variable) holds an object array, which takes the multi-id handle branch.
  const decoded = decodeMat('busArray').get('buses')!;

  it('decodes a 1x3 Bus array with correct dimensions', () => {
    expect(decoded).toBeDefined();
    expect(decoded.dimensions).toEqual([1, 3]);
    expect(decoded.elements).toHaveLength(3);
  });

  it('resolves a scalar Elements_internal as a single nested object', () => {
    // bus[0] has one BusElement, so resolveValue takes the scalar-handle path.
    const ei = decoded.elements[0].Elements_internal as Record<string, unknown>;
    expect(ei._object_class).toBe('Simulink.BusElement');
    expect((ei._properties as Record<string, unknown>).Name).toBe('a');
  });

  it('resolves a multi-element Elements_internal as an object array shape', () => {
    // bus[1] has 2 BusElements. resolveValue must take the multi-id handle branch
    // (lines 337-344), producing the _array_class / _elements form that the SLDD
    // path emits for object arrays, so the data model builds child rows correctly.
    const ei = decoded.elements[1].Elements_internal as Record<string, unknown>;
    expect(ei._array_type).toBe('MATLABArray');
    expect(ei._array_class).toBe('Simulink.BusElement');
    expect(ei._dimensions).toEqual([2, 1]);
    const elems = ei._elements as { _properties: Record<string, unknown> }[];
    expect(elems).toHaveLength(2);
    expect(elems[0]._properties.Name).toBeDefined();
    expect(elems[1]._properties.Name).toBeDefined();
    expect(elems[0]._properties.Name).not.toBe(elems[1]._properties.Name);
  });

  it('resolves a 3-element object array with each element carrying its own props', () => {
    const ei = decoded.elements[2].Elements_internal as Record<string, unknown>;
    expect(ei._array_type).toBe('MATLABArray');
    const elems = ei._elements as { _properties: Record<string, unknown> }[];
    expect(elems).toHaveLength(3);
    const names = elems.map((e) => e._properties.Name);
    expect(new Set(names).size).toBe(3);
  });
});

// Defect 9's third site. resolveValue's object-array branch truncated a nested
// property's shape to its first two extents exactly as the root-variable branch and
// mcosTypedNode did. busArray cannot see it — a Bus's Elements_internal is always
// Nx1 — so ndNested.mat exists for this: MATLAB R2027a wrote
// `h.Kids = reshape(arrayfun(@(k) Simulink.Parameter(k), 1:12), [2 3 2])` and
// reports size(h.Kids) as [2 3 2], h.Kids(:) as Values 1..12 (see NdHolder.m).
describe('decodeMcosBlob — a RANK-3 nested object array property (ndNested.mat)', () => {
  const decoded = decodeMat('ndNested').get('h');

  it('keeps every extent the property handle declares', () => {
    expect(decoded).toBeDefined();
    const kids = decoded!.properties.Kids as Record<string, unknown>;
    expect(kids._array_class).toBe('Simulink.Parameter');
    expect(kids._dimensions).toEqual([2, 3, 2]);
    const elems = kids._elements as { _properties: Record<string, unknown> }[];
    expect(elems).toHaveLength(12);
    // Column-major, as MATLAB stores it.
    expect(elems.map((e) => e._properties.Value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('decodeMcosBlob — short / null / undefined rawBytes on a variable', () => {
  // objectHandleFromRaw (line 480) bails when rawBytes is missing or too short to
  // hold even one uint32 word. Without the guard, a variable whose element was
  // truncated by MxArrayParser would throw RangeError from DataView instead of
  // quietly producing an unresolved shell.
  it('skips a variable whose rawBytes is null, undefined, or shorter than 4 bytes', () => {
    const { raw } = blobParts('Param.mat');
    expect(decodeMcosBlob(raw, [{ name: 'x', className: 'Simulink.Parameter', rawBytes: null }]).size).toBe(0);
    expect(decodeMcosBlob(raw, [{ name: 'x', className: 'Simulink.Parameter' }]).size).toBe(0);
    expect(decodeMcosBlob(raw, [{ name: 'x', className: 'Simulink.Parameter', rawBytes: new Uint8Array(3) }]).size).toBe(0);
  });
});

// REGRESSION. The metadata table's property blocks, object references, and string
// indices all come from the FILE. If any of those is out of range, the decoder used
// to either throw (RangeError / TypeError on an undefined object) or return a
// mis-built property bag. Every one of these must silently degrade — the variable
// opens as an empty shell, exactly like a truncated blob.
//
// The damage technique: we decode a known-good fixture to get the blob bytes, then
// patch specific words in the metadata or property blocks to values that are out of
// range. The decoder must still return without throwing and must decode the UNDAMAGED
// variables correctly when possible.
describe('decodeMcosBlob — damaged metadata (bad offsets, flags, ids)', () => {
  // For these tests we damage the blob's metadata bytes directly. The metadata is
  // inside the first heap cell (cells[0]), which is deeply nested in the blob
  // (outerMatrix → structMatrix → MCOS opaque → cell array → cells[0]). Rather than
  // navigate that structure, we sweep through the blob bytes looking for a unique
  // sentinel pattern in the metadata we can patch.
  //
  // However, a simpler approach: we test the EFFECTS of bad data by feeding the
  // decoder variables with broken handles (which we can control via patchHandle).

  it('returns an empty map when the blob is internally valid but no handle resolves', () => {
    // An opaque var whose handle points to object 0 (the null object) — the
    // confidence check must reject it because object 0's class is undefined.
    const { raw, vars } = blobParts('Param.mat');
    const patched = patchHandle(vars[0].rawBytes!, 4, 0); // objId = 0 (null object)
    expect(decodeMcosBlob(raw, [{ ...vars[0], rawBytes: patched }]).size).toBe(0);
  });

  it('truncation sweep on busArray (multi-object blob) never throws', () => {
    // busArray.mat has a richer metadata table (multiple classes, object arrays,
    // property blocks with heap-cell references). Truncating it exercises the
    // bounds guards in the metadata parser and nested-object resolution path.
    //
    // EVERY byte length, not every fourth: the navigation guards trigger on how a
    // declared length lands relative to the bytes present, and a stride of 4 steps
    // over three quarters of those landings — including the ones where a nested
    // view is long enough for its own tag but not for the subelement after it.
    const { raw, vars } = blobParts('busArray.mat');
    const threw: number[] = [];
    let decoded = 0;
    for (let len = 0; len <= raw.length; len++) {
      try {
        if (decodeMcosBlob(raw.slice(0, len), vars).size > 0) decoded++;
      } catch {
        threw.push(len);
      }
    }
    expect(threw).toEqual([]);
    expect(decoded).toBeGreaterThan(0);
    // The blob only becomes navigable once essentially all of it is present, so a
    // partial file yields an empty shell rather than a half-built object.
    expect(decoded).toBeLessThan(raw.length);
  });
});

describe('decodeMcosBlob — damaged nested handles (byte surgery on blob)', () => {
  // These tests corrupt specific object handles INSIDE the blob (not the variable's
  // own handle, which patchHandle covers). In busArray.mat, the nested
  // Elements_internal property on each Bus element holds an object handle as a
  // uint32 heap cell. The handles are at known blob offsets:
  //   offset 1872: [magic, 2, 1, 1, 2]     — scalar handle to BusElement obj 2
  //   offset 2544: [magic, 2, 2, 1, 4, 5]   — 2-element array to objs 4, 5
  //   offset 3400: [magic, 2, 3, 1, 7, 8, 9] — 3-element array to objs 7, 8, 9

  function patchBlobWord(raw: Uint8Array, magicOffset: number, wordIndex: number, value: number): Uint8Array {
    const copy = raw.slice();
    const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
    view.setUint32(magicOffset + wordIndex * 4, value, true);
    return copy;
  }

  it('rejects a nested handle with bad ndims, falling back to scalar path', () => {
    // Patching ndims to 0 on the 2-element handle triggers objectHandleFromValue's
    // guard (ndims < 1); resolveValue gets null and falls back to the scalar-handle
    // path using cell.value[4] directly.
    const { raw, vars } = blobParts('busArray.mat');
    const patched = patchBlobWord(raw, 2544, 1, 0); // ndims = 0
    const result = decodeMcosBlob(patched, vars).get('buses')!;
    expect(result).toBeDefined();
    // bus[1] had a 2-element array; after the bad ndims, it falls back to a scalar
    // reference, so it resolves as a single nested object, not an array.
    const ei = result.elements[1].Elements_internal as Record<string, unknown>;
    expect(ei._object_class).toBe('Simulink.BusElement');
  });

  it('returns undefined for a nested scalar handle pointing to a nonexistent object', () => {
    // Patching the objId in the scalar handle (offset 1872) to a value beyond the
    // object table triggers buildObjectValue's guard (if !obj return undefined),
    // which silently drops the property rather than throwing.
    const { raw, vars } = blobParts('busArray.mat');
    const patched = patchBlobWord(raw, 1872, 4, 99999);
    const result = decodeMcosBlob(patched, vars).get('buses')!;
    expect(result).toBeDefined();
    // bus[0].Elements_internal resolves to undefined (dropped from props).
    expect(result.elements[0].Elements_internal).toBeUndefined();
  });

  it('returns empty props for a nonexistent object inside a multi-element handle', () => {
    // Patching one objId in the 2-element handle (offset 2544, word[4]) to 99999
    // triggers buildProperties' guard (if !obj return {}), producing an element with
    // an empty _properties bag instead of throwing.
    const { raw, vars } = blobParts('busArray.mat');
    const patched = patchBlobWord(raw, 2544, 4, 99999);
    const result = decodeMcosBlob(patched, vars).get('buses')!;
    const ei = result.elements[1].Elements_internal as Record<string, unknown>;
    expect(ei._array_type).toBe('MATLABArray');
    const elems = ei._elements as { _properties: Record<string, unknown> }[];
    // The first element (patched to 99999) has an empty props bag.
    expect(elems[0]._properties).toEqual({});
    // The second element (untouched, obj 5) still resolves correctly.
    expect(elems[1]._properties.Name).toBeDefined();
  });

  it('detects a cycle when a nested handle points back to an ancestor object', () => {
    // Patching the scalar handle (offset 1872, obj 2) to point to obj 1 (the root
    // Bus) creates a cycle: Bus -> Elements_internal -> Bus -> ... The path set
    // catches it and returns an empty _properties bag, preventing infinite recursion.
    const { raw, vars } = blobParts('busArray.mat');
    const patched = patchBlobWord(raw, 1872, 4, 1); // obj 1 is the root Bus
    const result = decodeMcosBlob(patched, vars).get('buses')!;
    const ei = result.elements[0].Elements_internal as Record<string, unknown>;
    expect(ei._object_class).toBe('Simulink.Bus');
    expect(ei._properties).toEqual({});
  });
});

// REGRESSION. resolveValue checked `className === 'logical'` to detect logical arrays,
// but parseMatrix never sets className to 'logical' — it uses the MAT class number
// (uint8 = 9) for the className and records the logical flag separately on the
// isLogical field. The check was dead code, so a logical-flagged heap cell fell through
// to the numeric branches and returned raw numbers (0/1) instead of booleans.
//
// The fix: check `cell.isLogical` instead of `cls === 'logical'`.
//
// To reach this branch with a real fixture, we set the isLogical flag bit (0x02 at
// the flags byte offset) on specific heap cells inside the Bp.mat blob. The offsets
// were found by tracing the nested MAT structure: outer uint8 matrix → blob bytes →
// struct → MCOS opaque → cell array → child mxArrays → flags subelement.
describe('decodeMcosBlob — logical-flagged heap cells resolve as booleans', () => {
  it('scalar logical resolves as boolean, not number (TunableSizeValue)', () => {
    // cells[3] in Bp.mat is a double scalar (value = -1) used as TunableSizeValue
    // on the nested Breakpoint. Setting isLogical should resolve it to true.
    const { raw, vars } = blobParts('Bp.mat');
    const patched = raw.slice();
    // The flags byte for cells[3]'s mxArray is at raw offset 1417 (offset 1416 is
    // the class byte = 0x06 for double; 1417 is the flags byte = 0x00). Setting
    // bit 1 (0x02) marks it as logical.
    expect(patched[1416]).toBe(0x06); // class = double — guards against fixture drift
    patched[1417] |= 0x02;

    const bp = decodeMcosBlob(patched, vars).get('Bp')!;
    const breakpoints = bp.properties.Breakpoints as Record<string, unknown>;
    const bpProps = (breakpoints._properties as Record<string, unknown>);
    // Before fix: -1 (number). After fix: true (boolean, via !!(-1)).
    expect(bpProps.TunableSizeValue).toBe(true);
    expect(typeof bpProps.TunableSizeValue).toBe('boolean');
  });

  it('array of logicals resolves as boolean[], not number[] (Dimensions)', () => {
    // cells[4] in Bp.mat is a double array [0, 0] used as Dimensions. Setting
    // isLogical should resolve it to [false, false].
    const { raw, vars } = blobParts('Bp.mat');
    const patched = raw.slice();
    // Flags byte for cells[4] is at raw offset 1481 (class = 0x06 at 1480).
    expect(patched[1480]).toBe(0x06);
    patched[1481] |= 0x02;

    const bp = decodeMcosBlob(patched, vars).get('Bp')!;
    const breakpoints = bp.properties.Breakpoints as Record<string, unknown>;
    const bpProps = (breakpoints._properties as Record<string, unknown>);
    // Before fix: [0, 0] (number[]). After fix: [false, false] (boolean[]).
    expect(bpProps.Dimensions).toEqual([false, false]);
  });
});

// The metadata table's property blocks are the last thing between the FILE's bytes
// and a property bag: a block's declared property count is a loop bound, each
// triple's name index is a string-table lookup, and each triple's flag selects how
// its value is read. All three come from the file, so all three can be wrong on a
// damaged or hand-edited blob, and each has to degrade to "that property is absent"
// rather than throw, hang, or invent a value. The blob's metadata table sits at a
// known offset in these fixtures (see the block walk below), so we can aim a patch
// at one real triple and watch exactly one property drop out.
describe('decodeMcosBlob — damaged property blocks (byte surgery on the metadata table)', () => {
  // busArray.mat's metadata table starts at this blob offset. Asserted below, so
  // fixture drift fails loudly instead of silently patching the wrong bytes.
  const META = 304;

  function meta(raw: Uint8Array): { header: number[]; blocks: { at: number; nProps: number }[] } {
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const u32 = (byteOffset: number) => view.getUint32(byteOffset, true);
    const header = Array.from({ length: 10 }, (_, i) => u32(META + i * 4));
    const align8 = (n: number) => n + ((8 - (n % 8)) % 8);
    // Walk the property-block segment [w[5], w[6]) exactly as the parser does.
    const blocks: { at: number; nProps: number }[] = [];
    for (let p = header[5]; p < header[6]; ) {
      const start = p;
      const nProps = u32(META + p);
      p += 4 + nProps * 12;
      blocks.push({ at: start, nProps });
      p = start + align8(p - start);
    }
    return { header, blocks };
  }

  function patchWord(raw: Uint8Array, byteOffset: number, value: number): Uint8Array {
    const copy = raw.slice();
    new DataView(copy.buffer, copy.byteOffset, copy.byteLength).setUint32(byteOffset, value, true);
    return copy;
  }

  // The busArray fixture's Bus object: 6 properties, 3 array elements.
  const ALL_PROPS = ['Alignment', 'PreserveElementDimensions', 'Elements_internal', 'Description', 'DataScope', 'HeaderFile'];

  it('the metadata table is where these tests assume it is', () => {
    const { raw } = blobParts('busArray.mat');
    const { header, blocks } = meta(raw);
    // Segment ends monotonic and in bounds — i.e. we really found the header.
    expect(header[2]).toBeLessThanOrEqual(header[3]);
    expect(header[6]).toBeLessThanOrEqual(raw.length - META);
    // Block 0 is the empty/default block; block 1 is the Bus instance's own.
    expect(blocks[0].nProps).toBe(0);
    expect(blocks[1].nProps).toBe(5);
    expect(Object.keys(decodeMcosBlob(raw, blobParts('busArray.mat').vars).get('buses')!.properties)).toEqual(ALL_PROPS);
  });

  it('drops a property whose name index points at the empty string', () => {
    // Index 0 of the string table is the synthetic empty string, so a triple
    // naming it names nothing. Keying a property bag on '' would put a nameless
    // row in the Property Inspector; the class default it was overriding
    // (PreserveElementDimensions) is what remains.
    const { raw, vars } = blobParts('busArray.mat');
    const { blocks } = meta(raw);
    const patched = patchWord(raw, META + blocks[1].at + 4, 0);
    const props = decodeMcosBlob(patched, vars).get('buses')!.properties;
    expect(Object.keys(props)).toEqual(ALL_PROPS.filter((p) => p !== 'PreserveElementDimensions'));
  });

  it('drops a property whose name index is past the end of the string table', () => {
    // Out of range reads as undefined, which the same guard rejects — the decoder
    // must not key the bag on the string "undefined".
    const { raw, vars } = blobParts('busArray.mat');
    const { blocks } = meta(raw);
    const patched = patchWord(raw, META + blocks[1].at + 4, 99999);
    const props = decodeMcosBlob(patched, vars).get('buses')!.properties;
    expect(Object.keys(props)).not.toContain('undefined');
    expect(Object.keys(props)).toEqual(ALL_PROPS.filter((p) => p !== 'PreserveElementDimensions'));
  });

  it('drops a property carrying a flag the format does not define', () => {
    // Flags 0/1/2 select string-table index / heap-cell index / inline boolean.
    // Any other flag means we do not know how to read the value word, and a guess
    // would surface a wrong value indistinguishable from a real one — so the
    // property is dropped and the rest of the block still decodes.
    const { raw, vars } = blobParts('busArray.mat');
    const { blocks } = meta(raw);
    for (const flag of [3, 7, 0xffffffff]) {
      const patched = patchWord(raw, META + blocks[1].at + 8, flag);
      const decoded = decodeMcosBlob(patched, vars).get('buses')!;
      expect(Object.keys(decoded.properties)).toEqual(ALL_PROPS.filter((p) => p !== 'PreserveElementDimensions'));
      // The object array is otherwise intact — one bad flag costs one property.
      expect(decoded.elements).toHaveLength(3);
    }
  });

  it('stops reading blocks when a declared property count cannot be right', () => {
    // The count is the loop bound AND the stride: a wildly large or
    // segment-overrunning value means we lost alignment, and continuing would
    // read triples out of whatever bytes follow — fabricating properties. Stopping
    // costs the blocks after the damage (so only the class defaults remain for
    // those objects), which is the honest answer.
    const { raw, vars } = blobParts('busArray.mat');
    const { header, blocks } = meta(raw);
    for (const [byteOffset, count] of [
      [META + header[5], 99999], // over the 1000-property sanity cap
      [META + blocks[1].at, 999], // under the cap, but overruns the segment
    ] as const) {
      const decoded = decodeMcosBlob(patchWord(raw, byteOffset, count), vars).get('buses')!;
      // Alignment survives: it comes from the per-class DEFAULTS, which are a
      // separate heap cell and unaffected by block damage.
      expect(Object.keys(decoded.properties)).toEqual(['Alignment']);
      expect(decoded.elements).toHaveLength(3);
    }
  });
});
