// Copyright 2026 The MathWorks, Inc.
// Unit tests for the prop atoms in src/datamodel/prop/. Each atom is a static
// descriptor telling the table and property inspector how to surface one
// property: which raw key it reads, whether it is editable, and how a raw value
// renders as display text. `format` is the only behaviour they carry, so these
// tests cover its edge cases plus the structural contract every atom must meet
// to be consumed by BaseNode.getPropInfo.

import { describe, it, expect } from 'vitest';
import PropBaseType from '../src/datamodel/prop/PropBaseType.js';
import PropBlockPath from '../src/datamodel/prop/PropBlockPath.js';
import PropClass from '../src/datamodel/prop/PropClass.js';
import PropComplexity from '../src/datamodel/prop/PropComplexity.js';
import PropCondition from '../src/datamodel/prop/PropCondition.js';
import PropDataType from '../src/datamodel/prop/PropDataType.js';
import PropDescription from '../src/datamodel/prop/PropDescription.js';
import PropDimensions from '../src/datamodel/prop/PropDimensions.js';
import PropDimensionsMode from '../src/datamodel/prop/PropDimensionsMode.js';
import PropEnumValue from '../src/datamodel/prop/PropEnumValue.js';
import PropFileFormat from '../src/datamodel/prop/PropFileFormat.js';
import PropKind from '../src/datamodel/prop/PropKind.js';
import PropLabels from '../src/datamodel/prop/PropLabels.js';
import PropLocation from '../src/datamodel/prop/PropLocation.js';
import PropMax from '../src/datamodel/prop/PropMax.js';
import PropMin from '../src/datamodel/prop/PropMin.js';
import PropName from '../src/datamodel/prop/PropName.js';
import PropNumberOfEntries from '../src/datamodel/prop/PropNumberOfEntries.js';
import PropPath from '../src/datamodel/prop/PropPath.js';
import PropRelease from '../src/datamodel/prop/PropRelease.js';
import PropSpecification from '../src/datamodel/prop/PropSpecification.js';
import PropStatus from '../src/datamodel/prop/PropStatus.js';
import PropType from '../src/datamodel/prop/PropType.js';
import PropUnit from '../src/datamodel/prop/PropUnit.js';
import PropValue from '../src/datamodel/prop/PropValue.js';
import { formatText } from '../src/datamodel/prop/formatText.js';
import type BaseNode from '../src/datamodel/node/BaseNode.js';

// Every atom, so the structural checks below cannot silently skip a new one.
const ALL_ATOMS = [
  PropBaseType, PropBlockPath, PropClass, PropComplexity, PropCondition,
  PropDataType, PropDescription, PropDimensions, PropDimensionsMode,
  PropEnumValue, PropFileFormat, PropKind, PropLabels, PropLocation, PropMax,
  PropMin, PropName, PropNumberOfEntries, PropPath, PropRelease,
  PropSpecification, PropStatus, PropType, PropUnit, PropValue,
];

// A stand-in for the node fields the readValue implementations reach for.
const node = (fields: Record<string, unknown>) => fields as unknown as BaseNode;

