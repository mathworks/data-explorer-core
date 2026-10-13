// Copyright 2026 The MathWorks, Inc.
//
// A dynamic property keeps the Source and PropertyType MATLAB wrote on it.
//
// MATLAB writes a config component's dynamic properties, the options a custom or AUTOSAR target
// adds to Simulink.STFCustomTargetCC, as `<P Name="AutosarSchemaVersion" Source="dynamic"
// PropertyType="RTWOptions_EnumType__…" Class="char">4.0</P>`, after the component's own.
// BinarySlddParser.parseStructElement knew one Source, the unnamed saveobj envelope's, and of any
// other kept the value and dropped both attributes, so the model held no record that the
// property was dynamic and every save wrote it as an ordinary one, `<P
// Name="AutosarSchemaVersion" Class="char">4.0</P>`.
//
// The element now keeps, under a binary-only reserved key (XmlUtils.PROPERTY_SOURCE_KEY), the
// Source and PropertyType of each property that has them, and the writers of an object's
// element write them back. The property itself stays in the element's bag, shown like any
// other. A text dictionary has no spelling for either attribute, so it is written without
// the key, as before.
//
// No fixture holds one, so the input is built here in MATLAB's spelling: a config set whose
// RTWCC's Components hold a code-appearance component and a custom target with three dynamic
// properties, of the three PropertyType kinds and the two classes the corpus holds.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest, serializeEntryToXml } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
const META = unzipSync(new Uint8Array(read('./fixtures/object_array_binary.sldd')))['metadata/mwcoreProperties.xml'];
const NS_CONFIG = 'a3b2532e-8e6e-47f5-94fb-b15daf666a84';
const NS_OTHER = '42516768-0ace-4981-8ac7-0a9b32cba471';
const pad = (n: number) => ' '.repeat(n);
const ENUM_TYPE = 'RTWOptions_EnumType__toolbox_rtw_targets_AUTOSAR_AUTOSAR_autosar_2AutosarSchemaVersion';

const dynamicProps = (at: number) =>
  pad(at) + '<P Name="AutosarCompilerAbstraction" Source="dynamic" PropertyType="slbool" Class="char">off</P>\n' +
  pad(at) + '<P Name="AutosarMaxShortNameLength" Source="dynamic" PropertyType="slint" Class="double">32.0</P>\n' +
  pad(at) + '<P Name="AutosarSchemaVersion" Source="dynamic" PropertyType="' + ENUM_TYPE + '" Class="char">4.0</P>\n';

const RTW_COMPONENTS =
  pad(24) + '<P Name="Components" Dimension="2*1">\n' +
  pad(28) + '<Element Class="Simulink.CodeAppCC">\n' +
  pad(32) + '<P Name="Name" Class="char">Code Appearance</P>\n' +
  pad(28) + '</Element>\n' +
  pad(28) + '<Element Class="Simulink.STFCustomTargetCC">\n' +
  pad(32) + '<P Name="Name" Class="char">Target</P>\n' +
  pad(32) + '<P Name="IsERTTarget" Class="char">on</P>\n' +
  dynamicProps(32) +
  pad(28) + '</Element>\n' +
  pad(24) + '</P>';

const CONFIG_SET_VALUE =
  '        <P Name="Value">\n' +
  '            <Element Class="Simulink.ConfigSet">\n' +
  '                <P Name="Name" Class="char">cs</P>\n' +
  '                <P Name="Components" Dimension="2*1">\n' +
  '                    <Element Class="Simulink.SolverCC">\n' +
  '                        <P Name="Name" Class="char">Solver</P>\n' +
  '                    </Element>\n' +
  '                    <Element Class="Simulink.RTWCC">\n' +
  '                        <P Name="SystemTargetFile" Class="char">autosar.tlc</P>\n' +
  RTW_COMPONENTS + '\n' +
  '                    </Element>\n' +
  '                </P>\n' +
  '            </Element>\n' +
  '        </P>';

// The same target as an entry of a class this package has no node for, and as an array of two,
// which its own nodes write: a scalar object's (DataNode._serializeSimulinkObjectXml) and an
// object array's (ObjectNode.serializeXml).
const TARGET_VALUE =
  '        <P Name="Value">\n' +
  '            <Element Class="Simulink.STFCustomTargetCC">\n' +
  '                <P Name="Name" Class="char">Target</P>\n' +
  dynamicProps(16) +
  '            </Element>\n' +
  '        </P>';
