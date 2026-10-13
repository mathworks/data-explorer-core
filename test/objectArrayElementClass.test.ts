// Copyright 2026 The MathWorks, Inc.
//
// Each element of a mixed-class object array keeps its own class.
//
// MATLAB states an object array in a binary dictionary as one `<Element Class="…">` per
// element, each naming its own class, and a config set's Components is such an array of nine or
// more classes: `<P Name="Components" Dimension="9*1">` over a Simulink.SolverCC, a
// Simulink.DataIOCC, … a SlCovCC.ConfigComp. BinarySlddParser.objectArrayValue took the first
// element's class for the whole array and dropped the rest, so every component read as a
// Simulink.SolverCC, every save wrote nine Simulink.SolverCCs, and a copy carried them into a
// text dictionary that way.
//
// A text dictionary states the same array as MATLAB's text format does: the class the elements
// share in `_array_class` (Simulink.ConfigComponent for Components) and the class of each element
// that differs from it in that element's `_object_class`. That is the spelling the binary reader
// now holds: `_array_class` is the class every element shares, or the common base class where it
// can be derived (a config set's Components, or the one MathWorks class beside user classes), or
// else the first element's class, and `_object_class` is on each element of another class. The
// consumers read it: ObjectNode builds each element as its own class, serializeValue keeps it,
// and both object-array writers (DataNode._objectXml and ObjectNode.serializeXml) write each
// element's own Class.
//
// No fixture holds a mixed array, so the inputs are built here in MATLAB's spelling: a config set
// shaped as every config set MATLAB writes is (nine components, and the RTWCC's own Components of
// a code-appearance component and a target), and a 1x2 array of a Simulink.Signal subclass and a
// Simulink.Signal, shaped as a corpus dictionary's custom alias type holds one.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest, serializeEntryToXml } from '../src/index.js';
import { regenerateEntryXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
const META = unzipSync(new Uint8Array(read('./fixtures/object_array_binary.sldd')))['metadata/mwcoreProperties.xml'];
const NS_DESIGN = 'dacaf35e-55a5-454d-a7c1-93db038a210e';
const NS_CONFIG = 'a3b2532e-8e6e-47f5-94fb-b15daf666a84';

const COMPONENT_CLASSES = [
  'Simulink.SolverCC',
  'Simulink.DataIOCC',
  'Simulink.OptimizationCC',
  'Simulink.DebuggingCC',
  'Simulink.HardwareCC',
  'Simulink.ModelReferenceCC',
  'Simulink.SFSimCC',
  'Simulink.RTWCC',
  'SlCovCC.ConfigComp',
];
const RTW_COMPONENTS = ['Simulink.CodeAppCC', 'Simulink.ERTTargetCC'];

const pad = (n: number) => ' '.repeat(n);
function component(cls: string, at: number): string {
  if (cls === 'Simulink.RTWCC') {
    return (
      pad(at) + '<Element Class="Simulink.RTWCC">\n' +
      pad(at + 4) + '<P Name="SystemTargetFile" Class="char">ert.tlc</P>\n' +
      pad(at + 4) + '<P Name="Components" Dimension="2*1">\n' +
      RTW_COMPONENTS.map((c) => pad(at + 8) + '<Element Class="' + c + '">\n' + pad(at + 12) + '<P Name="Name" Class="char">' + c + '</P>\n' + pad(at + 8) + '</Element>\n').join('') +
      pad(at + 4) + '</P>\n' +
      pad(at) + '</Element>\n'
    );
  }
  return pad(at) + '<Element Class="' + cls + '">\n' + pad(at + 4) + '<P Name="Name" Class="char">' + cls + '</P>\n' + pad(at) + '</Element>\n';
}

// The Components span as MATLAB writes it, and as the writer writes it back at the same depth.
const COMPONENTS =
  pad(16) + '<P Name="Components" Dimension="9*1">\n' + COMPONENT_CLASSES.map((c) => component(c, 20)).join('') + pad(16) + '</P>';

const SIGNAL_PROPS = (at: number) =>
  pad(at) + '<P Name="Dimensions" Class="double">-1.0</P>\n' +
  pad(at) + '<P Name="DataType" Class="char">auto</P>\n' +
  pad(at) + '<P Name="Description" Class="char">sig</P>\n';
const USER_ARRAY =
  pad(16) + '<P Name="UserMLArray2" Dimension="1*2">\n' +
  pad(20) + '<Element Class="MySubclasses.MySlSignal">\n' +
  pad(24) + '<P Name="myDescription" Class="char">sub</P>\n' +
  SIGNAL_PROPS(24) +
  pad(20) + '</Element>\n' +
  pad(20) + '<Element Class="Simulink.Signal">\n' +
  SIGNAL_PROPS(24) +
  pad(20) + '</Element>\n' +
  pad(16) + '</P>';

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

const CONFIG_SET_VALUE =
  '        <P Name="Value">\n' +
  '            <Element Class="Simulink.ConfigSet">\n' +
  '                <P Name="Name" Class="char">cs</P>\n' +
  COMPONENTS + '\n' +
  '                <P Name="Description" Class="char"/>\n' +
  '            </Element>\n' +
  '        </P>';
const ALIAS_VALUE =
  '        <P Name="Value">\n' +
  '            <Element Class="MySubclasses.MyAliasType">\n' +
  USER_ARRAY + '\n' +
  '                <P Name="BaseType" Class="char">double</P>\n' +
  '            </Element>\n' +
  '        </P>';

// The same array as an entry's value, which MATLAB refuses to write but this package reads and
// writes: the array's own node writes it (ObjectNode.serializeXml), not its owner's bag.
const ARRAY_VALUE = USER_ARRAY.split('\n').map((l) => l.slice(8)).join('\n').replace('<P Name="UserMLArray2"', '<P Name="Value"');

const CHUNK =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">\n' +
  entryXml('cs', 'a1b2c3d4-0000-4000-8000-000000000001', NS_CONFIG, CONFIG_SET_VALUE) +
  entryXml('alias', 'a1b2c3d4-0000-4000-8000-000000000002', NS_DESIGN, ALIAS_VALUE) +
  entryXml('signals', 'a1b2c3d4-0000-4000-8000-000000000003', NS_DESIGN, ARRAY_VALUE) +
  '    <Object Class="DD.Dictionary">\n' +
  '        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n' +
  '    </Object>\n' +
  '</DataSource>';
const BINARY = zipSync({ 'data/chunk0.xml': strToU8(CHUNK), 'metadata/mwcoreProperties.xml': META });

const openBinary = (bytes: Uint8Array = BINARY) => {
  const session = createSession();
  const source: any = ingest(session, bytes, { filename: 'mixed.sldd' });
  const entry = (name: string): any => source.flatten().find((n: any) => n.name === name);
  const saved = () => strFromU8(unzipSync((session.serializeSource(source.name) as { bytes: Uint8Array }).bytes)['data/chunk0.xml']);
  return { session, source, entry, saved };
};

/** The span of the `<P>` whose opening line is `open`, through its own closing line. */
function spanOf(xml: string, open: string): string {
  const from = xml.indexOf(open + '\n');
  expect(from, open).toBeGreaterThanOrEqual(0);
  const indent = open.length - open.trimStart().length;
  const close = '\n' + ' '.repeat(indent) + '</P>';
  return xml.slice(from, xml.indexOf(close, from) + close.length);
}
const COMPONENTS_OPEN = pad(16) + '<P Name="Components" Dimension="9*1">';
const USER_ARRAY_OPEN = pad(16) + '<P Name="UserMLArray2" Dimension="1*2">';
const classesIn = (xml: string) => [...xml.matchAll(/<Element Class="([^"]*)"/g)].map((m) => m[1]);

describe('a binary dictionary\'s mixed-class object array', () => {
  it('reads each element\'s own class, under the common base class MATLAB\'s text format names for a config set\'s components', () => {
    const components = openBinary().entry('cs').serial._rawVal._elements[0]._properties.Components;
    expect(components._array_class).toBe('Simulink.ConfigComponent');
    expect(components._elements.map((e: any) => e._object_class)).toEqual(COMPONENT_CLASSES);
    const rtw = components._elements[7]._properties.Components;
    expect(rtw._array_class).toBe('Simulink.ConfigComponent');
    expect(rtw._elements.map((e: any) => e._object_class)).toEqual(RTW_COMPONENTS);
  });

  it('reads a Simulink.Signal subclass beside a Simulink.Signal under the Simulink.Signal, and marks the subclass element', () => {
    const array = openBinary().entry('alias').serial._rawVal._elements[0]._properties.UserMLArray2;
    expect(array._array_class).toBe('Simulink.Signal');
    expect(array._elements.map((e: any) => e._object_class)).toEqual(['MySubclasses.MySlSignal', undefined]);
  });

  it('opens each element as a node of its own class', () => {
    const array = openBinary().entry('alias').children.find((c: any) => c.name === 'UserMLArray2');
    expect(array.children.map((c: any) => [c.constructor.name, c.className])).toEqual([
      ['ObjectNode', 'MySubclasses.MySlSignal'],
      ['SignalNode', 'Simulink.Signal'],
    ]);
    expect([array.className, array.icon]).toEqual(['Simulink.Signal', array.children[1].icon]);
  });

  it('writes each element\'s own Class, on an untouched save and a regenerated entry', () => {
    const { entry, saved } = openBinary();
    const xml = saved();
    expect(spanOf(xml, COMPONENTS_OPEN)).toBe(COMPONENTS);
    expect(spanOf(xml, USER_ARRAY_OPEN)).toBe(USER_ARRAY);
    expect(spanOf(serializeEntryToXml(entry('cs')), COMPONENTS_OPEN)).toBe(COMPONENTS);
    expect(spanOf(serializeEntryToXml(entry('alias')), USER_ARRAY_OPEN)).toBe(USER_ARRAY);
    // An unedited entry's serializeEntryToXml is its own bytes; the writer is asked directly.
    expect(spanOf(regenerateEntryXml(entry('cs')), COMPONENTS_OPEN), 'written from the model').toBe(COMPONENTS);
    expect(spanOf(regenerateEntryXml(entry('alias')), USER_ARRAY_OPEN), 'written from the model').toBe(USER_ARRAY);
    expect(classesIn(spanOf(xml, COMPONENTS_OPEN))).toEqual([
      ...COMPONENT_CLASSES.slice(0, 7), 'Simulink.RTWCC', ...RTW_COMPONENTS, 'SlCovCC.ConfigComp',
    ]);
  });

  it('writes each element\'s own Class where the array is an entry\'s value', () => {
    const { entry, saved } = openBinary();
    const open = '        <P Name="Value" Dimension="1*2">';
    expect(entry('signals').children.map((c: any) => c.className)).toEqual(['MySubclasses.MySlSignal', 'Simulink.Signal']);
    expect(spanOf(saved(), open)).toBe(ARRAY_VALUE);
    expect(spanOf(serializeEntryToXml(entry('signals')), open)).toBe(ARRAY_VALUE);
    expect(spanOf(regenerateEntryXml(entry('signals')), open), 'written from the model').toBe(ARRAY_VALUE);
  });

  it('writes each element\'s own Class after an edit inside the array', () => {
    const { entry } = openBinary();
    const alias = entry('alias');
    const second = alias.children.find((c: any) => c.name === 'UserMLArray2').children[1];
    expect(second.setProperty('Description', 'edited')).toBe(true);
    const span = spanOf(serializeEntryToXml(alias), USER_ARRAY_OPEN);
    expect(classesIn(span)).toEqual(['MySubclasses.MySlSignal', 'Simulink.Signal']);
    expect(span).toBe(USER_ARRAY.replace(/(<Element Class="Simulink\.Signal">[\s\S]*)>sig</, '$1>edited<'));
  });

  it('copies each element\'s own class, as MATLAB\'s text format spells it', () => {
    const { entry } = openBinary();
    const copy = JSON.parse(JSON.stringify(entry('cs').serialize()));
    const components = copy.value._elements[0]._properties.Components;
    expect(components._array_class).toBe('Simulink.ConfigComponent');
    expect(components._elements.map((e: any) => e._object_class)).toEqual(COMPONENT_CLASSES);
    const array = JSON.parse(JSON.stringify(entry('alias').serialize())).value._elements[0]._properties.UserMLArray2;
    expect(array._elements.map((e: any) => e._object_class)).toEqual(['MySubclasses.MySlSignal', undefined]);
  });

  it('pasted into a text dictionary, saves each element\'s own class there', () => {
    const { entry } = openBinary();
    const payload = JSON.parse(JSON.stringify(entry('alias').serialize()));
    const session = createSession();
    const text: any = ingest(session, read('./fixtures/rt_text.sldd').toString('utf8'), { filename: 'rt_text.sldd' });
    const design = text.getSection('design');
    design.parseEntry({ ...payload, metadata: { ...text.flatten().find((n: any) => n.isEntry).metadata, uuid: 'b1b2c3d4-0000-4000-8000-000000000002' } });
    const saved = JSON.parse((session.serializeSource(text.name) as { text: string }).text);
    const pasted = saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'alias');
    const array = pasted.value._elements[0]._properties.UserMLArray2;
    expect(array._array_class).toBe('Simulink.Signal');
    expect(array._elements.map((e: any) => e._object_class)).toEqual(['MySubclasses.MySlSignal', undefined]);
  });
});

