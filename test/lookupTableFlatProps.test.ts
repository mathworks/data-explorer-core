// Copyright 2026 The MathWorks, Inc.
//
// THE SIX FLAT PROPERTIES OF A LOOKUP TABLE, AND WHY REACHABILITY IS THE ASSERTION.
//
// `Simulink.LookupTable` and `Simulink.Breakpoint` carried almost no schema: a LookupTable
// declared only `breakpointsSpecification`, a Breakpoint nothing at all. Everything MATLAB
// models about their code generation — the storage class, the generated struct type, and the
// two tunable-size switches — reached the Property Inspector only as flattened "Other" rows
// (`CoderInfo.StorageClass`, `StructTypeInfo.DataScope`, …), i.e. as raw serialized paths in
// a collapsed catch-all group rather than as named, grouped properties.
//
// So what is asserted here is DISPLAY, not schema shape. A `props` entry that resolves but
// renders blank is the exact defect this work removes, and asserting the JSON's own contents
// would not catch it: the value has to travel `serial._properties` → `resolveSourcePath` →
// `hydrate` → `toPIObject`, and two of the six travel through a nested MATLAB sub-object on
// the way (`CoderInfo`, `StructTypeInfo`). Only rendering the sheet exercises that.
//
// The bags below are the shape MATLAB R2027a actually wrote for a fully-configured
// LookupTable — a nested `Simulink.lookuptable.StructTypeInfo` with its own `_properties`,
// booleans stored as real `true`, and `CoderInfo` carrying a `CustomAttributes` object it
// never uses here. They are written inline rather than added under
// `test/parity/artifacts/`, which is MATLAB-generated and checked by `drift.mjs`; a
// hand-written file there would break that contract.
//
// EXCLUDED, deliberately: the `Table.*` and `Breakpoints.*` sub-object groups. `Breakpoints`
// is a 1xN array for a multi-dimensional table and MATLAB builds one group per breakpoint
// dynamically — that is the lookup-table specification editor, a whole Simulink dialog. The
// six flat properties do not touch it, which is why the bags below carry `Table` and
// `Breakpoints` without any expectation about them.
import { describe, it, expect } from 'vitest';
import LookupTableNode from '../src/datamodel/node/data/LookupTableNode.js';
import BreakpointNode from '../src/datamodel/node/data/BreakpointNode.js';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import { getLayout, resolveSourcePath } from '../src/datamodel/schema/index.js';
import type DataNode from '../src/datamodel/node/DataNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

// The 1x1 MATLABArray envelope MATLAB writes around every scalar object, built the way
// test/absentPropertyWriteBack.test.ts builds it.
function rawVal(className: string, properties: Record<string, unknown>): Record<string, unknown> {
  return {
    _array_class: className,
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: properties }],
  };
}

// The rendered Property Inspector, reduced to the three things asserted below: the group
// titles in order, the item keys per group, and the displayed value per key. Reading through
// toPIObject (rather than buildPILayout) is the point — `objects[0]` holds the string a user
// would actually see.
const sheet = (node: DataNode) => node.toPIObject()!;
const groupTitles = (node: DataNode) => (sheet(node).propertySheet.groups as any[]).map((g) => g.displayName);
function itemsIn(node: DataNode, groupTitle: string): string[] {
  const g = (sheet(node).propertySheet.groups as any[]).find((x) => x.displayName === groupTitle);
  expect(g, `no "${groupTitle}" group`).toBeDefined();
  return g.items.map((it: any) => it.name);
}
const shown = (node: DataNode) => (sheet(node).objects as any[])[0] as Record<string, unknown>;

// A nested MCOS sub-object: a class name plus its own `_properties` bag. Both nested paths
// under test (`CoderInfo.StorageClass`, `StructTypeInfo.*`) reach their value through one of
// these, so the helper names the shape rather than repeating it.
const mcos = (className: string, properties: Record<string, unknown>) => ({
  _object_class: className,
  _properties: properties,
});

// Exactly what MATLAB R2027a serialized for a LookupTable with every one of the six set to a
// non-default value. `Table`/`Breakpoints` are kept so the bag is the real one — nothing here
// models them.
const LUT_CONFIGURED = () => ({
  AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes: true,
  Breakpoints: mcos('Simulink.lookuptable.Breakpoint', {
    DataType: 'auto', Description: '', Dimensions: [0, 0],
    FieldName: 'BP1', TunableSizeName: 'N1', TunableSizeValue: -1, Unit: '',
  }),
  CoderInfo: mcos('Simulink.CoderInfo', {
    CSCPackageName: 'Simulink',
    CustomAttributes: mcos('SimulinkCSC.AttribClass_Simulink_Default', {}),
    CustomStorageClass: 'Default',
    ParameterOrSignal: 'Parameter',
    StorageClass: 'ExportedGlobal',
  }),
  StructTypeInfo: mcos('Simulink.lookuptable.StructTypeInfo', {
    DataScope: 'Exported', HeaderFileName: 'mylut.h', Name: 'MyLutType',
  }),
  SupportTunableSize: true,
  Table: mcos('Simulink.lookuptable.Table', {
    DataType: 'auto', Description: '', Dimensions: [0, 0], FieldName: 'Table', Unit: '',
  }),
});

