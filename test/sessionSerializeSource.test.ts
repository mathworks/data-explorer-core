// Copyright 2026 The MathWorks, Inc.
//
// The write path, from a consumer's side of the package boundary. Two things are
// under test, and they are the same gap seen from two distances:
//
//   serializeBinarySldd  — the function the live MATLAB gate exists to prove, which
//                          was reachable only from inside this repo.
//   session.serializeSource(srcId)
//                        — the uniform "give me this source's bytes" ask, which did
//                          not exist at all: the textual flavour was reachable only
//                          by knowing to call SlddNode.serializeJson() yourself, and
//                          the binary flavour needed a deep import that the exports
//                          map does not publish.
//
// The contract that matters most here is the DISCRIMINANT. A caller writing a file
// must not have to `typeof` the result to find out whether it holds bytes or text,
// and must not have to try/catch a format that has no write path — so a read-only
// source answers null, in the same register getDataSource already uses for absent.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest, parseBinarySldd, serializeBinarySldd, SlddNode } from '../src/index.js';
import { applyScEdits, scRenameEdits, scanScJsonText } from '../src/index.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function bytes(name: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fixture(name)));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

const info = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
const PRJ_STORE = {
  'resources/project/root/FILESHASHp.xml': info('<Info location="Root" type="Files"/>'),
  'resources/project/FILESHASH/AAAp.xml': info('<Info location="helper.m" type="File"/>'),
  'resources/project/FILESHASH/AAAd.xml': info('<Info/>'),
};

// Every entry name in a dictionary tree, which is what "the same document came back"
// means for a round trip that does not claim to be byte-exact.
function entryNames(source: { flatten(): { name: string; isEntry?: boolean }[] }): string[] {
  return source
    .flatten()
    .filter((n) => n.isEntry)
    .map((n) => n.name)
    .sort();
}

function load(file: string) {
  const s = createSession();
  const src = ingest(s, bytes(file), { filename: file });
  return { s, src };
}

describe('serializeBinarySldd is reachable from the package root', () => {
  it('is exported, and its output re-parses as the dictionary it came from', () => {
    // The whole point of the item: the MATLAB-gated write path was callable only by
    // this repo's own tests. A consumer holding an SlddNode — which the root DOES
    // export — must be able to turn it back into bytes.
    expect(typeof serializeBinarySldd).toBe('function');

    const { src } = load('object_array_binary.sldd');
    const written = serializeBinarySldd(src as unknown as SlddNode);
    expect(written.byteLength).toBeGreaterThan(0);

    const reparsed = SlddNode.parse(parseBinarySldd(written), 'again.sldd');
    expect(entryNames(reparsed)).toEqual(entryNames(src));
  });
});