// Two shapes no dictionary MATLAB wrote holds, built here so that each arm of the reader that
// decides them is pinned: an element of Simulink.ConfigComponent itself beside one of the
// classes listed under it (BinarySlddParser.heterogeneousBaseOf), and a later element carrying
// no Class of its own, which counts as one of the first element's class (objectArrayValue).
describe('a binary dictionary\'s mixed array of config components, in the shapes MATLAB does not write', () => {
  const configSetOf = (elements: string[]) =>
    '        <P Name="Value">\n' +
    '            <Element Class="Simulink.ConfigSet">\n' +
    '                <P Name="Name" Class="char">cs</P>\n' +
    pad(16) + '<P Name="Components" Dimension="' + elements.length + '*1">\n' + elements.join('') + pad(16) + '</P>\n' +
    '            </Element>\n' +
    '        </P>';
  const CLASSLESS = pad(20) + '<Element>\n' + pad(24) + '<P Name="Name" Class="char">unclassed</P>\n' + pad(20) + '</Element>\n';
  const ARMS = zipSync({
    'data/chunk0.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">\n' +
      entryXml('withBase', 'a1b2c3d4-0000-4000-8000-000000000004', NS_CONFIG, configSetOf([component('Simulink.SolverCC', 20), component('Simulink.ConfigComponent', 20)])) +
      entryXml('classless', 'a1b2c3d4-0000-4000-8000-000000000005', NS_CONFIG, configSetOf([component('Simulink.SolverCC', 20), component('Simulink.DataIOCC', 20), CLASSLESS])) +
      '    <Object Class="DD.Dictionary">\n' +
      '        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n' +
      '    </Object>\n' +
      '</DataSource>',
    ),
    'metadata/mwcoreProperties.xml': META,
  });
  const componentsOf = (entry: any) => entry.serial._rawVal._elements[0]._properties.Components;

  it('reads an array of Simulink.ConfigComponent beside a class listed under it as a Simulink.ConfigComponent array', () => {
    const { entry } = openBinary(ARMS);
    const components = componentsOf(entry('withBase'));
    expect(components._array_class).toBe('Simulink.ConfigComponent');
    expect(components._elements.map((e: any) => e._object_class)).toEqual(['Simulink.SolverCC', undefined]);
    expect(classesIn(spanOf(serializeEntryToXml(entry('withBase')), pad(16) + '<P Name="Components" Dimension="2*1">'))).toEqual([
      'Simulink.SolverCC', 'Simulink.ConfigComponent',
    ]);
    expect(classesIn(spanOf(regenerateEntryXml(entry('withBase')), pad(16) + '<P Name="Components" Dimension="2*1">')), 'written from the model').toEqual([
      'Simulink.SolverCC', 'Simulink.ConfigComponent',
    ]);
  });

  it('reads a later element with no Class as one of the first element\'s class, in an array of config components', () => {
    const { entry } = openBinary(ARMS);
    const components = componentsOf(entry('classless'));
    expect(components._array_class).toBe('Simulink.ConfigComponent');
    expect(components._elements.map((e: any) => e._object_class)).toEqual(['Simulink.SolverCC', 'Simulink.DataIOCC', 'Simulink.SolverCC']);
    expect(components._elements[2]._properties).toEqual({ Name: 'unclassed' });
    // Written from the model, the classless element is written with the class it is read as.
    expect(classesIn(spanOf(regenerateEntryXml(entry('classless')), pad(16) + '<P Name="Components" Dimension="3*1">'))).toEqual([
      'Simulink.SolverCC', 'Simulink.DataIOCC', 'Simulink.SolverCC',
    ]);
    // Unedited, the entry is its own bytes, where that element states no Class.
    expect(classesIn(spanOf(serializeEntryToXml(entry('classless')), pad(16) + '<P Name="Components" Dimension="3*1">'))).toEqual([
      'Simulink.SolverCC', 'Simulink.DataIOCC',
    ]);
  });
});