// The same shape for a Breakpoint, minus the two properties a Breakpoint does not have:
// `AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes` (a LookupTable governs
// whether its instances may differ in size; a lone breakpoint set has no table to differ
// from) and `BreakpointsSpecification`.
const BP_CONFIGURED = () => ({
  Breakpoints: mcos('Simulink.lookuptable.Breakpoint', {
    DataType: 'auto', Description: '', Dimensions: [0, 0],
    FieldName: 'BP1', TunableSizeName: 'N1', TunableSizeValue: -1, Unit: '',
  }),
  CoderInfo: mcos('Simulink.CoderInfo', {
    CSCPackageName: 'Simulink',
    CustomAttributes: mcos('SimulinkCSC.AttribClass_Simulink_Default', {}),
    CustomStorageClass: 'Default',
    ParameterOrSignal: 'Parameter',
    StorageClass: 'ImportedExtern',
  }),
  StructTypeInfo: mcos('Simulink.lookuptable.StructTypeInfo', {
    DataScope: 'Imported', HeaderFileName: 'mybp.h', Name: 'MyBpType',
  }),
  SupportTunableSize: true,
});

const lut = (properties: Record<string, unknown>) =>
  LookupTableNode.parse(rawVal('Simulink.LookupTable', properties), 'MyLut', null);
const bp = (properties: Record<string, unknown>) =>
  BreakpointNode.parse(rawVal('Simulink.Breakpoint', properties), 'MyBp', null);

// The 17 values MATLAB accepts on a LookupTable's (and a Breakpoint's)
// CoderInfo.StorageClass, measured on R2027a. Held here as the test's own literal rather
// than read back out of the schema, so the schema cannot both define and verify the list.
const LUT_STORAGE_CLASSES = [
  'Auto', 'Model default', 'ExportedGlobal', 'ImportedExtern', 'ImportedExternPointer',
  'BitField', 'Const', 'Volatile', 'ConstVolatile', 'Define', 'ImportedDefine',
  'ExportToFile', 'ImportFromFile', 'FileScope', 'Struct', 'GetSet', 'CompilerFlag',
];

describe('a configured LookupTable displays all six flat properties', () => {
  it('renders every value the file carries, including the two nested paths', () => {
    const v = shown(lut(LUT_CONFIGURED()));
    // Nested: one hop through CoderInfo._properties.
    expect(v.storageClass).toBe('ExportedGlobal');
    // Nested: one hop through StructTypeInfo._properties. Three keys, one of which
    // (HeaderFileName) is spelled differently from its schema key, so this also pins that
    // the sourcePath — not the key — is what addresses the file.
    expect(v.structTypeName).toBe('MyLutType');
    expect(v.structTypeDataScope).toBe('Exported');
    expect(v.structTypeHeaderFile).toBe('mylut.h');
    // Flat, and stored as MATLAB booleans rather than strings — so this pins that a real
    // `true` survives formatting instead of rendering as '[object]' or ''.
    expect(v.supportTunableSize).toBe('true');
    expect(v.allowDifferentTableBpSizes).toBe('true');
  });

  it('stops re-listing the same values as raw "Other" rows', () => {
    // Before these props existed, a LookupTable's whole code-gen surface reached the sheet
    // only here, flattened one level as `Other.CoderInfo.StorageClass` /
    // `Other.StructTypeInfo.DataScope`. Each prop names the top-level bag it consumes
    // (`sourceKeys`), so surfacing it must also suppress the raw row — otherwise the same
    // value appears twice under two different names.
    const keys = Object.keys(shown(lut(LUT_CONFIGURED())));
    expect(keys.filter((k) => k.startsWith('Other.CoderInfo'))).toEqual([]);
    expect(keys.filter((k) => k.startsWith('Other.StructTypeInfo'))).toEqual([]);
    expect(keys).not.toContain('Other.SupportTunableSize');
    expect(keys).not.toContain('Other.AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes');
    // Table/Breakpoints are deliberately unmodeled, so they MUST still reach "Other" —
    // that is how an unmodeled property stays visible instead of being silently dropped.
    expect(keys.some((k) => k.startsWith('Other.Table'))).toBe(true);
    expect(keys.some((k) => k.startsWith('Other.Breakpoints'))).toBe(true);
  });
});

