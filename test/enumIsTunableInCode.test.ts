// Copyright 2026 The MathWorks, Inc.
//
// `IsTunableInCode` on Simulink.data.dictionary.EnumTypeDefinition — the last
// property of MATLAB's own enum code-generation list that we did not model.
//
// MATLAB's `SLEnum.getCodegenPropertyNames()` returns DataScope, HeaderFile,
// AddClassNameToEnumNames and then appends IsTunableInCode when the `OpaqueEnum`
// feature is on, which it is in R2027a; the property reports `valid=1 readonly=0`.
// Measured on a dictionary R2027a wrote for an enum with every property set, it
// serializes as a FLAT, top-level key whose value is a real JSON boolean:
// `"IsTunableInCode": true` — not a nested sub-object and not MATLAB's `'on'`/`'off'`
// string, so `formatSchemaValue` renders it `"true"`. That measured bag is built
// inline below rather than added under `test/parity/artifacts/`, which is generated
// by a MATLAB script and policed by `drift.mjs`.
//
// THE ROW IS ALWAYS SHOWN. MATLAB gates it on a feature flag we have no way to
// read: the flag lives in the running MATLAB installation, not in the `.sldd`, and
// a file carries no trace of whether the release that wrote it had `OpaqueEnum`
// enabled. Hiding the row on a heuristic would hide a value the file really holds,
// which is the exact defect this whole round of schema work removes — so an enum
// whose bag omits the key gets a blank row instead. There is no comment channel in
// `schema/classes/enumType.json` (a JSON module import, so no `//`), which is why
// that decision is recorded here.
//
// The two halves this pins, because a schema entry can be present and still not
// reach a user:
//   * the layout says WHERE the row sits (asserted as an exact key list, the way
//     test/schema/schemaBridge.test.ts pins Simulink.Parameter's), and
//   * `toPIObject()` says whether the value actually renders. A key in the schema
//     registry that renders blank is worse than no key at all, since
//     `BaseNode.toPIObject` adds it to `shownKeys` and the "Other" catch-all then
//     suppresses the raw property too — the value becomes unreachable in the UI.
//
// Read-only, like its sibling `addClassNameToEnumNames`: the schema declares it
// `editor: 'label'` and `buildPILayout` forces every schema-resolved PI item to
// 'label' regardless, because the Property Inspector has no edit channel. So there
// is no write path to test — only that saving invents nothing.

import { describe, it, expect } from 'vitest';
import { EnumTypeNode } from '../src/datamodel/node/data/EnumTypeNode.js';
import { buildPILayout, schemaColumns } from '../src/datamodel/node/schemaBridge.js';
import { getLayout } from '../src/datamodel/schema/index.js';
import type DataNode from '../src/datamodel/node/DataNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const CLASS_NAME = 'Simulink.data.dictionary.EnumTypeDefinition';

// A dictionary entry as it arrives from either parser: the MATLABArray wrapper
// whose single element carries the `_properties` bag.
function rawVal(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    _array_class: CLASS_NAME,
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: properties }],
  };
}

// The Enumerals wrapper of the measured dictionary: a 1x3 row-vector struct array,
// carried verbatim because `_getSerializedProperties` rebuilds this wrapper on every
// save and the round-trip assertions below have to see it come back unchanged.
const ENUMERALS = {
  _array_type: 'Struct',
  _dimensions: [1, 3],
  _elements: [
    { Description: '', Name: 'enum1', Value: '0' },
    { Description: 'first', Name: 'A', Value: '0' },
    { Description: 'second', Name: 'B', Value: '1' },
  ],
  _fields: ['Name', 'Value', 'Description'],
};

// The bag R2027a wrote for an enum with every property assigned (abridged to the
// keys this file is about, nested exactly as measured). Frozen so no test can
// mutate the shared reference and quietly change what a later test starts from.
const MEASURED: Readonly<Record<string, unknown>> = Object.freeze({
  AddClassNameToEnumNames: true,
  DataScope: 'Exported',
  DefaultValue: 'B',
  Description: 'enum desc',
  Enumerals: ENUMERALS,
  HeaderFile: 'myenum.h',
  IsTunableInCode: true,
});

function makeEnum(properties: Record<string, unknown>): EnumTypeNode {
  return EnumTypeNode.parse(rawVal(structuredClone(properties)), 'Color', null);
}