// A binary dictionary has no place for an object array's class, so the reader derives it from
// its elements' (BinarySlddParser.arrayClassOf). Two rules name a base the classes alone cannot:
// the one MathWorks class beside classes that are not MathWorks' is the array's class, a user
// class deriving from a MathWorks class and never the other way; and the Components of a
// Simulink.ConfigSet or a Simulink.RTWCC is a Simulink.ConfigComponent array, whatever its
// components, as every one MATLAB writes in a text dictionary is. Where neither rule names one the
// reader keeps the first element's class.
describe('a binary dictionary\'s mixed object array, under the base its classes name', () => {
  const element = (cls: string, props: string, at = 20) => pad(at) + '<Element Class="' + cls + '">\n' + props + pad(at) + '</Element>\n';
  const named = (name: string, at: number) => pad(at) + '<P Name="Name" Class="char">' + name + '</P>\n';
  const arrayOf = (name: string, classes: string[], at = 16) =>
    pad(at) + '<P Name="' + name + '" Dimension="1*' + classes.length + '">\n' + classes.map((c, k) => element(c, named(c + k, at + 8), at + 4)).join('') + pad(at) + '</P>';
  const owned = (cls: string, props: string) => '        <P Name="Value">\n' + element(cls, props + '\n', 12) + '        </P>';
  const configSet = (components: string[], rtw: string[]) =>
    owned('Simulink.ConfigSet',
      pad(16) + '<P Name="Components" Dimension="' + components.length + '*1">\n' +
      components.map((c) => c === 'Simulink.RTWCC'
        ? element(c, pad(24) + '<P Name="Components" Dimension="' + rtw.length + '*1">\n' + rtw.map((r) => element(r, named(r, 32), 28)).join('') + pad(24) + '</P>\n')
        : element(c, named(c, 24))).join('') +
      pad(16) + '</P>');
  const CODER_TARGET = 'CoderTarget.SettingsController';
  const entries: [string, string, string][] = [
    ['coder', NS_CONFIG, configSet(['Simulink.SolverCC', 'Simulink.DataIOCC', 'Simulink.RTWCC', CODER_TARGET], ['Simulink.CodeAppCC', CODER_TARGET])],
    ['simscape', NS_CONFIG, configSet(['Simulink.SolverCC', 'SSC.SimscapeCC'], [])],
    ['oneClass', NS_DESIGN, owned('MySubclasses.MyAliasType', arrayOf('UserMLArray2', ['Simulink.Signal', 'Simulink.Signal']))],
    ['listed', NS_DESIGN, owned('MySubclasses.MyAliasType', arrayOf('UserMLArray2', ['Simulink.SolverCC', 'Simulink.DataIOCC']))],
    ['users', NS_DESIGN, owned('MySubclasses.MyAliasType', arrayOf('UserMLArray2', ['My.A', 'My.B']))],
    ['twoKnown', NS_DESIGN, owned('MySubclasses.MyAliasType', arrayOf('UserMLArray2', ['MySubclasses.MySlSignal', 'Simulink.Signal', 'Simulink.Parameter']))],
    ['userComponents', NS_DESIGN, owned('My.Holder', arrayOf('Components', ['My.A', 'My.B']))],
  ];
  const BASES = zipSync({
    'data/chunk0.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">\n' +
      entries.map(([name, ns, value], k) => entryXml(name, 'a1b2c3d4-0000-4000-8000-0000000001' + String(k).padStart(2, '0'), ns, value)).join('') +
      '    <Object Class="DD.Dictionary">\n' +
      '        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n' +
      '    </Object>\n' +
      '</DataSource>',
    ),
    'metadata/mwcoreProperties.xml': META,
  });
  const read1 = (array: any) => [array._array_class, array._elements.map((e: any) => e._object_class)];
  const propertyOf = (entry: any, name: string) => entry.serial._rawVal._elements[0]._properties[name];

  it('reads a Simulink.Signal subclass beside a Simulink.Signal as a Simulink.Signal array, at an alias type\'s property', () => {
    const { entry, saved } = openBinary();
    expect(read1(propertyOf(entry('alias'), 'UserMLArray2'))).toEqual(['Simulink.Signal', ['MySubclasses.MySlSignal', undefined]]);
    const array = entry('alias').children.find((c: any) => c.name === 'UserMLArray2');
    expect([array.className, array.displayValue]).toEqual(['Simulink.Signal', '<1x2 Simulink.Signal>']);
    expect(spanOf(saved(), USER_ARRAY_OPEN)).toBe(USER_ARRAY);
    // The save keeps the unedited entry's bytes; the writer writes each element's own Class too.
    expect(spanOf(regenerateEntryXml(entry('alias')), USER_ARRAY_OPEN), 'written from the model').toBe(USER_ARRAY);
  });

  it('reads the same array as a Simulink.Signal array where it is an entry\'s value', () => {
    const { entry, saved } = openBinary();
    const signals = entry('signals');
    expect(read1(signals.serial._rawVal)).toEqual(['Simulink.Signal', ['MySubclasses.MySlSignal', undefined]]);
    expect([signals.className, signals.displayValue]).toEqual(['Simulink.Signal', '<1x2 Simulink.Signal>']);
    expect(signals.children.map((c: any) => [c.constructor.name, c.className])).toEqual([['ObjectNode', 'MySubclasses.MySlSignal'], ['SignalNode', 'Simulink.Signal']]);
    expect(spanOf(saved(), '        <P Name="Value" Dimension="1*2">')).toBe(ARRAY_VALUE);
    expect(spanOf(regenerateEntryXml(signals), '        <P Name="Value" Dimension="1*2">'), 'written from the model').toBe(ARRAY_VALUE);
  });

  it('reads a config set\'s Components, and its RTWCC\'s, as Simulink.ConfigComponent arrays, whatever components they hold', () => {
    const { entry } = openBinary(BASES);
    const components = propertyOf(entry('coder'), 'Components');
    expect(read1(components)).toEqual(['Simulink.ConfigComponent', ['Simulink.SolverCC', 'Simulink.DataIOCC', 'Simulink.RTWCC', CODER_TARGET]]);
    expect(read1(components._elements[2]._properties.Components)).toEqual(['Simulink.ConfigComponent', ['Simulink.CodeAppCC', CODER_TARGET]]);
    expect(read1(propertyOf(entry('simscape'), 'Components'))).toEqual(['Simulink.ConfigComponent', ['Simulink.SolverCC', 'SSC.SimscapeCC']]);
    // An unedited entry's serializeEntryToXml is its own bytes; the writer is asked directly.
    expect(classesIn(spanOf(regenerateEntryXml(entry('coder')), pad(16) + '<P Name="Components" Dimension="4*1">')), 'written from the model').toEqual([
      'Simulink.SolverCC', 'Simulink.DataIOCC', 'Simulink.RTWCC', 'Simulink.CodeAppCC', CODER_TARGET, CODER_TARGET,
    ]);
  });

  it('reads an array of one class, a mix of listed config components, and a mix with no MathWorks class or two of them as before', () => {
    const { entry } = openBinary(BASES);
    expect(read1(propertyOf(entry('oneClass'), 'UserMLArray2'))).toEqual(['Simulink.Signal', [undefined, undefined]]);
    expect(read1(propertyOf(entry('listed'), 'UserMLArray2'))).toEqual(['Simulink.ConfigComponent', ['Simulink.SolverCC', 'Simulink.DataIOCC']]);
    expect(read1(propertyOf(entry('users'), 'UserMLArray2'))).toEqual(['My.A', [undefined, 'My.B']]);
    expect(read1(propertyOf(entry('twoKnown'), 'UserMLArray2'))).toEqual(['MySubclasses.MySlSignal', [undefined, 'Simulink.Signal', 'Simulink.Parameter']]);
    // Only a config set's and an RTWCC's Components are config components.
    expect(read1(propertyOf(entry('userComponents'), 'Components'))).toEqual(['My.A', [undefined, 'My.B']]);
  });
});