describe('session.serializeSource', () => {
  it('answers a binary .sldd with bytes, marked as bytes', () => {
    const { s, src } = load('object_array_binary.sldd');
    const out = s.serializeSource('object_array_binary.sldd');

    expect(out).not.toBeNull();
    expect(out!.kind).toBe('binary');
    // The vocabulary is the source node's own, so a caller can correlate this with
    // the `sourceFormat` it already sees on SourceDTO.
    expect(out!.sourceFormat).toBe('xml');
    expect(out!.kind === 'binary' && out!.bytes instanceof Uint8Array).toBe(true);

    const written = out!.kind === 'binary' ? out!.bytes : new Uint8Array();
    const buf = written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer;
    expect(entryNames(SlddNode.parse(parseBinarySldd(buf), 'again.sldd'))).toEqual(entryNames(src));
  });

  it('answers a textual .sldd with text, marked as text', () => {
    const { s, src } = load('object_array_text.sldd');
    const out = s.serializeSource('object_array_text.sldd');

    expect(out).not.toBeNull();
    expect(out!.kind).toBe('text');
    expect(out!.sourceFormat).toBe('json');

    const text = out!.kind === 'text' ? out!.text : '';
    // Round-trips through the reader that opens a textual .sldd, so what came back
    // is a file and not a debug dump.
    const reparsed = SlddNode.parse(JSON.parse(text), 'again.sldd');
    expect(entryNames(reparsed)).toEqual(entryNames(src));
  });

  it('returns the flavour the file arrived in, not one fixed default', () => {
    // The two fixtures are the SAME dictionary written both ways, which is what makes
    // this assertion possible: identical entries, different bytes-vs-text answer. The
    // point of serializing is writing back over the original, so answering a
    // compressed-binary .sldd with JSON text would corrupt every file it touched.
    const bin = load('object_array_binary.sldd');
    const txt = load('object_array_text.sldd');
    expect(entryNames(bin.src)).toEqual(entryNames(txt.src));

    expect(bin.s.serializeSource('object_array_binary.sldd')!.kind).toBe('binary');
    expect(txt.s.serializeSource('object_array_text.sldd')!.kind).toBe('text');
  });

  it('carries an edit into the bytes it hands back', () => {
    // A serializer that returned the ORIGINAL bytes would pass every assertion above
    // and still be useless — save exists to persist an edit.
    const { s, src } = load('object_array_text.sldd');
    const entry = (src.flatten() as { id: string; name: string; isEntry?: boolean }[]).find((n) => n.isEntry)!;
    s.setActive(src as never, entry as never);
    expect(s.editProperty(entry.id, 'Name', 'renamedByTest')).toBe(true);

    const out = s.serializeSource('object_array_text.sldd')!;
    const text = out.kind === 'text' ? out.text : '';
    expect(entryNames(SlddNode.parse(JSON.parse(text), 'again.sldd'))).toContain('renamedByTest');
  });

  it('returns null for a read-only format instead of throwing', () => {
    // .slx / .mdl / .prj have no write path at all (see docs/TODO.md, "Not gaps"). A
    // consumer enumerating every open source must not need a try/catch per source to
    // find that out, and must never be handed bytes that only look like a file —
    // ModelNode.serialize(), for one, returns a summary object, not a model.
    const s = createSession();
    s.addModelSource('model_with_refs.slx', bytes('model_with_refs.slx'));
    s.addProjectSource('MyProj.prj', PRJ_STORE);

    expect(s.serializeSource('model_with_refs.slx')).toBeNull();
    expect(s.serializeSource('MyProj.prj')).toBeNull();
  });

  it('answers a MAT-file with its bytes, which unedited are the file it was read from', () => {
    // A `.mat` is written as its own records, what was edited written fresh
    // (test/matFileSave.test.ts holds every edit to that), so with nothing edited it is
    // the file, byte for byte.
    const s = createSession();
    const input = bytes('strings.mat');
    s.addMatSource('strings.mat', input);

    const out = s.serializeSource('strings.mat')!;
    expect([out.kind, out.sourceFormat]).toEqual(['binary', 'mat']);
    expect(out.kind === 'binary' ? [...out.bytes] : null).toEqual([...new Uint8Array(input)]);
  });

  it('returns null for a srcId the session does not hold', () => {
    // Same answer as getDataSource for the same question, so a caller has one rule.
    const s = createSession();
    expect(s.serializeSource('never-opened.sldd')).toBeNull();
  });
});

