// Copyright 2026 The MathWorks, Inc.
// Unit tests for the single-property leaf nodes: Simulink.VariantBank,
// VariantBankCoderInfo, VariantExpression, VariantVariable,
// VariantConfigurationData and CustomObject. Each wraps one MATLAB property
// (Value / Condition / Specification / Description) behind a different display
// atom, and each has to write that live field back through
// _serializeSimulinkObject or an edit is silently dropped on save. They are
// near-identical by design, so the shared contract is tested as a table and only
// the per-class differences get their own cases.

import { describe, it, expect } from 'vitest';
import '../src/datamodel/node/NodeClassMap.js';
import VariantBankNode from '../src/datamodel/node/data/VariantBankNode.js';
import VariantBankCoderInfoNode from '../src/datamodel/node/data/VariantBankCoderInfoNode.js';
import VariantExpressionNode from '../src/datamodel/node/data/VariantExpressionNode.js';
import VariantVariableNode from '../src/datamodel/node/data/VariantVariableNode.js';
import VariantConfigurationDataNode from '../src/datamodel/node/data/VariantConfigurationDataNode.js';
import CustomObjectNode from '../src/datamodel/node/data/CustomObjectNode.js';

// The MATLABArray wrapper a .sldd stores a scalar class instance in.
function wrap(className: string, props: Record<string, unknown> = {}) {
  return {
    _array_class: className,
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: props }],
  };
}

// className, node class, the one live property, and the icon it presents with.
const LEAVES = [
  { cls: 'Simulink.VariantBank', Node: VariantBankNode, prop: 'Value', icon: 'wsParameters_bank', kind: 'Variant Bank' },
  { cls: 'Simulink.VariantBankCoderInfo', Node: VariantBankCoderInfoNode, prop: 'Value', icon: 'wsParameters_bankCoderInfo', kind: 'Variant Bank Coder Info' },
  { cls: 'Simulink.VariantExpression', Node: VariantExpressionNode, prop: 'Condition', icon: 'wsVariant', kind: 'Variant Expression' },
  { cls: 'Simulink.VariantVariable', Node: VariantVariableNode, prop: 'Specification', icon: 'variant_wsParameters', kind: 'Variant Variable' },
  { cls: 'Simulink.VariantConfigurationData', Node: VariantConfigurationDataNode, prop: 'Value', icon: 'variantSettings', kind: 'Variant Configuration' },
  { cls: 'CustomObject', Node: CustomObjectNode, prop: 'Description', icon: 'object', kind: 'CustomObject' },
] as const;

describe('single-property leaf nodes — shared contract', () => {
  for (const { cls, Node, prop, icon, kind } of LEAVES) {
    describe(cls, () => {
      const parsed = (props: Record<string, unknown> = {}) => Node.parse(wrap(cls, props), 'n', null) as any;

      it('reports its class, kind and icon', () => {
        const n = parsed();
        expect(n.className).toBe(cls);
        expect(n.kind).toBe(kind);
        expect(n.icon).toBe(icon);
      });

      it('reads its one property off the parsed bag', () => {
        expect(parsed({ [prop]: 'x' })[prop]).toBe('x');
      });

      it('defaults the property to empty when the file omits it', () => {
        // The JSON .sldd format drops default-valued properties, so an absent key
        // is the normal case, not a corrupt file.
        expect(parsed()[prop]).toBe('');
      });

      it('writes an edit back through the array wrapper', () => {
        // _serializeSimulinkObject rebuilds _elements[0]._properties from the live
        // field; without it the loaded raw value is written and the edit vanishes.
        const n = parsed({ [prop]: 'old', Untouched: 7 });
        expect(n.setProperty(prop, 'new')).toBe(true);
        expect(n.serializeValue()).toEqual(wrap(cls, { [prop]: 'new', Untouched: 7 }));
      });

      it('createDefault produces a node that serializes to a valid wrapper', () => {
        const n = (Node as any).createDefault('n', null);
        expect((Node as any).defaultName).toBe(cls.replace('Simulink.', ''));
        expect(n.serializeValue()).toMatchObject({ _array_class: cls, _dimensions: [1, 1] });
      });

      it('emits its property as one <Element> in XML', () => {
        const xml = parsed({ [prop]: 'v' }).serializeXml('P', { Name: 'n' }, 0);
        expect(xml).toContain('<Element Class="' + cls + '">');
        expect(xml).toContain('<P Name="' + prop + '" Class="char">v</P>');
      });
    });
  }
});

