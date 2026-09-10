// src/core/findQuery.ts
// Copyright 2026 The MathWorks, Inc.
//
// A FindNodesQuery, compiled into the per-node tests that answer it.
//
// This is the whole of the "decide what matching MEANS" half of session.findNodes(),
// and it is separate from the session because it needs nothing from one: it reads the
// caller's query object and a node's own getters, holds no state between calls, and
// touches neither the node index, the open sources nor the event bus. Compiling a query
// and running it over a session are two different jobs, and only the second one is
// session bookkeeping — so the corners that a query API's behaviour actually lives in
// (an empty search box, a caller's `/g` pattern, a getter that throws) can be read,
// reviewed and reasoned about here without 1900 lines of session around them.
//
// What stayed in `core/DataModel.ts`, so that this file is not mistaken for the whole
// search: session.findNodes() owns everything that needs the session — the walk over
// the flat node index, the `sourceId` scope (compared by walking to the owning root),
// the `limit`, and the ordering guarantee. It also owns the two DECISIONS that read
// like they might be here and are not:
//
//   * criteria combine with AND — that is the inner loop in findNodes, which rejects a
//     node at the first criterion that says no;
//   * a query with no criteria matches NOTHING — compileCriteria simply returns an
//     empty array for such a query, and findNodes is what turns an empty array into an
//     empty answer rather than into "everything passes an AND over nothing".
//
// Both are documented on findNodes, which is where a host reads them. Changing either
// one is a change to findNodes, not to this file.

import type { INode } from './NodeInterfaces.js';
import type { FindNodesQuery } from './sessionTypes.js';

// One query field, reduced to a test over a node. Compiled once per query rather
// than re-decided per node, so the per-node cost is a call and a string compare
// instead of a walk back through the query object.
export type NodeCriterion = (node: INode) => boolean;

// Whether a query field was actually asked about.
//
// `undefined` is the field a host left out. `''` is the field it filled in from an
// empty search box, and it is treated as ALSO not asked: a substring test against ''
// passes for every node, so honouring it would answer "the user has typed nothing"
// with every node in every open file — the largest allocation the session can make
// and the one nobody asked for. A caller that really means "renders as empty" says
// so with a pattern, `/^$/`, which this leaves alone. A RegExp is never `''`, so an
// explicit `new RegExp('')` stays a match-all: a pattern object is a choice, an
// empty string is a blank.
function isAsked(field: string | RegExp | undefined): boolean {
  return field !== undefined && field !== '';
}

// A criterion over one piece of a node's text.
//
// The read is defensive. Name, class, kind and value are all getters over parsed
// content, and a host may hand the session a tree this package did not build
// (session.addParsedSource() exists for exactly that), so one node that throws on read
// must not take a whole search down — the same rule readPropertyValue applies on the
// edit path over in DataModel.ts.
//
// A failed read is NOT the empty string: a criterion is a claim about a field, and a
// field that cannot be read is a claim that cannot be checked, so it is false. Folding
// it to '' instead would let `{ value: /^$/ }` — a caller asking specifically which
// nodes render no value — answer with a node whose value might render as anything, if
// only it could be read.
function textCriterion(read: (node: INode) => string, test: (text: string) => boolean): NodeCriterion {
  return (node) => {
    let text: string;
    try {
      text = read(node);
    } catch {
      return false;
    }
    return typeof text === 'string' && test(text);
  };
}

// A caller's string or RegExp as a test over one piece of text. `whole` picks between
// the two kinds of string criterion described on FindNodesQuery.
function compileTextTest(
  pattern: string | RegExp,
  caseSensitive: boolean,
  whole: boolean,
): (text: string) => boolean {
  if (typeof pattern !== 'string') {
    // A RegExp is honoured exactly as written: `caseSensitive` never adds an `i` flag
    // and never takes one away, because the caller already made that choice and a
    // pattern that behaves differently inside this call than it did in the host's own
    // test is worse than either default.
    //
    // The one rewrite is `g`/`y`, and it is not optional. RegExp.prototype.test on a
    // global or sticky pattern advances lastIndex and resumes from there next call,
    // so reusing one caller-supplied pattern across a whole index would match roughly
    // every SECOND node — and because the state lives in the caller's object, a host
    // retyping the same search would watch its own results flicker. Cloned rather
    // than reset per node so the caller's own object is never mutated, and once per
    // query rather than once per node.
    if (pattern.global || pattern.sticky) {
      const stateless = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
      return (text) => stateless.test(text);
    }
    return (text) => pattern.test(text);
  }
  if (caseSensitive) {
    return whole ? (text) => text === pattern : (text) => text.includes(pattern);
  }
  // Folded once here, per query, rather than per node per criterion.
  const folded = pattern.toLowerCase();
  return whole ? (text) => text.toLowerCase() === folded : (text) => text.toLowerCase().includes(folded);
}

// The criteria a query asks for, in the order they should be evaluated: the two
// whole-string compares first, then the name substring, and the VALUE last —
// displayValue formats its content on read (a large matrix or cell renders through
// the display-convention machinery), so it is the one field worth not reading for a
// node another criterion has already rejected.
export function compileCriteria(query: FindNodesQuery): NodeCriterion[] {
  const caseSensitive = query.caseSensitive === true;
  const criteria: NodeCriterion[] = [];
  if (isAsked(query.className)) {
    criteria.push(textCriterion((node) => node.className, compileTextTest(query.className!, caseSensitive, true)));
  }
  if (isAsked(query.kind)) {
    criteria.push(textCriterion((node) => node.kind, compileTextTest(query.kind!, caseSensitive, true)));
  }
  if (isAsked(query.name)) {
    // The node's own name — the identifier its id is built from, and the same string
    // findNodeById resolves against — not its rendered displayName. The two differ
    // only for positional elements, whose label embeds the PARENT's name ('Array(1)'
    // for the node named '1'), so matching the label as well would make a search for
    // `Array` return every element of every array and bury the variable in its own
    // contents. A host that wants label matching has displayName one field away.
    criteria.push(textCriterion((node) => node.name, compileTextTest(query.name!, caseSensitive, false)));
  }
  if (isAsked(query.value)) {
    // Matched against displayValue, which is the string a host actually shows: it is
    // what PropValue.readValue returns for the Value column and what BaseNode.toRow
    // falls back to, so a user searches over exactly what a user can read. A node
    // with no value renders '' and so fails every non-empty pattern, which is what
    // keeps a value query from sweeping up the sections and the structure-only
    // entries the way a listing would.
    criteria.push(textCriterion((node) => node.displayValue, compileTextTest(query.value!, caseSensitive, false)));
  }
  return criteria;
}
