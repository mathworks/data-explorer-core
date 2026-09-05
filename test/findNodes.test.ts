// test/findNodes.test.ts
// Copyright 2026 The MathWorks, Inc.
//
// Search and query across a session. findNodeById was the only lookup this package
// offered, so every host wrote its own flatten().filter(...): the same predicate
// duplicated in three consumers (a VS Code extension, a CLI, an RPC server), each
// walking the whole tree again per keystroke. session.findNodes() is that filter,
// written once, over the flat node index the session already maintains.
//
// What is under test is mostly the CONTRACT rather than the mechanics, because a
// query API's decisions all live in the corners a host hits on its second day:
//
//   - criteria combine with AND, so a two-field query is always a narrowing and
//     never a union;
//   - a RegExp is honoured exactly as written — `caseSensitive` never rewrites its
//     flags, and a stateful /g/ pattern must not match every OTHER node;
//   - a query with no criteria in it matches nothing, and no field's absence is
//     allowed to mean something different from that;
//   - the order is document order and it is fixed, because a results list and this
//     suite both read it positionally;
//   - a node whose value cannot be read has no value to match: it must neither match
//     a value query nor take the whole search down with it;
//   - the index tracks mutation, so a node just added is findable and a node just
//     deleted is not.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function loadFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

function bytes(name: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// arch.sldd is the fixture with a real vocabulary in it: eight architectural entry
// classes over four sections, three different kinds of element child, and a handful
// of entries that render a value. Every count asserted below is a property of that
// file, so the assertions read as statements about a dictionary rather than about a
// synthetic tree built to suit the query engine.
function archSession(srcId = 'arch.sldd') {
  const s = createSession();
  const src = s.addDataSource(srcId, loadFixture('arch.sldd')) as any;
  return { s, src };
}

const ids = (nodes: any[]) => nodes.map((n) => n.id);

// The six nodes of arch.sldd whose NAME contains 'Element', in the order the session
// indexed them — which is the order flatten() yields, i.e. document order.
const ELEMENT_IDS = [
  'arch.sldd/arch/DataInterface/Element',
  'arch.sldd/arch/DataInterface/Element1',
  'arch.sldd/arch/PhysicalInterface/Element',
  'arch.sldd/arch/PhysicalInterface/Element1',
  'arch.sldd/arch/StructType/Element',
  'arch.sldd/arch/StructType/Element1',
];

// The same six, for a session that loaded arch.sldd under a different srcId. A node
// id is path-derived from the root's name, so the srcId is its first segment.
const elementIds = (srcId: string) => ELEMENT_IDS.map((id) => srcId + id.slice('arch.sldd'.length));

describe('findNodes() — by name', () => {
  it('matches a substring of the name, case-insensitively by default', () => {
    const { s } = archSession();
    expect(ids(s.findNodes({ name: 'Element' }))).toEqual(ELEMENT_IDS);
    expect(ids(s.findNodes({ name: 'element' }))).toEqual(ELEMENT_IDS);
    // A substring, not a whole-string match: 'Elem' finds the same six.
    expect(ids(s.findNodes({ name: 'Elem' }))).toEqual(ELEMENT_IDS);
  });

  it('honours caseSensitive for a string pattern', () => {
    const { s } = archSession();
    expect(s.findNodes({ name: 'element', caseSensitive: true })).toEqual([]);
    expect(ids(s.findNodes({ name: 'Element', caseSensitive: true }))).toEqual(ELEMENT_IDS);
  });

  it('tests a RegExp against the name', () => {
    const { s } = archSession();
    // Anchored, which a substring pattern cannot express — the reason a RegExp is
    // accepted at all. Only the three 'Element1' nodes end in a digit.
    expect(ids(s.findNodes({ name: /^Element\d$/ }))).toEqual([
      'arch.sldd/arch/DataInterface/Element1',
      'arch.sldd/arch/PhysicalInterface/Element1',
      'arch.sldd/arch/StructType/Element1',
    ]);
  });

  it('never rewrites a RegExp’s own flags', () => {
    // A caller that wrote a RegExp already chose its case sensitivity with the `i`
    // flag, so `caseSensitive` must not add one or take one away. If it did, the
    // pattern a host debugged in isolation would behave differently once it reached
    // this call, and the flag it wrote would be a lie.
    const { s } = archSession();
    // No `i`, so still case-sensitive even under the default caseSensitive: false.
    expect(s.findNodes({ name: /element/ })).toEqual([]);
    expect(s.findNodes({ name: /element/, caseSensitive: false })).toEqual([]);
    // `i` present, so still case-insensitive even when asked for the opposite.
    expect(ids(s.findNodes({ name: /element/i, caseSensitive: true }))).toEqual(ELEMENT_IDS);
  });

  it('matches every node with a global RegExp, not every other one', () => {
    // RegExp.prototype.test on a /g/ or /y/ pattern advances lastIndex and resumes
    // from there on the next call, so reusing one caller-supplied pattern across a
    // whole index matches roughly every second node — and a host retyping the same
    // search would watch its own results flicker.
    const { s } = archSession();
    const pattern = /Element/g;
    expect(ids(s.findNodes({ name: pattern }))).toEqual(ELEMENT_IDS);
    // Twice, because the damage this guards against is carried in the pattern object
    // and would show up on the second call even if the first were clean.
    expect(ids(s.findNodes({ name: pattern }))).toEqual(ELEMENT_IDS);
    expect(pattern.lastIndex).toBe(0);
  });
});

describe('findNodes() — by class, kind and value', () => {
  it('matches className exactly, not as a substring', () => {
    const { s } = archSession();
    // Two entries are a Simulink.Bus. Five nodes are a Simulink.BusElement, and a
    // substring match would drag all five in behind them.
    expect(ids(s.findNodes({ className: 'Simulink.Bus' }))).toEqual([
      'arch.sldd/arch/DataInterface',
      'arch.sldd/arch/StructType',
    ]);
    expect(s.findNodes({ className: 'Simulink.BusElement' })).toHaveLength(5);
  });

  it('applies caseSensitive to an exact className match too', () => {
    const { s } = archSession();
    expect(s.findNodes({ className: 'simulink.bus' })).toHaveLength(2);
    expect(s.findNodes({ className: 'simulink.bus', caseSensitive: true })).toEqual([]);
  });

  it('matches the Kind column, which is not the class', () => {
    // The two are deliberately different vocabularies: 'Bus Element' is what the
    // Kind column shows for the class Simulink.BusElement, and a host offering a
    // filter over what the user can see needs the former.
    const { s } = archSession();
    const kindHits = s.findNodes({ kind: 'Bus Element' });
    expect(kindHits).toHaveLength(5);
    expect(kindHits.every((n: any) => n.className === 'Simulink.BusElement')).toBe(true);
    expect(s.findNodes({ kind: 'Simulink.BusElement' })).toEqual([]);
  });

  it('matches the rendered value a host displays', () => {
    const { s } = archSession();
    // The three function elements of the service interface are the entries in this
    // fixture that render a signature as their Value.
    expect(ids(s.findNodes({ value: 'y = f' }))).toEqual([
      'arch.sldd/arch/ServiceInterface/f',
      'arch.sldd/arch/ServiceInterface/f1',
      'arch.sldd/arch/ServiceInterface/f2',
    ]);
    expect(ids(s.findNodes({ value: /^y = f1/ }))).toEqual(['arch.sldd/arch/ServiceInterface/f1']);
    // The value criterion is matched against the same string the Value column shows,
    // so what a user searched for is what a user could read.
    for (const hit of s.findNodes({ value: 'y = f' })) {
      expect((hit as any).toRow().Value).toBe((hit as any).displayValue);
    }
  });

  it('never matches a node that has no value on a value query', () => {
    // Sections and the entries whose content is structure rather than a value render
    // an empty Value. A value query must not sweep them up — that is the difference
    // between a search and a listing.
    const { s, src } = archSession();
    const valueless = (src.flatten() as any[]).filter((n) => n.displayValue === '');
    expect(valueless.length).toBeGreaterThan(0);
    for (const query of [{ value: 'y' }, { value: 'enum' }, { value: /./ }]) {
      const hits = s.findNodes(query);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((n: any) => n.displayValue !== '')).toBe(true);
    }
    // An empty value is still ASKABLE, by a pattern that says so: /^$/ is the caller
    // opting in explicitly, which is a different thing from being swept up by a
    // pattern that was about something else.
    expect(ids(s.findNodes({ value: /^$/ }))).toEqual(ids(valueless));
  });

  it('survives a node whose value cannot be read, and does not match it', () => {
    // A node's value is a getter over parsed content, and a host may hand the session
    // a tree this package did not build (addParsedSource exists for exactly that). One
    // node that throws on read must not take the whole search down: it has no value to
    // match, so it fails a value query and stays findable by everything else.
    const { s } = archSession();
    const root: any = {
      name: 'hostile.sldd',
      isContainer: true,
      parent: null,
      children: [] as any[],
      get id() { return this.name; },
      flatten() { return this.children; },
    };
    const bad: any = {
      name: 'boom',
      parent: root,
      children: [],
      get id() { return 'hostile.sldd/boom'; },
      get className() { return 'Host.Node'; },
      get kind() { return 'Hostile'; },
      get displayValue(): string { throw new Error('value getter exploded'); },
    };
    root.children.push(bad);
    s.addParsedSource('hostile.sldd', root);

    // Asserted by reference identity throughout, never with toEqual or toContain:
    // both compare structurally, which reads the exploding getter from inside the
    // assertion and would fail this test for a reason that has nothing to do with
    // the code under test.
    const has = (nodes: any[]) => nodes.some((n) => n === bad);
    expect(() => s.findNodes({ value: 'y = f' })).not.toThrow();
    expect(has(s.findNodes({ value: 'y = f' }))).toBe(false);
    // Not even for /^$/, the one pattern an empty value satisfies: a value that could
    // not be read is not a value that read as empty. It might render as anything —
    // that is precisely what is unknown — so no claim about it holds, while the nodes
    // that genuinely render nothing still answer the same query.
    const emptyValued = s.findNodes({ value: /^$/ });
    expect(has(emptyValued)).toBe(false);
    expect(emptyValued.length).toBeGreaterThan(0);
    // Still an ordinary, findable node by every criterion that does not need its value.
    expect(ids(s.findNodes({ name: 'boom' }))).toEqual(['hostile.sldd/boom']);
    expect(s.findNodes({ name: 'boom' })[0]).toBe(bad);
    expect(s.findNodes({ className: 'Host.Node' })[0]).toBe(bad);
    expect(s.findNodes({ kind: 'Hostile' })).toHaveLength(1);
    // And the rest of the session is still searchable with it loaded.
    expect(ids(s.findNodes({ name: 'Element' }))).toEqual(ELEMENT_IDS);
  });
});

