// Copyright 2026 The MathWorks, Inc.
//
// Unit tests for VariantControlNode — the Simulink.VariantControl class that
// wraps a single Value property behind strict integer/logical/empty validation
// mirroring MATLAB's reject messages verbatim. The fidelity suite
// (parity/fidelity/variant.fidelity.test.ts) covers the round-trip and MATLAB
// parity paths; this suite pins the data-model identity, property inspector
// layout, and serialization contract.

import { describe, it, expect } from 'vitest';
import VariantControlNode from '../src/datamodel/node/data/VariantControlNode.js';
import '../src/datamodel/node/NodeClassMap.js';

function wrap(props: Record<string, unknown> = {}) {
  return {
    _array_class: 'Simulink.VariantControl',
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: props }],
  };
}

describe('VariantControlNode identity', () => {
  it('reports the correct icon, className, and property list', () => {
    // The icon distinguishes a VariantControl from other variant types in the
    // tree; the property list drives which columns the table renders.
    const vc = VariantControlNode.createDefault('vc', null);
    expect(vc.icon).toBe('twoConnected_wsDefault');
    expect(vc.className).toBe('Simulink.VariantControl');
    expect(vc.getProperties().map((p) => p.key)).toEqual(['Name', 'Value', 'DataType']);
  });
});

describe('VariantControlNode displayValue', () => {
  it('formats an integer Value as a bare number', () => {
    const vc = VariantControlNode.parse(wrap({ Value: 42 }), 'vc', null);
    expect(vc.displayValue).toBe('42');
  });

  it('formats an empty string Value with MATLAB quotes', () => {
    const vc = VariantControlNode.createDefault('vc', null);
    expect(vc.displayValue).toBe("''");
  });

  it('formats null as the empty-matrix display', () => {
    const vc = VariantControlNode.parse(wrap({ Value: null }), 'vc', null);
    expect(vc.displayValue).toBe('[ ]');
  });

  it('formats a boolean Value as true/false', () => {
    const vc = VariantControlNode.parse(wrap({ Value: true }), 'vc', null);
    expect(vc.displayValue).toBe('true');
  });
});

describe('VariantControlNode serialization', () => {
  it('writes an edited Value back through the array wrapper', () => {
    // Without _getSerializedProperties writing Value back, an edit entered in
    // the value cell would be silently dropped on save.
    const vc = VariantControlNode.parse(wrap({ Value: '' }), 'vc', null);
    vc.setProperty('Value', '7');
    expect(vc.serializeValue()).toEqual(wrap({ Value: 7 }));
  });

  it('round-trips through _getSerializedProperties', () => {
    const vc = VariantControlNode.parse(wrap({ Value: 5 }), 'vc', null);
    const sp = (vc as any)._getSerializedProperties();
    expect(sp.Value).toBe(5);
  });
});

describe('VariantControlNode.setProperty delegation', () => {
  it('delegates non-Value properties to the DataNode base class', () => {
    // A rename or other property edit must still work; without the delegation
    // guard, every property edit would be treated as a Value edit and rejected.
    const vc = VariantControlNode.createDefault('vc', null);
    expect(vc.setProperty('Name', 'newName')).toBe(true);
    expect(vc.name).toBe('newName');
  });
});

describe('VariantControlNode.setProperty — Value edge cases', () => {
  it('rejects a very large exponent that overflows to Infinity', () => {
    // Number('1e309') is Infinity — MATLAB's integer constraint rejects it.
    const vc = VariantControlNode.createDefault('vc', null);
    const result = vc.setProperty('Value', '1e309') as any;
    expect(result.error).toBe(true);
    expect(result.reason).toContain('must be an integer');
  });

  it('accepts the quoted-empty-string form', () => {
    const vc = VariantControlNode.createDefault('vc', null);
    expect(vc.setProperty('Value', "''" )).toBe(true);
    expect(vc.Value).toBe('');
  });

  it('rejects NaN with the integer message', () => {
    const vc = VariantControlNode.createDefault('vc', null);
    const result = vc.setProperty('Value', 'NaN') as any;
    expect(result.error).toBe(true);
    expect(result.reason).toContain('must be an integer');
  });

  it('rejects "Infinity" (JS spelling) with the integer message', () => {
    const vc = VariantControlNode.createDefault('vc', null);
    const result = vc.setProperty('Value', 'Infinity') as any;
    expect(result.error).toBe(true);
    expect(result.reason).toContain('must be an integer');
  });
});

describe('VariantControlNode static helpers', () => {
  it('createDefault produces a valid node with empty Value', () => {
    const vc = VariantControlNode.createDefault('vc', null);
    expect(vc.Value).toBe('');
    expect(vc.serializeValue()).toMatchObject({ _array_class: 'Simulink.VariantControl' });
  });

  it('defaultName is VariantControl', () => {
    expect(VariantControlNode.defaultName).toBe('VariantControl');
  });

  it('parse with no _elements still constructs with empty Value', () => {
    // Defensive: a truncated .sldd should not crash the whole file's view.
    const vc = VariantControlNode.parse({}, 'vc', null);
    expect(vc.Value).toBe('');
  });
});
