// Copyright 2026 The MathWorks, Inc.
//
// The property surface of the two config-set classes, and — as much as the properties
// themselves — the surface deliberately left OUT.
//
// MATLAB models four parameters on a `Simulink.ConfigSet` that we do not: `StartTime`,
// `StopTime`, `SystemTargetFile` and `SourceLocation`. Only `Description` is modeled here,
// and the omission is a decision rather than an oversight, so the last describe block
// below pins it with the measurement that decided it. Dumping the config-set part of every
// era fixture in test/parity/artifacts/slx_layouts/ found three separate reasons at once:
//
//   - R2026b+ JSON nests StartTime/StopTime/SystemTargetFile inside a HETEROGENEOUS
//     `Simulink.ConfigComponent` array keyed by `_object_class`, which a fixed schema
//     `sourcePath` cannot address;
//   - a value at its default is not written at all, in any era;
//   - one era (R2025a XML) carries none of the three.
//
// So a layout entry for them would manufacture a permanently blank row — which is the
// exact defect this whole change removes, not a step towards parity. `SourceLocation` is
// out for a different reason, recorded at SlxParser.ts:59-62: it survives an export as the
// literal `Base Workspace` even when the set came from a data dictionary, so on a file we
// might be handed it is not a fact about the model.
//
// THE TRAP these tests are shaped around. `description` is a key in schemaBridge's
// ATOM_BY_KEY, and `resolvePropForKey` prefers the atom over the schema descriptor — so
// the row reads the node FIELD `node.Description`, never the descriptor's `sourcePath`.
// Both classes used to drop their `props` argument on the floor, so adding `description`
// to the layout alone would have rendered a blank row AND, because `toPIObject` adds every
// layout key to `shownKeys`, suppressed the raw `Description` from the "Other" catch-all
// as well: a Description in the file, unreachable in both panes. Measured before the fix,
// a ConfigSet parsed with `Description: 'the fast one'` showed it ONLY as
// `Other.Description` and left the table's Description column empty. So the first
// assertion in each block below is that the value DISPLAYS, not that a row exists.
//
// `sourceName` is the other half, and it needs no node field: the era-varying spelling
// (`SourceName` in R2021a+, `WSVarName` in R2018a and earlier) is already normalized
// upstream — SlxParser reads `props.SourceName ?? props.WSVarName` into
// ParsedConfigSet.sourceName and ModelSectionNode.addConfigSetEntry writes it back as
// `props.SourceName` — so by the time a node sees it the key is always spelled one way and
// a fixed `sourcePath` is safe. It was always stored and always saved; it simply had no
// row, so it leaked into "Other".
//
// Related: configSetSerialize.test.ts owns the Name/SourceName ownership question (a
// rename must move a ConfigSet's Name and must NOT touch a ConfigSetRef's SourceName);
// absentPropertyWriteBack.test.ts owns the two-save-path agreement for the whole cluster.
// This file owns what the two classes DISPLAY, plus the round trip of the one property
// they gained.
import { describe, it, expect } from 'vitest';
import ConfigSetNode from '../src/datamodel/node/data/ConfigSetNode.js';
import ConfigSetRefNode from '../src/datamodel/node/data/ConfigSetRefNode.js';
import { getLayout } from '../src/datamodel/schema/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/** The 1x1 MATLABArray envelope MATLAB writes around a scalar object, as both parse paths hand it over. */
function raw(className: string, properties: Record<string, unknown>): Record<string, unknown> {
  return {
    _array_class: className,
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: properties }],
  };
}

/** The PI's groups, each reduced to its title and the ordered property names it lists. */
function piGroups(node: any): { name: string; items: string[] }[] {
  return (node.toPIObject().propertySheet.groups as any[]).map((g) => ({
    name: g.displayName,
    items: g.items.map((i: any) => i.name),
  }));
}

/** Every property name the PI declares, across all groups — the duplicate check reads this. */
function piPropertyNames(node: any): string[] {
  return (node.toPIObject().propertySheet.properties as any[]).map((p) => p.name);
}

/** What the PI actually DISPLAYS for one property name (the objects bag, not the sheet). */
function piValue(node: any, name: string): unknown {
  return (node.toPIObject().objects[0] as Record<string, unknown>)[name];
}

// The two save paths, each reduced to the property bag it puts in the file — the same pair
// absentPropertyWriteBack.test.ts uses, because a gated key has to be checked on both or
// the two hand-written copies of the gate can drift. `_getSerializedProperties` feeds the
// compressed-binary `.sldd`; `serializeValue` feeds the JSON of an uncompressed-text one,
// whose bag is written by JSON.stringify (hence the round trip, which drops `undefined`).
const binaryProps = (node: any): Record<string, unknown> => node._getSerializedProperties();
const textProps = (node: any): Record<string, unknown> =>
  (node.serializeValue() as { _elements: { _properties: Record<string, unknown> }[] })._elements[0]._properties;