describe('a configured Breakpoint displays the same set minus the LookupTable-only key', () => {
  it('renders the five properties a Breakpoint has', () => {
    const v = shown(bp(BP_CONFIGURED()));
    expect(v.storageClass).toBe('ImportedExtern');
    expect(v.structTypeName).toBe('MyBpType');
    expect(v.structTypeDataScope).toBe('Imported');
    expect(v.structTypeHeaderFile).toBe('mybp.h');
    expect(v.supportTunableSize).toBe('true');
  });

  it('models neither the LookupTable-only switch nor a breakpoints specification', () => {
    // Not "does not display" but "does not claim": a Breakpoint has no table for instances
    // to differ over, and no BreakpointsSpecification of its own. Asserting the absence
    // from the LAYOUT is what stops a copy-paste of the LookupTable file from quietly
    // giving a Breakpoint two permanently blank rows.
    const keys = getLayout('Simulink.Breakpoint')!.flatMap((g) => g.items);
    expect(keys).not.toContain('allowDifferentTableBpSizes');
    expect(keys).not.toContain('breakpointsSpecification');
  });
});

// MATLAB's own group titles, read from the sandbox adapter that builds this sheet:
// `+entry_adapter/+lut/{LutBase,Lut,Bp}.m` place StorageClass and the three StructTypeInfo
// items in ONE group (`CodeGenerationGroup` → "Code Generation"; `Lut.insertCodeGenGroup`
// concatenates `getCodeGenDataDefinitionsPropAndItems` with
// `getCodeGenStructTypeDefinitionsPropAndItems`), and the tunable-size switches in a separate
// `AdvancedGroup` → "Advanced", allow-different-sizes first. Both resolved from
// `resources/data_explorer/en/propertyinspector.xml`. Asserted exactly, and in order,
// because a layout key that resolves to nothing is dropped silently — the only symptom is a
// row missing from the sheet.
describe('PI layout — groups and ordered keys, matching MATLAB', () => {
  it('LookupTable: General, Value Properties, Code Generation, Advanced', () => {
    const n = lut(LUT_CONFIGURED());
    expect(groupTitles(n)).toEqual(['General', 'Value Properties', 'Code Generation', 'Advanced', 'Other']);
    expect(itemsIn(n, 'General')).toEqual(['Name', 'Value', 'DataType', 'Kind', 'Class', 'Description']);
    expect(itemsIn(n, 'Value Properties')).toEqual(['breakpointsSpecification']);
    expect(itemsIn(n, 'Code Generation')).toEqual([
      'storageClass', 'structTypeName', 'structTypeDataScope', 'structTypeHeaderFile',
    ]);
    expect(itemsIn(n, 'Advanced')).toEqual(['allowDifferentTableBpSizes', 'supportTunableSize']);
  });

  it('Breakpoint: General, Code Generation, Advanced (no Value Properties)', () => {
    const n = bp(BP_CONFIGURED());
    expect(groupTitles(n)).toEqual(['General', 'Code Generation', 'Advanced', 'Other']);
    expect(itemsIn(n, 'General')).toEqual(['Name', 'Value', 'DataType', 'Kind', 'Class', 'Description']);
    expect(itemsIn(n, 'Code Generation')).toEqual([
      'storageClass', 'structTypeName', 'structTypeDataScope', 'structTypeHeaderFile',
    ]);
    expect(itemsIn(n, 'Advanced')).toEqual(['supportTunableSize']);
  });
});

