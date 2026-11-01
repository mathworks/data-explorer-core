// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ValueTypeNode from '../../src/datamodel/node/data/ValueTypeNode.js';
import AliasTypeNode from '../../src/datamodel/node/data/AliasTypeNode.js';
import NumericTypeNode from '../../src/datamodel/node/data/NumericTypeNode.js';
import { EnumTypeNode } from '../../src/datamodel/node/data/EnumTypeNode.js';
import { BusNode } from '../../src/datamodel/node/data/BusNode.js';
import { ConnectionBusNode } from '../../src/datamodel/node/data/ConnectionBusNode.js';
import { ServiceBusNode } from '../../src/datamodel/node/data/ServiceBusNode.js';
import DataModel from '../../src/core/DataModel.js';
import '../../src/datamodel/node/data/NodeClassMap.js';

// Every schema-driven class opens with a common, fixed-name "General" identity
// group [Name, (Value,) (DataType/BaseType,) Kind, Class] — a deliberate
// divergence from the MATLAB entry-adapter '<Class>: <name>' dynamic title, so a
// file-viewer user always sees the object's Kind and Class explicitly. Value
// semantics (Dimensions/Complexity/fixed-point/enumValue) live in "Value
// Properties"; code-gen attributes in "Code Generation"/"Custom Attributes".
// This pins the group structure per migrated class.

function groups(node: any): string[] {
  const pi = node.toPIObject();
  return (pi.propertySheet.groups as any[]).map((g) => g.displayName);
}
function itemsIn(node: any, groupTitle: string): string[] {
  const pi = node.toPIObject();
  const g = (pi.propertySheet.groups as any[]).find((x) => x.displayName === groupTitle)!;
  return g.items.map((it: any) => it.name);
}

describe('PI layout — common "General" identity group', () => {
  it('ValueType: General [Name, DataType, Kind, Class] + Value Properties', () => {
    const n = ValueTypeNode.createDefault('vt', null);
    expect(groups(n)).toEqual(['General', 'Value Properties']);
    expect(itemsIn(n, 'General')).toEqual(['Name', 'DataType', 'Kind', 'Class']);
    expect(itemsIn(n, 'Value Properties')).toEqual([
      'dimensions', 'complexity', 'Min', 'Max', 'Unit', 'dimensionsMode', 'Description',
    ]);
  });

  it('AliasType: General uses BaseType (no DataType) + Value + Code Generation', () => {
    const n = AliasTypeNode.createDefault('at', null);
    expect(groups(n)).toEqual(['General', 'Value Properties', 'Code Generation']);
    expect(itemsIn(n, 'General')).toEqual(['Name', 'BaseType', 'Kind', 'Class']);
    expect(itemsIn(n, 'Code Generation')).toEqual(['dataScope', 'headerFile']);
  });

  it('NumericType: General is identity-only; fixed-point items in Value Properties', () => {
    const n = NumericTypeNode.createDefault('nt', null);
    // slice(0, 3): an "Other" group also appears, for the same reason the EnumType case below
    // gets one. `createDefault` now seeds MATLAB's measured default bag, and three of its keys
    // are the STORAGE-side fixed-point spellings MATLAB saves — SignednessBool, FixedExponent,
    // SlopeAdjustmentFactor — while the descriptors name the DERIVED accessors MATLAB never
    // writes (Signed, FractionLength, Slope). So the catch-all picks all three up. This assertion
    // used to be an exact `toEqual` only because the seeded bag was EMPTY; it was pinning that
    // emptiness, not the layout, and every NumericType read from a real file already behaved
    // this way. What is actually being pinned here is the three GROUPS the schema declares.
    expect(groups(n).slice(0, 3)).toEqual(['General', 'Value Properties', 'Code Generation']);
    expect(itemsIn(n, 'General')).toEqual(['Name', 'Kind', 'Class']);
    expect(itemsIn(n, 'Value Properties')).toEqual([
      'dataTypeMode', 'signedness', 'wordLength', 'fractionLength', 'slope', 'bias', 'dataTypeOverride', 'isAlias', 'Description',
    ]);
  });

  it('EnumType: General is identity-only; enumValue in Value Properties', () => {
    const n = EnumTypeNode.createDefault('et', null);
    // The enum carries an unmodeled Enumerals bag → an "Other" group also appears.
    expect(groups(n).slice(0, 3)).toEqual(['General', 'Value Properties', 'Code Generation']);
    expect(itemsIn(n, 'General')).toEqual(['Name', 'Kind', 'Class']);
    expect(itemsIn(n, 'Value Properties')).toEqual(['Value', 'storageType', 'Description']);
  });

  it('Simulink.Bus: General identity-only + top-level-sourced Code Generation', () => {
    const n = BusNode.createDefault('b', null);
    expect(groups(n).slice(0, 3)).toEqual(['General', 'Value Properties', 'Code Generation']);
    expect(itemsIn(n, 'General')).toEqual(['Name', 'Kind', 'Class']);
    expect(itemsIn(n, 'Code Generation')).toEqual([
      'dataScope', 'headerFile', 'alignment', 'preserveElementDimensions',
    ]);
  });

  it('ConnectionBus / ServiceBus: General + Value Properties (no code-gen attrs)', () => {
    expect(groups(ConnectionBusNode.createDefault('cb', null)).slice(0, 2)).toEqual(['General', 'Value Properties']);
    expect(groups(ServiceBusNode.createDefault('sb', null)).slice(0, 2)).toEqual(['General', 'Value Properties']);
    expect(itemsIn(ConnectionBusNode.createDefault('cb', null), 'General')).toEqual(['Name', 'Kind', 'Class']);
  });
});

// A Bus MATLAB wrote, as the property inspector is handed it: arch.sldd's DataInterface.
function archBus(): any {
  const uri = 'pilayout://arch.sldd';
  DataModel.removeDataSource(uri);
  const text = readFileSync(fileURLToPath(new URL('../fixtures/arch.sldd', import.meta.url)), 'utf8');
  const root: any = DataModel.addDataSource(uri, JSON.parse(text), { path: 'arch.sldd' });
  const bus = (root.flatten() as any[]).find((n) => n.name === 'DataInterface' && n.className === 'Simulink.Bus');
  if (!bus) throw new Error('no DataInterface bus in arch.sldd');
  return bus;
}

describe('PI layout — a Bus read from a dictionary', () => {
  it('keeps the schema group order and titles each group by its display name', () => {
    // A group's name is an internal id ('GeneralGroup'); its displayName is the title a host shows.
    const pi = archBus().toPIObject();
    expect((pi.propertySheet.groups as any[]).map((g) => [g.name, g.displayName])).toEqual([
      ['GeneralGroup', 'General'],
      ['ValuePropertiesGroup', 'Value Properties'],
      ['CodeGenerationGroup', 'Code Generation'],
      ['OtherGroup', 'Other'],
    ]);
  });

  it('shows each property under its human display name, not its schema key', () => {
    // The items are schema keys ('dataScope'); each property's displayName is MATLAB's name for it.
    const pi = archBus().toPIObject();
    const codeGen = (pi.propertySheet.groups as any[]).find((g) => g.displayName === 'Code Generation')!;
    const label = (key: string) => (pi.propertySheet.properties as any[]).find((p) => p.name === key)!.displayName;
    expect(codeGen.items.map((it: any) => [it.name, label(it.name)])).toEqual([
      ['dataScope', 'Data Scope'],
      ['headerFile', 'Header File'],
      ['alignment', 'Alignment'],
      ['preserveElementDimensions', 'Preserve Element Dimensions'],
    ]);
  });
});