const textFileBag = (node: any): Record<string, unknown> =>
  JSON.parse(JSON.stringify({ p: textProps(node) })).p;

describe('Simulink.ConfigSet — Description', () => {
  it('DISPLAYS a Description the file carried, in the Property Inspector and the table alike', () => {
    // The assertion the trap is about: before the node read `props.Description`, the row
    // existed and read ''. Both panes are checked because they reach the value by
    // different routes — the PI through the layout's PropDescription atom, the table
    // through toRow's Description column — and the field is what makes them agree.
    const n = ConfigSetNode.parse(raw('Simulink.ConfigSet', { Name: 'Cfg', Description: 'the fast one' }), 'Cfg', null);
    expect(n.Description).toBe('the fast one');
    expect(piValue(n, 'Description')).toBe('the fast one');
    expect(n.toRow()!.Description).toBe('the fast one');
  });

  it('opens with the identity group, Description last, and no "Other" group left over', () => {
    // Exact titles and exact key lists, the idiom test/schema/schemaBridge.test.ts uses for
    // Simulink.Parameter. `description` trails the five identity keys, which is where every
    // other class file that carries it in General puts it (lookupTable.json,
    // breakpoint.json, customObject.json). No "Other" group at all here: the layout now
    // accounts for every key this bag holds, which is the same fact as the row not being
    // duplicated below.
    const n = ConfigSetNode.parse(raw('Simulink.ConfigSet', { Name: 'Cfg', Description: 'd' }), 'Cfg', null);
    expect(piGroups(n)).toEqual([
      { name: 'General', items: ['Name', 'Value', 'DataType', 'Kind', 'Class', 'Description'] },
    ]);
  });

  it('shows Description ONCE — it is no longer in the "Other" group', () => {
    // Where it used to be, and only there. `Other` still exists for a key nothing models
    // (StopTime, deliberately — see the exclusions block), so this is not "Other is gone",
    // it is "Description moved out of it".
    const n = ConfigSetNode.parse(
      raw('Simulink.ConfigSet', { Name: 'Cfg', Description: 'd', StopTime: '10' }),
      'Cfg',
      null,
    );
    const names = piPropertyNames(n);
    expect(names.filter((p) => p === 'Description')).toEqual(['Description']);
    expect(names).not.toContain('Other.Description');
    expect(piGroups(n)[1]).toEqual({ name: 'Other', items: ['Other.StopTime'] });
  });
});

