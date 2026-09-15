// Copyright 2026 The MathWorks, Inc.
// Generates test/fixtures/typeLink.sldd. Run: node test/fixtures/make-typeLink.mjs
//
// One dictionary holding every case the Data Type link rule has to answer, so a
// regression shows up as a changed cell rather than as a link that quietly stopped
// appearing. Every entry lands in Design Data (a chunk0-only dictionary), which is where
// type objects live.
//
// Hand-authoring these would be twenty-one 25-line _array_class/_elements/_properties
// nests; a typo in one of those keys fails as a MISSING entry, not as an error. Stated one
// line each here instead.
//
// Key names below are the ones the parsers actually read (the source of truth), which is
// not always the name MATLAB shows in the Property Inspector:
//   - a bus holds its elements under `Elements_internal`, as a MATLABArray wrapper
//     (`_array_class` + `_elements`), NOT under `Elements` — BaseBusNode._parseElements
//     reads that key and nothing else, so a bus written the other way parses to zero
//     elements without complaining;
//   - a bus element's type is `DataType_internal` (BusElementNode falls back to
//     `DataType`), matching what MATLAB writes and what arch_binary_as_text.sldd holds.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));

// Fixed uuids, derived from the index: a fixture regenerated with random ones would show a
// whole-file diff on every run and hide the change that mattered.
let n = 0;
const uuid = () => {
  n += 1;
  const h = String(n).padStart(12, '0');
  return `00000000-0000-4000-8000-${h}`;
};
const NAMESPACE = 'dacaf35e-55a5-454d-a7c1-93db038a210e';

const entry = (name, arrayClass, properties, elements) => ({
  name,
  metadata: {
    uuid: uuid(),
    namespace: NAMESPACE,
    lastmod: '20260914T000000.000000',
    modifiedby: 'make-typeLink',
    isderived: '0',
  },
  value: {
    _array_class: arrayClass,
    _dimensions: [1, 1],
    _elements: elements ?? [{ _id: String(n), _properties: properties }],
    _mw_element_type: 'MATLABArray',
  },
});

const alias = (name, baseType) =>
  entry(name, 'Simulink.AliasType', { BaseType: baseType, DataScope: 'Auto', Description: '', HeaderFile: '' });

const param = (name, dataType, value = 1) =>
  entry(name, 'Simulink.Parameter', { DataType: dataType, Value: value, Complexity: 'real', Description: '' });

const signal = (name, dataType) =>
  entry(name, 'Simulink.Signal', { DataType: dataType, Complexity: 'real', Description: '' });

const busElement = (name, dataType, id) => ({
  _id: String(id),
  _properties: { Name: name, DataType_internal: dataType, Complexity: 'real', Dimensions: 1, DimensionsMode: 'Fixed' },
});

// The MATLABArray wrapper a bus's elements arrive in — the shape
// BaseBusNode._parseElements walks.
const busElements = (...elements) => ({
  _array_class: 'Simulink.BusElement',
  _dimensions: [elements.length, 1],
  _elements: elements,
  _mw_element_type: 'MATLABArray',
});

const entries = [
  // --- the five type-defining classes: every one of these is a link TARGET ---
  alias('adtUint8', 'uint8'),
  // An alias OF an alias. Its Data Type column is filled by PropBaseType, not
  // PropDataType — the second prop feeding one column, and the drift Task 4 pins.
  alias('adtCounter', 'adtUint8'),
  entry('ntFix16', 'Simulink.NumericType', {
    DataTypeMode: 'Fixed-point: binary point scaling',
    Signedness: 'Signed',
    WordLength: 16,
    FractionLength: 3,
    Description: '',
  }),
  entry('avtEngSt', 'Simulink.data.dictionary.EnumTypeDefinition', {
    Description: '',
    HeaderFile: '',
    DefaultValue: 'OFF',
    StorageType: 'int32',
  }),
  entry('vtSpeed', 'Simulink.ValueType', {
    DataType: 'double',
    Dimensions: [1],
    Complexity: 'real',
    Description: '',
  }),
  // A bus, carrying an element named `elemOnlyType`. No TOP-LEVEL entry has that name, so
  // `ElemOnly` below must stay plain text: an element is not a definition.
  entry('artFsAimCmd', 'Simulink.Bus', { Description: '', HeaderFile: '' }, [
    {
      _id: '100',
      _properties: {
        Description: '',
        HeaderFile: '',
        Elements_internal: busElements(
          busElement('elemOnlyType', 'double', 101),
          busElement('speed', 'single', 102),
        ),
      },
    },
  ]),

  // --- a NON-type entry whose name another entry names as its type ---
  // pmScale is a Simulink.Parameter. `UsesParamName` must stay plain: class-gated, not
  // name-gated, because a Data Type cell reading `pmScale` does not mean that parameter.
  param('pmScale', 'double', 2),

  // --- cells that MUST link ---
  param('Kp', 'adtUint8'),
  param('Ki', 'adtUint8'), // a second row of the same value, so pooling is observable
  signal('BusSig', 'Bus: artFsAimCmd'),
  signal('EnumSig', 'Enum: avtEngSt'),
  signal('TightSig', 'Bus:artFsAimCmd'), // no space after the colon
  // An INVENTED qualifier. Nothing in the rule knows any qualifier by name, and this is
  // the case that fails if a list of known ones ever appears.
  signal('QuatSig', 'Quaternion: vtSpeed'),
  param('NumSig', 'ntFix16'),

  // --- cells that MUST stay plain text ---
  param('Gain', 'double'), // a built-in: simply not an entry
  param('Auto', 'auto'),
  param('Dangling', 'sint8'), // a non-built-in nothing here defines
  param('Fix', 'fixdt(1,16,3)'),
  param('ElemOnly', 'elemOnlyType'), // names a bus ELEMENT, not a definition
  param('UsesParamName', 'pmScale'), // names a Parameter, not a type
  // A Signal whose DataType property is present but empty. Note the CELL does not read
  // empty: SignalNode maps an absent-or-empty DataType to MATLABs default 'auto'
  // deliberately (a text sldd omits the key where a binary one writes "auto"), so what
  // this pins is that the rule is handed 'auto' here and links nothing.
  signal('EmptySig', ''),
];

const dictionary = {
  __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
  __MW_TEXT_PARTS__: {
    '__MW_TEXT_PART__/data/chunk0': { __MW_TEXT_content: { entries } },
  },
};

writeFileSync(here('typeLink.sldd'), JSON.stringify(dictionary, null, '\t') + '\n');
console.log(`wrote typeLink.sldd with ${entries.length} entries`);
