// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import '../src/datamodel/node/NodeClassMap.js';
import ModelSectionNode from '../src/datamodel/node/container/ModelSectionNode.js';
import ConfigSetNode from '../src/datamodel/node/data/ConfigSetNode.js';
import ConfigSetRefNode from '../src/datamodel/node/data/ConfigSetRefNode.js';
import { configSetIdentity } from '../src/datamodel/parser/SlxParser.js';

// The SLX Configurations section and the SLDD path must produce the SAME node
// class for a config set — ConfigSetNode / ConfigSetRefNode — so presentation
// is identical: empty, non-editable Value and Data Type. The SLX-only "active"
// state rides on the shared node and shows up in the icon, not a Value suffix.
// (Previously the SLX path used a separate ModelConfigSetNode that diverged.)
function configSection(): ModelSectionNode {
  return new ModelSectionNode('config', null, 'Configurations', 'databaseFolderConfiguration');
}

/** A `ParsedConfigSet` as the parser hands one over, with the fields a test cares about. */
function parsed(over: Partial<Parameters<ModelSectionNode['addConfigSetEntry']>[0]>) {
  return { name: 'C', active: false, data: null, objectClass: 'Simulink.ConfigSet', sourceName: '', ...over };
}

describe('SLX config section uses the shared SLDD ConfigSet node classes', () => {
  it('builds a ConfigSetNode with empty, non-editable Value and empty Data Type', () => {
    const section = configSection();
    const node = section.addConfigSetEntry(parsed({ name: 'Configuration', active: true }));
    expect(node).toBeInstanceOf(ConfigSetNode);

    const row = node.toRow() as any;
    expect(row.Name?.label ?? row.Name).toBe('Configuration');
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
    expect(row.DataType).toBe('');
  });

  // `objectClass`, not `data._object_class`: the class is a JSON field in one layout and
  // an XML attribute in four, so the parser normalizes it and this layer only routes on
  // the answer. See the configSetIdentity block below.
  it('routes objectClass Simulink.ConfigSetRef to ConfigSetRefNode', () => {
    const section = configSection();
    const node = section.addConfigSetEntry(
      parsed({ name: 'RefConfig', objectClass: 'Simulink.ConfigSetRef', sourceName: 'dictCfg' }),
    );
    expect(node).toBeInstanceOf(ConfigSetRefNode);

    const row = node.toRow() as any;
    expect(row.Value).toBe('');
    expect(row.DataType).toBe('');
  });

  // A reference's entire content is the name of the set it points at, so losing
  // `sourceName` on the way in leaves a row that says nothing.
  it('passes a reference its source, and gives a plain set none', () => {
    const section = configSection();
    const ref = section.addConfigSetEntry(
      parsed({ name: 'R', objectClass: 'Simulink.ConfigSetRef', sourceName: 'dictCfg' }),
    ) as any;
    const set = section.addConfigSetEntry(parsed({ name: 'S', sourceName: 'ignored' })) as any;
    expect(ref.SourceName).toBe('dictCfg');
    expect(set.SourceName).toBeUndefined();
  });

  it('reflects active state in the icon, not the Value', () => {
    const section = configSection();
    const active = section.addConfigSetEntry(parsed({ name: 'A', active: true }));
    const inactive = section.addConfigSetEntry(parsed({ name: 'B' }));
    expect(active.icon).toBe('check_settings');
    expect(inactive.icon).toBe('settings');

    const ref = { objectClass: 'Simulink.ConfigSetRef', sourceName: 'src' };
    const activeRef = section.addConfigSetEntry(parsed({ name: 'R1', active: true, ...ref }));
    const inactiveRef = section.addConfigSetEntry(parsed({ name: 'R2', ...ref }));
    expect(activeRef.icon).toBe('check_configurationReference');
    expect(inactiveRef.icon).toBe('configurationReference');
  });

  // Blank means "this layout did not say", which is what an old file with no class
  // recorded is: an ordinary set. Only a positive ConfigSetRef promotes a row.
  it('defaults to ConfigSetNode when the parser could not name a class', () => {
    const section = configSection();
    expect(section.addConfigSetEntry(parsed({ name: 'Plain', objectClass: '' }))).toBeInstanceOf(ConfigSetNode);
    expect(section.addConfigSetEntry(parsed({ name: 'Odd', objectClass: 'Simulink.Something' }))).toBeInstanceOf(
      ConfigSetNode,
    );
  });
});

