// Copyright 2026 The MathWorks, Inc.
//
// An entry a paste or a drop makes reads as the save of it reads: its Kind, and its icon, are a
// reopen's. A dictionary's System Composer catalog says which Simulink.Bus is a Data Interface and
// which a Struct Type, by name, in the Design namespace (Design and Architectural Data). The read
// classifies by it; the paste (prepareEntryForPaste) made its node without it, so an Architectural
// Data interface dropped into Design Data said "Bus" until a wide repaint re-read it, and "Data
// Interface" after (open-questions 17a, bug-datainterface-kind.md). Every entry of each fixture
// with a catalog, copied and moved into every section that takes it, in both formats.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { pasteEntries } from '../src/edit/structuralEdit.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
// A text dictionary, a binary one, and the binary one's text, each with a catalog.
const FILES = ['test/fixtures/arch.sldd', 'test/fixtures/arch_binary.sldd', 'test/fixtures/arch_binary_as_text.sldd'];

function opened(bytes: Uint8Array, filename: string) {
  const session: Any = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  const bytesOf = (): Uint8Array => {
    const out: Any = session.serializeSource(root.name);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
  };
  const section = (name: string): Any => root.children.find((s: Any) => s.name === name);
  return { session, root, bytesOf, section, reopened: () => opened(bytesOf(), filename) };
}
const open = (path: string) => opened(new Uint8Array(readFileSync(path)), path.split('/').pop()!);
const shown = (n: Any) => n.kind + ' / ' + n.icon;

describe.each(FILES)('a pasted entry of %s reads as its save reads', (file) => {
  it('every entry, copied and moved into every section that takes it', () => {
    const entries = (['arch', 'design'] as const).flatMap((from) => open(file).section(from).children.map((e: Any) => [from, e.name] as const));
    expect(entries.length).toBeGreaterThanOrEqual(4);
    const wrong: string[] = [];
    let made = 0;
    for (const [from, name] of entries) {
      for (const into of ['design', 'arch', 'other']) {
        for (const move of [false, true]) {
          if (move && into === from) continue;
          const d = open(file);
          const entry = d.section(from).children.find((e: Any) => e.name === name);
          if (d.session.pasteRefusal(d.section(into).id, entry.serialize()) !== null) continue;
          d.session.setActive(d.root, d.section(into));
          const result = d.session.pasteEntries(d.section(into).id, [entry.serialize()], move ? { removeFirst: [entry] } : undefined);
          const what = (move ? 'move ' : 'copy ') + from + '/' + name + ' into ' + into;
          if (result.error) {
            wrong.push(what + ': refused, ' + result.reason);
            continue;
          }
          made++;
          const node = result.nodes[0];
          const read = d.reopened().section(into).children.find((e: Any) => e.name === node.name);
          if (shown(node) !== shown(read)) wrong.push(what + ' as ' + node.name + ': pasted ' + shown(node) + ', read ' + shown(read));
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(made).toBeGreaterThanOrEqual(8);
  });
});

describe('the drop the bug was seen by', () => {
  it.each(['test/fixtures/arch.sldd', 'test/fixtures/arch_binary.sldd'])('%s: an Architectural Data interface moved into Design Data is a Data Interface', (file) => {
    const d = open(file);
    const entry = d.section('arch').children.find((e: Any) => e.name === 'DataInterface');
    expect(shown(entry)).toBe('Data Interface / typeBus');
    d.session.setActive(d.root, d.section('design'));
    const { nodes } = d.session.pasteEntries(d.section('design').id, [entry.serialize()], { removeFirst: [entry] });
    expect(nodes.map((n: Any) => [n.name, n.kind])).toEqual([['DataInterface', 'Data Interface']]);
    expect(d.reopened().section('design').children.find((e: Any) => e.name === 'DataInterface').kind).toBe('Data Interface');
  });

  it("a JSON host's own paste into its text (structuralEdit.pasteEntries) makes the same node", () => {
    const d = open('test/fixtures/arch.sldd');
    const text = readFileSync('test/fixtures/arch.sldd', 'utf8');
    const entry = d.section('arch').children.find((e: Any) => e.name === 'StructType');
    const payload = entry.serialize();
    pasteEntries(text, d.section('design'), [payload]);
    // A copy into the same namespace is renamed, and the catalog names no StructType1: a Bus, as
    // a read of it is.
    expect([d.section('design').children.at(-1).name, d.section('design').children.at(-1).kind]).toEqual(['StructType1', 'Bus']);
    // Moved (the original taken out first, as a host's move does), it keeps its name, and the
    // catalog's Kind.
    d.section('arch').removeChild(entry);
    pasteEntries(text, d.section('design'), [payload]);
    expect([d.section('design').children.at(-1).name, d.section('design').children.at(-1).kind]).toEqual(['StructType', 'Struct Type']);
  });
});
