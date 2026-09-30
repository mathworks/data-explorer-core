// Copyright 2026 The MathWorks, Inc.
//
// What a newly added entry's property bag holds, pinned against MATLAB R2027a's OWN
// default-constructed object of the same class — measured by writing one of each into a text
// dictionary from MATLAB and reading the bytes back out, not inferred from documentation.
//
// This file exists because four of these bags were wrong in a way nothing could catch. MATLAB's
// `loadobj` fills an absent property from its own default rather than complaining, so a bag that
// is missing eleven properties (`Simulink.NumericType` seeded NOTHING) or carries the wrong empty
// (`Simulink.VariantControl` seeded the empty CHAR where MATLAB stores the empty DOUBLE) opens in
// MATLAB without a word. The divergence surfaces only as a diff against a MATLAB-authored
// dictionary holding the same class, or as a property the Property Inspector cannot write —
// `writeSourcePath` refuses rather than synthesizing a missing sub-object, so a Breakpoint or
// LookupTable with no `CoderInfo` displayed a Storage Class of 'Auto' that no edit could reach.
//
// The expected bags are spelled out as literals here on purpose, so the source cannot both define
// a default and verify it — the same reasoning `Simulink.LookupTable.md` gives for restating the
// storage-class list in its test.
//
// `Simulink.Parameter` is deliberately ABSENT. Its seed is also divergent — `Dimensions: -1`
// against MATLAB's `[0, 0]`, plus a `Value: 0` MATLAB does not write at all — but it is a measured
// open question, not a settled one (`Dimensions` is derived from the value in MATLAB and no
// artifact in the corpus pins what ours should become; see DESIGN.md). Pinning today's values here
// would encode that gap as intended behaviour.

import { describe, it, expect } from 'vitest';
import NumericTypeNode from '../src/datamodel/node/data/NumericTypeNode.js';
import BreakpointNode from '../src/datamodel/node/data/BreakpointNode.js';
import LookupTableNode from '../src/datamodel/node/data/LookupTableNode.js';
import VariantControlNode from '../src/datamodel/node/data/VariantControlNode.js';
import SignalNode from '../src/datamodel/node/data/SignalNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

// MATLAB's nested-object envelope as its text writer emits it, minus the `_id` it numbers each
// one with. We do not allocate an `_id` for a nested SCALAR object property and never have —
// `_nextElementId` exists for array ELEMENTS (a bus's) — and MATLAB reads the bag back either
// way, so the omission is house convention rather than a gap this file should pin against.
function coderInfo(parameterOrSignal: string) {
  return {
    _object_class: 'Simulink.CoderInfo',
    _properties: {
      CSCPackageName: 'Simulink',
      CustomAttributes: { _object_class: 'SimulinkCSC.AttribClass_Simulink_Default', _properties: {} },
      CustomStorageClass: 'Default',
      ParameterOrSignal: parameterOrSignal,
      StorageClass: 'Auto',
    },
  };
}

const STRUCT_TYPE_INFO = {
  _object_class: 'Simulink.lookuptable.StructTypeInfo',
  _properties: { DataScope: 'Auto', HeaderFileName: '', Name: '' },
};

describe('createDefault matches MATLAB R2027a property for property', () => {
  it('Simulink.NumericType seeds all eleven properties MATLAB writes', () => {
    // The three fixed-point keys are the STORAGE-side spellings MATLAB saves. Signedness,
    // FractionLength and Slope are derived accessors it never writes, and must not appear.
    expect(NumericTypeNode.createDefault('nt', null).serial._properties).toEqual({
      Bias: 0,
      DataScope: 'Auto',
      DataTypeMode: 'Double',
      DataTypeOverride: 'Inherit',
      Description: '',
      FixedExponent: 0,
      HeaderFile: '',
      IsAlias: false,
      SignednessBool: true,
      SlopeAdjustmentFactor: 1,
      WordLength: 64,
    });
  });

  it('Simulink.Breakpoint seeds three nested objects and the tunable-size flag', () => {
    expect(BreakpointNode.createDefault('bp', null).serial._properties).toEqual({
      Breakpoints: {
        _object_class: 'Simulink.lookuptable.Breakpoint',
        _properties: { DataType: 'auto', Description: '', Dimensions: [0, 0], FieldName: 'BP', TunableSizeName: 'N', TunableSizeValue: -1, Unit: '' },
      },
      CoderInfo: coderInfo('Parameter'),
      StructTypeInfo: STRUCT_TYPE_INFO,
      SupportTunableSize: false,
    });
  });

  it('Simulink.LookupTable numbers its breakpoint BP1/N1, not the Breakpoint class\'s BP/N', () => {
    // The two classes share `Simulink.lookuptable.Breakpoint` and differ in its VALUES: a table
    // has an axis per dimension, a standalone breakpoint set has one. Getting this wrong would
    // give every new lookup table a field name MATLAB reserves for the other class.
    expect(LookupTableNode.createDefault('lut', null).serial._properties).toEqual({
      AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes: false,
      Breakpoints: {
        _object_class: 'Simulink.lookuptable.Breakpoint',
        _properties: { DataType: 'auto', Description: '', Dimensions: [0, 0], FieldName: 'BP1', TunableSizeName: 'N1', TunableSizeValue: -1, Unit: '' },
      },
      CoderInfo: coderInfo('Parameter'),
      StructTypeInfo: STRUCT_TYPE_INFO,
      SupportTunableSize: false,
      Table: {
        _object_class: 'Simulink.lookuptable.Table',
        _properties: { DataType: 'auto', Description: '', Dimensions: [0, 0], FieldName: 'Table', Unit: '' },
      },
    });
  });

  it('Simulink.VariantControl seeds the empty DOUBLE and a Numeric ValueType', () => {
    expect(VariantControlNode.createDefault('vc', null).serial._properties).toEqual({ Value: [], ValueType: 'Numeric' });
  });

  it('Simulink.Signal seeds exactly two nested objects and nothing else', () => {
    // No Dimensions, no Complexity, no DataType — MATLAB writes neither, and this was the one
    // class of the six already correct. Pinned so it stays that way.
    expect(SignalNode.createDefault('s', null).serial._properties).toEqual({
      CoderInfo: coderInfo('Signal'),
      LoggingInfo: { _object_class: 'Simulink.LoggingInfo', _properties: {} },
    });
  });
});

describe('the shared CoderInfo helper', () => {
  it('hands every caller its OWN bag, so a Storage Class set on one entry does not move another', () => {
    // A module-level constant would be the obvious way to state this literal once, and it would
    // alias: `_defaultRawVal` owns the bag it is given by reference, which is how an edit reaches
    // the saved bytes. Two new entries sharing one CoderInfo would share one storage class.
    const a = BreakpointNode.createDefault('a', null);
    const b = BreakpointNode.createDefault('b', null);
    const aCoder = (a.serial._properties as Record<string, any>).CoderInfo;
    const bCoder = (b.serial._properties as Record<string, any>).CoderInfo;
    expect(aCoder).not.toBe(bCoder);
    aCoder._properties.StorageClass = 'ExportedGlobal';
    expect(bCoder._properties.StorageClass).toBe('Auto');
  });
});