// Where a config set records its class and its source, per layout era. Measured with
// test/parity/matlab/probe_configsetref.m and pinned end to end by the five
// slxcfgref*.slx fixtures in the layout parity suite; these cases are the same facts at
// unit scale, so a regression names the era it broke instead of a fixture.
describe('configSetIdentity reads the class and source of every layout era', () => {
  it('R2026b+ JSON: class is a FIELD, source is SourceName', () => {
    expect(
      configSetIdentity({
        _object_class: 'Simulink.ConfigSetRef',
        _properties: { SourceName: 'dictCfg', SourceLocation: 'Data Dictionary' },
      }),
    ).toEqual({ objectClass: 'Simulink.ConfigSetRef', sourceName: 'dictCfg' });
  });

  it('R2021a–R2026a XML: class is the ClassName ATTRIBUTE of a nested <Object>', () => {
    expect(
      configSetIdentity({
        Object: {
          '@_ClassName': 'Simulink.ConfigSetRef',
          P: [
            { '@_Name': 'Name', '#text': 'RefFromDict' },
            { '@_Name': 'SourceName', '#text': 'dictCfg' },
          ],
        },
      }),
    ).toEqual({ objectClass: 'Simulink.ConfigSetRef', sourceName: 'dictCfg' });
  });

  it('R2018a and earlier XML: the same source is spelled WSVarName', () => {
    expect(
      configSetIdentity({
        Object: {
          '@_ClassName': 'Simulink.ConfigSetRef',
          P: [{ '@_Name': 'WSVarName', '#text': 'dictCfg' }],
        },
      }),
    ).toEqual({ objectClass: 'Simulink.ConfigSetRef', sourceName: 'dictCfg' });
  });

  it('R2014b and earlier: the <Object> IS the record, read inline from blockdiagram.xml', () => {
    expect(
      configSetIdentity({
        '@_ClassName': 'Simulink.ConfigSetRef',
        P: [{ '@_Name': 'WSVarName', '#text': 'dictCfg' }],
      }),
    ).toEqual({ objectClass: 'Simulink.ConfigSetRef', sourceName: 'dictCfg' });
  });

  it('classic .mdl: the JSON shape MdlParser builds from the node name', () => {
    expect(
      configSetIdentity({ _object_class: 'Simulink.ConfigSetRef', _properties: { WSVarName: 'dictCfg' } }),
    ).toEqual({ objectClass: 'Simulink.ConfigSetRef', sourceName: 'dictCfg' });
  });

  it('an ordinary set has a class and no source', () => {
    expect(configSetIdentity({ _object_class: 'Simulink.ConfigSet', _properties: { Name: 'Configuration' } })).toEqual({
      objectClass: 'Simulink.ConfigSet',
      sourceName: '',
    });
    expect(
      configSetIdentity({ Object: { '@_ClassName': 'Simulink.ConfigSet', P: { '@_Name': 'Name', '#text': 'C' } } }),
    ).toEqual({ objectClass: 'Simulink.ConfigSet', sourceName: '' });
  });

  it('says nothing rather than guessing when the part records no class', () => {
    const blank = { objectClass: '', sourceName: '' };
    expect(configSetIdentity(null)).toEqual(blank);
    expect(configSetIdentity('not an object')).toEqual(blank);
    expect(configSetIdentity({})).toEqual(blank);
    expect(configSetIdentity({ Object: { P: [{ '@_Name': 'SourceName', '#text': 'x' }] } })).toEqual(blank);
  });
});

// The SLDD path (no active flag) must be unchanged: inactive icon by default.
describe('SLDD ConfigSet nodes are unchanged when active is not set', () => {
  it('ConfigSetNode.parse yields the plain settings icon', () => {
    const rawVal = { _array_class: 'Simulink.ConfigSet', _elements: [{ _properties: { Name: 'C' } }] };
    const node = ConfigSetNode.parse(rawVal, 'C', null);
    expect(node.active).toBeUndefined();
    expect(node.icon).toBe('settings');
  });

  it('ConfigSetRefNode.parse yields the plain configurationReference icon', () => {
    const rawVal = { _array_class: 'Simulink.ConfigSetRef', _elements: [{ _properties: { SourceName: 'src' } }] };
    const node = ConfigSetRefNode.parse(rawVal, 'R', null);
    expect(node.active).toBeUndefined();
    expect(node.icon).toBe('configurationReference');
  });
});