// THE MOST IMPORTANT BLOCK IN THIS FILE.
//
// `storageClass` is one shared descriptor used by Simulink.Parameter, Simulink.Signal AND
// these two classes, and the value sets are NOT nested: a LookupTable accepts 12 values the
// shared descriptor never listed, and REFUSES two that it does (`SimulinkGlobal`, `Custom`).
// So the class files override `options` through a `$ref` rather than widening the shared
// list — widening would offer `Custom` on a LookupTable, narrowing would break Parameter.
//
// `trySetSchemaProperty` validates a 'select' write against `prop.options`, so this list is
// an ENFORCEMENT point, not a dropdown decoration. The Parameter assertions below are what
// prove the override is per-class: if someone "fixes" this by editing the shared descriptor
// in props/codeGen.json, the LookupTable assertions still pass and these fail.
describe('the storageClass option list is enforced per class, not shared', () => {
  it('accepts all 17 values MATLAB accepts on a LookupTable', () => {
    for (const value of LUT_STORAGE_CLASSES) {
      const node = lut(LUT_CONFIGURED());
      expect(node.setProperty('storageClass', value), value).toBe(true);
      expect(resolveSourcePath(node.serial._properties, 'CoderInfo.StorageClass'), value).toBe(value);
    }
  });

  it('refuses the two the shared descriptor offers but a LookupTable does not accept', () => {
    for (const value of ['SimulinkGlobal', 'Custom']) {
      const node = lut(LUT_CONFIGURED());
      const before = JSON.stringify(node.serial._properties);
      const r = node.setProperty('storageClass', value);
      expect(r, value).not.toBe(true);
      expect((r as any).error, value).toBe(true);
      // A refusal must not half-apply: the bag is byte-identical afterwards.
      expect(JSON.stringify(node.serial._properties), value).toBe(before);
    }
  });

  it('enforces the same 17 on a Breakpoint', () => {
    // `LutBase.getCodeGenDataDefinitionsPropAndItems` is defined ONCE and read by both
    // Lut.m and Bp.m, taking its allowed values from the same `dataCache('StorageClass')`
    // with no class-conditional narrowing — so the two classes share one list.
    const ok = bp(BP_CONFIGURED());
    expect(ok.setProperty('storageClass', 'FileScope')).toBe(true);
    expect(resolveSourcePath(ok.serial._properties, 'CoderInfo.StorageClass')).toBe('FileScope');
    expect((bp(BP_CONFIGURED()).setProperty('storageClass', 'Custom') as any).error).toBe(true);
  });

  it('leaves Simulink.Parameter with its own list — Custom still accepted', () => {
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('storageClass', 'Custom')).toBe(true);
    expect(resolveSourcePath(p.serial._properties, 'CoderInfo.StorageClass')).toBe('Custom');
  });

  it('and does not leak the LookupTable values onto a Parameter', () => {
    // The other direction of the same claim: the override replaced the list for one class
    // only. `CompilerFlag` is legal on a LookupTable and must stay illegal on a Parameter.
    const r = ParameterNode.createDefault('p', null).setProperty('storageClass', 'CompilerFlag');
    expect(r).not.toBe(true);
    expect((r as any).error).toBe(true);
  });

  it('refuses the write when the file carries no CoderInfo, rather than synthesizing one', () => {
    // `writeSourcePath` never invents a missing sub-object, so a bag with no CoderInfo gets
    // a refusal even for a value in the list. Worth pinning because a NEWLY CREATED
    // LookupTable is exactly that bag: unlike ParameterNode.createDefault, which seeds a
    // CoderInfo, LookupTableNode.createDefault starts empty. The value is displayable
    // (default 'Auto') and not yet writable, and the refusal says which.
    const node = lut({});
    const r = node.setProperty('storageClass', 'ExportedGlobal');
    expect(r).not.toBe(true);
    expect((r as any).error).toBe(true);
    expect(node.serial._properties).not.toHaveProperty('CoderInfo');
  });
});

describe('a LookupTable that omits these properties', () => {
  it('renders each descriptor default, not another class\'s value or a stray object', () => {
    // The JSON `.sldd` format omits a property sitting at its default, so "absent" is the
    // COMMON case, not an edge one. Each of these is the value MATLAB reports for an
    // unconfigured object; an empty string is the honest answer where MATLAB's own default
    // is empty, and what must never appear is a value belonging to some other class (the
    // shared storageClass descriptor's 'Auto' is correct here, and shared by coincidence).
    const v = shown(lut({}));
    expect(v.storageClass).toBe('Auto');
    expect(v.structTypeName).toBe('');
    expect(v.structTypeDataScope).toBe('Auto');
    expect(v.structTypeHeaderFile).toBe('');
    expect(v.supportTunableSize).toBe('');
    expect(v.allowDifferentTableBpSizes).toBe('');
    expect(v.breakpointsSpecification).toBe('Explicit values');
  });

  it('renders a present-but-incomplete sub-object without inventing a sibling value', () => {
    // A StructTypeInfo that carries only Name: the other two must fall back to their own
    // defaults rather than to whatever the traversal last touched.
    const v = shown(lut({ StructTypeInfo: mcos('Simulink.lookuptable.StructTypeInfo', { Name: 'OnlyName' }) }));
    expect(v.structTypeName).toBe('OnlyName');
    expect(v.structTypeDataScope).toBe('Auto');
    expect(v.structTypeHeaderFile).toBe('');
  });

  it('keeps exactly the keys it arrived with on save — displaying a default writes nothing', () => {
    // A default read for DISPLAY must not become a key on disk. Both save paths are checked
    // because they are independent copies of the decision (see absentPropertyWriteBack for
    // the full account); rendering the sheet first is the part that matters — it is the read
    // that could plausibly have written back.
    for (const bag of [{}, LUT_CONFIGURED()]) {
      const node = lut(bag);
      const arrived = Object.keys(bag);
      shown(node);
      expect(Object.keys(node._getSerializedProperties())).toEqual(arrived);
      const text = (node.serializeValue() as any)._elements[0]._properties;
      expect(Object.keys(JSON.parse(JSON.stringify({ p: text })).p)).toEqual(arrived);
    }
  });
});