const TARGETS_VALUE =
  '        <P Name="Value" Dimension="1*2">\n' +
  '            <Element Class="Simulink.STFCustomTargetCC">\n' +
  '                <P Name="Name" Class="char">First</P>\n' +
  '            </Element>\n' +
  '            <Element Class="Simulink.STFCustomTargetCC">\n' +
  '                <P Name="Name" Class="char">Second</P>\n' +
  dynamicProps(16) +
  '            </Element>\n' +
  '        </P>';

function entryXml(name: string, uuid: string, ns: string, value: string): string {
  return (
    '    <Object Class="DD.ENTRY">\n' +
    '        <P Name="Name" Class="char">' + name + '</P>\n' +
    '        <P Name="UUID" Class="char">' + uuid + '</P>\n' +
    '        <P Name="Namespace" Class="char">' + ns + '</P>\n' +
    '        <P Name="LastMod" Class="char">20261013T101010.000000</P>\n' +
    '        <P Name="LastModBy" Class="char">someone</P>\n' +
    '        <P Name="IsDerived" Class="char">0</P>\n' +
    value + '\n' +
    '    </Object>\n'
  );
}
const CHUNK =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">\n' +
  entryXml('cs', 'e1b2c3d4-0000-4000-8000-000000000001', NS_CONFIG, CONFIG_SET_VALUE) +
  entryXml('target', 'e1b2c3d4-0000-4000-8000-000000000002', NS_OTHER, TARGET_VALUE) +
  entryXml('targets', 'e1b2c3d4-0000-4000-8000-000000000003', NS_OTHER, TARGETS_VALUE) +
  '    <Object Class="DD.Dictionary">\n' +
  '        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n' +
  '    </Object>\n' +
  '</DataSource>';
const BINARY = zipSync({ 'data/chunk0.xml': strToU8(CHUNK), 'metadata/mwcoreProperties.xml': META });

const openBinary = (bytes: Uint8Array = BINARY) => {
  const session = createSession();
  const source: any = ingest(session, bytes, { filename: 'targets.sldd' });
  return {
    session,
    source,
    entry: (name: string): any => source.flatten().find((n: any) => n.name === name),
    saved: () => strFromU8(unzipSync((session.serializeSource(source.name) as { bytes: Uint8Array }).bytes)['data/chunk0.xml']),
  };
};

/** The span of the `<P>` whose opening line is `open`, through its own closing line. */
function spanOf(xml: string, open: string): string {
  const from = xml.indexOf(open + '\n');
  expect(from, open).toBeGreaterThanOrEqual(0);
  const indent = open.length - open.trimStart().length;
  const close = '\n' + ' '.repeat(indent) + '</P>';
  return xml.slice(from, xml.indexOf(close, from) + close.length);
}
/** The <Object> of the entry called `name`. */
function entryOf(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThanOrEqual(0);
  return xml.slice(xml.lastIndexOf('<Object', at), xml.indexOf('</Object>', at) + '</Object>'.length);
}
const VALUE_OPEN = '        <P Name="Value">';
const RTW_OPEN = pad(24) + '<P Name="Components" Dimension="2*1">';
const SOURCES = {
  AutosarCompilerAbstraction: { source: 'dynamic', propertyType: 'slbool' },
  AutosarMaxShortNameLength: { source: 'dynamic', propertyType: 'slint' },
  AutosarSchemaVersion: { source: 'dynamic', propertyType: ENUM_TYPE },
};
const targetOf = (value: any) => value._elements[0]._properties.Components._elements[1]._properties.Components._elements[1];