// A textual `.sldd` is more than its entries. MATLAB writes each part of the dictionary
// as one key of `__MW_TEXT_PARTS__`: the data part, and beside it the System Composer
// interface dictionary (what says a `Simulink.Bus` is a struct type rather than a data
// interface) and the ArchitecturePart. A save that wrote back only the data part left a
// file whose struct types reopened as data interfaces, in this package and in MATLAB,
// which does not regenerate the part. So the save writes every part it read, in the
// order the file had them, with the rebuilt data part in its own slot.
describe('a textual .sldd save writes back every part it read', () => {
  type Json = Record<string, unknown>;
  const textOf = (name: string): string => readFileSync(fixture(name), 'utf8');
  const partsOf = (json: Json): Json => json.__MW_TEXT_PARTS__ as Json;
  const kindsOf = (source: { flatten(): { name: string; isEntry?: boolean; kind?: string }[] }) =>
    Object.fromEntries(source.flatten().filter((n) => n.isEntry).map((n) => [n.name, n.kind]));
  const saved = (file: string): { text: string; src: ReturnType<typeof load>['src'] } => {
    const { s, src } = load(file);
    const out = s.serializeSource(file)!;
    expect(out.kind).toBe('text');
    return { text: out.kind === 'text' ? out.text : '', src };
  };
  const reopen = (text: string, file: string) =>
    ingest(createSession(), new TextEncoder().encode(text).buffer as ArrayBuffer, { filename: file });

  // What a save writes outside the data part is the file's own: the parsed input with
  // only the data part's value swapped for the one the save rebuilt, laid out as the save
  // lays out (MATLAB's tab). Asserted on the whole text, so a part out of its place, or a
  // key the save added or dropped around the data part, is a byte difference.
  const withDataPartOf = (input: string, text: string): string => {
    const read = JSON.parse(input) as Json;
    partsOf(read)['__MW_TEXT_PART__/data/chunk0'] = partsOf(JSON.parse(text))['__MW_TEXT_PART__/data/chunk0'];
    return JSON.stringify(read, null, '\t');
  };

  it('saves arch.sldd, untouched, with every part in its place as it was read', () => {
    // MATLAB-written and tab-indented, the layout the save writes, so every byte outside
    // the data part is the file's: all three parts, in their order.
    const input = textOf('arch.sldd');
    const { text } = saved('arch.sldd');
    expect(Object.keys(partsOf(JSON.parse(text)))).toEqual([
      '__MW_TEXT_PART__/data/chunk0',
      '__MW_TEXT_PART__/simulink/ArchitecturePart',
      '__MW_TEXT_PART__/simulink/systemcomposer/interfaceDictionary',
    ]);
    expect(text).toBe(withDataPartOf(input, text));
    expect(JSON.stringify(JSON.parse(input), null, '\t')).toBe(input);
  });

  it('saves arch_binary_as_text.sldd, untouched, with every part in its place as it was read', () => {
    // Laid out with one SPACE a level rather than MATLAB's tab, so the save cannot be its
    // bytes; what it keeps is the input's own content around the data part, in order.
    const input = textOf('arch_binary_as_text.sldd');
    const { text } = saved('arch_binary_as_text.sldd');
    expect(Object.keys(partsOf(JSON.parse(text)))).toEqual([
      '__MW_TEXT_PART__/data/chunk0',
      '__MW_TEXT_PART__/simulink/systemcomposer/interfaceDictionary',
    ]);
    expect(text).toBe(withDataPartOf(input, text));
  });

  it('reopens a saved struct type as a struct type', () => {
    for (const file of ['arch.sldd', 'arch_binary_as_text.sldd']) {
      const { text, src } = saved(file);
      expect(kindsOf(src).StructType, file).toBe('Struct Type');
      expect(kindsOf(reopen(text, file)), file).toEqual(kindsOf(src));
    }
  });

  it('carries an edit into the data part and leaves the other parts as they were read', () => {
    const { s, src } = load('arch.sldd');
    const entry = (src.flatten() as { id: string; name: string; isEntry?: boolean }[])
      .find((n) => n.isEntry && n.name === 'Constant')!;
    s.setActive(src as never, entry as never);
    expect(s.editProperty(entry.id, 'Name', 'ConstantRenamed')).toBe(true);

    const out = s.serializeSource('arch.sldd')!;
    const written = partsOf(JSON.parse(out.kind === 'text' ? out.text : '{}'));
    const read = partsOf(JSON.parse(textOf('arch.sldd')));
    expect(Object.keys(written)).toEqual(Object.keys(read));
    expect(written['__MW_TEXT_PART__/simulink/ArchitecturePart'])
      .toEqual(read['__MW_TEXT_PART__/simulink/ArchitecturePart']);
    expect(written['__MW_TEXT_PART__/simulink/systemcomposer/interfaceDictionary'])
      .toEqual(read['__MW_TEXT_PART__/simulink/systemcomposer/interfaceDictionary']);
    expect(entryNames(SlddNode.parse(JSON.parse(out.kind === 'text' ? out.text : '{}'), 'again.sldd')))
      .toContain('ConstantRenamed');
  });
});

