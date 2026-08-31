// Copyright 2026 The MathWorks, Inc.
//
// SectionNode — the four sections of a .sldd (Design Data, Architectural Data,
// Configurations, Other Data) and the entry create/remove/rename machinery hanging
// off them. dataModelMutations.test.ts drives these through a real session, which
// exercises the happy paths; this suite goes at the section directly to reach the
// gating and the shared-namespace rules a session-level test cannot easily set up.
//
// Two behaviours here are subtle enough to be worth stating up front:
//
//   1. Design and Architectural Data share ONE flat name space (both map to
//      NS_DESIGN). A name unique within `design` may still collide with an `arch`
//      entry, and MATLAB refuses to load a dictionary with a duplicate — so
//      _uniqueName must look across BOTH sections, not just its own children.
//   2. getAllowedTypes returning [] means "no restriction", not "nothing allowed".
//      A section whose key is not in ALLOWED_TYPES therefore accepts everything;
//      inverting that reading would make such a section silently unusable.
import { describe, it, expect } from 'vitest';
import SectionNode from '../src/datamodel/node/container/SectionNode.js';
import SlddNode from '../src/datamodel/node/container/SlddNode.js';
import { generateUuid } from '../src/datamodel/node/container/SectionNode.js';
import { NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER } from '../src/datamodel/SectionConstants.js';
import { getClass, getRegisteredClasses } from '../src/datamodel/node/NodeClassMap.js';

// A real SlddNode already builds the four sections wired to a parent, which is
// what the namespace and dirty-flag logic reads.
const sldd = (name = 'd.sldd') => new SlddNode(name);
const sectionOf = (root: SlddNode, key: string) => root.getSection(key)!;

describe('presentation', () => {
  it('shows the human label, not the section key', () => {
    // The key ('design') is the protocol name used by addEntry/getSection; the
    // tree must show the catalog label.
    const s = sectionOf(sldd(), 'design');
    expect(s.name).toBe('design');
    expect(s.displayName).toBe('Design Data');
    expect(s.icon).toBe('databaseFolderDesign');
    expect(s.isContainer).toBe(true);
  });

  it('gives Configurations its own column set, since a config set has no Value', () => {
    // A ConfigSet's displayValue is '' by design, so a Value column would be a
    // column of blanks. Description/Status carry the useful information instead.
    expect(sectionOf(sldd(), 'config').tableColumnConfig).toEqual({
      columns: ['Name', 'Description', 'Status'],
    });
  });

  it('gives every other section the standard entry columns', () => {
    const root = sldd();
    for (const key of ['design', 'arch', 'other']) {
      expect(sectionOf(root, key).tableColumnConfig, key).toEqual({
        columns: ['Name', 'Value', 'DataType', 'Status', 'UsedBy'],
      });
    }
  });
});

describe('allowsType / getAllowedTypes', () => {
  it('admits a class its own allow-list names', () => {
    const root = sldd();
    expect(sectionOf(root, 'design').allowsType('Simulink.Parameter')).toBe(true);
    expect(sectionOf(root, 'config').allowsType('Simulink.ConfigSet')).toBe(true);
    expect(sectionOf(root, 'arch').allowsType('Simulink.ServiceBus')).toBe(true);
  });

  it('refuses a class that belongs to a different section', () => {
    // This is the gate the host's paste/drop path consults before moving an
    // entry between sections — a Parameter has no meaning in Configurations.
    const root = sldd();
    expect(sectionOf(root, 'config').allowsType('Simulink.Parameter')).toBe(false);
    expect(sectionOf(root, 'design').allowsType('Simulink.ConfigSet')).toBe(false);
    // A ServiceBus is architectural only.
    expect(sectionOf(root, 'design').allowsType('Simulink.ServiceBus')).toBe(false);
  });

  it('refuses a class no section models at all', () => {
    expect(sectionOf(sldd(), 'design').allowsType('Simulink.NotAThing')).toBe(false);
  });

  it('treats an empty allow-list as no restriction, matching addEntry', () => {
    // A section key absent from ALLOWED_TYPES gets []. allowsType must read that
    // as "unrestricted" — the same reading addEntry uses — or such a section
    // would accept nothing while addEntry accepted everything.
    const loose = new SectionNode('notAKnownKey', null, 'Loose', 'databaseFolder');
    expect(loose.getAllowedTypes()).toEqual([]);
    expect(loose.allowsType('Simulink.Parameter')).toBe(true);
    expect(loose.allowsType('anything at all')).toBe(true);
  });

  it('lets Design and Architectural Data each hold value and numeric types', () => {
    // Both sections model ValueType/NumericType; a fixture has an arch-side
    // ValueType interface and a modeled NumericType, so dropping them from the
    // arch list would break that file's paste path.
    const root = sldd();
    for (const cls of ['Simulink.ValueType', 'Simulink.NumericType', 'Simulink.AliasType']) {
      expect(sectionOf(root, 'design').allowsType(cls), cls).toBe(true);
      expect(sectionOf(root, 'arch').allowsType(cls), cls).toBe(true);
    }
  });
});

