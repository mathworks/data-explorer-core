// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Parameter pasted into a binary dictionary is written with its Value before its DataType,
// as MATLAB writes one there (open-questions 14, E). MATLAB R2027a reads a binary dictionary's
// properties in the order they are written, and a text dictionary holds them by name, DataType
// before Value: a struct-valued Parameter copied out of one (the edit-bash pStruct, pStructArr) was
// read back with "The parameter DataType cannot be set to 'struct' unless the Value is a structure",
// the DataType set while the Value was still a double. Every MATLAB-written binary Parameter in this
// repo holds Value first (R2027a: Value, Complexity, Dimensions, CoderInfo, Description, DataType,
// Min, Max, DocUnits).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const DIR = 'test/fixtures/edit-bash/r2027a/';

function opened(bytes: Uint8Array, filename: string) {
  const session: Any = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  return { session, root, design: root.children.find((s: Any) => s.name === 'design') };
}
const open = (file: string) => opened(new Uint8Array(readFileSync(DIR + file)), file);

// The names of the top-level properties of entry `name`'s Simulink.Parameter, in the order a binary
// dictionary's save writes them.
function writtenOrder(d: { session: Any; root: Any }, name: string): string[] {
  const xml = strFromU8(unzipSync(d.session.serializeSource(d.root.name).bytes)['data/chunk0.xml']);
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  const start = xml.indexOf('>', xml.indexOf('<Element Class="', at)) + 1;
  const names: string[] = [];
  let depth = 0;
  for (const m of xml.slice(start).matchAll(/<(\/?)(Element|P)\b([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m;
    if (tag === 'Element') {
      if (close) {
        if (depth === 0) break;
        depth--;
      } else if (!self) depth++;
    } else if (!close && depth === 0) {
      names.push(/Name="([^"]+)"/.exec(attrs)![1]);
    }
  }
  return names;
}

describe('a Parameter out of a text dictionary, pasted into a binary one', () => {
  it.each(['pStruct', 'pStructArr', 'pMatrix', 'pInt8', 'pProps'])('%s is written with its Value first, and reads back as it was', (name) => {
    const text = open('values_text.sldd');
    const entry = text.design.children.find((e: Any) => e.name === name);
    expect(Object.keys(entry.serialize().value._elements[0]._properties).indexOf('DataType')).toBeLessThan(Object.keys(entry.serialize().value._elements[0]._properties).indexOf('Value'));
    const d = open('values_binary.sldd');
    d.session.setActive(d.root, d.design);
    const made = d.session.pasteEntries(d.design.id, [entry.serialize()]);
    expect(made.error).toBeUndefined();
    // First, as MATLAB writes it, and so before any DataType.
    const order = writtenOrder(d, made.nodes[0].name);
    expect(order[0]).toBe('Value');
    // Every other property in the order it came in.
    const rest = Object.keys(entry.serialize().value._elements[0]._properties).filter((k) => k !== 'Value');
    expect(order.filter((k) => k !== 'Value')).toEqual(rest.filter((k) => order.includes(k)));
    const back = opened(d.session.serializeSource(d.root.name).bytes, 'values_binary.sldd').design.children.find((e: Any) => e.name === made.nodes[0].name);
    expect([back.className, back.DataType, back.displayValue]).toEqual([entry.className, entry.DataType, entry.displayValue]);
  });

  it("a MAT-file's Parameter, which holds its Value first, is written as before", () => {
    const mat = opened(new Uint8Array(readFileSync(DIR + 'values.mat')), 'values.mat');
    const node = mat.root.children.find((v: Any) => v.name === 'pStruct');
    const before = Object.keys(node.serialize().value._elements[0]._properties);
    const d = open('values_binary.sldd');
    d.session.setActive(d.root, d.design);
    const made = d.session.pasteEntries(d.design.id, [node.serialize()]);
    expect(made.error).toBeUndefined();
    expect(writtenOrder(d, made.nodes[0].name).filter((k) => before.includes(k))).toEqual(before.filter((k) => writtenOrder(d, made.nodes[0].name).includes(k)));
  });
});