describe('findNodes() — combining criteria', () => {
  it('narrows with AND, never widens with OR', () => {
    const { s } = archSession();
    // Two criteria that each match on their own and share no node between them. Under
    // OR this would return eight; under AND it is the empty set, which is the whole
    // point — a second criterion can only ever take results away.
    expect(s.findNodes({ className: 'Simulink.Bus' })).toHaveLength(2);
    expect(s.findNodes({ name: 'Element' })).toHaveLength(6);
    expect(s.findNodes({ className: 'Simulink.Bus', name: 'Element' })).toEqual([]);
  });

  it('applies every criterion, not just the first one it can', () => {
    const { s } = archSession();
    // Of the six nodes named '…Element…', only the two under the physical interface
    // are a connection element.
    expect(ids(s.findNodes({ name: 'Element', className: 'Simulink.ConnectionElement' }))).toEqual([
      'arch.sldd/arch/PhysicalInterface/Element',
      'arch.sldd/arch/PhysicalInterface/Element1',
    ]);
    // Four criteria at once, including a value and a scope.
    expect(
      ids(
        s.findNodes({
          name: 'f',
          kind: 'Function Element',
          value: /\(u,v\)$/,
          sourceId: 'arch.sldd',
        }),
      ),
    ).toEqual(['arch.sldd/arch/ServiceInterface/f', 'arch.sldd/arch/ServiceInterface/f2']);
  });
});