describe('per-class display differences', () => {
  it('VariantBank and VariantBankCoderInfo quote their Value like MATLAB', () => {
    for (const Node of [VariantBankNode, VariantBankCoderInfoNode]) {
      const n = Node.parse(wrap('Simulink.VariantBank', { Value: 'b1' }), 'n', null) as any;
      expect(n.displayValue).toBe("'b1'");
    }
  });

  it('VariantExpression shows its Condition and VariantVariable its Specification', () => {
    expect(
      (VariantExpressionNode.parse(wrap('Simulink.VariantExpression', { Condition: 'a == 1' }), 'n', null) as any).displayValue,
    ).toBe("'a == 1'");
    expect(
      (VariantVariableNode.parse(wrap('Simulink.VariantVariable', { Specification: 'v' }), 'n', null) as any).displayValue,
    ).toBe("'v'");
  });

  it('a VariantConfiguration has no scalar value at all', () => {
    // It is a container of configurations, so the Value cell stays blank and must
    // not offer an editor that would write a meaningless scalar.
    const n = VariantConfigurationDataNode.parse(wrap('Simulink.VariantConfigurationData', { Value: 'ignored' }), 'n', null) as any;
    expect(n.displayValue).toBe('');
    expect(n.valueEditable).toBe(false);
    expect(n.getProperties().map((p: any) => p.key)).toEqual(['Name', 'DataType']);
  });

  it('a VariantConfiguration reports whichever class spelling the file used', () => {
    // A .sldd may store either name; the node must not relabel one as the other.
    const n = VariantConfigurationDataNode.parse(wrap('Simulink.VariantConfigurations'), 'n', null) as any;
    expect(n.className).toBe('Simulink.VariantConfigurations');
    // Both spellings must still resolve a Property Inspector (see the schema alias).
    expect(n.toPIObject()).not.toBeNull();
  });

  it('a VariantConfiguration with no parsed value falls back to its data class', () => {
    const n = VariantConfigurationDataNode.createDefault('n', null) as any;
    expect(n.className).toBe('Simulink.VariantConfigurationData');
  });

  it('CustomObject shows its dimensions rather than a value', () => {
    // It models an unknown user class, so there is no property worth printing.
    const n = CustomObjectNode.parse(wrap('CustomObject', { Description: 'd' }), 'n', null) as any;
    expect(n.displayValue).toBe('<1x1 CustomObject>');
  });

  it('CustomObject omits Description entirely until one is set', () => {
    // Writing an empty Description into a file that never had one would be a
    // spurious diff on save.
    const n = CustomObjectNode.parse(wrap('CustomObject'), 'n', null) as any;
    expect(n._getSerializedProperties()).toEqual({});
    expect(n.setProperty('Description', 'hi')).toBe(true);
    expect(n._getSerializedProperties()).toEqual({ Description: 'hi' });
  });

  it('CustomObject keeps an explicitly empty Description that was in the file', () => {
    const n = CustomObjectNode.parse(wrap('CustomObject', { Description: '' }), 'n', null) as any;
    expect(n._getSerializedProperties()).toEqual({ Description: '' });
  });
});

describe('REGRESSION: a quoted display round-trips through an edit', () => {
  // These leaves store RAW text but display it as a quoted MATLAB literal, and the
  // table seeds its in-place editor with the displayed text — so an edit arrives
  // quoted. Storing it verbatim made the quotes part of the value and the next
  // edit wrapped them again ('a == 1' → ''a == 1'' → …), until the saved .sldd
  // held a condition MATLAB could no longer evaluate. Note the edit is committed
  // in the 'Value' COLUMN, which is how the table addresses these props.
  const QUOTED = [
    { cls: 'Simulink.VariantExpression', Node: VariantExpressionNode, prop: 'Condition', raw: "strcmp(mode,'fast')" },
    { cls: 'Simulink.VariantVariable', Node: VariantVariableNode, prop: 'Specification', raw: "p('x')" },
    { cls: 'Simulink.VariantBank', Node: VariantBankNode, prop: 'Value', raw: "bank'1" },
  ] as const;

  for (const { cls, Node, prop, raw } of QUOTED) {
    it(cls + ' keeps its ' + prop + ' unquoted after committing the displayed text', () => {
      const n = Node.parse(wrap(cls, { [prop]: raw }), 'n', null) as any;
      const shown = n.displayValue;
      // A quote in the value displays doubled, so the shown text is a real literal.
      expect(shown).toBe("'" + raw.replace(/'/g, "''") + "'");
      expect(n.setProperty('Value', shown)).toBe(true);
      expect(n[prop]).toBe(raw);
      expect(n.displayValue).toBe(shown);
      expect(n.serializeValue()).toEqual(wrap(cls, { [prop]: raw }));
    });

    it(cls + ' stores a NEW value typed in the displayed quoted form', () => {
      const n = Node.parse(wrap(cls, { [prop]: 'old' }), 'n', null) as any;
      expect(n.setProperty('Value', "'a''b'")).toBe(true);
      expect(n[prop]).toBe("a'b");
      // Unquoted text is stored as typed, since that is not a literal to strip.
      expect(n.setProperty('Value', 'a == 1')).toBe(true);
      expect(n[prop]).toBe('a == 1');
    });
  }
});

describe('a leaf parsed from a value with no elements', () => {
  it('still constructs, with an empty property and no XML element', () => {
    // Defensive: a hand-edited or truncated .sldd can omit _elements. The node
    // must not throw during tree construction, since one bad entry would take the
    // whole file's view down.
    const n = VariantBankNode.parse({}, 'n', null) as any;
    expect(n.Value).toBe('');
    // With no _array_class there is no Simulink object to emit.
    expect(n.serializeXml('P', undefined, 0)).toBe('<P/>');
  });
});
