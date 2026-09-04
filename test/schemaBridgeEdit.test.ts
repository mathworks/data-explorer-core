// Copyright 2026 The MathWorks, Inc.
//
// trySetSchemaProperty and schemaColumnLabels — the two schemaBridge surfaces the
// existing schema/schemaBridge.test.ts (read paths) and codegenEdit.test.ts (the
// happy-path storageClass edit through a real ParameterNode) leave uncovered.
//
// trySetSchemaProperty is a three-valued function, and the distinction between its
// two falsy-ish outcomes is what callers depend on: `null` means "not mine, fall
// back to your own setProperty logic", while a SetPropertyResult means "mine, and
// refused". Confusing the two either swallows a refusal or makes an unrelated key
// unsettable, so each of the four ways to reach `null` gets its own assertion.
import { describe, it, expect } from 'vitest';
import { trySetSchemaProperty, schemaColumnLabels, schemaColumns } from '../src/datamodel/node/schemaBridge.js';

// The bridge reads exactly two things off a node: `className` (to pick the schema)
// and `serial._properties` (the bag it writes into). `_markModified` is optional —
// its absence is exercised deliberately below.
type FakeNode = {
  className?: string;
  serial?: { _properties?: Record<string, unknown> };
  modified?: number;
  _markModified?: () => void;
};

