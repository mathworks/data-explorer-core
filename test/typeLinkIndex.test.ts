// Copyright 2026 The MathWorks, Inc.
//
// Which names in a source count as TYPE DEFINITIONS — the index a Data Type cell's
// link is resolved against.
//
// The rule is CLASS-gated and TOP-LEVEL-only, and both halves are load-bearing. A
// `Simulink.Parameter` named `adtBool` must not be a link target, because a Data Type
// cell naming `adtBool` does not mean that parameter; and a bus ELEMENT named
// `adtBool` must not be one either, because an element is not a definition. Neither
// mistake is visible in a rendered table — both produce a plausible link to the wrong
// row — so they are pinned here.
import { describe, it, expect } from 'vitest';
import { buildTypeLinkIndex, typeLinkIndexOf, typeLinkTargetIn } from '../src/core/typeLinkIndex.js';
import type { ISourceNode } from '../src/core/NodeInterfaces.js';

// A stand-in for the two-level shape the walk expects (source → sections → entries),
// built by hand rather than parsed: this test is about the WALK and the class gate, and
// a fixture would put a parser between the rule and its assertion. The real tree is
// covered in test/typeLinkCell.test.ts and test/typeLinkFixture.test.ts.
function fakeNode(name: string, className: string, isEntry: boolean, children: unknown[] = []): unknown {
  return { name, className, isEntry, children };
}
function fakeSource(sections: unknown[]): ISourceNode {
  return { name: 'src', className: 'Simulink.data.Dictionary', children: sections } as unknown as ISourceNode;
}

describe('buildTypeLinkIndex', () => {
  it('admits the five type-defining classes and nothing else', () => {
    const source = fakeSource([
      fakeNode('Design Data', 'section', false, [
        fakeNode('adtUint8', 'Simulink.AliasType', true),
        fakeNode('ntFix16', 'Simulink.NumericType', true),
        fakeNode('avtEngSt', 'Simulink.data.dictionary.EnumTypeDefinition', true),
        fakeNode('artFsAimCmd', 'Simulink.Bus', true),
        fakeNode('vtSpeed', 'Simulink.ValueType', true),
        fakeNode('Kp', 'Simulink.Parameter', true),
        fakeNode('Sig', 'Simulink.Signal', true),
      ]),
    ]);
    expect([...buildTypeLinkIndex(source)].sort()).toEqual(
      ['adtUint8', 'artFsAimCmd', 'avtEngSt', 'ntFix16', 'vtSpeed'].sort(),
    );
  });

  it('ignores a node that is not an entry, however it is classed', () => {
    // A bus ELEMENT can carry a type-defining class in a malformed tree and is still
    // not a definition. `isEntry` is the same gate definedNamesOf applies.
    const source = fakeSource([
      fakeNode('Design Data', 'section', false, [
        fakeNode('artFsAimCmd', 'Simulink.Bus', true, [fakeNode('adtUint8', 'Simulink.AliasType', false)]),
      ]),
    ]);
    expect([...buildTypeLinkIndex(source)]).toEqual(['artFsAimCmd']);
  });

  it('reads entries at the root too, for a .mat that has no sections', () => {
    const source = fakeSource([fakeNode('adtUint8', 'Simulink.AliasType', true)]);
    expect([...buildTypeLinkIndex(source)]).toEqual(['adtUint8']);
  });

  it('survives a malformed source rather than taking the whole answer down', () => {
    // addParsedSource takes a tree this package did not build — the same reason
    // definedNamesOf is defensive.
    const source = { children: [null, { children: null }, { name: '', className: 'Simulink.Bus', isEntry: true, children: [] }] } as unknown as ISourceNode;
    expect([...buildTypeLinkIndex(source)]).toEqual([]);
  });
});

describe('typeLinkIndexOf', () => {
  it('builds once and caches on the source node', () => {
    const source = fakeSource([fakeNode('adtUint8', 'Simulink.AliasType', true)]);
    const first = typeLinkIndexOf(source);
    expect(typeLinkIndexOf(source)).toBe(first);
    expect(source._typeLinkIndex).toBe(first);
  });

  it('rebuilds after the cache slot is cleared', () => {
    const source = fakeSource([fakeNode('adtUint8', 'Simulink.AliasType', true)]);
    const first = typeLinkIndexOf(source);
    source._typeLinkIndex = null;
    const second = typeLinkIndexOf(source);
    expect(second).not.toBe(first);
    expect([...second]).toEqual(['adtUint8']);
  });
});

describe('typeLinkTargetIn', () => {
  const source = fakeSource([
    fakeNode('Design Data', 'section', false, [
      fakeNode('adtUint8', 'Simulink.AliasType', true),
      fakeNode('Kp', 'Simulink.Parameter', true),
    ]),
  ]);

  it('answers core’s own link grammar for a type-defining entry', () => {
    expect(typeLinkTargetIn(source, 'd.sldd', 'adtUint8')).toBe('adtUint8@d.sldd');
  });

  it('answers null for a name no type defines', () => {
    expect(typeLinkTargetIn(source, 'd.sldd', 'single')).toBeNull();
    expect(typeLinkTargetIn(source, 'd.sldd', 'Kp')).toBeNull();
    expect(typeLinkTargetIn(source, 'd.sldd', '')).toBeNull();
  });
});
