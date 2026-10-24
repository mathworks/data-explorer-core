// Copyright 2026 The MathWorks, Inc.
//
// A copy of an entry is what its file's save writes of it: after an edit of any row an object
// offers, made through the session as a host makes one, the entry's serialize() (what a host copies)
// is the serialize() of the entry the save reopens as. Of a MAT-file's objects, created by an Add
// and held by the file, whose save writes each edit into the file's objects; and of a text and a
// binary dictionary's objects, whose save writes the entry from the model. A copy that disagreed
// pasted the value from before the edit: a Signal's DataType edited to `single` was copied as
// `auto`.
import { describe, it, expect } from 'vitest';
import { createSession, MAT_CREATABLE_CLASSES } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { sourceEditRefusal } from '../src/datamodel/node/BaseNode.js';
import { BINARY_CASES, MIXED, TEXT_CASES, bufferOf, fixture } from './tools/matPaste.js';

type Any = any;

/** A file opened through a session, as a host opens one, and what a host does to it. */
function opened(path: string, bytes: Uint8Array = fixture(path)) {
  const session = createSession();
  const filename = path.split('/').pop()!;
  const root: Any = path.endsWith('.mat') ? session.addMatSource(filename, bufferOf(bytes)) : ingest(session, bytes, { filename });
  session.setActiveContext(root);
  const entries = (): Any[] => (root.constructor.name === 'MatNode' ? root.children : root.children.flatMap((s: Any) => s.children));
  const by = (name: string): Any => entries().find((e) => e.name === name);
  const edit = (node: Any, key: string, value: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, key, value);
  };
  const save = (): Uint8Array => {
    const out: Any = session.serializeSource(filename);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
  };
  return { session, root, by, edit, save, filename };
}

function propsOf(node: Any): Any[] {
  const columns = node.getProperties();
  const keys = new Set(columns.map((p: Any) => p.key));
  return [...columns, ...(node.getPILayout() ?? []).flatMap((g: Any) => g.items).filter((p: Any) => !keys.has(p.key))];
}

/** The values an edit of `key` of `node` is tried with: its choices, or a few of each kind MATLAB takes. */
function candidates(node: Any, key: string): string[] {
  const prop = propsOf(node).find((p: Any) => p.key === key);
  const info = prop ? node.getPropInfo(prop) : null;
  const options = info && info.editor === 'select' ? info.options ?? prop.options : null;
  if (Array.isArray(options) && options.length > 0) {
    return options.map(String);
  }
  if (node.className === 'string') {
    return ['"zz edited"', '["a" "b"]'];
  }
  switch (key) {
    case 'Name':
      return ['renamed'];
    case 'Value':
      return ['7', '[1 2; 3 4]', 'true', "'abc'", '[]', '-3'];
    case 'Min':
      return ['-1', '[]'];
    case 'Max':
      return ['9', '[]'];
    case 'Description':
    case 'Unit':
      return ['zz edited', ''];
    case 'DataType':
      return ['int8', 'fixdt(1,16,4)', 'single'];
    case 'BaseType':
      return ['int16', 'single'];
    case 'dimensions':
      return ['[2 3]', '4'];
    case 'initialValue':
      return ['0.5'];
    case 'sampleTime':
      return ['0.1', '[0.2 0.1]'];
    case 'headerFile':
      return ['zz.h'];
    case 'alignment':
      return ['8', '16'];
    case 'identifier':
      return ['zzId'];
    case 'wordLength':
      return ['8', '32'];
    case 'fractionLength':
      return ['3', '-2'];
    case 'slope':
      return ['0.5', '3'];
    case 'bias':
      return ['2'];
    default:
      return ['7', "'zz'"];
  }
}

// Where `a` and `b` differ, each path and the two values there, or null; keys in any order. A
// text dictionary's object identities (`_id`) are no values.
//
// A bound a copy holds no value of is the bound a save writes as `[]`, MATLAB's own empty: both read
// back as no bound (test/absentPropertyWriteBack.test.ts pins the text dictionary's omitted key).
function differenceOf(a: unknown, b: unknown, path: string, out: string[] = []): string | null {
  if (Object.is(a, b)) return out.length ? out.join('; ') : null;
  if (a === undefined && Array.isArray(b) && b.length === 0 && /\.(Min|Max)(_internal)?$/.test(path)) return out.length ? out.join('; ') : null;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      if (k === '_id') continue;
      differenceOf((a as Any)[k], (b as Any)[k], path + '.' + k, out);
    }
  } else {
    out.push(path.replace('._elements.0._properties', '') + ': copy ' + JSON.stringify(a) + ', saved ' + JSON.stringify(b));
  }
  return out.length ? out.join('; ') : null;
}