function fakeNode(properties: Record<string, unknown> | undefined, className = 'Simulink.Parameter'): FakeNode {
  const n: FakeNode = { className, serial: properties === undefined ? {} : { _properties: properties }, modified: 0 };
  n._markModified = () => { n.modified = (n.modified ?? 0) + 1; };
  return n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trySet = (node: FakeNode, key: string, value: string) => trySetSchemaProperty(node as any, key, value);

// A CoderInfo bag in the MATLABArray shape the parsers actually produce.
const coderInfo = (props: Record<string, unknown>) => ({
  CoderInfo: { _elements: [{ _properties: props }] },
});

describe('trySetSchemaProperty — declining to own the edit', () => {
  it('declines a node with no className at all', () => {
    // Container/section nodes have no className; the bridge must not claim their
    // edits, or a rename on a section would be silently swallowed.
    const node: FakeNode = { serial: { _properties: {} } };
    expect(trySet(node, 'storageClass', 'Auto')).toBeNull();
  });

  it('declines a class that has no schema', () => {
    expect(trySet(fakeNode({}, 'Simulink.NotAThing'), 'storageClass', 'Auto')).toBeNull();
  });

  it('declines a key the schema does not know', () => {
    expect(trySet(fakeNode({}), 'notASchemaProp', 'x')).toBeNull();
  });

  it('declines a node-owned prop that the schema authors for reference only', () => {
    // min/max/unit appear in the registry but are NOT projected — the node owns
    // them. Claiming them here would bypass DataNode's own Min/Max validation.
    for (const key of ['min', 'max', 'unit']) {
      expect(trySet(fakeNode({}), key, '5')).toBeNull();
    }
  });

  it('declines a read-only label prop, so the caller can refuse it its own way', () => {
    // headerFile and alignment are projected but rendered as labels. Returning
    // null (rather than a refusal) is what makes them fall through to
    // DataNode.setProperty, which also does not handle them → read-only.
    const node = fakeNode(coderInfo({ Alignment: 4 }));
    expect(trySet(node, 'headerFile', 'foo.h')).toBeNull();
    expect(trySet(node, 'alignment', '8')).toBeNull();
    // Nothing was written and nothing was marked dirty.
    expect(node.serial!._properties!).toEqual(coderInfo({ Alignment: 4 }));
    expect(node.modified).toBe(0);
  });
});

describe('trySetSchemaProperty — validating and writing', () => {
  it('writes a valid enumerated value into the nested CoderInfo bag', () => {
    const node = fakeNode(coderInfo({ StorageClass: 'Auto' }));
    expect(trySet(node, 'storageClass', 'ExportedGlobal')).toBe(true);
    expect(node.serial!._properties!).toEqual(coderInfo({ StorageClass: 'ExportedGlobal' }));
    // The caller relies on the returned `true` meaning "already marked dirty".
    expect(node.modified).toBe(1);
  });

  it('refuses a token outside the schema options, naming the label not the key', () => {
    // The reason text reaches the user, so it must read 'Storage Class', not
    // 'storageClass'. CSC names like BitField are exactly the plausible-looking
    // input this guards: MATLAB rejects them on the CoderInfo.StorageClass path.
    const node = fakeNode(coderInfo({ StorageClass: 'Auto' }));
    const result = trySet(node, 'storageClass', 'BitField');
    expect(result).toEqual({
      error: true,
      reason: 'Invalid value for Storage Class',
      invalidValue: 'BitField',
      validValue: '',
    });
    // A refused edit writes nothing.
    expect(node.serial!._properties!).toEqual(coderInfo({ StorageClass: 'Auto' }));
    expect(node.modified).toBe(0);
  });

  it('refuses the empty string, which is not an option either', () => {
    const node = fakeNode(coderInfo({ StorageClass: 'Auto' }));
    expect((trySet(node, 'storageClass', '') as { error?: boolean }).error).toBe(true);
  });

  it('reports a refusal when the write target is absent, rather than reporting success', () => {
    // writeSourcePath cannot create the intermediate CoderInfo bag, so an entry
    // parsed without one has nowhere to put StorageClass. Returning true here
    // would show the new value in the UI while the file kept the old one.
    const node = fakeNode({ Value: 1 });
    const result = trySet(node, 'storageClass', 'ExportedGlobal');
    expect(result).toEqual({
      error: true,
      reason: 'Cannot set Storage Class (target property is absent)',
      invalidValue: 'ExportedGlobal',
      validValue: '',
    });
    expect(node.modified).toBe(0);
  });

  it('reports the same refusal when the node carries no properties bag at all', () => {
    const node = fakeNode(undefined);
    expect((trySet(node, 'storageClass', 'Auto') as { error?: boolean }).error).toBe(true);
  });

  it('writes through a typed {_type,_value} leaf without replacing the wrapper', () => {
    // Binary-parsed properties arrive as typed wrappers. writeSourcePath updates
    // _value in place; clobbering the wrapper would lose the class on save.
    const node = fakeNode(coderInfo({ StorageClass: { _type: 'char', _value: 'Auto' } }));
    expect(trySet(node, 'storageClass', 'Custom')).toBe(true);
    expect(node.serial!._properties!).toEqual(coderInfo({ StorageClass: { _type: 'char', _value: 'Custom' } }));
  });

  it('accepts every option the dropdown offers', () => {
    // The validation list and the dropdown list must be the same list — if they
    // drift, the UI offers a value its own write path then refuses.
    const options = schemaColumns('Simulink.Parameter').find((c) => c.key === 'storageClass')!.readOptions!();
    expect(options.length).toBeGreaterThan(0);
    for (const opt of options) {
      const node = fakeNode(coderInfo({ StorageClass: 'Auto' }));
      expect(trySet(node, 'storageClass', opt)).toBe(true);
    }
  });

  it('works on Simulink.Signal too, which projects storageClass via its own $ref', () => {
    const node = fakeNode(coderInfo({ StorageClass: 'Auto' }), 'Simulink.Signal');
    expect(trySet(node, 'storageClass', 'ImportedExtern')).toBe(true);
    expect(node.serial!._properties!).toEqual(coderInfo({ StorageClass: 'ImportedExtern' }));
  });

  it('succeeds on a node with no _markModified, rather than throwing', () => {
    // The call is optional-chained precisely so a bare object works; a plain
    // throw here would break any caller that is not a full BaseNode.
    const node: FakeNode = { className: 'Simulink.Parameter', serial: { _properties: coderInfo({ StorageClass: 'Auto' }) } };
    expect(trySet(node, 'storageClass', 'Custom')).toBe(true);
  });
});

describe('a schema PropClass formats values the same way it reads them', () => {
  it('renders absent, array, and scalar values consistently through format', () => {
    // readValue formats what it hydrates; `format` is the same formatter exposed
    // for a value the caller already has. The two must agree, or a cell rendered
    // via format would differ from the same cell rendered via readValue.
    const dims = schemaColumns('Simulink.Parameter').find((c) => c.key === 'dimensions')!;
    expect(dims.format!(undefined)).toBe('');
    expect(dims.format!(null)).toBe('');
    // Space-separated, as MATLAB's mat2str spells a row and as every other
    // surface in the product spells the same value — see formatSchemaValue.
    expect(dims.format!([2, 3])).toBe('[2 3]');
    expect(dims.format!(5)).toBe('5');
    expect(dims.format!('inherit')).toBe('inherit');
  });
});

describe('schemaColumnLabels — key → label across every schema class', () => {
  it('labels every projected column of every schema class', () => {
    const labels = schemaColumnLabels();
    expect(labels.storageClass).toBe('Storage Class');
    expect(labels.headerFile).toBe('Header File');
    expect(labels.alignment).toBe('Alignment');
    expect(labels.dimensions).toBe('Dimensions');
    expect(labels.complexity).toBe('Complexity');
  });

  it('covers the union of classes, not just one of them', () => {
    // The host merges this map over its base-column labels, so a column that
    // only some class projects must still be labelled — otherwise that column
    // header falls back to the raw key for those rows.
    const labels = schemaColumnLabels();
    const union = new Set<string>();
    for (const cls of ['Simulink.Parameter', 'Simulink.Signal', 'Simulink.AliasType', 'Simulink.NumericType']) {
      for (const col of schemaColumns(cls)) {
        union.add(col.key);
      }
    }
    expect(union.size).toBeGreaterThan(0);
    for (const key of union) {
      expect(labels[key], `missing label for ${key}`).toBeTruthy();
    }
  });

  it('never labels a node-owned reference prop as a schema column', () => {
    // min/max/unit are authored in the registry but not projected. Labelling
    // them here would make the host think the schema owns those columns.
    const labels = schemaColumnLabels();
    expect(labels.min).toBeUndefined();
    expect(labels.max).toBeUndefined();
    expect(labels.unit).toBeUndefined();
  });
});
