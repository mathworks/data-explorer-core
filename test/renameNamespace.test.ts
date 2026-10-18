// Copyright 2026 The MathWorks, Inc.
//
// The duplicate-name rule an entry rename applies, across the edits that change which names a
// dictionary holds. Design Data and Architectural Data share one namespace (NS_DESIGN), so an
// entry's new name must be free across both; Configurations and Other Data each have their own.
// MATLAB refuses to open a dictionary that holds one name twice in a namespace.
//
// Guards for F1-23 (renameAtScale.test.ts), which made the check a lookup in an index the
// dictionary keeps rather than a scan of every name on every rename. An index is only as good as
// the edits that keep it current, so each case here makes one such edit and then asks the rule
// a question whose answer that edit changed: an add, a removal and their undo and redo, a
// rename and its undo, a replaced node, a section leaving the dictionary, and a name two entries
// share. They hold with the scan as well, which is what makes them a guard of equivalence.

import { describe, it, expect } from 'vitest';
import { createSession } from '../src/index.js';
import SectionNode from '../src/datamodel/node/container/SectionNode.js';
import { NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER } from '../src/datamodel/SectionConstants.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SECTION_META: Record<string, { namespace: string; isderived: string }> = {
  design: { namespace: NS_DESIGN, isderived: '0' },
  arch: { namespace: NS_DESIGN, isderived: '1' },
  config: { namespace: NS_CONFIGURATIONS, isderived: '0' },
  other: { namespace: NS_OTHER, isderived: '0' },
};

// A session holding a text dictionary of scalar entries, `spec` naming each entry's section and
// name, in file order.
function dictionary(spec: Array<[string, string]>) {
  const entries = spec.map(([section, name], i) => ({
    name,
    metadata: { uuid: 'u' + i, ...SECTION_META[section], lastmod: '20260506T140856.858540', modifiedby: '' },
    value: i + 1,
  }));
  const s = createSession();
  const src = s.addDataSource('ns.sldd', {
    __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
    __MW_TEXT_PARTS__: { '__MW_TEXT_PART__/data/chunk0': { __MW_TEXT_content: { entries } } },
  }) as any;
  const section = (key: string) => src.getSection(key);
  const entry = (key: string, name: string) => section(key).children.find((e: any) => e.name === name);
  return { s, src, section, entry };
}

const REFUSED = (name: string) => ({ error: true, reason: "'" + name + "' already exists in Design or Architectural Data" });

