// Copyright 2026 The MathWorks, Inc.
//
// The save path for the two config-set node classes. Both hold a scalar string
// property alongside the entry name — ConfigSet its own Name, ConfigSetRef the
// SourceName of the file it points at — and both re-emit it through
// _getSerializedProperties / serializeValue.
//
// The distinction these tests exist to pin: a ConfigSet's Name IS the entry
// name (renaming the entry must move both, or the reopened file shows the old
// name), whereas a ConfigSetRef's SourceName is an INDEPENDENT value naming an
// external file, and a rename must leave it alone.
//
// Presentation (icons, active state, empty Value) is covered in
// configSetUnified.test.ts.
import { describe, it, expect } from 'vitest';
import ConfigSetNode from '../src/datamodel/node/data/ConfigSetNode.js';
import ConfigSetRefNode from '../src/datamodel/node/data/ConfigSetRefNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const savedProps = (node: { serializeValue(): unknown }): Record<string, unknown> => {
  const sv = node.serializeValue() as { _elements: { _properties: Record<string, unknown> }[] };
  return sv._elements[0]._properties;
};

describe('ConfigSetNode save path', () => {
  it('round-trips the Name it was parsed with', () => {
    const raw = {
      _array_class: 'Simulink.ConfigSet',
      _dimensions: [1, 1],
      _elements: [{ _properties: { Name: 'Config1', StopTime: '10' } }],
    };
    const n = ConfigSetNode.parse(raw, 'Config1', null);
    expect(n.ConfigName).toBe('Config1');
    // Every other property in the bag survives untouched — the node only owns Name.
    expect(savedProps(n)).toEqual({ Name: 'Config1', StopTime: '10' });
  });

  it('carries a rename into the saved Name property', () => {
    // In a .sldd the entry name and the ConfigSet's Name property are the same
    // string. ConfigName used to be an independently stored field, so a rename
    // updated the tree but serialized the STALE name — the entry silently
    // reverted the next time the file was opened.
    const n = ConfigSetNode.createDefault('Configuration', null);
    expect(n.setProperty('Name', 'Renamed')).toBe(true);
    expect(n.name).toBe('Renamed');
    expect(n.ConfigName).toBe('Renamed');
    expect(savedProps(n).Name).toBe('Renamed');
  });

  it('writes the renamed value into the XML entry and its Name property alike', () => {
    const n = ConfigSetNode.createDefault('Configuration', null);
    n.setProperty('Name', 'Fast');
    const xml = n.serializeXml('entry', { Name: n.name }, 0);
    expect(xml).toContain('<entry Name="Fast">');
    expect(xml).toContain('<P Name="Name" Class="char">Fast</P>');
    expect(xml).not.toContain('Configuration');
  });

  it('rejects an invalid rename and leaves the saved Name untouched', () => {
    // Name validation is DataNode's; what matters here is that a refused edit
    // does not half-apply, leaving the entry and the property disagreeing.
    const n = ConfigSetNode.createDefault('Configuration', null);
    const result = n.setProperty('Name', '1bad');
    expect((result as { error?: boolean }).error).toBe(true);
    expect(n.ConfigName).toBe('Configuration');
    expect(savedProps(n).Name).toBe('Configuration');
  });

  it('reports the class name and the default entry name', () => {
    expect(ConfigSetNode.createDefault('c', null).className).toBe('Simulink.ConfigSet');
    expect(ConfigSetNode.defaultName).toBe('Configuration');
  });

  it('falls back to the entry name when the raw bag has no Name at all', () => {
    const raw = { _array_class: 'Simulink.ConfigSet', _dimensions: [1, 1], _elements: [{ _properties: {} }] };
    const n = ConfigSetNode.parse(raw, 'FromEntry', null);
    expect(n.ConfigName).toBe('FromEntry');
    expect(savedProps(n).Name).toBe('FromEntry');
  });
});