// The rendered Property Inspector, reduced to the two things a user sees: the
// per-key display values, and the ordered items of one group.
function piValues(node: EnumTypeNode): Record<string, unknown> {
  return (node.toPIObject()!.objects as Record<string, unknown>[])[0];
}
function piItems(node: EnumTypeNode, groupTitle: string): string[] {
  const groups = node.toPIObject()!.propertySheet.groups as { displayName: string; items: { name: string }[] }[];
  const group = groups.find((g) => g.displayName === groupTitle);
  expect(group, `no "${groupTitle}" group in the PI`).toBeDefined();
  return group!.items.map((i) => i.name);
}

// The two save paths, named as absentPropertyWriteBack.test.ts names them: the
// compressed-binary writer reads `_getSerializedProperties`, the uncompressed-text
// one the bag inside `serializeValue`. They are independent copies of one decision,
// so both are asserted every time.
const binaryPath = (node: DataNode) => node._getSerializedProperties();
const textPath = (node: DataNode) => {
  const sv = node.serializeValue() as { _elements: { _properties: Record<string, unknown> }[] };
  return sv._elements[0]._properties;
};
// The text bag as the FILE would carry it: JSON.stringify drops `undefined` values,
// so a key that only exists in memory does not count as written.
const textFileBag = (node: DataNode) =>
  JSON.parse(JSON.stringify({ p: textPath(node) })).p as Record<string, unknown>;

describe('an enum whose file carries IsTunableInCode', () => {
  it('displays it in the Property Inspector', () => {
    // The assertion that matters. Everything else here is structure; this is the
    // one that fails if the property is modelled but unreachable.
    const node = makeEnum(MEASURED);
    expect(piValues(node).isTunableInCode).toBe('true');
  });

  it('displays it as a read-only row labelled the way MATLAB spells the property', () => {
    const properties = makeEnum(MEASURED).toPIObject()!.propertySheet.properties as {
      name: string;
      displayName: string;
      editable: boolean;
    }[];
    const row = properties.find((p) => p.name === 'isTunableInCode');
    expect(row).toBeDefined();
    expect(row!.displayName).toBe('Is Tunable In Code');
    // The PI has no edit channel at all, so every schema-resolved row is a label.
    expect(row!.editable).toBe(false);
  });

  it('does not ALSO list the raw key under "Other"', () => {
    // The pair of failure modes `shownKeys` sits between. Before the property was
    // modelled, `IsTunableInCode` reached the user only as an "Other" row; now that
    // Code Generation shows it, "Other" must stop — two rows for one property in
    // one sheet is a worse answer than either alone. The unmodelled `Enumerals` bag
    // is still expected there, so this is not asserting "Other" is empty.
    const node = makeEnum(MEASURED);
    expect(piValues(node)).not.toHaveProperty('Other.IsTunableInCode');
    expect(piItems(node, 'Other')).toEqual(['Other.Enumerals']);
  });

  it('reads a false as a false, distinctly from an absent key', () => {
    // `hydrate` substitutes the descriptor's default only when the resolved value is
    // `undefined`, so an enum that explicitly turns tunability OFF must render
    // "false" — not the blank an omitted key gets. A truthiness test anywhere on
    // this path would collapse the two states into one.
    const node = makeEnum({ ...MEASURED, IsTunableInCode: false });
    expect(piValues(node).isTunableInCode).toBe('false');
  });
});

describe('an enum whose file omits IsTunableInCode', () => {
  it('renders the row blank rather than a bogus value', () => {
    // The descriptor's `default` is the empty string: we do not know MATLAB's own
    // default for a property whose feature flag we cannot see, so the honest render
    // for an absent key is nothing. In particular not "false" (a claim the file did
    // not make) and not "undefined" (the raw value leaking through String()).
    const node = makeEnum({ Enumerals: ENUMERALS });
    expect(piValues(node).isTunableInCode).toBe('');
  });

  it('still shows the row — we cannot read MATLAB\'s OpaqueEnum feature flag from a file', () => {
    // See this file's header: the gate MATLAB applies is a property of the running
    // installation, not of the dictionary, so the row is unconditional. Pinned as a
    // decision rather than left implicit, because "hide it when empty" is the
    // obvious-looking change that would break the carrying case above.
    expect(piItems(makeEnum({ Enumerals: ENUMERALS }), 'Code Generation')).toContain('isTunableInCode');
  });
});