describe('a dynamic property of a config component', () => {
  it('reads as a property of the component, with its Source and PropertyType kept beside the bag', () => {
    const target = targetOf(openBinary().entry('cs').serial._rawVal);
    expect(target._properties).toEqual({
      Name: 'Target', IsERTTarget: 'on', AutosarCompilerAbstraction: 'off', AutosarMaxShortNameLength: 32, AutosarSchemaVersion: '4.0',
    });
    expect(target._property_source).toEqual(SOURCES);
  });

  it('is written back with them, on an untouched save and a regenerated entry', () => {
    const { entry, saved } = openBinary();
    expect(spanOf(saved(), RTW_OPEN)).toBe(RTW_COMPONENTS);
    expect(spanOf(serializeEntryToXml(entry('cs')), RTW_OPEN)).toBe(RTW_COMPONENTS);
  });

  it('is copied with them, and pasted into a binary dictionary writes them', () => {
    const payload = JSON.parse(JSON.stringify(openBinary().entry('cs').serialize()));
    expect(targetOf(payload.value)._property_source).toEqual(SOURCES);
    const { source, saved } = openBinary();
    const config = source.getSection('config');
    const pasted = config.parseEntry({ ...payload, name: 'csPasted', metadata: { ...payload.metadata, uuid: 'f1b2c3d4-0000-4000-8000-000000000001' } });
    expect(spanOf(serializeEntryToXml(pasted), RTW_OPEN)).toBe(RTW_COMPONENTS);
    expect(saved().split(RTW_COMPONENTS).length - 1).toBe(2);
  });

  it('pasted into a text dictionary, is saved there as it was, a property with no reserved key', () => {
    const payload = JSON.parse(JSON.stringify(openBinary().entry('cs').serialize()));
    const session = createSession();
    const text: any = ingest(session, read('./fixtures/rt_text.sldd').toString('utf8'), { filename: 'rt_text.sldd' });
    const metadata = { ...text.flatten().find((n: any) => n.isEntry).metadata, namespace: NS_CONFIG, uuid: 'f1b2c3d4-0000-4000-8000-000000000002' };
    text.getSection('config').parseEntry({ ...payload, metadata });
    const saved = (session.serializeSource(text.name) as { text: string }).text;
    expect(saved).not.toContain('_property_source');
    const entries = JSON.parse(saved).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    expect(targetOf(entries.find((e: any) => e.name === 'cs').value)).toEqual({
      _object_class: 'Simulink.STFCustomTargetCC',
      _properties: { Name: 'Target', IsERTTarget: 'on', AutosarCompilerAbstraction: 'off', AutosarMaxShortNameLength: 32, AutosarSchemaVersion: '4.0' },
    });
  });
});

describe('a dynamic property of an object this package has no node for', () => {
  it('shows as a row like any other property', () => {
    const target = openBinary().entry('target');
    expect(target.children.map((c: any) => c.name)).toEqual(['Name', 'AutosarCompilerAbstraction', 'AutosarMaxShortNameLength', 'AutosarSchemaVersion']);
  });

  it('is written back with its Source and PropertyType, untouched and after an edit to it', () => {
    const { entry, saved } = openBinary();
    expect(spanOf(entryOf(saved(), 'target'), VALUE_OPEN)).toBe(TARGET_VALUE);
    const target = entry('target');
    const version = target.children.find((c: any) => c.name === 'AutosarSchemaVersion');
    expect(version.setProperty('Value', "'4.3'")).toBe(true);
    expect(serializeEntryToXml(target)).toContain(
      pad(16) + '<P Name="AutosarSchemaVersion" Source="dynamic" PropertyType="' + ENUM_TYPE + '" Class="char">4.3</P>\n',
    );
  });

  it('of an element of an object array, is written back with them', () => {
    const { entry, saved } = openBinary();
    const open = '        <P Name="Value" Dimension="1*2">';
    expect(spanOf(entryOf(saved(), 'targets'), open)).toBe(TARGETS_VALUE);
    expect(spanOf(serializeEntryToXml(entry('targets')), open)).toBe(TARGETS_VALUE);
    expect(entry('targets').children[1].children.map((c: any) => c.name)).toEqual(['Name', 'AutosarCompilerAbstraction', 'AutosarMaxShortNameLength', 'AutosarSchemaVersion']);
  });
});

// A PropertyType with no Source beside it is kept as well: of the two attributes, the reader keeps
// whichever MATLAB wrote (BinarySlddParser.propertySources). No dictionary holds one, so this
// pins the arm that keeps it.
describe('a property written with a PropertyType and no Source', () => {
  const TYPED_VALUE =
    '        <P Name="Value">\n' +
    '            <Element Class="Simulink.STFCustomTargetCC">\n' +
    '                <P Name="Name" Class="char">Target</P>\n' +
    '                <P Name="AutosarCompilerAbstraction" PropertyType="slbool" Class="char">off</P>\n' +
    '            </Element>\n' +
    '        </P>';
  const TYPED = zipSync({
    'data/chunk0.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">\n' +
      entryXml('typed', 'e1b2c3d4-0000-4000-8000-000000000004', NS_OTHER, TYPED_VALUE) +
      '    <Object Class="DD.Dictionary">\n' +
      '        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n' +
      '    </Object>\n' +
      '</DataSource>',
    ),
    'metadata/mwcoreProperties.xml': META,
  });

  it('keeps the PropertyType, and is written back with it on an untouched save and a regenerated entry', () => {
    const { entry, saved } = openBinary(TYPED);
    expect(entry('typed').serial._rawVal._elements[0]._property_source).toEqual({ AutosarCompilerAbstraction: { propertyType: 'slbool' } });
    expect(spanOf(entryOf(saved(), 'typed'), VALUE_OPEN)).toBe(TYPED_VALUE);
    expect(spanOf(serializeEntryToXml(entry('typed')), VALUE_OPEN)).toBe(TYPED_VALUE);
  });
});