describe('renaming an entry: the names its namespace holds', () => {
  it('refuses a Design sibling\'s name and an Architectural entry\'s name, from either side', () => {
    const { entry } = dictionary([['design', 'A'], ['design', 'B'], ['arch', 'Z']]);
    expect(entry('design', 'A').setProperty('Name', 'B')).toMatchObject(REFUSED('B'));
    expect(entry('design', 'A').setProperty('Name', 'Z')).toMatchObject(REFUSED('Z'));
    expect(entry('arch', 'Z').setProperty('Name', 'A')).toMatchObject(REFUSED('A'));
    expect(entry('design', 'A').name).toBe('A');
  });

  it('accepts a Configurations or Other Data entry\'s name, which is another namespace', () => {
    const { entry } = dictionary([['design', 'A'], ['design', 'B'], ['config', 'C'], ['other', 'O']]);
    expect(entry('design', 'A').setProperty('Name', 'C')).toBe(true);
    expect(entry('design', 'B').setProperty('Name', 'O')).toBe(true);
    // And in their own namespace the rule holds as well.
    expect(entry('config', 'C').setProperty('Name', 'C')).toBe(true);
    expect(entry('other', 'O').setProperty('Name', 'O')).toBe(true);
  });

  it('follows a rename: the old name is free and the new one taken', () => {
    const { entry, section } = dictionary([['design', 'A'], ['design', 'B'], ['arch', 'C']]);
    const [a, b] = section('design').children;
    const c = entry('arch', 'C');
    expect(a.setProperty('Name', 'X')).toBe(true);
    expect(b.setProperty('Name', 'A')).toBe(true);
    expect(c.setProperty('Name', 'X')).toMatchObject(REFUSED('X'));
    expect(c.setProperty('Name', 'B')).toBe(true);
    expect(a.setProperty('Name', 'C')).toBe(true);
    expect(b.setProperty('Name', 'C')).toMatchObject(REFUSED('C'));
  });

  it('follows an entry added after the dictionary was read, and removed again', () => {
    const { entry, section } = dictionary([['design', 'A']]);
    const a = entry('design', 'A');
    expect(a.setProperty('Name', 'B')).toBe(true); // the rule has been asked once already
    const added = section('arch').addEntry('Simulink.Bus', 'N');
    expect(added).toBeTruthy();
    expect(a.setProperty('Name', 'N')).toMatchObject(REFUSED('N'));
    section('arch').removeChild(added);
    expect(a.setProperty('Name', 'N')).toBe(true);
  });

  it('is not moved by removing a node the section does not hold', () => {
    const { entry, section } = dictionary([['design', 'A'], ['design', 'B']]);
    const a = entry('design', 'A');
    expect(a.setProperty('Name', 'C')).toBe(true); // the rule has been asked once already
    const stranger = NodeRegistry.parseValue(7, 'B', null) as any;
    section('design').removeChild(stranger);
    expect(section('design').children.length).toBe(2);
    expect(a.setProperty('Name', 'B')).toMatchObject(REFUSED('B'));
  });

  it('follows an entry pasted in (parseEntry)', () => {
    const { entry, section } = dictionary([['design', 'A']]);
    const a = entry('design', 'A');
    expect(a.setProperty('Name', 'B')).toBe(true);
    section('design').parseEntry({ name: 'P', metadata: { uuid: 'uP' }, value: 3 });
    expect(a.setProperty('Name', 'P')).toMatchObject(REFUSED('P'));
  });

  it('follows execAddEntry and its undo and redo, and execRemoveEntry and its undo', () => {
    const { entry, section } = dictionary([['design', 'A'], ['design', 'R']]);
    const a = entry('design', 'A');
    expect(a.setProperty('Name', 'B')).toBe(true);
    const step = section('design').execAddEntry('Simulink.Parameter', 'N');
    expect(a.setProperty('Name', 'N')).toMatchObject(REFUSED('N'));
    step.undo();
    expect(a.setProperty('Name', 'N')).toBe(true);
    expect(a.setProperty('Name', 'B')).toBe(true);
    step.redo();
    expect(a.setProperty('Name', 'N')).toMatchObject(REFUSED('N'));

    const removal = section('design').execRemoveEntry(entry('design', 'R'));
    expect(a.setProperty('Name', 'R')).toBe(true);
    expect(a.setProperty('Name', 'B')).toBe(true);
    removal.undo();
    expect(a.setProperty('Name', 'R')).toMatchObject(REFUSED('R'));
  });

  it('follows an entry replaced in its slot by a node of another name (_replaceWith)', () => {
    const { entry, section } = dictionary([['design', 'A'], ['design', 'B']]);
    const a = entry('design', 'A');
    expect(a.setProperty('Name', 'C')).toBe(true); // the rule has been asked once already
    const fresh = NodeRegistry.parseValue(7, 'Q', section('design')) as any;
    expect(entry('design', 'B')._replaceWith(fresh)).toBe(true);
    expect(a.setProperty('Name', 'Q')).toMatchObject(REFUSED('Q'));
    expect(a.setProperty('Name', 'B')).toBe(true);
  });

  it('follows a section leaving the dictionary and coming back', () => {
    const { src, entry, section } = dictionary([['design', 'A'], ['arch', 'Z']]);
    const a = entry('design', 'A');
    expect(a.setProperty('Name', 'Z')).toMatchObject(REFUSED('Z'));
    const arch = section('arch');
    const at = src.children.indexOf(arch);
    src.removeChild(arch);
    expect(a.setProperty('Name', 'Z')).toBe(true);
    expect(a.setProperty('Name', 'A')).toBe(true);
    src.addChild(arch, at);
    expect(a.setProperty('Name', 'Z')).toMatchObject(REFUSED('Z'));
  });

  it('follows a section replaced by another of the same name and as many edits', () => {
    const { src, entry, section } = dictionary([['design', 'A'], ['arch', 'Z']]);
    const a = entry('design', 'A');
    expect(a.setProperty('Name', 'B')).toBe(true); // the rule has been asked once already
    const arch = section('arch');
    const at = src.children.indexOf(arch);
    const fresh = new SectionNode('arch', src, arch.label, arch.iconId);
    fresh._readEntry({ name: 'W', metadata: { uuid: 'uW', namespace: NS_DESIGN, isderived: '1' }, value: 5 });
    expect(fresh._entriesVersion).toBe(arch._entriesVersion);
    src.removeChild(arch);
    src.addChild(fresh, at);
    expect(a.setProperty('Name', 'W')).toMatchObject(REFUSED('W'));
    expect(a.setProperty('Name', 'Z')).toBe(true);
  });

  it('follows a rename made in a section while it was out of the dictionary', () => {
    const { src, entry, section } = dictionary([['design', 'A'], ['arch', 'Z']]);
    const a = entry('design', 'A');
    const z = entry('arch', 'Z');
    expect(a.setProperty('Name', 'B')).toBe(true); // the rule has been asked once already
    const arch = section('arch');
    const at = src.children.indexOf(arch);
    src.removeChild(arch);
    expect(z.setProperty('Name', 'Y')).toBe(true);
    src.addChild(arch, at);
    expect(a.setProperty('Name', 'Y')).toMatchObject(REFUSED('Y'));
    expect(a.setProperty('Name', 'Z')).toBe(true);
  });

  it('counts a name two entries share as held twice: renaming one twin away leaves it taken', () => {
    const { section } = dictionary([['design', 'T'], ['design', 'T'], ['design', 'V']]);
    const [t1, t2, v] = section('design').children;
    expect(t1.setProperty('Name', 'U')).toBe(true);
    expect(v.setProperty('Name', 'T')).toMatchObject(REFUSED('T'));
    expect(t1.setProperty('Name', 'T')).toMatchObject(REFUSED('T'));
    expect(t2.setProperty('Name', 'W')).toBe(true);
    expect(v.setProperty('Name', 'T')).toBe(true);
  });

  it('follows a session rename and its undo and redo', () => {
    const { s, entry, section } = dictionary([['design', 'A'], ['design', 'B']]);
    const a = entry('design', 'A');
    const b = entry('design', 'B');
    s.setActive(section('design'), a);
    expect(s.editProperty(a.id, 'Name', 'X')).toBe(true);
    expect(b.setProperty('Name', 'A')).toBe(true);
    expect(b.setProperty('Name', 'B')).toBe(true);
    s.undo();
    expect(a.name).toBe('A');
    expect(b.setProperty('Name', 'A')).toMatchObject(REFUSED('A'));
    expect(b.setProperty('Name', 'X')).toBe(true);
    expect(b.setProperty('Name', 'B')).toBe(true);
    s.redo();
    expect(a.name).toBe('X');
    expect(b.setProperty('Name', 'X')).toMatchObject(REFUSED('X'));
    expect(b.setProperty('Name', 'A')).toBe(true);
  });

  it('a section on its own (no dictionary) checks its own entries', () => {
    const detached = new SectionNode('design', null, 'Design Data', 'databaseFolderDesign');
    detached.addEntry('Simulink.Parameter', 'Kp');
    const ki = detached.addEntry('Simulink.Parameter', 'Ki')!;
    expect(ki.setProperty('Name', 'Kp')).toMatchObject(REFUSED('Kp'));
    expect(ki.setProperty('Name', 'Kd')).toBe(true);
  });
});