describe('findNodes() — scope, order and limit', () => {
  it('searches every open source at once', () => {
    // The complaint the API answers: there was no lookup that crossed sources at all,
    // so a host that wanted one wrote a walk per file and concatenated the results.
    const s = createSession();
    s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd'));
    s.addMatSource('strings.mat', bytes('strings.mat'));
    const hits = s.findNodes({ kind: 'MATLAB Variable' });
    expect(new Set(hits.map((n: any) => n.id.split('/')[0]))).toEqual(
      new Set(['numeric_json.sldd', 'strings.mat']),
    );
    // Sources come out in the order they were indexed, so one source's nodes are a
    // contiguous run rather than interleaved with another's.
    const owners = hits.map((n: any) => n.id.split('/')[0]);
    expect(owners.lastIndexOf('numeric_json.sldd')).toBeLessThan(owners.indexOf('strings.mat'));
  });

  it('restricts to one source with sourceId', () => {
    const s = createSession();
    s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd'));
    s.addMatSource('strings.mat', bytes('strings.mat'));
    const scoped = s.findNodes({ kind: 'MATLAB Variable', sourceId: 'strings.mat' });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((n: any) => n.id.startsWith('strings.mat/'))).toBe(true);
    expect(scoped.length).toBeLessThan(s.findNodes({ kind: 'MATLAB Variable' }).length);
  });

  it('finds the same names in two sources, and one source when scoped', () => {
    // The same file opened twice under two ids: every name is duplicated, which is
    // what makes the scoped and unscoped answers distinguishable.
    const s = createSession();
    s.addDataSource('a.sldd', loadFixture('arch.sldd'));
    s.addDataSource('b.sldd', loadFixture('arch.sldd'));
    expect(ids(s.findNodes({ name: 'Element' }))).toEqual([...elementIds('a.sldd'), ...elementIds('b.sldd')]);
    expect(ids(s.findNodes({ name: 'Element', sourceId: 'b.sldd' }))).toEqual(elementIds('b.sldd'));
  });

  it('returns nothing for a sourceId the session does not hold', () => {
    // Not "every source", which is what an ignored scope would silently mean — the
    // same answer getDataSource gives for an id it does not know.
    const { s } = archSession();
    expect(s.getDataSource('not-loaded.sldd')).toBeNull();
    expect(s.findNodes({ name: 'Element', sourceId: 'not-loaded.sldd' })).toEqual([]);
  });

  it('stops returning the nodes of a closed source', () => {
    const s = createSession();
    s.addDataSource('a.sldd', loadFixture('arch.sldd'));
    s.addDataSource('b.sldd', loadFixture('arch.sldd'));
    s.removeDataSource('a.sldd');
    expect(ids(s.findNodes({ name: 'Element' }))).toEqual(elementIds('b.sldd'));
  });

  it('returns matches in document order, and the same order every time', () => {
    const { s, src } = archSession();
    const hits = s.findNodes({ name: 'Element' });
    expect(ids(hits)).toEqual(ELEMENT_IDS);
    // Which is exactly the order a tree view draws: the order flatten() yields.
    // Asserted against the literal list as well, so that a change to either one has
    // to be a deliberate change to the documented contract.
    expect(ids(hits)).toEqual(ids((src.flatten() as any[]).filter((n) => n.name.includes('Element'))));
    expect(ids(s.findNodes({ name: 'Element' }))).toEqual(ELEMENT_IDS);
  });

  it('caps the result set with limit, keeping the first matches in order', () => {
    const { s } = archSession();
    expect(ids(s.findNodes({ name: 'Element', limit: 2 }))).toEqual(ELEMENT_IDS.slice(0, 2));
    expect(ids(s.findNodes({ name: 'Element', limit: 1 }))).toEqual(ELEMENT_IDS.slice(0, 1));
    // A cap above the number of matches is not an error and pads nothing.
    expect(ids(s.findNodes({ name: 'Element', limit: 99 }))).toEqual(ELEMENT_IDS);
  });

  it('treats a limit below one as a cap that admits nothing', () => {
    // The opposite reading — 0 as "uncapped" — would turn an off-by-one in a host's
    // paging arithmetic into the largest answer the session can produce.
    const { s } = archSession();
    expect(s.findNodes({ name: 'Element', limit: 0 })).toEqual([]);
    expect(s.findNodes({ name: 'Element', limit: -1 })).toEqual([]);
  });
});