describe('the Code Generation group of an EnumTypeDefinition', () => {
  it('lists exactly dataScope, headerFile, addClassNameToEnumNames, isTunableInCode', () => {
    // Position is the point: MATLAB's `getCodegenPropertyNames()` builds the first
    // three and APPENDS IsTunableInCode under the feature gate, so ours goes last to
    // match the order a user sees in the MATLAB app. An exact list rather than a
    // `toContain` — a key appearing in the wrong group, or a fifth key arriving
    // unnoticed, is what this catches. Same idiom as the Simulink.Parameter layout
    // assertion in test/schema/schemaBridge.test.ts.
    expect(getLayout(CLASS_NAME)!.find((g) => g.group === 'Code Generation')!.items).toEqual([
      'dataScope',
      'headerFile',
      'addClassNameToEnumNames',
      'isTunableInCode',
    ]);
  });

  it('resolves every authored key, in that order, through the bridge and into the sheet', () => {
    // The authored list above is only a claim about JSON. `buildPILayout` drops a key
    // that resolves to neither a curated atom nor a schema prop, silently, so the
    // built layout is asserted separately — and then the rendered sheet, since the
    // node is what a host actually calls.
    const built = buildPILayout(CLASS_NAME)!;
    expect(built.map((g) => g.group)).toEqual(['General', 'Value Properties', 'Code Generation']);
    expect(built.flatMap((g) => g.items.map((i) => i.key))).toEqual([
      'Name', 'Kind', 'Class',
      'Value', 'storageType', 'Description',
      'dataScope', 'headerFile', 'addClassNameToEnumNames', 'isTunableInCode',
    ]);
    expect(piItems(makeEnum(MEASURED), 'Code Generation')).toEqual([
      'dataScope',
      'headerFile',
      'addClassNameToEnumNames',
      'isTunableInCode',
    ]);
  });

  it('adds no table column — the property is Property-Inspector-only', () => {
    // Table columns come from the props marked `projected` in the registry, and this
    // descriptor is not one. Pinned because adding `projected: true` is a one-word
    // edit that would put a fourth code-gen column in front of every user with a
    // dictionary, enum or not (schemaColumnLabels unions across all classes).
    expect(schemaColumns(CLASS_NAME).map((c) => c.key)).not.toContain('isTunableInCode');
  });
});

describe('saving an enum nobody edited', () => {
  it('keeps exactly the keys the file arrived with, on both save paths', () => {
    // "Open a dictionary, save it, get no diff." Reading a property for DISPLAY must
    // not write it: `hydrate` substitutes the descriptor's default in the returned
    // value only, never back into the bag. A modelled key that leaked its default
    // into the save bag would put `IsTunableInCode: ""` — an empty char where MATLAB
    // wrote a logical — into every enum in every dictionary opened and saved.
    const node = makeEnum(MEASURED);
    const arrived = Object.keys(MEASURED).sort();
    node.toPIObject();
    expect(Object.keys(binaryPath(node)).sort()).toEqual(arrived);
    expect(Object.keys(textFileBag(node)).sort()).toEqual(arrived);
  });

  it('keeps the value as the logical MATLAB wrote, not the string the PI renders', () => {
    // The display path stringifies (`"true"`), the save path must not. A `true`
    // demoted to `"true"` reaches the binary XML writer as `Class="char"` and MATLAB
    // then reads a char where a logical belongs.
    const node = makeEnum(MEASURED);
    expect(piValues(node).isTunableInCode).toBe('true');
    expect(binaryPath(node).IsTunableInCode).toBe(true);
    expect(textFileBag(node).IsTunableInCode).toBe(true);
  });

  it('does not invent the key when the file never had it, on either save path', () => {
    // The other direction, and the one modelling a new property newly risks. The bag
    // an enum saves is `serial._properties` plus a rebuilt Enumerals wrapper, so the
    // expected key set here is exactly what arrived.
    const node = makeEnum({ Enumerals: ENUMERALS });
    node.toPIObject();
    expect(binaryPath(node)).not.toHaveProperty('IsTunableInCode');
    expect(textFileBag(node)).not.toHaveProperty('IsTunableInCode');
    expect(Object.keys(binaryPath(node))).toEqual(['Enumerals']);
    expect(Object.keys(textFileBag(node))).toEqual(['Enumerals']);
  });

  it('round-trips: the saved bag re-parses to the same displayed value', () => {
    // Reading the saved file back is the only statement that covers both halves at
    // once, and it is what a user experiences as "the property survived".
    const saved = textFileBag(makeEnum(MEASURED));
    const reopened = EnumTypeNode.parse(rawVal(saved), 'Color', null);
    expect(piValues(reopened).isTunableInCode).toBe('true');
    expect(piItems(reopened, 'Code Generation')).toContain('isTunableInCode');
  });
});