describe('Simulink.ConfigSetRef — Description and SourceName', () => {
  it('DISPLAYS a Description the file carried', () => {
    const n = ConfigSetRefNode.parse(
      raw('Simulink.ConfigSetRef', { SourceName: 'sharedCfg', Description: 'points at the shared set' }),
      'Ref',
      null,
    );
    expect(n.Description).toBe('points at the shared set');
    expect(piValue(n, 'Description')).toBe('points at the shared set');
    expect(n.toRow()!.Description).toBe('points at the shared set');
  });

  it('DISPLAYS SourceName in a real row, whose value matches the field the node saves', () => {
    // Unlike Description, this row resolves to the SCHEMA descriptor (`sourceName` is not
    // an ATOM_BY_KEY key), so it hydrates `serial._properties.SourceName` rather than
    // reading `node.SourceName`. Both are asserted, and their agreement is the point: the
    // row is read-only (`editor: 'label'`, and the PI has no edit channel), so the two
    // cannot drift today. They WOULD the moment SourceName becomes editable — an edit
    // lands on the field and this row would keep showing the untouched bag. That is the
    // divergence ValueTypeNode's getPILayout comment records; the fix then is an atom, not
    // a descriptor, and this assertion is what fails to say so.
    const n = ConfigSetRefNode.parse(raw('Simulink.ConfigSetRef', { SourceName: 'sharedCfg' }), 'Ref', null);
    expect(piValue(n, 'sourceName')).toBe('sharedCfg');
    expect(n.SourceName).toBe('sharedCfg');
  });

  it('labels the SourceName row and keeps it read-only', () => {
    const row = (n: any) => (n.toPIObject().propertySheet.properties as any[]).find((p) => p.name === 'sourceName');
    const n = ConfigSetRefNode.parse(raw('Simulink.ConfigSetRef', { SourceName: 'sharedCfg' }), 'Ref', null);
    expect(row(n).displayName).toBe('Source Name');
    expect(row(n).editable).toBe(false);
  });

  it('opens with the identity group, then SourceName, then Description', () => {
    // SourceName sits AFTER the five identity keys rather than replacing `value`: the
    // fixed [Name, value-like, DataType, Kind, Class] opening is common to every
    // schema-driven class (test/schema/piGeneralAllNodes.test.ts pins that), and a
    // reference's source is a property of it, not its identity. Description stays last, as
    // in every other class file. No second group is invented, because no MATLAB
    // measurement says what one would be called.
    const n = ConfigSetRefNode.parse(
      raw('Simulink.ConfigSetRef', { SourceName: 'sharedCfg', Description: 'd' }),
      'Ref',
      null,
    );
    expect(piGroups(n)).toEqual([
      { name: 'General', items: ['Name', 'Value', 'DataType', 'Kind', 'Class', 'sourceName', 'Description'] },
    ]);
  });

  it('shows each ONCE — neither SourceName nor Description is in the "Other" group', () => {
    // Both were there before this change, and only there: a ConfigSetRef parsed with both
    // keys listed `Other.SourceName` and `Other.Description` and nothing else. An
    // unmodeled key (UseLocalSolver) is kept in the bag so what remains in "Other" is
    // visible rather than inferred.
    const n = ConfigSetRefNode.parse(
      raw('Simulink.ConfigSetRef', { SourceName: 'sharedCfg', Description: 'd', UseLocalSolver: false }),
      'Ref',
      null,
    );
    const names = piPropertyNames(n);
    expect(names.filter((p) => p === 'Description')).toEqual(['Description']);
    expect(names.filter((p) => p === 'sourceName')).toEqual(['sourceName']);
    expect(names).not.toContain('Other.Description');
    expect(names).not.toContain('Other.SourceName');
    expect(piGroups(n)[1]).toEqual({ name: 'Other', items: ['Other.UseLocalSolver'] });
  });
});

describe('the config-set save path keeps what the file had', () => {
  // Both directions, on both save paths, for both classes. The failure this rules out is
  // the one a gated property invites: a config set that never carried a Description gains
  // an empty one, so opening a dictionary and saving it with no edits produces a diff in
  // source control. The opposite failure — an edit accepted by the UI and dropped on save
  // — is the second half of each pair.
  const cases: { label: string; className: string; parse: (bag: Record<string, unknown>) => any; identity: Record<string, unknown> }[] = [
    {
      label: 'Simulink.ConfigSet',
      className: 'Simulink.ConfigSet',
      parse: (bag) => ConfigSetNode.parse(raw('Simulink.ConfigSet', bag), 'Cfg', null),
      // The key this class writes unconditionally, and its value for entry name 'Cfg'.
      identity: { Name: 'Cfg' },
    },
    {
      label: 'Simulink.ConfigSetRef',
      className: 'Simulink.ConfigSetRef',
      parse: (bag) => ConfigSetRefNode.parse(raw('Simulink.ConfigSetRef', bag), 'Ref', null),
      identity: { SourceName: 'shared' },
    },
  ];

  it('does not invent a Description the file never had, on either path', () => {
    for (const c of cases) {
      const n = c.parse({ ...c.identity });
      expect(binaryProps(n), `${c.label} binary`).not.toHaveProperty('Description');
      expect(textFileBag(n), `${c.label} text`).not.toHaveProperty('Description');
    }
  });

  it('carries a Description the file HAD straight back, on either path', () => {
    for (const c of cases) {
      const n = c.parse({ ...c.identity, Description: 'as the file spelled it' });
      expect(binaryProps(n)['Description'], `${c.label} binary`).toBe('as the file spelled it');
      expect(textFileBag(n)['Description'], `${c.label} text`).toBe('as the file spelled it');
    }
  });

  it('writes a Description the user typed onto an entry that had none, on either path', () => {
    for (const c of cases) {
      const n = c.parse({ ...c.identity });
      expect(n.setProperty('Description', 'typed in the inspector'), `${c.label} setProperty`).toBe(true);
      expect(binaryProps(n)['Description'], `${c.label} binary`).toBe('typed in the inspector');
      expect(textFileBag(n)['Description'], `${c.label} text`).toBe('typed in the inspector');
    }
  });

  it('leaves the identity key each class owns exactly as it was', () => {
    // The behaviour that must NOT have changed: ConfigSet writes `Name` and ConfigSetRef
    // writes `SourceName` UNCONDITIONALLY (a set MATLAB can load has to say what it is
    // called; a reference has to say what it points at), and adding a gated Description
    // beside them must not gate them or reorder them out of the bag.
    for (const c of cases) {
      for (const bag of [{ ...c.identity }, { ...c.identity, Description: 'd' }, {}]) {
        const n = c.parse(bag);
        const [key, value] = Object.entries(c.identity)[0];
        // An empty bag still gets the key: a ConfigSet falls back to the entry name, a
        // ConfigSetRef to ''.
        const expected = 'Name' in bag || 'SourceName' in bag ? value : key === 'Name' ? 'Cfg' : '';
        expect(binaryProps(n), `${c.label} binary ${JSON.stringify(bag)}`).toHaveProperty(key, expected);
        expect(textFileBag(n), `${c.label} text ${JSON.stringify(bag)}`).toHaveProperty(key, expected);
      }
    }
  });

  it('re-emits every other property in the bag untouched', () => {
    // The whole bag, not just the modeled keys: a config set holds dozens of solver
    // parameters we do not model, and a save that dropped or reordered them would lose
    // most of the entry.
    const cfg = ConfigSetNode.parse(
      raw('Simulink.ConfigSet', { Name: 'Cfg', Description: 'd', StopTime: '10', SystemTargetFile: 'grt.tlc' }),
      'Cfg',
      null,
    );
    expect(textProps(cfg)).toEqual({ Name: 'Cfg', Description: 'd', StopTime: '10', SystemTargetFile: 'grt.tlc' });
    const ref = ConfigSetRefNode.parse(
      raw('Simulink.ConfigSetRef', { SourceName: 'shared', Description: 'd', UseLocalSolver: false }),
      'Ref',
      null,
    );
    expect(textProps(ref)).toEqual({ SourceName: 'shared', Description: 'd', UseLocalSolver: false });
  });

  it('names the same keys on both save paths, in every state the gate distinguishes', () => {
    // The drift check: the two paths are two hand-written copies of one rule per class, so
    // a per-path literal cannot see them lose each other.
    for (const c of cases) {
      const states: [string, () => any][] = [
        ['no Description, untouched', () => c.parse({ ...c.identity })],
        [
          'no Description, user typed one',
          () => {
            const n = c.parse({ ...c.identity });
            n.setProperty('Description', 'x');
            return n;
          },
        ],
        [
          'file had a Description, user cleared it',
          () => {
            const n = c.parse({ ...c.identity, Description: 'x' });
            n.setProperty('Description', '');
            return n;
          },
        ],
      ];
      for (const [state, make] of states) {
        const n = make();
        expect(Object.keys(binaryProps(n)).sort(), `${c.label} — ${state}`).toEqual(
          Object.keys(textProps(n)).sort(),
        );
      }
    }
  });
});

