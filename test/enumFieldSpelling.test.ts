// Copyright 2026 The MathWorks, Inc.
//
// Complexity and DimensionsMode take only MATLAB's enumerals (group E, theme 2, C-030), whichever
// spelling of the property an edit names. A Signal's, a BusElement's and a ValueType's two enums
// are each reached by the prop atom's key, the column it renders into (`complexity`,
// `dimensionsMode`), and by the node field and raw `_properties` key it writes (`Complexity`,
// `DimensionsMode`, the atom's `nodeProperty`). The writers save the field under MATLAB's
// spelling, so both names are the same property.
//
// The prop lookup every per-property gate asks (DataNode._propFor) matched only the key and the
// column. So `setProperty('Complexity', 'bogus')` found no prop: the enumeral check, the
// unchanged-commit check and SignalNode's own enum test all let it through, and the generic tail
// wrote 'bogus' into the field the writers save. The same call with `complexity` was refused in
// MATLAB's words. The session's own capture of the prior value, for the undo, had the same gap.
//
// Driven through ingest, the node's own setProperty and the session's editProperty and undo, over
// sig1, MyBus.x and MyValueType in test/parity/artifacts/{text,binary}/params.sldd, which MATLAB
// wrote.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest, type SerializedSource } from '../src/index.js';
import type DataNode from '../src/datamodel/node/DataNode.js';

type Format = 'text' | 'binary';
const FORMATS: Format[] = ['text', 'binary'];

// Where each node is: its entry, and the name under the entry for a bus element.
const NODES = [
  { label: 'a Signal', entry: 'sig1', child: null, className: 'Simulink.Signal' },
  { label: 'a BusElement', entry: 'MyBus', child: 'x', className: 'Simulink.BusElement' },
  { label: 'a ValueType', entry: 'MyValueType', child: null, className: 'Simulink.ValueType' },
] as const;

// Each property by its key and by its field, with a value each class's enum holds, and two it
// does not: a word, and a near miss in case that MATLAB refuses as well.
const ENUMS = [
  { key: 'complexity', field: 'Complexity', to: 'complex', refused: ['bogus', 'Real'] },
  { key: 'dimensionsMode', field: 'DimensionsMode', to: 'Variable', refused: ['bogus', 'fixed'] },
] as const;

function params(format: Format): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./parity/artifacts/${format}/params.sldd`, import.meta.url))));
}

function open(content: Uint8Array | string) {
  const session = createSession();
  const source: any = ingest(session, content, { filename: 'params.sldd' });
  return { session, source };
}

function saved(session: any, source: any): Uint8Array | string {
  const out = session.serializeSource(source.name) as SerializedSource;
  return out.kind === 'binary' ? out.bytes : out.text;
}

function entryIn(root: any, name: string): DataNode {
  const stack = [root];
  while (stack.length) {
    const n = stack.shift();
    if (n?.name === name && n.isEntry) {
      return n as DataNode;
    }
    stack.push(...(n?.children ?? []));
  }
  throw new Error(`no entry "${name}"`);
}

function nodeIn(root: any, where: (typeof NODES)[number]): { entry: DataNode; node: DataNode } {
  const entry = entryIn(root, where.entry);
  const node = where.child ? (entry.children.find((c: any) => c.name === where.child) as DataNode) : entry;
  expect(node, `${where.entry}.${where.child}`).toBeDefined();
  expect(node.className).toBe(where.className);
  return { entry, node };
}

const cellText = (node: DataNode, column: string): string => {
  const c = (node.toRow() as Record<string, any>)[column];
  return typeof c === 'string' ? c : c.text;
};
const field = (node: DataNode, name: string): unknown => (node as unknown as Record<string, unknown>)[name];

// An edited entry is stamped with the time of the edit, so two saves are compared at one time.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Complexity and DimensionsMode take only MATLAB's enumerals under either spelling", () => {
  for (const format of FORMATS) {
    for (const where of NODES) {
      describe(`${where.label} (${where.entry}${where.child ? '.' + where.child : ''}) in a ${format} dictionary`, () => {
        for (const e of ENUMS) {
          it(`refuses '${e.field}' set to a value outside the enum, in the words '${e.key}' is refused in, and changes nothing`, () => {
            for (const value of e.refused) {
              const { session, source } = open(params(format));
              const { entry, node } = nodeIn(source, where);
              const before = saved(session, source);
              const was = field(node, e.field);
              const result = node.setProperty(e.field, value);
              expect(result).toEqual({
                error: true,
                reason: `There is no enumerated value named '${value}'.`,
                invalidValue: value,
                validValue: was,
              });
              // The same refusal the key spelling gives, on a file opened afresh.
              const control = nodeIn(open(params(format)).source, where).node;
              expect(result).toEqual(control.setProperty(e.key, value));
              expect(field(node, e.field)).toBe(was);
              expect(cellText(node, e.key)).toBe(was);
              expect(entry.status).not.toBe('Modified');
              expect(saved(session, source)).toEqual(before);
            }
          });

          it(`takes '${e.field}' set to one of MATLAB's enumerals, and saves the file '${e.key}' saves`, () => {
            const byField = open(params(format));
            const byKey = open(params(format));
            const a = nodeIn(byField.source, where);
            const b = nodeIn(byKey.source, where);
            expect(a.node.setProperty(e.field, e.to)).toBe(true);
            expect(b.node.setProperty(e.key, e.to)).toBe(true);
            expect(cellText(a.node, e.key)).toBe(e.to);
            expect(a.entry.status).toBe('Modified');
            const out = saved(byField.session, byField.source);
            expect(out).toEqual(saved(byKey.session, byKey.source));
            expect(field(nodeIn(open(out).source, where).node, e.field)).toBe(e.to);
          });

          it(`'${e.field}' set to the value it shows is no edit: the entry is not Modified and the save is the file`, () => {
            const { session, source } = open(params(format));
            const { entry, node } = nodeIn(source, where);
            const before = saved(session, source);
            const shown = cellText(node, e.key);
            expect(node.setProperty(e.field, shown)).toBe(true);
            expect(field(node, e.field)).toBe(shown);
            expect(entry.status).not.toBe('Modified');
            expect(saved(session, source)).toEqual(before);
          });

          it(`an edit of '${e.field}' through the session is refused outside the enum, and is undone to the value it replaced`, () => {
            const { session, source } = open(params(format));
            const { node } = nodeIn(source, where);
            const before = saved(session, source);
            const was = field(node, e.field);
            session.setActiveContext(source);
            session.setActive(source, node);
            expect(session.editProperty(node.id, e.field, 'bogus')).toEqual({
              error: true,
              reason: `Cannot edit "${node.matlabPath}": There is no enumerated value named 'bogus'.`,
              invalidValue: 'bogus',
              validValue: was,
            });
            expect(field(node, e.field)).toBe(was);
            expect(session.editProperty(node.id, e.field, e.to)).toBe(true);
            expect(cellText(node, e.key)).toBe(e.to);
            session.undo();
            expect(field(node, e.field)).toBe(was);
            expect(cellText(node, e.key)).toBe(was);
            // The undo puts back the value, not a text the file never held.
            const again = nodeIn(open(saved(session, source)).source, where).node;
            expect(field(again, e.field)).toBe(was);
            expect(field(nodeIn(open(before).source, where).node, e.field)).toBe(was);
          });
        }
      });
    }
  }
});
