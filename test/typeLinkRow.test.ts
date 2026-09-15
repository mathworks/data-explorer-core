// Copyright 2026 The MathWorks, Inc.
//
// The Data Type link, on a real tree, through a real session.
//
// Two facts, and the second is the one worth the file. First, that a Data Type naming a
// type definition in the same dictionary comes out of toRow as a link. Second, that it
// does so for a class whose SCHEMA lists dataType and for a class whose schema does not —
// asserted against each other rather than one at a time, because those are two different
// lines writing the same cell (the prop loop and the fallback), and one rule implemented
// twice is the bug class this codebase keeps rediscovering. The link is applied in one
// post-step downstream of both, and this is what says so.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import BaseNode from '../src/datamodel/node/BaseNode.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const loadJson = (name: string) => JSON.parse(readFileSync(fixture(name), 'utf8')) as Record<string, unknown>;

// The fixture Task 7 authors. Its full contents and the rule table it covers are that
// task's business; what matters here is that it holds an AliasType `adtUint8`, a Bus
// `artFsAimCmd`, a Parameter `Kp` typed `adtUint8`, and a Parameter `Gain` typed `double`.
const DICT = 'typeLink.sldd';

// EXACT-match, and do not simplify this to `findNodes(...)[0]`. The `name` criterion is a
// case-insensitive SUBSTRING test (src/core/findQuery.ts — only className and kind compare
// whole strings) returning document order, so in this fixture `{ name: 'NumSig' }` yields
// `EnumSig` first, `{ name: 'Fix' }` yields `ntFix16`, and `{ name: 'ElemOnly' }` yields the
// bus element `elemOnlyType`. Taking [0] asserts against the wrong row, and for `NumSig` the
// wrong row carries a link too, so it fails looking like a broken rule.
function rowOf(srcId: string, session: ReturnType<typeof createSession>, name: string): Record<string, unknown> {
  const node = session.findNodes({ sourceId: srcId, name }).find((n) => n.name === name && n.isEntry === true);
  if (!node) {
    throw new Error(`the fixture holds no entry named ${name}`);
  }
  return node.toRow() as unknown as Record<string, unknown>;
}

describe('toRow links a Data Type that names a type definition', () => {
  it('turns a resolving bare name into a link cell', () => {
    const s = createSession();
    s.addDataSource('d.sldd', loadJson(DICT));
    expect(rowOf('d.sldd', s, 'Kp').DataType).toEqual({ text: 'adtUint8', linkTarget: 'adtUint8@d.sldd' });
  });

  it('leaves a built-in a plain string, the shape it has always been', () => {
    const s = createSession();
    s.addDataSource('d.sldd', loadJson(DICT));
    expect(rowOf('d.sldd', s, 'Gain').DataType).toBe('double');
  });

  it('links the name half of a qualified cell and leaves the qualifier plain', () => {
    const s = createSession();
    s.addDataSource('d.sldd', loadJson(DICT));
    // BusSig is a Simulink.Signal whose DataType reads `Bus: artFsAimCmd`.
    expect(rowOf('d.sldd', s, 'BusSig').DataType).toEqual({
      prefix: 'Bus: ',
      text: 'artFsAimCmd',
      linkTarget: 'artFsAimCmd@d.sldd',
    });
  });

  it('applies the SAME rule to two different props feeding one column', () => {
    // Simulink.Parameter reaches the DataType column through PropDataType; a
    // Simulink.AliasType reaches it through PropBaseType (see AliasTypeNode: "PropBaseType
    // owns the Data Type column"). Two props, one column, one rule — and the drift this
    // catches is concrete: a link applied inside PropDataType.format would miss every
    // alias-of-an-alias, and nothing else in the suite would notice.
    const s = createSession();
    s.addDataSource('d.sldd', loadJson(DICT));
    // adtCounter is a Simulink.AliasType whose BaseType is adtUint8.
    const viaPropDataType = rowOf('d.sldd', s, 'Kp').DataType;
    const viaPropBaseType = rowOf('d.sldd', s, 'adtCounter').DataType;
    expect(viaPropBaseType).toEqual(viaPropDataType);
    expect(viaPropBaseType).toEqual({ text: 'adtUint8', linkTarget: 'adtUint8@d.sldd' });
  });

  it('applies it on the FALLBACK path too, for a class with no DataType prop', () => {
    // No shipping class reaches `if (!('DataType' in row))` with a non-empty dataType
    // today — every data node lists a DataType-column prop, and the two that do not
    // (EnumTypeNode, ServiceBusNode) answer ''. So the path is held open with a minimal
    // node here rather than with a fixture entry: it is the arm a NEW class arrives on,
    // and the post-step covering both is the only reason it would work on arrival.
    const s = createSession();
    const src = s.addDataSource('d.sldd', loadJson(DICT));
    class NoDataTypeProp extends BaseNode {
      override getProperties(): never[] {
        return [];
      }
      override get dataType(): string {
        return 'adtUint8';
      }
    }
    const [section] = (src as unknown as { children: BaseNode[] }).children;
    const node = new NoDataTypeProp('Fallback', section);
    section.addChild(node);
    expect(node.toRow()!.DataType).toEqual({ text: 'adtUint8', linkTarget: 'adtUint8@d.sldd' });
  });

  it('round-trips through resolveLink to the node the cell points at', () => {
    // The target is core's own grammar, so the session reads it back with no new parser.
    const s = createSession();
    s.addDataSource('d.sldd', loadJson(DICT));
    const cell = rowOf('d.sldd', s, 'Kp').DataType as { linkTarget: string };
    const resolved = s.resolveLink(cell.linkTarget);
    expect(resolved.status).toBe('resolved');
    expect(resolved.node?.name).toBe('adtUint8');
    expect(resolved.node?.className).toBe('Simulink.AliasType');
  });

  it('leaves the cell plain on a tree no session registered', () => {
    // No resolver, so no link and no crash — the same silence _usedByCell keeps.
    const s = createSession();
    const src = s.addDataSource('d.sldd', loadJson(DICT));
    delete (src as unknown as { _typeLinkResolver?: unknown })._typeLinkResolver;
    expect(rowOf('d.sldd', s, 'Kp').DataType).toBe('adtUint8');
  });

  it('shares one frozen cell between two rows of the same Data Type', () => {
    // A flat all-strings object pools fine (RowCellPool.keyOf refuses only nested objects
    // and object arrays). Two rows, one cell — which is what keeps the link from costing
    // an object per row on a 128,000-row dictionary.
    const s = createSession();
    const src = s.addDataSource('d.sldd', loadJson(DICT));
    const rows = s.rowsOf(src);
    const linked = rows.filter(
      (r) => typeof r.DataType === 'object' && r.DataType !== null && (r.DataType as { text?: string }).text === 'adtUint8',
    );
    expect(linked.length).toBeGreaterThan(1);
    expect(linked[0].DataType).toBe(linked[1].DataType);
    expect(Object.isFrozen(linked[0].DataType)).toBe(true);
  });
});