describe('an object array whose elements share one class', () => {
  it('reads and writes as it always did, with no element class', () => {
    const session = createSession();
    const source: any = ingest(session, new Uint8Array(read('./fixtures/object_array_binary.sldd')), { filename: 'object_array_binary.sldd' });
    const entry = source.flatten().find((n: any) => n.name === 'paramArray');
    expect(entry.serial._rawVal._array_class).toBe('Simulink.Parameter');
    expect(entry.serial._rawVal._elements.every((e: any) => !('_object_class' in e))).toBe(true);
    expect(JSON.stringify(entry.serialize())).not.toContain('_object_class');
    expect(classesIn(serializeEntryToXml(entry))).toEqual(['Simulink.Parameter', 'Simulink.Parameter', 'Simulink.Parameter']);
    expect(classesIn(regenerateEntryXml(entry)), 'written from the model').toEqual(['Simulink.Parameter', 'Simulink.Parameter', 'Simulink.Parameter']);
  });
});

// The same arrays as MATLAB's text format holds them: Components under Simulink.ConfigComponent
// with each component's class on it, and the subclass element of a Simulink.Signal array marked
// `_object_class` beside the plain one, as a corpus dictionary MATLAB wrote holds it.
describe('a text dictionary\'s mixed-class object array', () => {
  const textObject = (cls: string, props: Record<string, unknown>) => ({ _object_class: cls, _properties: props });
  const SIGNAL = { DataType: 'auto', Description: 'sig', Dimensions: -1 };
  const configSet = {
    _array_class: 'Simulink.ConfigSet',
    _dimensions: [1, 1],
    _elements: [{
      _properties: {
        Components: {
          _array_class: 'Simulink.ConfigComponent',
          _dimensions: [9, 1],
          _elements: COMPONENT_CLASSES.map((c) => textObject(c, c === 'Simulink.RTWCC'
            ? {
              Components: { _array_class: 'Simulink.ConfigComponent', _dimensions: [2, 1], _elements: RTW_COMPONENTS.map((r) => textObject(r, { Name: r })) },
              SystemTargetFile: 'ert.tlc',
            }
            : { Name: c })),
        },
        Description: '',
        Name: 'cs',
      },
    }],
    _mw_element_type: 'MATLABArray',
  };
  const alias = {
    _array_class: 'MySubclasses.MyAliasType',
    _dimensions: [1, 1],
    _elements: [{
      _properties: {
        BaseType: 'double',
        UserMLArray2: {
          _array_class: 'Simulink.Signal',
          _dimensions: [1, 2],
          _elements: [{ _object_class: 'MySubclasses.MySlSignal', _properties: { ...SIGNAL, myDescription: 'sub' } }, { _properties: SIGNAL }],
        },
      },
    }],
    _mw_element_type: 'MATLABArray',
  };
  const textDictionary = () => {
    const json = JSON.parse(read('./fixtures/rt_text.sldd').toString('utf8'));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const metadata = entries[0].metadata;
    entries.push({ name: 'cs', metadata: { ...metadata, namespace: NS_CONFIG, uuid: 'c1b2c3d4-0000-4000-8000-000000000001' }, value: configSet });
    entries.push({ name: 'alias', metadata: { ...metadata, namespace: NS_DESIGN, uuid: 'c1b2c3d4-0000-4000-8000-000000000002' }, value: alias });
    return JSON.stringify(json, null, '\t');
  };
  const openText = () => {
    const session = createSession();
    const source: any = ingest(session, textDictionary(), { filename: 'mixed_text.sldd' });
    return { session, source, entry: (name: string): any => source.flatten().find((n: any) => n.name === name) };
  };

  it('opens each element as a node of its own class', () => {
    const array = openText().entry('alias').children.find((c: any) => c.name === 'UserMLArray2');
    expect(array.children.map((c: any) => [c.constructor.name, c.className])).toEqual([
      ['ObjectNode', 'MySubclasses.MySlSignal'],
      ['SignalNode', 'Simulink.Signal'],
    ]);
    // The array reads as the class it is, a Simulink.Signal array, not as its subclass element.
    expect([array.className, array.icon]).toEqual(['Simulink.Signal', array.children[1].icon]);
  });

  it('keeps each element\'s class on an untouched save', () => {
    const { session, source } = openText();
    const saved = JSON.parse((session.serializeSource(source.name) as { text: string }).text);
    const entries = saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    expect(JSON.stringify(entries.find((e: any) => e.name === 'alias').value)).toBe(JSON.stringify(alias));
    expect(JSON.stringify(entries.find((e: any) => e.name === 'cs').value)).toBe(JSON.stringify(configSet));
  });

  it('written to a binary dictionary, writes each element\'s own Class, not the base class', () => {
    const { entry } = openText();
    expect(classesIn(spanOf(serializeEntryToXml(entry('cs')), COMPONENTS_OPEN))).toEqual([
      ...COMPONENT_CLASSES.slice(0, 7), 'Simulink.RTWCC', ...RTW_COMPONENTS, 'SlCovCC.ConfigComp',
    ]);
    expect(classesIn(spanOf(serializeEntryToXml(entry('alias')), USER_ARRAY_OPEN))).toEqual(['MySubclasses.MySlSignal', 'Simulink.Signal']);
  });

  // A binary dictionary writes the array as `<P Name="UserMLArray2" Dimension="1*2">` over an
  // element of each class, as MATLAB writes it there, and its reader derives the array's class
  // from those (BinarySlddParser.arrayClassOf). It used to derive the first element's, so a paste
  // showed `<1x2 Simulink.Signal>`, as the text names it, and saved and reopened
  // `<1x2 MySubclasses.MySlSignal>`.
  it('pasted into a binary dictionary, shows what its save writes and a reopen reads', () => {
    const { entry: textEntry } = openText();
    const host = openBinary();
    const design = host.source.getSection('design');
    const config = host.source.getSection('config');
    const signals = { _array_class: 'Simulink.Signal', _dimensions: [1, 2], _elements: alias._elements[0]._properties.UserMLArray2._elements, _mw_element_type: 'MATLABArray' };
    const payloads: [string, any, any][] = [
      ['alias', textEntry('alias').serialize(), design],
      ['cs', textEntry('cs').serialize(), config],
      ['sigs', { ...textEntry('alias').serialize(), value: signals }, design],
    ];
    const pasted = payloads.map(([name, payload, section], k) => {
      const p = JSON.parse(JSON.stringify(payload));
      return section.parseEntry({ ...p, name: name + 'B', metadata: { ...p.metadata, uuid: 'd1b2c3d4-0000-4000-8000-00000000000' + k } });
    });
    const shownAs = (node: any) => JSON.stringify(rows(node)).split(node.name).join('#');
    const pastedRows = pasted.map(shownAs);
    const saved = host.saved();
    const again = openBinary(zipSync({ 'data/chunk0.xml': strToU8(saved), 'metadata/mwcoreProperties.xml': META }));
    expect(payloads.map(([name]) => shownAs(again.entry(name + 'B')))).toEqual(pastedRows);
    // The array shows the class the text names, each element its own, and is saved as MATLAB
    // writes it.
    const array = pasted[0].children.find((c: any) => c.name === 'UserMLArray2');
    expect([array.className, ...array.children.map((c: any) => c.className)]).toEqual(['Simulink.Signal', 'MySubclasses.MySlSignal', 'Simulink.Signal']);
    expect([pasted[2].className, pasted[2].displayValue]).toEqual(['Simulink.Signal', '<1x2 Simulink.Signal>']);
    // The pasted entry's, not the host's own alias, which the save keeps as its bytes.
    const aliasB = saved.indexOf('<P Name="Name" Class="char">aliasB</P>');
    expect(aliasB).toBeGreaterThanOrEqual(0);
    expect(classesIn(spanOf(saved.slice(aliasB), USER_ARRAY_OPEN))).toEqual(['MySubclasses.MySlSignal', 'Simulink.Signal']);
    expect(again.entry('csB').serial._rawVal._elements[0]._properties.Components._array_class).toBe('Simulink.ConfigComponent');
  });
});