describe('findNodes() — a query with no criteria in it', () => {
  it('matches nothing for an empty query, on a session that is not empty', () => {
    const { s } = archSession();
    expect(s.findNodes({ name: 'Element' }).length).toBeGreaterThan(0);
    expect(s.findNodes({})).toEqual([]);
  });

  it('treats every field explicitly undefined exactly as an empty query', () => {
    // A host builds a query object from optional inputs, so `{ name: undefined }` is
    // the ordinary shape of "the user typed nothing". It must not mean something
    // different from `{}` — whichever answer is right, both have to get it.
    const { s } = archSession();
    expect(
      s.findNodes({
        name: undefined,
        className: undefined,
        kind: undefined,
        value: undefined,
        sourceId: undefined,
        caseSensitive: undefined,
        limit: undefined,
      }),
    ).toEqual([]);
  });

  it('treats an empty string as no criterion rather than as a match-all', () => {
    // A substring test against '' passes for every node, so an empty search box would
    // otherwise return every node in every open file — the largest allocation the
    // session can make and the one nobody asked for.
    const { s } = archSession();
    expect(s.findNodes({ name: '' })).toEqual([]);
    expect(s.findNodes({ value: '' })).toEqual([]);
    expect(s.findNodes({ className: '', kind: '' })).toEqual([]);
    // Narrowing an empty criterion with a real one still runs the real one.
    expect(ids(s.findNodes({ name: '', className: 'Simulink.Bus' }))).toEqual([
      'arch.sldd/arch/DataInterface',
      'arch.sldd/arch/StructType',
    ]);
  });

  it('matches nothing for a query of modifiers alone', () => {
    // sourceId, caseSensitive and limit shape an answer; they do not select one. A
    // scope with nothing to scope is not a request for the whole file.
    const { s } = archSession();
    expect(s.findNodes({ sourceId: 'arch.sldd' })).toEqual([]);
    expect(s.findNodes({ caseSensitive: true, limit: 5 })).toEqual([]);
  });
});