describe('prop atoms — structural contract', () => {
  it('every atom declares the members BaseNode.getPropInfo relies on', () => {
    for (const atom of ALL_ATOMS) {
      expect(typeof atom.key, `${atom.name}.key`).toBe('string');
      expect(atom.key.length, `${atom.name}.key`).toBeGreaterThan(0);
      expect(typeof atom.displayName, `${atom.name}.displayName`).toBe('string');
      expect(typeof atom.editor, `${atom.name}.editor`).toBe('string');
      expect(typeof atom.format, `${atom.name}.format`).toBe('function');
    }
  });

  it('every editor names a renderer the UI knows', () => {
    const editors = new Set(['text', 'textArea', 'label', 'select']);
    for (const atom of ALL_ATOMS) {
      expect(editors, `${atom.name}.editor`).toContain(atom.editor);
    }
  });

  it('format never returns a non-string, even for junk input', () => {
    // getPropInfo assigns format()'s result straight to a display-text field, so
    // a stray undefined would surface in the table as the literal "undefined".
    const junk = [undefined, null, '', 0, false, NaN, [], {}, 'x'];
    for (const atom of ALL_ATOMS) {
      for (const v of junk) {
        expect(typeof atom.format(v), `${atom.name}.format(${String(v)})`).toBe('string');
      }
    }
  });

  it('every read-only atom is a label, and vice versa', () => {
    // A label editor is how an atom declares itself read-only; getPropInfo turns
    // any other editor into an editable cell, which then needs a writable path.
    for (const atom of ALL_ATOMS) {
      const readOnly = atom.editor === 'label';
      const hasWritablePath = ['text', 'textArea', 'select'].includes(atom.editor);
      expect(readOnly !== hasWritablePath, `${atom.name}`).toBe(true);
    }
  });

  it('no atom carries a parse/validate/defaultValue member', () => {
    // Edits are applied and validated by the node (DataNode.setProperty and
    // friends), which never consults the atom. Re-adding these here would create
    // a second, unreachable rule that silently drifts from the enforced one.
    for (const atom of ALL_ATOMS) {
      const a = atom as unknown as Record<string, unknown>;
      expect(a.parse, `${atom.name}.parse`).toBeUndefined();
      expect(a.validate, `${atom.name}.validate`).toBeUndefined();
      expect(a.defaultValue, `${atom.name}.defaultValue`).toBeUndefined();
    }
  });
});

describe('PropValue.format', () => {
  it('renders an unset value as the empty-matrix token', () => {
    expect(PropValue.format(null)).toBe('[ ]');
    expect(PropValue.format(undefined)).toBe('[ ]');
    expect(PropValue.format([])).toBe('[ ]');
  });

  it('renders numbers and logicals bare', () => {
    expect(PropValue.format(5)).toBe('5');
    expect(PropValue.format(0)).toBe('0');
    expect(PropValue.format(-2.5)).toBe('-2.5');
    expect(PropValue.format(true)).toBe('true');
    expect(PropValue.format(false)).toBe('false');
  });

  it('quotes a string the way MATLAB spells a char vector', () => {
    expect(PropValue.format('abc')).toBe("'abc'");
    expect(PropValue.format('')).toBe("''");
  });

  it('renders a 1-element string array in double quotes', () => {
    expect(PropValue.format(['abc'])).toBe('"abc"');
  });

  it("REGRESSION: doubles a quote inside the value, as MATLAB escapes it", () => {
    // "'" + value + "'" rendered `it's` as 'it's', which is not a MATLAB literal.
    // The cell is also what seeds the in-place editor, so the displayed text has
    // to be text that reads back as the same value.
    expect(PropValue.format("it's")).toBe("'it''s'");
    expect(PropValue.format("'")).toBe("''''");
    expect(PropValue.format(['a"b'])).toBe('"a""b"');
  });

  it('renders a short numeric array in bracket form', () => {
    expect(PropValue.format([1, 2, 3])).toBe('[1 2 3]');
  });

  it('summarises an array whose bracket form would be too wide', () => {
    // Long vectors are collapsed so one cell cannot blow out the column width.
    const long = Array.from({ length: 40 }, (_, i) => i);
    expect(PropValue.format(long)).toBe('<1x40 double>');
  });

  it('renders an unrecognised value as empty rather than [object Object]', () => {
    expect(PropValue.format({ a: 1 })).toBe('');
  });

  it('spells a non-finite value as MATLAB does, so the cell stays editable', () => {
    // Inf is a legal Parameter.Value and MatlabValueParser.parse('Inf') accepts
    // it — but it rejects the JavaScript spelling 'Infinity'. Rendering with
    // String() therefore produced a cell whose own displayed text could not be
    // typed back in: the edit was refused as an invalid MATLAB expression.
    expect(PropValue.format(Infinity)).toBe('Inf');
    expect(PropValue.format(-Infinity)).toBe('-Inf');
    expect(PropValue.format(NaN)).toBe('NaN');
    expect(PropValue.format([1, Infinity, NaN])).toBe('[1 Inf NaN]');
  });
});