/** Each row `node` shows, itself and every one under it. */
function rows(node: any): unknown[] {
  const out: unknown[] = [];
  const walk = (n: any, at: string) => {
    out.push([at, n.name, n.constructor.name, n.className, n.displayValue, n.dims, n.valueEditable]);
    (n.children || []).forEach((c: any, i: number) => walk(c, at + '/' + i));
  };
  walk(node, '');
  return out;
}

// An object value of one element is an object of that element's class. MATLAB's text format
// spells a mixed-class array with the class its elements share in `_array_class` and each
// element's own in its `_object_class`, and an array of one element can be spelled the same way:
// `{_array_class: 'Simulink.Signal', _elements: [{_object_class: 'mpt.Signal', …}]}` is one
// mpt.Signal. It opened, showed and was written to a binary dictionary as the array's class.
describe('a text dictionary\'s object value of one element of another class', () => {
  const SIGNAL = { DataType: 'auto', Description: 'sig', Dimensions: -1 };
  const one = (arrayClass: string, elementClass: string, props: Record<string, unknown>) => ({
    _array_class: arrayClass,
    _dimensions: [1, 1],
    _elements: [{ _object_class: elementClass, _properties: props }],
    _mw_element_type: 'MATLABArray',
  });
  const sub = one('Simulink.Signal', 'MySubclasses.MySlSignal', { ...SIGNAL, myDescription: 'sub' });
  const mpt = one('Simulink.Signal', 'mpt.Signal', SIGNAL);
  const param = one('Simulink.Parameter', 'mpt.Parameter', { DataType: 'auto', Description: 'p', Value: 5 });
  const configurations = one('Simulink.VariantConfigurationData', 'Simulink.VariantConfigurations', {});
  // The same as a property, holding no properties: written from its value as an element with
  // none (DataNode._objectXml), the arm that writes `<Element Class="…"/>`.
  const holder = {
    _array_class: 'MySubclasses.MyAliasType',
    _dimensions: [1, 1],
    _elements: [{ _properties: { BaseType: 'double', UserMLArray2: one('Simulink.Signal', 'MySubclasses.MySlSignal', {}) } }],
    _mw_element_type: 'MATLABArray',
  };
  const VALUES: Record<string, unknown> = { sub, mpt, param, configurations, holder };
  const textDictionary = () => {
    const json = JSON.parse(read('./fixtures/rt_text.sldd').toString('utf8'));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const metadata = entries[0].metadata;
    Object.entries(VALUES).forEach(([name, value], k) => {
      entries.push({ name, metadata: { ...metadata, namespace: NS_DESIGN, uuid: 'd1b2c3d4-0000-4000-8000-00000000000' + (k + 1) }, value });
    });
    return JSON.stringify(json, null, '\t');
  };
  const openText = () => {
    const session = createSession();
    const source: any = ingest(session, textDictionary(), { filename: 'one_text.sldd' });
    const saved = () => JSON.parse((session.serializeSource(source.name) as { text: string }).text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    return { entry: (name: string): any => source.flatten().find((n: any) => n.name === name), saved };
  };

  it('opens as a node of its element\'s class', () => {
    const { entry } = openText();
    expect([entry('sub').constructor.name, entry('sub').className, entry('sub').displayValue]).toEqual(['ObjectNode', 'MySubclasses.MySlSignal', '<1x1 MySubclasses.MySlSignal>']);
    expect([entry('mpt').constructor.name, entry('mpt').className]).toEqual(['SignalNode', 'mpt.Signal']);
    expect([entry('param').constructor.name, entry('param').className]).toEqual(['ParameterNode', 'mpt.Parameter']);
    expect([entry('configurations').constructor.name, entry('configurations').className]).toEqual(['VariantConfigurationDataNode', 'Simulink.VariantConfigurations']);
    const property = entry('holder').children.find((c: any) => c.name === 'UserMLArray2');
    expect([property.constructor.name, property.className]).toEqual(['ObjectNode', 'MySubclasses.MySlSignal']);
  });

  it('written to a binary dictionary, writes its element\'s class, not the array\'s', () => {
    const { entry } = openText();
    expect(classesIn(serializeEntryToXml(entry('sub')))).toEqual(['MySubclasses.MySlSignal']);
    expect(classesIn(serializeEntryToXml(entry('mpt')))).toEqual(['mpt.Signal']);
    expect(classesIn(serializeEntryToXml(entry('param')))).toEqual(['mpt.Parameter']);
    expect(classesIn(serializeEntryToXml(entry('configurations')))).toEqual(['Simulink.VariantConfigurations']);
    expect(serializeEntryToXml(entry('holder'))).toContain(
      pad(16) + '<P Name="UserMLArray2">\n' + pad(20) + '<Element Class="MySubclasses.MySlSignal"/>\n' + pad(16) + '</P>',
    );
  });

  it('written to a binary dictionary after an edit, writes its element\'s class', () => {
    const { entry } = openText();
    expect(entry('mpt').setProperty('Description', 'edited')).toBe(true);
    const mptXml = serializeEntryToXml(entry('mpt'));
    expect([classesIn(mptXml), mptXml.includes('<P Name="Description" Class="char">edited</P>')]).toEqual([['mpt.Signal'], true]);
    const row = entry('sub').children.find((c: any) => c.name === 'myDescription');
    expect(row, 'the myDescription row').toBeDefined();
    expect(row.setProperty('Value', "'edited'")).toBe(true);
    const subXml = serializeEntryToXml(entry('sub'));
    expect([classesIn(subXml), subXml.includes('<P Name="myDescription" Class="char">edited</P>')]).toEqual([['MySubclasses.MySlSignal'], true]);
  });

  it('keeps the file\'s spelling on an untouched save, in a copy, and in an edited save', () => {
    const { entry, saved } = openText();
    // Not the VariantConfigurations: its node writes a Value its element does not hold, whatever
    // the element's class.
    for (const [name, value] of Object.entries(VALUES).filter(([name]) => name !== 'configurations')) {
      expect(JSON.stringify(saved().find((e: any) => e.name === name).value), name).toBe(JSON.stringify(value));
      expect(JSON.stringify(entry(name).serialize().value), name).toBe(JSON.stringify(value));
    }
    expect(entry('mpt').setProperty('Description', 'edited')).toBe(true);
    const edited = saved().find((e: any) => e.name === 'mpt').value;
    expect([edited._array_class, edited._elements[0]._object_class, edited._elements[0]._properties.Description]).toEqual(['Simulink.Signal', 'mpt.Signal', 'edited']);
  });
});

// MATLAB writes a 1x1 object of a class of its own with an empty `_object_class` on its element:
// a corpus text dictionary's 1x1 My.MyClass entry is `{_array_class: 'My.MyClass', _elements:
// [{_id: '1', _object_class: '', _properties: {…}}], …}`. An empty `_object_class` names no
// class, so the value is of its array's class (DataNode.elementClassOf), and objectValueClassOf
// answers that for its node and its XML.
describe('a text dictionary\'s object value of one element whose _object_class is empty', () => {
  const value = {
    _array_class: 'My.MyClass',
    _elements: [{ _id: '1', _object_class: '', _properties: { Property1: 6 } }],
    _mw_element_type: 'MATLABArray',
    _num_columns: 1,
    _num_rows: 1,
  };
  const open = () => {
    const json = JSON.parse(read('./fixtures/rt_text.sldd').toString('utf8'));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    entries.push({ name: 'a', metadata: { ...entries[0].metadata, namespace: NS_DESIGN, uuid: 'e1b2c3d4-0000-4000-8000-000000000001' }, value });
    const source: any = ingest(createSession(), JSON.stringify(json, null, '\t'), { filename: 'empty_class_text.sldd' });
    return source.flatten().find((n: any) => n.name === 'a');
  };

  it('opens as its array\'s class, and is written to a binary dictionary as that class', () => {
    const a = open();
    expect([a.className, a.displayValue]).toEqual(['My.MyClass', '<1x1 My.MyClass>']);
    expect(classesIn(serializeEntryToXml(a))).toEqual(['My.MyClass']);
  });
});
