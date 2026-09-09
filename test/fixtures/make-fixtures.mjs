// Copyright 2026 The MathWorks, Inc.
// Generates minimal binary fixtures for tests. Run: node test/fixtures/make-fixtures.mjs
//
// Key names below are derived from the real parsers (the source of truth):
//   - SlxParser.extractModelReferences reads ref.BlockPath + ref.ModelName
//     under GraphicalInterface.ModelReferences.
//   - SlxParser.extractExternalDataSources looks for <ExplicitExternalBrokerSources>
//     elements and reads their <fullPathToSource> child.
//   - SlxParser reads BlockDiagram.DataDictionary for the linked dictionary.
//   - BinarySlddParser reads <P Name="..."> properties inside <Object Class="DD.ENTRY">.
import { zipSync, strToU8 } from 'fflate';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));

// --- model_with_refs.slx: references plant.slx + a dictionary + a .mat ---
const slxParts = {
  'simulink/blockDiagram.json': strToU8(
    JSON.stringify({ BlockDiagram: { DataDictionary: 'params.sldd', ModelUUID: 'uuid-1' } }),
  ),
  'simulink/graphicalInterface.json': strToU8(
    JSON.stringify({
      ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant.slx' }],
    }),
  ),
  'simulink/ExternalDataSourceSettings.xml': strToU8(
    `<?xml version="1.0"?><ExternalDataSourceSettings><ExplicitExternalBrokerSources><fullPathToSource>signals.mat</fullPathToSource></ExplicitExternalBrokerSources></ExternalDataSourceSettings>`,
  ),
  'metadata/coreProperties.xml': strToU8(
    `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
  ),
};
writeFileSync(here('model_with_refs.slx'), zipSync(slxParts));

// --- compressed.sldd: a ZIP SLDD with one entry, zero references ---
const slddXml =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<DataSource FormatVersion="4" MinRelease="R2026b" Arch="glnxa64">` +
  `<Object Class="DD.ENTRY"><P Name="Name">Kp</P></Object>` +
  `</DataSource>`;
const slddParts = {
  'data/chunk0.xml': strToU8(slddXml),
  'metadata/mwcoreProperties.xml': strToU8(`<x><matlabRelease>R2026b</matlabRelease></x>`),
};
writeFileSync(here('compressed.sldd'), zipSync(slddParts));

// --- object_array_binary.sldd: a binary (zip) SLDD holding two OBJECT ARRAYS ---
// so the binary parser's multi-<Element> object path is exercised end-to-end:
//   paramArray : 3x1 Simulink.Parameter (a KNOWN class → each element a typed
//                ParameterNode) in Design Data
//   usageArray : 2x1 Simulink.VariableUsage (a CUSTOM class → each element a
//                generic ObjectNode) in Other Data
// The shape mirrors object_props_binary.sldd: a <P Name="Value"> with a
// Dimension attribute and one <Element Class="..."> per array element.
const entry = (name, ns, valueXml) =>
  `<Object Class="DD.ENTRY">` +
  `<P Name="Name" Class="char">${name}</P>` +
  `<P Name="Namespace" Class="char">${ns}</P>` +
  `<P Name="IsDerived" Class="char">0</P>` +
  `<P Name="Value" Dimension="${valueXml.dim}">${valueXml.elements}</P>` +
  `</Object>`;
const NS_DESIGN = 'dacaf35e-55a5-454d-a7c1-93db038a210e';
const NS_OTHER = '42516768-0ace-4981-8ac7-0a9b32cba471';
const paramElem = (v, desc) =>
  `<Element Class="Simulink.Parameter">` +
  `<P Name="Value" Class="int32">${v}</P>` +
  `<P Name="Description" Class="char">${desc}</P>` +
  `</Element>`;
const usageElem = (n) =>
  `<Element Class="Simulink.VariableUsage">` +
  `<P Name="Name" Class="char">${n}</P>` +
  `<P Name="Source" Class="char">f14</P>` +
  `<P Name="SourceType" Class="char">model workspace</P>` +
  `</Element>`;
const objArrXml =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">` +
  entry('paramArray', NS_DESIGN, {
    dim: '3*1',
    elements: paramElem(10, 'first') + paramElem(20, 'second') + paramElem(30, 'third'),
  }) +
  entry('usageArray', NS_OTHER, {
    dim: '2*1',
    elements: usageElem('Ka') + usageElem('Kf'),
  }) +
  `</DataSource>`;
writeFileSync(
  here('object_array_binary.sldd'),
  zipSync({
    'data/chunk0.xml': strToU8(objArrXml),
    'metadata/mwcoreProperties.xml': strToU8(`<x><matlabRelease>R2027a</matlabRelease></x>`),
  }),
);

// --- arch_binary.sldd + arch_binary_as_text.sldd: ONE architectural dictionary,
// written in both dictionary formats, so the System Composer catalog reader can be
// held to the same answer whichever format it read.
//
// Shapes are copied from real MATLAB output (a customer System Composer interface
// dictionary); only the names are invented. The parts that matter:
//   - the catalog lists a definition by NAME and by System Composer TYPE, and the
//     type is what says `Simulink.Bus` StructType from `Simulink.Bus` interface;
//   - `DataInterface` holds a bus element NAMED after the value type it uses
//     (`ValueType`), which is how System Composer writes a bus of value types — a
//     third occurrence of that name that is not a definition of anything;
//   - the TypeCatalog also lists MATLAB's built-in types (`double`), which are not
//     dictionary entries either.
const NS_ARCH = 'dacaf35e-55a5-454d-a7c1-93db038a210e';
const U = {
  unit: '398f5b73-d3b9-43cb-a2a8-99ec65c79483',
  model: '127f28ec-e357-4fa3-8a7e-52f7437bff42',
  typeCat: 'fee70a44-2c9c-4c19-acfb-329cd36f6fc7',
  ifaceCat: '144e27c1-b244-4360-ba96-0cb8df225695',
  valueType: '46cb9da0-fc40-4566-a6a7-cc5d6d953c46',
  valueTypeDesc: '82927978-4c91-4892-80d8-c2370f926b6d',
  dataIface: '61e42015-fa86-4b2f-bd2f-04350e68a7b0',
  dataElem: 'a4c32884-42b1-408e-bc27-e55141143e37',
  structType: 'beac7d1c-c596-438c-af7a-d94d268e9b11',
  structElem: '37453b4c-60be-4a11-a657-ccd189cc5e4a',
  structElemDesc: '6bc4a743-cd34-4ed6-b5e5-b510ba531389',
  numericType: 'ac8c1b34-e43d-4eef-b1e0-56fd8ef78928',
  builtInDouble: '44f10ce9-bfc8-414b-b9dd-c5ba0f83352d',
  modelId: '5ef7b605-9341-4c8a-a85f-6a125a1daf7e',
  proxyTarget: '86f959b6-8ae7-4ade-964d-f9b09dd5fd69',
};
const SC_TYPE = {
  valueTypeIface: 'systemcomposer.architecture.model.interface.ValueTypeInterface',
  compositeData: 'systemcomposer.architecture.model.interface.CompositeDataInterface',
  dataElement: 'systemcomposer.architecture.model.interface.DataElement',
  descriptor: 'systemcomposer.property.ValueTypeDescriptor',
  structDataType: 'systemcomposer.property.StructDataType',
  structElement: 'systemcomposer.property.StructElement',
  numericType: 'systemcomposer.property.NumericType',
  proxyTarget: 'systemcomposer.services.proxy.ProxyTarget',
  unitChecker: 'systemcomposer.property.UnitQueryClientWrapper',
};
const archEntryNames = ['StructType', 'DataInterface', 'ValueType', 'NumericType'];
const archEntryUuid = {
  StructType: '35295363-c32f-46ee-be90-558c6ac74ee0',
  DataInterface: '287f5dd2-a9f4-4992-a068-ef8cc14ce0e3',
  ValueType: 'eff4f621-407e-4a3c-9cba-54bf03d1e5fb',
  NumericType: '630fe342-234d-4a0e-aee2-7589ceeb1d8e',
};
const archEntryClass = {
  StructType: 'Simulink.Bus',
  DataInterface: 'Simulink.Bus',
  ValueType: 'Simulink.ValueType',
  NumericType: 'Simulink.NumericType',
};

const scXml =
  `<?xml version="1.0"?>\n` +
  `<MF0 packageUris="http://schema.mathworks.com/mf0/systemcomposer_architecture_model/3.21 http://schema.mathworks.com/mf0/systemcomposer_property/2.12 http://schema.mathworks.com/mf0/systemcomposer_services_proxy/1.2">\n` +
  `  <${SC_TYPE.unitChecker} type="${SC_TYPE.unitChecker}" uuid="${U.unit}"/>\n` +
  `  <systemcomposer.architecture.model.SystemComposerModel type="systemcomposer.architecture.model.SystemComposerModel" uuid="${U.model}">\n` +
  `    <p_TypeCatalog type="systemcomposer.property.TypeCatalog" uuid="${U.typeCat}"/>\n` +
  `    <p_Name>arch</p_Name>\n` +
  `    <p_PortInterfaceCatalog type="systemcomposer.architecture.model.interface.InterfaceCatalog" uuid="${U.ifaceCat}">\n` +
  `      <p_Interfaces type="${SC_TYPE.valueTypeIface}" uuid="${U.valueType}">\n` +
  `        <p_UnitChecker type="${SC_TYPE.unitChecker}" uuid="${U.unit}"/>\n` +
  `        <p_Name>ValueType</p_Name>\n` +
  `        <p_ValueType type="${SC_TYPE.descriptor}" uuid="${U.valueTypeDesc}">\n` +
  `          <p_Name>ValueType</p_Name>\n` +
  `        </p_ValueType>\n` +
  `        <elemProxy type="${SC_TYPE.proxyTarget}" uuid="${U.proxyTarget}"/>\n` +
  `      </p_Interfaces>\n` +
  `      <p_Interfaces type="${SC_TYPE.compositeData}" uuid="${U.dataIface}">\n` +
  `        <p_DataElements type="${SC_TYPE.dataElement}" uuid="${U.dataElem}">\n` +
  `          <p_Index>1</p_Index>\n` +
  `          <p_Name>ValueType</p_Name>\n` +
  `        </p_DataElements>\n` +
  `        <p_UnitChecker type="${SC_TYPE.unitChecker}" uuid="${U.unit}"/>\n` +
  `        <p_Name>DataInterface</p_Name>\n` +
  `      </p_Interfaces>\n` +
  `    </p_PortInterfaceCatalog>\n` +
  `  </systemcomposer.architecture.model.SystemComposerModel>\n` +
  `  <systemcomposer.property.TypeCatalog type="systemcomposer.property.TypeCatalog" uuid="${U.typeCat}">\n` +
  `    <p_BuiltInValueTypes type="${SC_TYPE.descriptor}" uuid="${U.builtInDouble}">\n` +
  `      <p_Name>double</p_Name>\n` +
  `    </p_BuiltInValueTypes>\n` +
  `    <p_ModeledDataTypes type="${SC_TYPE.structDataType}" uuid="${U.structType}">\n` +
  `      <p_StructElements type="${SC_TYPE.structElement}" uuid="${U.structElem}">\n` +
  `        <p_Index>1</p_Index>\n` +
  `        <p_Name>Element</p_Name>\n` +
  `        <p_Descriptor type="${SC_TYPE.descriptor}" uuid="${U.structElemDesc}"/>\n` +
  `      </p_StructElements>\n` +
  `      <p_Name>StructType</p_Name>\n` +
  `    </p_ModeledDataTypes>\n` +
  `    <p_ModeledDataTypes type="${SC_TYPE.numericType}" uuid="${U.numericType}">\n` +
  `      <p_Name>NumericType</p_Name>\n` +
  `    </p_ModeledDataTypes>\n` +
  `  </systemcomposer.property.TypeCatalog>\n` +
  `  <systemcomposer.services.proxy.ModelIdentifier type="systemcomposer.services.proxy.ModelIdentifier" uuid="${U.modelId}">\n` +
  `    <URI>arch</URI>\n` +
  `    <modelType>DICTIONARY_MODEL</modelType>\n` +
  `  </systemcomposer.services.proxy.ModelIdentifier>\n` +
  `</MF0>\n`;

// The four entries as the compressed-binary reader sees them: DD.ENTRY objects
// whose Value is one <Element Class="..."> per MATLAB object.
const busElemXml = (name, dataType) =>
  `<Element Class="Simulink.BusElement">` +
  `<P Name="DimensionsMode" Class="char">Fixed</P>` +
  `<P Name="Name" Class="char">${name}</P>` +
  (dataType ? `<P Name="DataType_internal" Class="char">${dataType}</P>` : '') +
  `<P Name="Complexity" Class="char">real</P>` +
  `<P Name="Dimensions" Class="double">1.0</P>` +
  `</Element>`;
const archValueXml = {
  StructType:
    `<Element Class="Simulink.Bus">` +
    `<P Name="Elements_internal">${busElemXml('Element')}</P>` +
    `<P Name="Description" Class="char"/>` +
    `<P Name="DataScope" Class="char">Auto</P>` +
    `</Element>`,
  // The element named after the value type it references, exactly as MATLAB writes it.
  DataInterface:
    `<Element Class="Simulink.Bus">` +
    `<P Name="Elements_internal">${busElemXml('ValueType', 'ValueType: ValueType')}</P>` +
    `<P Name="Description" Class="char"/>` +
    `<P Name="DataScope" Class="char">Auto</P>` +
    `</Element>`,
  ValueType: `<Element Class="Simulink.ValueType"><P Name="Description" Class="char"/></Element>`,
  NumericType:
    `<Element Class="Simulink.NumericType">` +
    `<P Name="DataTypeMode" Class="char">Double</P>` +
    `<P Name="IsAlias" Class="logical">0</P>` +
    `</Element>`,
};
const archChunkXml =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">\n` +
  archEntryNames
    .map(
      (name) =>
        `    <Object Class="DD.ENTRY">\n` +
        `        <P Name="Name" Class="char">${name}</P>\n` +
        `        <P Name="UUID" Class="char">${archEntryUuid[name]}</P>\n` +
        `        <P Name="Namespace" Class="char">${NS_ARCH}</P>\n` +
        `        <P Name="LastMod" Class="char">20260806T151506.676643</P>\n` +
        `        <P Name="LastModBy" Class="char">user</P>\n` +
        `        <P Name="IsDerived" Class="char">1</P>\n` +
        `        <P Name="Value">${archValueXml[name]}</P>\n` +
        `    </Object>\n`,
    )
    .join('') +
  `</DataSource>\n`;
writeFileSync(
  here('arch_binary.sldd'),
  zipSync({
    'data/chunk0.xml': strToU8(archChunkXml),
    'simulink/systemcomposer/interfaceDictionary.xml': strToU8(scXml),
    'metadata/mwcoreProperties.xml': strToU8(`<x><matlabRelease>R2027a</matlabRelease></x>`),
  }),
);

// The same dictionary as uncompressed text. Written from the same tables above, so
// the two fixtures cannot drift into describing different dictionaries.
const scObj = (type, uuid, content) => ({ content, type, uuid });
const archTextSldd = {
  __MW_TEXT_COREPROPERTIES__: { release: 'R2027a' },
  __MW_TEXT_PARTS__: {
    '__MW_TEXT_PART__/data/chunk0': {
      __MW_TEXT_content: {
        entries: archEntryNames.map((name) => ({
          name,
          metadata: {
            uuid: archEntryUuid[name],
            namespace: NS_ARCH,
            lastmod: '20260806T151506.676643',
            modifiedby: 'user',
            isderived: '1',
          },
          value: {
            _array_class: archEntryClass[name],
            _dimensions: [1, 1],
            _elements: [{ _id: '1', _properties: archTextProps(name) }],
            _mw_element_type: 'MATLABArray',
          },
        })),
        'Dictionary References': [],
        AllowAccessBWS: false,
      },
    },
    '__MW_TEXT_PART__/simulink/systemcomposer/interfaceDictionary': {
      __MW_TEXT_content: {
        entries: [
          scObj(SC_TYPE.unitChecker, U.unit, {}),
          scObj('systemcomposer.architecture.model.SystemComposerModel', U.model, {
            p_Name: 'arch',
            p_PortInterfaceCatalog: scObj(
              'systemcomposer.architecture.model.interface.InterfaceCatalog',
              U.ifaceCat,
              {
                p_Interfaces: [
                  scObj(SC_TYPE.valueTypeIface, U.valueType, {
                    p_Name: 'ValueType',
                    p_ValueType: scObj(SC_TYPE.descriptor, U.valueTypeDesc, { p_Name: 'ValueType' }),
                    elemProxy: scObj(SC_TYPE.proxyTarget, U.proxyTarget, {}),
                  }),
                  scObj(SC_TYPE.compositeData, U.dataIface, {
                    p_DataElements: [
                      scObj(SC_TYPE.dataElement, U.dataElem, { p_Index: '1', p_Name: 'ValueType' }),
                    ],
                    p_Name: 'DataInterface',
                  }),
                ],
              },
            ),
          }),
          scObj('systemcomposer.property.TypeCatalog', U.typeCat, {
            p_BuiltInValueTypes: [scObj(SC_TYPE.descriptor, U.builtInDouble, { p_Name: 'double' })],
            p_ModeledDataTypes: [
              scObj(SC_TYPE.structDataType, U.structType, {
                p_Name: 'StructType',
                p_StructElements: [
                  scObj(SC_TYPE.structElement, U.structElem, {
                    p_Index: '1',
                    p_Name: 'Element',
                    p_Descriptor: scObj(SC_TYPE.descriptor, U.structElemDesc, {}),
                  }),
                ],
              }),
              scObj(SC_TYPE.numericType, U.numericType, { p_Name: 'NumericType' }),
            ],
          }),
        ],
      },
    },
  },
};
function archTextProps(name) {
  const busElem = (elemName, dataType) => ({
    _id: elemName,
    _properties: {
      Complexity: 'real',
      Dimensions: 1,
      DimensionsMode: 'Fixed',
      Name: elemName,
      ...(dataType ? { DataType_internal: dataType } : {}),
    },
  });
  if (name === 'StructType' || name === 'DataInterface') {
    const elem =
      name === 'StructType' ? busElem('Element') : busElem('ValueType', 'ValueType: ValueType');
    return {
      DataScope: 'Auto',
      Description: '',
      Elements_internal: {
        _array_class: 'Simulink.BusElement',
        _dimensions: [1, 1],
        _elements: [elem],
      },
    };
  }
  if (name === 'NumericType') {
    return { DataTypeMode: 'Double', IsAlias: false };
  }
  return { Description: '' };
}
writeFileSync(here('arch_binary_as_text.sldd'), JSON.stringify(archTextSldd, null, 1) + '\n');

console.log(
  'wrote model_with_refs.slx, compressed.sldd, object_array_binary.sldd, '
    + 'arch_binary.sldd, arch_binary_as_text.sldd',
);