// The rows a sweep edits, by their path of child indices from the entry: the entry's own and each under it.
function rowPaths(node: Any): number[][] {
  const out: number[][] = [[]];
  const walk = (n: Any, path: number[]) => n.children.forEach((c: Any, i: number) => (out.push([...path, i]), walk(c, [...path, i])));
  walk(node, []);
  return out;
}
const at = (node: Any, path: number[]) => path.reduce((n, i) => n.children[i], node);

/**
 * For every row of the entry `name` a fresh `make()` gives, and every value an edit of it takes:
 * the copy of the entry, edited, against the copy of the entry its save reopens as. Answers the
 * edits made, and pushes each disagreement onto `wrong`.
 */
function sweep(make: () => { o: ReturnType<typeof opened>; entry: Any }, wrong: string[], also: (o: ReturnType<typeof opened>) => void = () => {}): number {
  const probe = make();
  let taken = 0;
  for (const path of rowPaths(probe.entry)) {
    const seen = at(probe.entry, path);
    for (const prop of propsOf(seen)) {
      const key = prop.key;
      if ((key === 'Name' && path.length === 0) || !seen.getPropInfo(prop).editable || sourceEditRefusal(seen, key) !== null) {
        continue;
      }
      for (const value of candidates(seen, key)) {
        if (value === seen.getPropInfo(prop).displayValue) {
          continue;
        }
        const { o, entry } = make();
        also(o);
        if (o.edit(at(entry, path), key, value) !== true) {
          continue;
        }
        taken++;
        // The edited entry may be another in its place (a MAT-file's Value typed as another kind).
        const now = o.by(entry.name);
        const copy = structuredClone(now.serialize());
        const again = opened(o.filename.endsWith('.mat') ? 'x/' + o.filename : 'x/' + o.filename, o.save()).by(entry.name);
        const differs = differenceOf(copy.value, structuredClone(again.serialize()).value, '');
        if (differs) {
          wrong.push(`${entry.name}${path.length ? '[' + path.join(',') + ']' : ''}.${key} = ${value}: ${differs}`);
        }
      }
    }
  }
  return taken;
}

describe('a copy of an edited object is what the save writes of it', () => {
  for (const cls of MAT_CREATABLE_CLASSES) {
    it(`a MAT-file's new ${cls}`, () => {
      const wrong: string[] = [];
      const taken = sweep(() => {
        const o = opened(MIXED);
        o.session.setActiveContext(o.root);
        const entry = o.session.addEntry('', cls, 'nv');
        if (cls === 'Simulink.Bus') {
          o.session.addChildTo(entry.id);
          o.session.addChildTo(entry.id);
        }
        return { o, entry };
      }, wrong);
      expect(wrong).toEqual([]);
      expect(taken).toBeGreaterThan(0);
    });
  }

  // Every object of these files, each row each takes an edit of.
  const OBJECT = /^Simulink\.(Parameter|Signal|Bus|NumericType|AliasType|ValueType)$|^string$/;
  for (const file of [MIXED, 'test/fixtures/mcos/Numeric.mat', 'test/fixtures/mcos/Alias.mat', 'test/fixtures/mcos/Sig.mat', 'test/fixtures/mcos/Param.mat', 'test/fixtures/strings.mat',
    TEXT_CASES, BINARY_CASES, 'test/parity/artifacts/text/params.sldd', 'test/parity/artifacts/binary/params.sldd']) {
    it(`every object of ${file}`, () => {
      const wrong: string[] = [];
      let taken = 0;
      const root = opened(file).root;
      const entries: Any[] = file.endsWith('.mat') ? root.children : root.children.flatMap((section: Any) => section.children);
      const names = entries.filter((e) => OBJECT.test(e.className)).map((e) => e.name);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        taken += sweep(() => {
          const o = opened(file);
          return { o, entry: o.by(name) };
        }, wrong);
      }
      expect(wrong).toEqual([]);
      expect(taken, names.join()).toBeGreaterThan(0);
    });
  }
});