describe('ConfigSetRefNode save path', () => {
  it('round-trips the SourceName it was parsed with', () => {
    const raw = {
      _array_class: 'Simulink.ConfigSetRef',
      _dimensions: [1, 1],
      _elements: [{ _properties: { SourceName: 'sharedConfig', UseLocalSolver: false } }],
    };
    const n = ConfigSetRefNode.parse(raw, 'Ref', null);
    expect(n.SourceName).toBe('sharedConfig');
    // `Name` arrives alongside even though the parsed bag had none, for the reason
    // ConfigSetRefNode.ConfigName records: MATLAB treats the entry name and the value's
    // `Name` as one string and silently renames the ENTRY when they disagree, so a bag with
    // no Name is a bag whose entry MATLAB is about to rename.
    expect(savedProps(n)).toEqual({ SourceName: 'sharedConfig', Name: 'Ref', UseLocalSolver: false });
  });

  it('leaves SourceName alone when the entry is renamed', () => {
    // Unlike ConfigSet.Name, SourceName identifies an EXTERNAL config set — it is
    // not the entry's own name, so a rename must not touch it.
    const raw = {
      _array_class: 'Simulink.ConfigSetRef',
      _dimensions: [1, 1],
      _elements: [{ _properties: { SourceName: 'sharedConfig' } }],
    };
    const n = ConfigSetRefNode.parse(raw, 'Ref', null);
    expect(n.setProperty('Name', 'RenamedRef')).toBe(true);
    expect(n.name).toBe('RenamedRef');
    expect(n.SourceName).toBe('sharedConfig');
    expect(savedProps(n).SourceName).toBe('sharedConfig');
  });

  it('defaults SourceName to empty, not undefined', () => {
    // An empty string serializes as <P Class="char"/>, which MATLAB reads as '';
    // undefined would emit the text 'undefined'.
    const n = ConfigSetRefNode.createDefault('r', null);
    expect(n.SourceName).toBe('');
    expect(savedProps(n).SourceName).toBe('');
  });

  it('reports the class name and the default entry name', () => {
    expect(ConfigSetRefNode.createDefault('r', null).className).toBe('Simulink.ConfigSetRef');
    // MATLAB's own name for a default-constructed Simulink.ConfigSetRef, and the name it
    // renames any other to. Read from `<P Name="Name" Class="char">Reference</P>` in a
    // dictionary MATLAB wrote, not from the class name.
    expect(ConfigSetRefNode.defaultName).toBe('Reference');
  });

  it('writes SourceName into the XML entry, and a rename into BOTH the entry name and Name', () => {
    // The XML save path (binary .sldd) goes through _getSerializedProperties
    // rather than serializeValue, so it is a second, independent copy of the
    // "which property owns the name" decision — and the one a compressed
    // dictionary is written with.
    //
    // This used to assert the OPPOSITE of its ConfigSet counterpart — that the entry name must
    // not reach any property — and MATLAB refuted it: given an entry we had named
    // `ConfigSetRef` with no `Name` written, MATLAB handed the dictionary back with the entry
    // renamed to `Reference`. The two names are one name for this class as much as for
    // ConfigSet, so the rename has to reach both. SourceName is the property that still must
    // NOT move: it names an EXTERNAL config set (the test above pins that).
    const raw = {
      _array_class: 'Simulink.ConfigSetRef',
      _dimensions: [1, 1],
      _elements: [{ _properties: { SourceName: 'sharedConfig', UseLocalSolver: false } }],
    };
    const n = ConfigSetRefNode.parse(raw, 'Ref', null);
    n.setProperty('Name', 'RenamedRef');
    const xml = n.serializeXml('entry', { Name: n.name }, 0);
    expect(xml).toContain('<entry Name="RenamedRef">');
    expect(xml).toContain('<Element Class="Simulink.ConfigSetRef">');
    expect(xml).toContain('<P Name="SourceName" Class="char">sharedConfig</P>');
    // Other properties in the bag are re-emitted untouched alongside it.
    expect(xml).toContain('<P Name="UseLocalSolver" Class="logical">0</P>');
    expect(xml).toContain('<P Name="Name" Class="char">RenamedRef</P>');
  });

  it('serializes an empty SourceName as an empty char property', () => {
    // <P Class="char"/> is what MATLAB reads back as ''. The alternative — omitting
    // the property, or emitting the text 'undefined' — is not loadable.
    const xml = ConfigSetRefNode.createDefault('r', null).serializeXml('entry', { Name: 'r' }, 0);
    expect(xml).toContain('<P Name="SourceName" Class="char"/>');
  });
});