describe('addEntry', () => {
  it('creates a default node of the class, parents it, and stamps section metadata', () => {
    const root = sldd();
    const design = sectionOf(root, 'design');
    const node = design.addEntry('Simulink.Parameter', 'Kp')!;
    expect(node.name).toBe('Kp');
    expect(node.className).toBe('Simulink.Parameter');
    expect(node.parent).toBe(design);
    expect(design.children).toContain(node);
    // The metadata is what places the entry back in this section on reload.
    expect(node.metadata!.namespace).toBe(NS_DESIGN);
    expect(node.metadata!.isderived).toBe('0');
    expect(node.metadata!.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(node.metadata!.lastmod).toMatch(/^\d{8}T\d{6}\.000000$/);
    expect(node.status).toBe('New');
  });

  it('marks an arch entry derived, which is the whole Design/Arch distinction', () => {
    // On disk an arch entry is byte-identical to a design one apart from
    // isderived; getSectionKey reads it back to choose the section.
    const node = sectionOf(sldd(), 'arch').addEntry('Simulink.Signal', 'sig')!;
    expect(node.metadata!.namespace).toBe(NS_DESIGN);
    expect(node.metadata!.isderived).toBe('1');
    expect(node.isDerived).toBe(true);
  });

  it('stamps the Configurations and Other namespaces', () => {
    const root = sldd();
    expect(sectionOf(root, 'config').addEntry('Simulink.ConfigSet')!.metadata!.namespace).toBe(NS_CONFIGURATIONS);
    expect(sectionOf(root, 'other').addEntry('MatlabVariable')!.metadata!.namespace).toBe(NS_OTHER);
  });

  it('falls back to the class declared default name when none is given', () => {
    const root = sldd();
    // 'Param', NOT 'Parameter' — the declared defaultName wins, and it is not the
    // className's last segment.
    expect(sectionOf(root, 'design').addEntry('Simulink.Parameter')!.name).toBe('Param');
    expect(sectionOf(root, 'arch').addEntry('Simulink.ServiceBus')!.name).toBe('ServiceInterface');
    expect(sectionOf(root, 'design').addEntry('Simulink.data.dictionary.EnumTypeDefinition')!.name).toBe('EnumType');
  });

  it('uses each class own declared default name, not a shared one', () => {
    // Every node class declares its own `static get defaultName`, and addEntry is
    // the only caller. A class that inherited a sibling's name would silently
    // create entries called e.g. "Bus" in a Breakpoint slot.
    const loose = new SectionNode('notAKnownKey', null, 'Loose', 'databaseFolder');
    const expected: [string, string][] = [
      ['Simulink.Breakpoint', 'Breakpoint'],
      ['Simulink.LookupTable', 'LookupTable'],
      ['Simulink.NumericType', 'NumericType'],
      ['Simulink.AliasType', 'AliasType'],
      ['Simulink.Bus', 'Bus'],
      ['Simulink.Signal', 'Signal'],
      ['Simulink.ValueType', 'ValueType'],
    ];
    for (const [cls, name] of expected) {
      const node = loose.addEntry(cls);
      expect(node, cls).toBeTruthy();
      expect(node!.name, cls).toBe(name);
      // Only the first of each class gets the bare name; drop it so the next
      // class is not deconflicted against a leftover sibling.
      loose.removeChild(node!);
    }
  });

  it('refuses a class the section does not allow', () => {
    expect(sectionOf(sldd(), 'config').addEntry('Simulink.Parameter', 'Kp')).toBeNull();
    expect(sectionOf(sldd(), 'config').children).toEqual([]);
  });

  it('refuses an unregistered class rather than creating an empty node', () => {
    const loose = new SectionNode('notAKnownKey', null, 'Loose', 'databaseFolder');
    expect(loose.addEntry('Simulink.NotAThing')).toBeNull();
    expect(loose.children).toEqual([]);
  });

  // addEntry names a new entry `entryName || NodeClass.defaultName`, and the
  // defaultName is what the user sees in the tree — it is NOT the className's last
  // segment (an EnumTypeDefinition entry is named 'EnumType', a ServiceBus one
  // 'ServiceInterface'). NodeClassType makes defaultName required so a new class
  // cannot omit it, but required-ness alone does not stop an empty string, which
  // would produce an entry named '1', '2', … out of _uniqueName.
  it('every registered class declares a non-empty defaultName', () => {
    for (const className of getRegisteredClasses()) {
      expect(getClass(className)!.defaultName, className).toBeTruthy();
    }
  });

  it('dirties the file root, so the save prompt appears', () => {
    const root = sldd();
    expect(root.dirty).toBe(false);
    sectionOf(root, 'design').addEntry('Simulink.Parameter', 'Kp');
    expect(root.dirty).toBe(true);
  });

  it('works on a detached section, which has no root to dirty', () => {
    // The dirty walk is guarded because a section built standalone (tests, or a
    // node constructed before it is attached) has no SlddNode above it.
    const detached = new SectionNode('design', null, 'Design Data', 'databaseFolderDesign');
    const node = detached.addEntry('Simulink.Parameter', 'Kp');
    expect(node).toBeTruthy();
    expect(node!.parent).toBe(detached);
  });
});

describe('_uniqueName and the shared Design/Arch namespace', () => {
  it('leaves an unused name alone', () => {
    expect(sectionOf(sldd(), 'design')._uniqueName('Kp')).toBe('Kp');
  });

  it('suffixes past every taken name in sequence', () => {
    const design = sectionOf(sldd(), 'design');
    expect(design.addEntry('Simulink.Parameter', 'Kp')!.name).toBe('Kp');
    expect(design.addEntry('Simulink.Parameter', 'Kp')!.name).toBe('Kp1');
    expect(design.addEntry('Simulink.Parameter', 'Kp')!.name).toBe('Kp2');
    // ...and skips a gap left by a name that was taken directly.
    design.addEntry('Simulink.Parameter', 'Kp4');
    expect(design.addEntry('Simulink.Parameter', 'Kp')!.name).toBe('Kp3');
    expect(design.addEntry('Simulink.Parameter', 'Kp')!.name).toBe('Kp5');
  });

  it('avoids a name taken by the OTHER section in the same namespace', () => {
    // Design and Arch share NS_DESIGN, so this is the collision that would
    // otherwise write a dictionary MATLAB refuses to load.
    const root = sldd();
    sectionOf(root, 'arch').addEntry('Simulink.Signal', 'shared');
    expect(sectionOf(root, 'design')._uniqueName('shared')).toBe('shared1');
    expect(sectionOf(root, 'design').addEntry('Simulink.Signal', 'shared')!.name).toBe('shared1');
    // ...and symmetrically: arch now sees design's 'shared1' too.
    expect(sectionOf(root, 'arch')._uniqueName('shared')).toBe('shared2');
  });

  it('suffixes the base name it was given, not the numeric stem inside it', () => {
    // Asking for 'shared1' when 'shared1' is taken yields 'shared11', not
    // 'shared2' — the counter appends to the argument verbatim. Callers pass a
    // user-typed or default base, so this only surfaces when a name that already
    // ends in a digit is re-added, and it still produces a unique name.
    const root = sldd();
    sectionOf(root, 'design').addEntry('Simulink.Signal', 'shared1');
    expect(sectionOf(root, 'arch')._uniqueName('shared1')).toBe('shared11');
  });

  it('does NOT avoid a name in a different namespace', () => {
    // Configurations is its own namespace, so a config set named 'shared' must
    // not push a design entry to 'shared1' — that would be a spurious rename.
    const root = sldd();
    sectionOf(root, 'config').addEntry('Simulink.ConfigSet', 'shared');
    expect(sectionOf(root, 'design')._uniqueName('shared')).toBe('shared');
  });

  it('falls back to its own children when the section is detached', () => {
    // No parent means no siblings to scan; the section still must not hand out a
    // name it already holds.
    const detached = new SectionNode('design', null, 'Design Data', 'databaseFolderDesign');
    detached.addEntry('Simulink.Parameter', 'Kp');
    expect(detached._namespaceEntryNames()).toEqual(['Kp']);
    expect(detached._uniqueName('Kp')).toBe('Kp1');
  });

  it('falls back to its own children when the section key has no namespace', () => {
    // An unknown key is not in SECTION_NAMESPACE, so there is no namespace to
    // group siblings by — scanning them anyway would mix unrelated names in.
    const root = sldd();
    const loose = new SectionNode('notAKnownKey', root, 'Loose', 'databaseFolder');
    root.addChild(loose);
    sectionOf(root, 'design').addEntry('Simulink.Parameter', 'Kp');
    loose.addEntry('Simulink.Parameter', 'Mine');
    expect(loose._namespaceEntryNames()).toEqual(['Mine']);
    expect(loose._uniqueName('Kp')).toBe('Kp');
  });

  it('reports every name across both namespace sections', () => {
    const root = sldd();
    sectionOf(root, 'design').addEntry('Simulink.Parameter', 'a');
    sectionOf(root, 'arch').addEntry('Simulink.Signal', 'b');
    sectionOf(root, 'config').addEntry('Simulink.ConfigSet', 'c');
    expect(sectionOf(root, 'design')._namespaceEntryNames().sort()).toEqual(['a', 'b']);
    expect(sectionOf(root, 'config')._namespaceEntryNames()).toEqual(['c']);
  });
});

describe('execAddEntry — undo/redo', () => {
  it('returns the node plus an undo that removes it and a redo that restores its place', () => {
    const root = sldd();
    const design = sectionOf(root, 'design');
    design.addEntry('Simulink.Parameter', 'first');
    const result = design.execAddEntry('Simulink.Parameter', 'second')!;
    expect(result.node.name).toBe('second');
    expect(design.children.map((c) => c.name)).toEqual(['first', 'second']);

    result.undo();
    expect(design.children.map((c) => c.name)).toEqual(['first']);
    expect(result.node.parent).toBeNull();

    result.redo();
    expect(design.children.map((c) => c.name)).toEqual(['first', 'second']);
    expect(result.node.parent).toBe(design);
  });

  it('redo restores the original position, not the end of the list', () => {
    // The index is captured at add time so a redo after other edits does not
    // reorder the section — entry order is what the user sees and what is saved.
    const root = sldd();
    const design = sectionOf(root, 'design');
    const first = design.execAddEntry('Simulink.Parameter', 'first')!;
    design.addEntry('Simulink.Parameter', 'second');
    design.addEntry('Simulink.Parameter', 'third');
    first.undo();
    expect(design.children.map((c) => c.name)).toEqual(['second', 'third']);
    first.redo();
    expect(design.children.map((c) => c.name)).toEqual(['first', 'second', 'third']);
  });

  it('survives repeated undo/redo cycles without duplicating the node', () => {
    // addChild adopts without detaching, so a redo that ran twice would list the
    // node twice. Each undo must fully remove it first.
    const design = sectionOf(sldd(), 'design');
    const r = design.execAddEntry('Simulink.Parameter', 'Kp')!;
    for (let i = 0; i < 3; i++) {
      r.undo();
      r.redo();
    }
    expect(design.children.filter((c) => c.name === 'Kp')).toHaveLength(1);
  });

  it('returns null when the entry could not be added, so no undo step is recorded', () => {
    // A caller that pushed an undo step for a refused add would later "undo" a
    // removal that never happened.
    expect(sectionOf(sldd(), 'config').execAddEntry('Simulink.Parameter', 'Kp')).toBeNull();
  });
});

describe('execRemoveEntry — undo/redo', () => {
  it('removes the node and hands back an undo that puts it back where it was', () => {
    const root = sldd();
    const design = sectionOf(root, 'design');
    design.addEntry('Simulink.Parameter', 'a');
    const middle = design.addEntry('Simulink.Parameter', 'b')!;
    design.addEntry('Simulink.Parameter', 'c');

    const result = design.execRemoveEntry(middle)!;
    expect(design.children.map((c) => c.name)).toEqual(['a', 'c']);

    result.undo();
    expect(design.children.map((c) => c.name)).toEqual(['a', 'b', 'c']);
    expect(middle.parent).toBe(design);

    result.redo();
    expect(design.children.map((c) => c.name)).toEqual(['a', 'c']);
  });

  it('dirties the file root', () => {
    const root = sldd();
    const design = sectionOf(root, 'design');
    const node = design.addEntry('Simulink.Parameter', 'Kp')!;
    root.dirty = false;
    design.execRemoveEntry(node);
    expect(root.dirty).toBe(true);
  });

  it('returns null for a node that is not a child, leaving the tree untouched', () => {
    // A stale selection can name a node already removed; returning a bogus undo
    // would re-add it on the next Ctrl+Z.
    const root = sldd();
    const design = sectionOf(root, 'design');
    const stranger = sectionOf(root, 'arch').addEntry('Simulink.Signal', 'sig')!;
    expect(design.execRemoveEntry(stranger)).toBeNull();
    expect(sectionOf(root, 'arch').children).toContain(stranger);
  });

  it('works on a detached section, which has no root to dirty', () => {
    const detached = new SectionNode('design', null, 'Design Data', 'databaseFolderDesign');
    const node = detached.addEntry('Simulink.Parameter', 'Kp')!;
    expect(detached.execRemoveEntry(node)).toBeTruthy();
    expect(detached.children).toEqual([]);
  });
});

describe('parseEntry', () => {
  const entry = (name: string, value: unknown, metadata?: Record<string, unknown>) => ({
    name,
    value,
    ...(metadata ? { metadata } : {}),
  });

  it('parses the value into a class-appropriate node, attaches it, and keeps the metadata', () => {
    const design = sectionOf(sldd(), 'design');
    const meta = { namespace: NS_DESIGN, isderived: '0', uuid: 'u' };
    const node = design.parseEntry(entry('Kp', { _type: 'double', _value: '1' }, meta))!;
    expect(node.name).toBe('Kp');
    expect(node.parent).toBe(design);
    expect(design.children).toContain(node);
    expect(node.metadata).toBe(meta);
  });

  it('normalizes a missing metadata bag to null rather than undefined', () => {
    // isDerived and the section-key lookup both read metadata; undefined would
    // sail past a `metadata === null` guard.
    const node = sectionOf(sldd(), 'design').parseEntry(entry('v', { _type: 'double', _value: '1' }))!;
    expect(node.metadata).toBeNull();
  });

  it('names an entry with no name at all rather than leaving it undefined', () => {
    const node = sectionOf(sldd(), 'design').parseEntry({ value: { _type: 'double', _value: '1' } })!;
    expect(node.name).toBe('');
  });

  it('carries rawXml through for byte-exact re-serialization', () => {
    // An entry we cannot fully model is re-emitted verbatim on save; dropping
    // rawXml here would silently rewrite it.
    const raw = '<entry Name="x"/>';
    const node = sectionOf(sldd(), 'design').parseEntry({ name: 'x', value: { _type: 'double', _value: '1' }, rawXml: raw })!;
    expect(node.rawXml).toBe(raw);
  });

  it('reclasses a derived plain variable as a Constant', () => {
    // parseValue picks the class from the value shape alone and never sees
    // metadata, so this is the seam that makes Design↔Arch conversion automatic.
    // Note className is the MATLAB type ('double') either way — the reclass shows
    // up as the node's constructor and its Kind, not its className.
    const arch = sectionOf(sldd(), 'arch');
    const node = arch.parseEntry(entry('c', { _type: 'double', _value: '5' }, { namespace: NS_DESIGN, isderived: '1' }))!;
    expect(node.constructor.name).toBe('ConstantNode');
    expect(node.kind).toBe('Constant');
    expect(node.canAddChild()).toBe(false);
    expect(node.parent).toBe(arch);
    expect(arch.children).toContain(node);
    // Only the wrapper is attached — the pre-reclass node must not also be listed.
    expect(arch.children).toHaveLength(1);
  });

  it('leaves a NON-derived plain variable a plain variable', () => {
    const node = sectionOf(sldd(), 'design').parseEntry(
      entry('v', { _type: 'double', _value: '5' }, { namespace: NS_DESIGN, isderived: '0' }),
    )!;
    expect(node.constructor.name).toBe('MatlabVariableNode');
    expect(node.kind).not.toBe('Constant');
  });

  it('applies a systemcomposer classification, and flags a StructType', () => {
    // A StructType and a DataInterface are both Simulink.Bus on disk — only the
    // catalog distinguishes them, and isStructType is what the UI branches on.
    const arch = sectionOf(sldd(), 'arch');
    const busValue = { _array_class: 'Simulink.Bus', _dimensions: [1, 1], _elements: [{ _properties: {} }] };
    const catalog = {
      interfaces: { Iface: 'systemcomposer.architecture.model.interface.CompositeDataInterface' },
      modeledDataTypes: { MyStruct: 'systemcomposer.property.StructDataType' },
    };

    const iface = arch.parseEntry(entry('Iface', busValue), catalog)!;
    expect(iface.classification).toBe('DataInterface');
    // BusNode initializes isStructType to false; only the StructType branch sets it.
    expect((iface as unknown as { isStructType?: boolean }).isStructType).toBe(false);

    const struct = arch.parseEntry(entry('MyStruct', busValue), catalog)!;
    expect(struct.classification).toBe('StructType');
    expect((struct as unknown as { isStructType?: boolean }).isStructType).toBe(true);
  });

  it('leaves an entry the catalog does not name unclassified', () => {
    const arch = sectionOf(sldd(), 'arch');
    const catalog = { interfaces: {}, modeledDataTypes: {} };
    const node = arch.parseEntry(entry('x', { _type: 'double', _value: '1' }), catalog)!;
    expect(node.classification).toBeUndefined();
  });

  it('accepts an absent catalog, which is the standalone .sldd case', () => {
    const node = sectionOf(sldd(), 'design').parseEntry(entry('x', { _type: 'double', _value: '1' }), null)!;
    expect(node.classification).toBeUndefined();
  });
});

describe('generateUuid', () => {
  it('produces a lowercase-hex 8-4-4-4-12 string', () => {
    // The dictionary format expects this exact shape for every entry.
    expect(generateUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('does not repeat across many calls', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateUuid()));
    expect(seen.size).toBe(200);
  });
});
