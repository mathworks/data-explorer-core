// Copyright 2026 The MathWorks, Inc.
// Unit tests for kindForClass — the model-free Class -> user-facing Kind
// resolution used by the webview drag/drop tooltip. Its contract is to mirror
// DataNode.kind / MatlabVariableNode.kind so the tooltip label matches the Kind
// column, so these tests pin the precedence rules that mirroring depends on.

import { describe, it, expect } from 'vitest';
import { kindForClass } from '../src/index.js';

describe('kindForClass — plain object classes', () => {
  it('maps a known Simulink class to its friendly Kind', () => {
    expect(kindForClass('Simulink.Bus')).toBe('Bus');
    expect(kindForClass('Simulink.Parameter')).toBe('Simulink Parameter');
    expect(kindForClass('Simulink.Signal')).toBe('Simulink Signal');
    expect(kindForClass('Simulink.ServiceBus')).toBe('Service Interface');
  });

  it('maps the fully-qualified enum type definition class', () => {
    expect(kindForClass('Simulink.data.dictionary.EnumTypeDefinition')).toBe('Enumerated Type');
  });

  it('falls back to the raw class name for an unmapped class', () => {
    expect(kindForClass('Some.Unmapped.Class')).toBe('Some.Unmapped.Class');
  });

  it('returns the empty string for an empty class name', () => {
    expect(kindForClass('')).toBe('');
  });
});

describe('kindForClass — derived (architectural) classes', () => {
  it('remaps the classes whose Kind differs in an architectural section', () => {
    expect(kindForClass('Simulink.Bus', { isDerived: true })).toBe('Data Interface');
    expect(kindForClass('Simulink.ConnectionBus', { isDerived: true })).toBe('Physical Interface');
  });

  it('leaves classes with the same Kind in both sections unchanged', () => {
    expect(kindForClass('Simulink.ServiceBus', { isDerived: true })).toBe('Service Interface');
    expect(kindForClass('Simulink.ValueType', { isDerived: true })).toBe('Value Type');
    expect(kindForClass('Simulink.NumericType', { isDerived: true })).toBe('Numeric Type');
  });

  it('does not apply the derived remap when isDerived is false', () => {
    expect(kindForClass('Simulink.Bus', { isDerived: false })).toBe('Bus');
  });
});

describe('kindForClass — classification precedence', () => {
  it('a classification outranks the class map', () => {
    // The same Simulink.Bus is a Data Interface or a Struct Type depending on
    // how the SystemComposer catalog models it.
    expect(kindForClass('Simulink.Bus', { classification: 'StructType' })).toBe('Struct Type');
    expect(kindForClass('Simulink.Bus', { classification: 'DataInterface' })).toBe('Data Interface');
  });

  it('a classification outranks the derived remap', () => {
    expect(kindForClass('Simulink.Bus', { isDerived: true, classification: 'StructType' }))
      .toBe('Struct Type');
  });

  it('falls back to the raw classification token when unmapped', () => {
    expect(kindForClass('Simulink.Bus', { classification: 'FutureKind' })).toBe('FutureKind');
  });

  it('maps every documented classification token', () => {
    const expected: Record<string, string> = {
      DataInterface: 'Data Interface',
      PhysicalInterface: 'Physical Interface',
      ServiceInterface: 'Service Interface',
      ValueType: 'Value Type',
      StructType: 'Struct Type',
      NumericType: 'Numeric Type',
      EnumType: 'Enumerated Type',
      AliasType: 'Alias Type',
    };
    for (const [token, kind] of Object.entries(expected)) {
      expect(kindForClass('Simulink.Bus', { classification: token })).toBe(kind);
    }
  });
});

describe('kindForClass — MATLAB variables', () => {
  it('reports a plain variable as MATLAB Variable regardless of its raw type', () => {
    expect(kindForClass('double', { isMatlabVariable: true })).toBe('MATLAB Variable');
    expect(kindForClass('int8', { isMatlabVariable: true })).toBe('MATLAB Variable');
    expect(kindForClass('struct', { isMatlabVariable: true })).toBe('MATLAB Variable');
  });

  it('reports a derived variable as Constant', () => {
    expect(kindForClass('double', { isMatlabVariable: true, isDerived: true })).toBe('Constant');
  });

  it('lets a classification outrank the variable Kind', () => {
    expect(kindForClass('struct', { isMatlabVariable: true, classification: 'StructType' }))
      .toBe('Struct Type');
  });

  it('does not route through the variable path when isMatlabVariable is false', () => {
    // 'double' is not an object class, so it falls through to the raw name.
    expect(kindForClass('double')).toBe('double');
  });
});
