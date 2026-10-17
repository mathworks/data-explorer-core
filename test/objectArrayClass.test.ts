// Copyright 2026 The MathWorks, Inc.
//
// The one rule both readers that hold no class for a mixed object array name it by
// (src/datamodel/parser/objectArrayClass.ts): a binary dictionary (BinarySlddParser) and a .mat
// or a model workspace's MCOS blob (McosParser). The rule was the binary reader's own, private
// to it, so the MCOS reader named every such array after its first element. These are the binary
// reader's assertions (objectArrayElementClass.test.ts) asked of the rule itself; the readers'
// tests ask each reader.
import { describe, it, expect } from 'vitest';
import { arrayClassOf, componentsBaseOf, heterogeneousBaseOf } from '../src/datamodel/parser/objectArrayClass.js';

// Every class MATLAB's text format lists under a Simulink.ConfigComponent array.
const COMPONENTS = [
  'Simulink.SolverCC', 'Simulink.DataIOCC', 'Simulink.OptimizationCC', 'Simulink.DebuggingCC', 'Simulink.HardwareCC',
  'Simulink.ModelReferenceCC', 'Simulink.SFSimCC', 'Simulink.RTWCC', 'Simulink.CodeAppCC', 'Simulink.GRTTargetCC',
  'Simulink.ERTTargetCC', 'Simulink.STFCustomTargetCC', 'SlCovCC.ConfigComp', 'Sldv.ConfigComp', 'hdlcoderui.hdlcc',
];

describe('arrayClassOf: the class of an object array, from its elements\' classes', () => {
  it('is the class every element shares', () => {
    expect(arrayClassOf(['Simulink.Signal', 'Simulink.Signal'])).toBe('Simulink.Signal');
    expect(arrayClassOf(['My.A', 'My.A', 'My.A'])).toBe('My.A');
    // One class alone, and a config component alone, are the class they are.
    expect(arrayClassOf(['Simulink.SolverCC'])).toBe('Simulink.SolverCC');
    expect(arrayClassOf(['Simulink.SolverCC', 'Simulink.SolverCC'])).toBe('Simulink.SolverCC');
  });

  it('is Simulink.ConfigComponent for a mix of the config components MATLAB lists under one', () => {
    expect(arrayClassOf(COMPONENTS)).toBe('Simulink.ConfigComponent');
    expect(arrayClassOf(['Simulink.CodeAppCC', 'Simulink.GRTTargetCC'])).toBe('Simulink.ConfigComponent');
    expect(arrayClassOf(['Simulink.CodeAppCC', 'Simulink.ERTTargetCC'])).toBe('Simulink.ConfigComponent');
    expect(arrayClassOf(['Simulink.ConfigComponent', 'Simulink.SolverCC'])).toBe('Simulink.ConfigComponent');
  });

  it('is the one MathWorks class beside classes that are not MathWorks\', wherever it stands', () => {
    expect(arrayClassOf(['dexdata.DerivedSignal', 'Simulink.Signal'])).toBe('Simulink.Signal');
    expect(arrayClassOf(['Simulink.Signal', 'dexdata.DerivedSignal'])).toBe('Simulink.Signal');
    expect(arrayClassOf(['My.A', 'mpt.Signal', 'My.B'])).toBe('mpt.Signal');
    // A package of no known MathWorks class counts as a user's, MathWorks' or not.
    expect(arrayClassOf(['CoderTarget.SettingsController', 'Simulink.SolverCC'])).toBe('Simulink.SolverCC');
    // The package is the text before the first dot: a name that only begins with one is not in it.
    expect(arrayClassOf(['SimulinkX.A', 'Simulink.Signal'])).toBe('Simulink.Signal');
    expect(arrayClassOf(['SimulinkX.A', 'My.B'])).toBe('SimulinkX.A');
  });

  it('is the first element\'s class where no base can be derived', () => {
    // Two MathWorks classes beside a user's.
    expect(arrayClassOf(['MySubclasses.MySlSignal', 'Simulink.Signal', 'Simulink.Parameter'])).toBe('MySubclasses.MySlSignal');
    // Two MathWorks classes alone, neither a listed config component.
    expect(arrayClassOf(['Simulink.BusElement', 'Simulink.Bus'])).toBe('Simulink.BusElement');
    // No MathWorks class at all.
    expect(arrayClassOf(['My.A', 'My.B'])).toBe('My.A');
    expect(arrayClassOf(['simmechanics.A', 'simmechanics.B'])).toBe('simmechanics.A');
    // A class with no package is a user's.
    expect(arrayClassOf(['BusElement', 'My.B'])).toBe('BusElement');
  });
});

describe('heterogeneousBaseOf: the base a mix names, or none', () => {
  it('names Simulink.ConfigComponent, the one MathWorks class, or nothing', () => {
    expect(heterogeneousBaseOf(['Simulink.SolverCC', 'hdlcoderui.hdlcc'])).toBe('Simulink.ConfigComponent');
    expect(heterogeneousBaseOf(['BusElement', 'Simulink.Bus'])).toBe('Simulink.Bus');
    expect(heterogeneousBaseOf(['My.A', 'My.B'])).toBeUndefined();
    expect(heterogeneousBaseOf(['Simulink.Signal', 'Simulink.Parameter', 'My.A'])).toBeUndefined();
  });
});

describe('componentsBaseOf: the class a property\'s place names for an object array there', () => {
  it('is Simulink.ConfigComponent for a config set\'s Components and an RTWCC\'s, and nothing else', () => {
    expect(componentsBaseOf('Simulink.ConfigSet', 'Components')).toBe('Simulink.ConfigComponent');
    expect(componentsBaseOf('Simulink.RTWCC', 'Components')).toBe('Simulink.ConfigComponent');
    expect(componentsBaseOf('My.Holder', 'Components')).toBeUndefined();
    expect(componentsBaseOf('Simulink.SolverCC', 'Components')).toBeUndefined();
    expect(componentsBaseOf('Simulink.ConfigSet', 'Elements')).toBeUndefined();
    expect(componentsBaseOf('Simulink.ConfigSet', undefined)).toBeUndefined();
    expect(componentsBaseOf(undefined, 'Components')).toBeUndefined();
  });
});