describe('findNodes() — what comes back', () => {
  it('hands back the live nodes, the same ones findNodeById resolves', () => {
    // Not DTOs: an in-process host edits what it finds, and toDTO is applied at the
    // out-of-process edge by the caller that needs it.
    const { s, src } = archSession();
    const hit = s.findNodes({ name: 'Element' })[0] as any;
    const fromTree = (src.flatten() as any[]).find((n) => n.id === ELEMENT_IDS[0]);
    expect(hit).toBe(fromTree);
    expect(hit).toBe(s.findNodeById(ELEMENT_IDS[0]));
    expect(typeof hit.getProperties).toBe('function');
  });

  it('returns an empty array for a query that matches nothing', () => {
    const { s } = archSession();
    expect(s.findNodes({ name: 'NoSuchNameAnywhere' })).toEqual([]);
    expect(s.findNodes({ className: 'Simulink.NoSuchClass' })).toEqual([]);
    expect(s.findNodes({ kind: 'No Such Kind' })).toEqual([]);
    expect(s.findNodes({ value: 'no such value' })).toEqual([]);
  });

  it('does not search the source roots, exactly as findNodeById does not resolve them', () => {
    // The index holds the nodes INSIDE each open source; a root is named by
    // getDataSourceIds()/getDataSource(), not found by search. Pinned here because
    // the two lookups have to agree about what is in the index.
    const { s, src } = archSession();
    expect(s.findNodeById(src.id)).toBeNull();
    expect(s.findNodes({ name: 'arch.sldd' })).toEqual([]);
  });
});

