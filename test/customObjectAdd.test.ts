// Copyright 2026 The MathWorks, Inc.
//
// No MATLAB class is named CustomObject: it is the class core reads an object of a class it has no
// node of as, and MATLAB makes none ("Unrecognized function or variable 'CustomObject'", R2027a). So
// an Add makes no CustomObject entry, in either dictionary format and in either section that holds
// one, and says why, as it does of every class this package makes no new entry of. A dictionary
// still reads one, and takes a paste of one, as it took one before (open-questions 15b).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const FILES = ['test/parity/artifacts/binary/params.sldd', 'test/fixtures/numeric_json.sldd'];

function opened(bytes: Uint8Array, filename: string) {
  const session: Any = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  const bytesOf = (): Uint8Array => {
    const out: Any = session.serializeSource(root.name);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
  };
  const section = (name: string): Any => root.children.find((s: Any) => s.name === name);
  return { session, root, bytesOf, section };
}
const open = (path: string) => opened(new Uint8Array(readFileSync(path)), path.split('/').pop()!);

// A CustomObject a host copied (DataNode.serialize of an entry), as one a file holds is read.
const held = {
  name: 'Held',
  metadata: null,
  value: { _array_class: 'CustomObject', _dimensions: [1, 1], _elements: [{ _properties: { Description: 'kept' } }] },
};

describe.each(FILES)('a CustomObject in %s', (file) => {
  it.each(['design', 'other'])('the %s section adds none, and says why', (name) => {
    const d = open(file);
    const section = d.section(name);
    const before = d.bytesOf();
    expect(d.session.addEntryRefusal(section.id, 'CustomObject')).toBe(
      'Cannot add a CustomObject to "' + section.label + '": this editor makes no new entry of that class.',
    );
    d.session.setActive(d.root, null);
    expect(d.session.addEntry(name, 'CustomObject')).toBeNull();
    expect(section.addEntry('CustomObject')).toBeNull();
    expect(section.children.some((e: Any) => e.className === 'CustomObject')).toBe(false);
    expect(d.root.dirty).toBeFalsy();
    expect(Buffer.from(d.bytesOf()).equals(Buffer.from(before))).toBe(true);
  });

  it.each(['design', 'other'])('the %s section still admits one, takes a paste of it, and reads it back', (name) => {
    const d = open(file);
    const section = d.section(name);
    expect(section.getAllowedTypes()).toContain('CustomObject');
    expect(section.allowsType('CustomObject')).toBe(true);
    expect(d.session.pasteRefusal(section.id, held)).toBeNull();
    expect(d.session.pasteRefusal(section.id, held, { deep: true })).toBeNull();
    d.session.setActive(d.root, section);
    const made = d.session.pasteEntries(section.id, [held]);
    expect(made.error).toBeUndefined();
    expect(made.nodes.map((n: Any) => [n.name, n.className])).toEqual([['Held', 'CustomObject']]);
    const back = opened(d.bytesOf(), file.split('/').pop()!);
    const read = back.section(name).children.find((e: Any) => e.name === 'Held');
    expect(read?.className).toBe('CustomObject');
    expect(read?.Description).toBe('kept');
  });
});