describe('PropMin / PropMax.format', () => {
  it('renders a set bound as its number', () => {
    expect(PropMin.format(0)).toBe('0');
    expect(PropMax.format(-1.5)).toBe('-1.5');
  });

  it('renders an unset bound as blank', () => {
    // MATLAB stores a cleared bound as [], which arrives here as undefined; a
    // blank cell is how the table shows "no bound".
    expect(PropMin.format(undefined)).toBe('');
    expect(PropMin.format(null)).toBe('');
    expect(PropMax.format(undefined)).toBe('');
  });

  it('renders a zero bound rather than treating it as unset', () => {
    expect(PropMin.format(0)).toBe('0');
    expect(PropMax.format(0)).toBe('0');
  });

  it('targets the Min and Max columns', () => {
    expect(PropMin.column).toBe('Min');
    expect(PropMax.column).toBe('Max');
  });
});

describe('quoting atoms', () => {
  it('PropCondition and PropSpecification quote a set value and blank an unset one', () => {
    expect(PropCondition.format('a == 1')).toBe("'a == 1'");
    expect(PropCondition.format('')).toBe('');
    expect(PropCondition.format(undefined)).toBe('');
    expect(PropSpecification.format('x')).toBe("'x'");
    expect(PropSpecification.format(null)).toBe('');
  });

  it('both feed the shared Value column', () => {
    expect(PropCondition.column).toBe('Value');
    expect(PropSpecification.column).toBe('Value');
  });

  it('REGRESSION: double an embedded quote instead of emitting a broken literal', () => {
    // strcmp(mode,'fast') is an ordinary variant condition, and it has to display
    // as text MATLAB could evaluate.
    expect(PropCondition.format("strcmp(mode,'fast')")).toBe("'strcmp(mode,''fast'')'");
    expect(PropSpecification.format("p('x')")).toBe("'p(''x'')'");
  });

  it('REGRESSION: every quoting atom carries the inverse of its format', () => {
    // DataNode.setProperty consults unformat on the way in. Without it the display
    // quotes were stored as part of the value and the next edit wrapped them again
    // ('a == 1' → ''a == 1'' → …) until the saved condition was no longer an
    // expression MATLAB could evaluate.
    for (const atom of [PropCondition, PropSpecification, PropValue]) {
      expect(typeof atom.unformat, `${atom.name}.unformat`).toBe('function');
      for (const raw of ["strcmp(mode,'fast')", 'a == 1', 'plain', '']) {
        // The displayed form of `raw`, spelled the way all three atoms spell it.
        const shown = "'" + raw.replace(/'/g, "''") + "'";
        expect(atom.unformat(shown), `${atom.name} ${raw}`).toBe(raw);
      }
      // Text that is not a single well-formed literal is left alone, not
      // half-stripped into something different from what the user typed.
      expect(atom.unformat("'a'b'"), atom.name).toBe("'a'b'");
      expect(atom.unformat('a == 1'), atom.name).toBe('a == 1');
    }
  });

  it('only the atoms whose display is decorated declare an unformat', () => {
    // unformat exists to undo a display decoration. An atom whose format is the
    // identity on strings must not have one, or an edit whose text happens to look
    // like a quoted literal would be silently unquoted.
    const decorated = new Set([PropCondition, PropSpecification, PropValue]);
    for (const atom of ALL_ATOMS) {
      const has = typeof (atom as unknown as { unformat?: unknown }).unformat === 'function';
      expect(has, `${atom.name}.unformat`).toBe(decorated.has(atom as never));
    }
  });
});

describe('PropDimensions', () => {
  it('renders a dimension vector in bracket form', () => {
    expect(PropDimensions.format([1, 3])).toBe('[1 3]');
  });

  it('renders a scalar dimension bare and an absent one blank', () => {
    expect(PropDimensions.format(1)).toBe('1');
    expect(PropDimensions.format('x')).toBe('x');
    expect(PropDimensions.format(undefined)).toBe('');
    expect(PropDimensions.format(null)).toBe('');
  });

  it('reads the capitalised raw key off the node', () => {
    expect(PropDimensions.readValue(node({ Dimensions: [2, 2] }))).toBe('[2 2]');
    expect(PropDimensions.readValue(node({}))).toBe('');
  });

  it('spells an Inf dimension as MATLAB does', () => {
    // Inf is one of the values MATLAB accepts here (see the atom's own note on
    // why this column is read-only), so it has to render as a MATLAB literal.
    expect(PropDimensions.format(Infinity)).toBe('Inf');
    expect(PropDimensions.format([1, Infinity])).toBe('[1 Inf]');
  });

  it('declares the raw key it consumes so the PI does not re-list it', () => {
    expect(PropDimensions.key).toBe('dimensions');
    expect(PropDimensions.sourceKeys).toEqual(['Dimensions']);
  });
});

describe('PropNumberOfEntries', () => {
  it('renders a count, and an absent count as zero', () => {
    expect(PropNumberOfEntries.format(7)).toBe('7');
    expect(PropNumberOfEntries.format(0)).toBe('0');
    expect(PropNumberOfEntries.format(undefined)).toBe('0');
  });
});

describe('node-reading atoms', () => {
  it('PropKind and PropClass read the live node getters', () => {
    // Both must go through the node, which applies classification and derived
    // overrides that a raw schema value would miss.
    expect(PropKind.readValue(node({ kind: 'Simulink Parameter' }))).toBe('Simulink Parameter');
    expect(PropClass.readValue(node({ className: 'Simulink.Parameter' }))).toBe('Simulink.Parameter');
  });

  it('PropKind and PropClass are inspector-only', () => {
    // The table emits its own Kind/Class columns in toRow, so these must not
    // also claim a column or it would be filled twice.
    expect(PropKind.column).toBeNull();
    expect(PropClass.column).toBeNull();
  });

  it('PropDataType reads the node dataType', () => {
    expect(PropDataType.readValue(node({ dataType: 'double' }))).toBe('double');
  });

  it('PropName reads displayName, not the raw name', () => {
    expect(PropName.readValue(node({ name: 'raw', displayName: 'shown' }))).toBe('shown');
  });

  it('PropLabels joins a label list and blanks an empty one', () => {
    expect(PropLabels.readValue(node({ labels: ['a', 'b'] }))).toBe('a, b');
    expect(PropLabels.readValue(node({ labels: [] }))).toBe('');
    expect(PropLabels.readValue(node({}))).toBe('');
  });

  it('PropLocation and PropBlockPath read their fields, blank when absent', () => {
    expect(PropLocation.readValue(node({ location: '/work' }))).toBe('/work');
    expect(PropLocation.readValue(node({}))).toBe('');
    expect(PropBlockPath.readValue(node({ blockPath: 'model/Gain' }))).toBe('model/Gain');
    expect(PropBlockPath.readValue(node({}))).toBe('');
  });

  it('PropStatus reports resolution as loaded or not', () => {
    expect(PropStatus.readValue(node({ resolved: true }))).toBe('Loaded');
    expect(PropStatus.readValue(node({ resolved: false }))).toBe('Not Loaded');
    expect(PropStatus.readValue(node({}))).toBe('Not Loaded');
  });

  it('PropPath falls back to the node name when there is no full path', () => {
    expect(PropPath.readValue(node({ fullPath: 'a/b', name: 'b' }))).toBe('a/b');
    expect(PropPath.readValue(node({ name: 'b' }))).toBe('b');
  });

  it('PropType prefers the project item type over the class name', () => {
    expect(PropType.readValue(node({ projectItemType: 'File', className: 'C' }))).toBe('File');
    expect(PropType.readValue(node({ className: 'C' }))).toBe('C');
    expect(PropType.readValue(node({}))).toBe('');
  });

  it('PropComplexity and PropDimensionsMode read their capitalised raw keys', () => {
    expect(PropComplexity.readValue(node({ Complexity: 'real' }))).toBe('real');
    expect(PropComplexity.readValue(node({}))).toBe('');
    expect(PropDimensionsMode.readValue(node({ DimensionsMode: 'Fixed' }))).toBe('Fixed');
    expect(PropDimensionsMode.readValue(node({}))).toBe('');
  });
});

describe('PropEnumValue', () => {
  it('offers the enumeral child names as its options', () => {
    const n = node({ displayValue: 'RED', children: [{ name: 'RED' }, { name: 'GREEN' }] });
    expect(PropEnumValue.readOptions(n)).toEqual(['RED', 'GREEN']);
    expect(PropEnumValue.readValue(n)).toBe('RED');
  });

  it('writes the choice to DefaultValue, not to a Value field', () => {
    expect(PropEnumValue.nodeProperty).toBe('DefaultValue');
    expect(PropEnumValue.editor).toBe('select');
  });
});

describe('read-only atoms surfaced deliberately as labels', () => {
  it('PropUnit is read-only and consumes both the modern and legacy raw keys', () => {
    // Simulink parses Unit through a unit-expression grammar we do not
    // replicate, so it is surfaced as a label rather than risk an invalid write.
    expect(PropUnit.editor).toBe('label');
    expect(PropUnit.sourceKeys).toEqual(['DocUnits', 'Unit']);
  });

  it('PropDataType, PropComplexity, and PropDimensionsMode are labels', () => {
    expect(PropDataType.editor).toBe('label');
    expect(PropComplexity.editor).toBe('label');
    expect(PropDimensionsMode.editor).toBe('label');
  });

  it('PropBaseType stays editable but renders in the Data Type column', () => {
    // An alias has no Value, so its base type takes over that slot; the column
    // itself has no in-place editor, so it reads read-only in the table.
    expect(PropBaseType.editor).toBe('text');
    expect(PropBaseType.column).toBe('DataType');
  });
});

describe('plain string atoms', () => {
  it('render a value or blank', () => {
    for (const atom of [PropDescription, PropFileFormat, PropRelease, PropUnit, PropDataType]) {
      expect(atom.format('v'), atom.name).toBe('v');
      expect(atom.format(undefined), atom.name).toBe('');
      expect(atom.format(null), atom.name).toBe('');
      expect(atom.format(''), atom.name).toBe('');
    }
  });

  it('all share one format implementation', () => {
    // Eighteen atoms used to spell out the same body; they now point at the
    // shared helper, so this pins that they have not drifted back apart.
    const shared = [
      PropBaseType, PropBlockPath, PropClass, PropComplexity, PropDataType,
      PropDescription, PropDimensionsMode, PropEnumValue, PropFileFormat,
      PropKind, PropLabels, PropLocation, PropName, PropPath, PropRelease,
      PropStatus, PropType, PropUnit,
    ];
    for (const atom of shared) {
      expect(atom.format, atom.name).toBe(formatText);
    }
  });

  it('stringifies a truthy non-string rather than passing it through', () => {
    // `(value as string) || ''` is a cast the compiler cannot check: it let a
    // truthy non-string reach a field typed as display text.
    expect(formatText([1, 2])).toBe('1,2');
    expect(formatText(7)).toBe('7');
    expect(formatText(true)).toBe('true');
  });

  it('PropDescription uses the multi-line editor', () => {
    expect(PropDescription.editor).toBe('textArea');
  });
});