// The catalog keys its definitions by entry NAME, so a renamed architectural entry has to
// be renamed in the catalog part too, or it reopens as its raw class (a struct type as a
// data interface). The save carries the rename into the part as read, changing only the
// renamed definitions' own name sites, which is what the binary save does for its member.
describe('a textual .sldd save carries a rename into the System Composer catalog', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  type Json = Record<string, any>;
  const SC = '__MW_TEXT_PART__/simulink/systemcomposer/interfaceDictionary';
  const textOf = (name: string): string => readFileSync(fixture(name), 'utf8');
  const catalogOf = (text: string): Json => JSON.parse(text).__MW_TEXT_PARTS__[SC];
  const entriesOf = (root: any): any[] => root.children.flatMap((s: any) => s.children);
  const named = (root: any, name: string): any => entriesOf(root).find((e: any) => e.name === name);
  const kindsOf = (root: any): Record<string, string> =>
    Object.fromEntries(entriesOf(root).map((e: any) => [e.name, e.kind]));
  const savedText = (s: any, file: string): string => {
    const out = s.serializeSource(file)!;
    expect(out.kind).toBe('text');
    return out.text;
  };
  const reopen = (text: string, file: string): any =>
    ingest(createSession(), new TextEncoder().encode(text).buffer as ArrayBuffer, { filename: file });
  /** The catalog part as the host's in-place rename writes it: each rename applied in turn. */
  const patched = (text: string, renames: [string, string][]): Json =>
    catalogOf(renames.reduce((t, [from, to]) => applyScEdits(t, scRenameEdits(scanScJsonText(t), from, to)), text));

  for (const file of ['arch.sldd', 'arch_binary_as_text.sldd']) {
    it(`${file}: a struct type renamed reopens as a struct type under its new name`, () => {
      const { s, src } = load(file);
      expect(named(src, 'StructType').setProperty('Name', 'StructTypeRenamed')).toBe(true);
      const text = savedText(s, file);
      expect(catalogOf(text)).toEqual(patched(textOf(file), [['StructType', 'StructTypeRenamed']]));
      const again = reopen(text, file);
      expect(kindsOf(again)).toEqual(kindsOf(src));
      expect(kindsOf(again).StructTypeRenamed).toBe('Struct Type');
    });
  }

  it('a value type renamed moves its definition and its own descriptor, not an element that shares the name', () => {
    const file = 'arch_binary_as_text.sldd';
    const { s, src } = load(file);
    expect(named(src, 'ValueType').setProperty('Name', 'VT2')).toBe(true);
    const text = savedText(s, file);
    expect(catalogOf(text)).toEqual(patched(textOf(file), [['ValueType', 'VT2']]));
    const part = JSON.stringify(catalogOf(text));
    expect(part.match(/"p_Name":"VT2"/g)).toHaveLength(2);
    // DataInterface's element is named after the value type it references, and stays so.
    expect(part.match(/"p_Name":"ValueType"/g)).toHaveLength(1);
  });

  it('a rename undone, a chain and a swap write what the names are at the save', () => {
    const file = 'arch_binary_as_text.sldd';
    const before = textOf(file);
    const { s, src } = load(file);
    s.setActiveContext(src as never);

    named(src, 'StructType').setProperty('Name', 'CompA');
    named(src, 'CompA').setProperty('Name', 'StructType');
    expect(catalogOf(savedText(s, file))).toEqual(catalogOf(before));

    named(src, 'StructType').setProperty('Name', 'CompA');
    named(src, 'CompA').setProperty('Name', 'CompB');
    expect(catalogOf(savedText(s, file))).toEqual(patched(before, [['StructType', 'CompB']]));

    named(src, 'NumericType').setProperty('Name', 'Tmp');
    named(src, 'CompB').setProperty('Name', 'NumericType');
    named(src, 'Tmp').setProperty('Name', 'StructType');
    expect(catalogOf(savedText(s, file))).toEqual(
      patched(before, [['StructType', 'Tmp'], ['NumericType', 'StructType'], ['Tmp', 'NumericType']]),
    );
    expect(kindsOf(reopen(savedText(s, file), file))).toEqual(kindsOf(src));
  });

  it('a rename the catalog does not know leaves the part as read', () => {
    const file = 'arch_binary_as_text.sldd';
    const { s, src } = load(file);
    expect(named(src, 'DataInterface').children[0].setProperty('Name', 'Elem2')).toBe(true);
    expect(catalogOf(savedText(s, file))).toEqual(catalogOf(textOf(file)));
  });

  it('agrees with the compressed-binary save of the same rename', () => {
    const txt = load('arch_binary_as_text.sldd');
    const bin = load('arch_binary.sldd');
    expect(named(txt.src, 'DataInterface').setProperty('Name', 'Bus1')).toBe(true);
    expect(named(bin.src, 'DataInterface').setProperty('Name', 'Bus1')).toBe(true);
    const fromText = reopen(savedText(txt.s, 'arch_binary_as_text.sldd'), 'arch_binary_as_text.sldd');
    const out = bin.s.serializeSource('arch_binary.sldd')!;
    const zipped = out.kind === 'binary' ? out.bytes : new Uint8Array();
    const fromBinary: any = ingest(createSession(), zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer, { filename: 'arch_binary.sldd' });
    expect(fromText.systemComposer).toEqual(fromBinary.systemComposer);
    expect(kindsOf(fromText)).toEqual(kindsOf(fromBinary));
    expect(kindsOf(fromText).Bus1).toBe('Data Interface');
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

// A save that changes nothing writes nothing new. A bus's elements are rebuilt on every
// save, and the rebuilt Elements_internal used to carry `_mw_element_type: "MATLABArray"`
// whatever the bag read had: MATLAB omits that key from this nested array in a text
// dictionary, so a no-op save of arch.sldd differed from the file at each of its 4 buses.
// The key is kept where it was read, as the binary reader's bag carries it.
describe('a textual .sldd save that changes nothing is the file it read', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const textOf = (name: string): string => readFileSync(fixture(name), 'utf8');
  const savedText = (file: string): string => {
    const { s } = load(file);
    const out = s.serializeSource(file)!;
    expect(out.kind).toBe('text');
    return out.kind === 'text' ? out.text : '';
  };
  const entriesOf = (root: any): any[] => root.children.flatMap((s: any) => s.children);
  const elementsInternal = (node: any): any => node.serializeValue()._elements[0]._properties.Elements_internal;

  it('saves arch.sldd, untouched, as the bytes of the file', () => {
    expect(savedText('arch.sldd')).toBe(textOf('arch.sldd'));
  });

  it('saves arch_binary_as_text.sldd, untouched, as the bytes of the file in the layout a save writes', () => {
    // make-fixtures.mjs writes this one with one space a level and a final newline;
    // a save writes MATLAB's tab. Byte for byte against that layout, with nothing exempt.
    const input = textOf('arch_binary_as_text.sldd');
    expect(savedText('arch_binary_as_text.sldd')).toBe(JSON.stringify(JSON.parse(input), null, '\t'));
  });

  it('saves bus_types_text.sldd, untouched, as the bytes of the file', () => {
    expect(savedText('bus_types_text.sldd')).toBe(textOf('bus_types_text.sldd'));
  });

  it('saves params.sldd, untouched, as the bytes of the file', () => {
    // MATLAB-written. Its MyConnBus holds one element, which MATLAB writes as the element itself,
    // `{_id, _object_class, _properties}`, and the save rebuilt as the array, `{_array_class,
    // _dimensions: [1, 1], _elements}`: the save differed from the file at byte 4731 (B-24).
    const input = readFileSync(fileURLToPath(new URL('./parity/artifacts/text/params.sldd', import.meta.url)), 'utf8');
    const s = createSession();
    ingest(s, new TextEncoder().encode(input).buffer as ArrayBuffer, { filename: 'params.sldd' });
    const out = s.serializeSource('params.sldd')!;
    expect(out.kind === 'text' ? out.text : '').toBe(input);
  });

  it('adds no _mw_element_type to a text bus that is edited, and keeps one that was read', () => {
    // arch.sldd's buses were read without the key; typeLink.sldd's with it.
    const arch = load('arch.sldd');
    const bus = entriesOf(arch.src).find((e: any) => e.name === 'StructType');
    expect(bus.execAddChild()).not.toBeNull();
    expect('_mw_element_type' in elementsInternal(bus)).toBe(false);
    expect(elementsInternal(bus)._elements).toHaveLength(bus.children.length);

    const linked = load('typeLink.sldd');
    const withKey = entriesOf(linked.src).filter((e: any) => typeof e.execAddChild === 'function' && e.children.length > 0);
    expect(withKey.map((b: any) => b.name)).toHaveLength(1);
    for (const b of withKey) {
      expect(elementsInternal(b)._mw_element_type, b.name).toBe('MATLABArray');
    }
  });

  it('keeps the _mw_element_type the binary reader gives a bus', () => {
    const { src } = load('arch_binary.sldd');
    const buses = entriesOf(src).filter((e: any) => e.kind === 'Struct Type' || e.kind === 'Data Interface');
    expect(buses.map((b: any) => b.name).sort()).toEqual(['DataInterface', 'StructType']);
    for (const b of buses) {
      expect(elementsInternal(b)._mw_element_type, b.name).toBe('MATLABArray');
    }
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});