describe('the config-set properties deliberately NOT modeled', () => {
  it('lists no StartTime, StopTime, SystemTargetFile or SourceLocation layout key', () => {
    // Pinned so a future reader sees the omission as a decision. The reasons, in full at
    // the top of this file: values at their default are not written at all; the modern
    // (R2026b+ JSON) path nests the three parameters inside a heterogeneous
    // Simulink.ConfigComponent array keyed by `_object_class`, which a fixed sourcePath
    // cannot address; one era (R2025a XML) carries none of them; and SourceLocation
    // exports as the literal `Base Workspace` even for a set that came from a dictionary.
    // A layout entry for any of them renders a permanently blank row on some era of every
    // real file — the defect this change removes, not a step towards parity.
    for (const className of ['Simulink.ConfigSet', 'Simulink.ConfigSetRef']) {
      const keys = getLayout(className)!.flatMap((g) => g.items);
      for (const excluded of ['startTime', 'stopTime', 'systemTargetFile', 'sourceLocation']) {
        expect(keys, `${className}/${excluded}`).not.toContain(excluded);
      }
    }
  });

  it('still shows them, unmodeled, when a file happens to carry them', () => {
    // Not modeling them is not hiding them: the PI's "Other" catch-all lists every raw
    // property the layout did not surface, so a file that HAS a StopTime shows it. That is
    // what makes a blank modeled row the strictly worse option — it would replace a row
    // that reads the file with one that cannot.
    const n = ConfigSetNode.parse(
      raw('Simulink.ConfigSet', { Name: 'Cfg', StopTime: '10', SystemTargetFile: 'grt.tlc' }),
      'Cfg',
      null,
    );
    expect(piGroups(n)[1]).toEqual({ name: 'Other', items: ['Other.StopTime', 'Other.SystemTargetFile'] });
    expect(piValue(n, 'Other.StopTime')).toBe('10');
    expect(piValue(n, 'Other.SystemTargetFile')).toBe('grt.tlc');
  });
});
