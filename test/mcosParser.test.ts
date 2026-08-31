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

  it('surfaces a MATLAB string-typed property value as the honest sentinel', () => {
    // The value cannot be recovered, but the property NAME is still present.
    expect('Name' in v!.properties).toBe(true);
    expect(v!.properties.Name).toBe(NOT_AVAILABLE);
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