describe('findNodes() — the index tracks mutation', () => {
  it('finds a node the moment it is added, and stops when it is deleted', () => {
    const { s, src } = archSession();
    expect(s.findNodes({ name: 'FindMeNewly' })).toEqual([]);
    expect(s.findNodes({ className: 'Simulink.Parameter' })).toEqual([]);

    s.setActiveContext(src);
    const added = s.addEntry('design', 'Simulink.Parameter', 'FindMeNewly') as any;
    expect(added).toBeTruthy();
    expect(ids(s.findNodes({ name: 'FindMeNewly' }))).toEqual([added.id]);
    expect(s.findNodes({ name: 'FindMeNewly' })[0]).toBe(added);
    // Findable by what it IS, not only by the name it was given.
    expect(s.findNodes({ className: 'Simulink.Parameter' })).toContain(added);

    expect(s.deleteNodeById(added.id)).toBe(true);
    expect(s.findNodes({ name: 'FindMeNewly' })).toEqual([]);
    expect(s.findNodes({ className: 'Simulink.Parameter' })).not.toContain(added);
    // The sibling lookup agrees, which is what "one index" is supposed to mean.
    expect(s.findNodeById(added.id)).toBeNull();
  });

  it('finds a non-entry child added under a node by id', () => {
    // The other half of the add path: a child appended inside an entry rather than a
    // new entry in a section. numeric_json.sldd is the fixture with array and cell
    // variables that accept one (the same node test/headlessMutation.test.ts mutates).
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    const parent = (src.flatten() as any[]).find((n) => typeof n.execAddChild === 'function');
    expect(parent).toBeTruthy();
    const child = s.addChildTo(parent.id) as any;
    expect(child).toBeTruthy();
    expect(s.findNodes({ name: child.name, sourceId: 'numeric_json.sldd' })).toContain(child);
    expect(s.deleteNodeById(child.id)).toBe(true);
    expect(s.findNodes({ name: child.name, sourceId: 'numeric_json.sldd' })).not.toContain(child);
  });
});

describe('findNode() — the first match', () => {
  it('returns the first match under the same order findNodes uses', () => {
    const { s } = archSession();
    const first = s.findNode({ name: 'Element' });
    expect(first).toBe(s.findNodes({ name: 'Element' })[0]);
    expect((first as any).id).toBe(ELEMENT_IDS[0]);
  });

  it('returns null rather than throwing when nothing matches', () => {
    const { s } = archSession();
    expect(s.findNode({ name: 'NoSuchNameAnywhere' })).toBeNull();
    // Same rule as findNodes: no criteria, no match.
    expect(s.findNode({})).toBeNull();
    expect(s.findNode({ sourceId: 'arch.sldd' })).toBeNull();
  });

  it('ignores a caller’s limit, because one match is not five', () => {
    const { s } = archSession();
    expect(s.findNode({ name: 'Element', limit: 5 })).toBe(s.findNodes({ name: 'Element' })[0]);
    // Even a limit that would have suppressed the answer entirely: asking for the
    // first match is a different question from asking for a capped list.
    expect(s.findNode({ name: 'Element', limit: 0 })).toBe(s.findNodes({ name: 'Element' })[0]);
  });
});
