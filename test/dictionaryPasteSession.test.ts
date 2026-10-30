// Copyright 2026 The MathWorks, Inc.
//
// A paste into a dictionary's section through the session (session.pasteEntries with a section's
// id), for a host whose truth is the model, not a text: the entries made by vscode's paste rules
// (src/edit/dictionaryPaste.ts), all of them or none, as ONE undo step, a same-document move's
// removal (`removeFirst`) in that same step. What data-explorer-vscode's own suites assert of its
// pastes (test/structuralEdit, constantNode, multiPasteAtomicity, dropComplete, dropEndToEnd and
// pasteNonFinite*.test.ts at c73da3c) is asserted here of the session's: of the model, of what its
// save writes, and of that save read back.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, entrySelectorOf, getSectionMetadata } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { cloneForPaste } from '../src/edit/dictionaryPaste.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
// vscode's test-integration/fixtures/workspace/data.sldd, test/fixtures/arch.sldd and
// test/parity/artifacts/binary/params.sldd, byte for byte.
const DATA = 'test/fixtures/numeric_json.sldd';
const ARCH = 'test/fixtures/arch.sldd';
const BINARY = 'test/parity/artifacts/binary/params.sldd';
const NS_DESIGN = getSectionMetadata('design').namespace;

function opened(bytes: Uint8Array, filename: string) {
  const session: Any = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  const save = (): string => {
    const out: Any = session.serializeSource(root.name);
    return out.kind === 'text' ? out.text : Buffer.from(out.bytes).toString('base64');
  };
  const bytesOf = (): Uint8Array => {
    const out: Any = session.serializeSource(root.name);
    return out.kind === 'text' ? strToU8(out.text) : out.bytes;
  };
  const section = (name: string): Any => root.children.find((s: Any) => s.name === name);
  const entry = (name: string): Any => (root.children as Any[]).flatMap((s) => s.children).find((e: Any) => e.name === name);
  const names = (name: string): string[] => section(name).children.map((e: Any) => e.name);
  const paste = (sectionName: string, payloads: Any[], removeFirst?: Any[]) => {
    session.setActive(root, section(sectionName));
    return session.pasteEntries(section(sectionName).id, payloads, removeFirst ? { removeFirst } : undefined);
  };
  const reopened = () => opened(bytesOf(), filename);
  return { session, root, save, bytesOf, section, entry, names, paste, reopened };
}
const open = (path: string) => opened(new Uint8Array(readFileSync(path)), path.split('/').pop()!);
const noLastmod = (text: string) => text.replace(/"lastmod": "[^"]*"/g, '"lastmod": "*"');

describe('a paste into a section', () => {
  it('pastes a uniquely-named copy as a new entry, which the save writes and a reopen reads', () => {
    const d = open(DATA);
    const result = d.paste('design', [d.entry('Number').serialize()]);
    expect(result.error).toBeUndefined();
    expect(result.nodes.map((n: Any) => n.name)).toEqual(['Number1']);
    expect(d.names('design')).toContain('Number');
    expect(d.names('design')).toContain('Number1');
    expect(() => JSON.parse(d.save())).not.toThrow();
    const back = d.reopened();
    expect(back.names('design')).toEqual(d.names('design'));
    expect(back.entry('Number1').displayValue).toBe(d.entry('Number').displayValue);
  });

  it('cross-section: the entry lands in the target section, read back there', () => {
    const d = open(DATA);
    d.paste('other', [d.entry('Number').serialize()]);
    expect(d.reopened().names('other')).toContain('Number');
  });

  it('rebinds the section even when the payload declares no metadata at all', () => {
    const d = open(DATA);
    d.paste('other', [{ name: 'Hand', value: 5 }]);
    const back = d.reopened();
    expect(back.names('other')).toContain('Hand');
    expect(back.names('design')).not.toContain('Hand');
  });

  it('gives the pasted copy a fresh uuid, read back so', () => {
    const d = open(DATA);
    const payload = d.entry('Number').serialize();
    d.paste('design', [payload]);
    const copy = d.reopened().entry('Number1');
    expect(copy.metadata.uuid).not.toBe(payload.metadata.uuid);
    expect(copy.metadata.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('pastes into a dictionary whose entries array is EMPTY', () => {
    const root = JSON.parse(readFileSync(DATA, 'utf8'));
    const donor = JSON.parse(JSON.stringify(root.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: Any) => e.name === 'Number')));
    root.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries = [];
    const d = opened(strToU8(JSON.stringify(root, null, 2)), 'data.sldd');
    expect(d.root.children.every((s: Any) => s.children.length === 0)).toBe(true);
    d.paste('design', [donor]);
    expect(() => JSON.parse(d.save())).not.toThrow();
    expect(d.reopened().names('design')).toEqual(['Number']);
  });

  it('two entries into design, each uniquely named across the namespace (a drop)', () => {
    const d = open(ARCH);
    const di = d.entry('DataInterface').serialize();
    const result = d.paste('design', [di, di]);
    expect(result.nodes.map((n: Any) => n.name)).toEqual(['DataInterface1', 'DataInterface2']);
    expect(d.reopened().names('design')).toEqual(['DataInterface1', 'DataInterface2']);
  });

  it('a copy keeps the source and is uniquified, so the catalog no longer classifies it', () => {
    const d = open(ARCH);
    d.paste('design', [d.entry('DataInterface').serialize()]);
    const back = d.reopened();
    expect(back.names('arch')).toContain('DataInterface');
    const copy = back.section('design').children.find((c: Any) => c.name === 'DataInterface1');
    expect([copy.className, copy.kind]).toEqual(['Simulink.Bus', 'Bus']);
  });
});

describe('is one undo step, announced, indexed, and leaves the selection where it was', () => {
  it('its undo puts the save back to the bytes read, and its redo makes it again', () => {
    const d = open(DATA);
    const before = d.save();
    d.paste('design', [d.entry('Number').serialize(), d.entry('PI').serialize()]);
    const pasted = d.save();
    expect(d.session.canUndo()).toBe(true);
    d.session.undo();
    expect(d.save()).toBe(before);
    expect(d.names('design')).not.toContain('Number1');
    d.session.redo();
    expect(noLastmod(d.save())).toBe(noLastmod(pasted));
    expect(d.names('design')).toContain('PI1');
    d.session.undo();
    expect(d.session.canUndo()).toBe(false);
  });

  it('announces each entry added, and each taken out by the undo; the pasted ones answer by id', () => {
    const d = open(DATA);
    const added: string[] = [];
    const deleted: string[] = [];
    d.session.bus.subscribe('node/added', (p: Any) => added.push(p.node.name));
    d.session.bus.subscribe('node/deleted', (p: Any) => deleted.push(p.node.name));
    const { nodes } = d.paste('design', [d.entry('Number').serialize(), d.entry('PI').serialize()]);
    expect(added).toEqual(['Number1', 'PI1']);
    for (const node of nodes) expect(d.session.findNodeById(node.id)).toBe(node);
    // And an edit of a pasted entry, by id, is made.
    d.session.setActive(d.root, nodes[0]);
    expect(d.session.editProperty(nodes[0].id, 'Value', '7')).toBe(true);
    d.session.undo();
    d.session.undo();
    expect(deleted).toEqual(['Number1', 'PI1']);
    expect(d.session.findNodeById(nodes[0].id)).toBeNull();
  });

  it('does not move the selection', () => {
    const d = open(DATA);
    const number = d.entry('Number');
    d.session.setActive(d.root, number);
    d.session.pasteEntries(d.section('design').id, [number.serialize()]);
    expect(d.session.getEntryNodes()).toEqual([number]);
  });
});

describe('all of it or none', () => {
  it('a class with no home in the section refuses the paste whole, in the rule’s words, whatever the order', () => {
    for (const order of [['DataInterface', 'ServiceInterface'], ['ServiceInterface', 'DataInterface']]) {
      const d = open(ARCH);
      const before = d.save();
      const result = d.paste('design', order.map((n) => d.entry(n).serialize()));
      expect(result).toEqual({ error: true, reason: 'A "Simulink.ServiceBus" entry is not allowed in Design Data.', name: 'ServiceInterface' });
      expect(d.names('design')).toEqual([]);
      expect(d.save()).toBe(before);
      expect(d.session.canUndo()).toBe(false);
    }
  });

  it('asks the allow-list of every payload before it makes any, as foldPasteEntries does', () => {
    // A Constant that is no scalar is refused only once made; a class with no home in the section
    // before anything is made, so that is the refusal said, wherever it stands in the list.
    const d = open(ARCH);
    const vec = { name: 'Vec', value: [1, 2, 3] };
    const param = { name: 'P', value: { _array_class: 'Simulink.Parameter', _elements: [{ _properties: {} }] } };
    expect(d.paste('arch', [vec, d.entry('DataInterface').serialize()])).toMatchObject({ error: true, name: 'Vec' });
    expect(d.paste('arch', [vec, param])).toEqual({ error: true, reason: 'A "Simulink.Parameter" entry is not allowed in Architectural Data.', name: 'P' });
  });

  it('an all-allowed multi-paste still adds every entry', () => {
    const d = open(ARCH);
    const result = d.paste('design', [d.entry('DataInterface').serialize(), d.entry('NumericType').serialize()]);
    expect(result.nodes).toHaveLength(2);
    expect(d.names('design')).toHaveLength(2);
  });

  it('a classless payload is judged by what it becomes: no MATLAB variable or struct in Configurations', () => {
    const d = open(DATA);
    for (const name of ['Number', 'Struct']) {
      expect(d.paste('config', [d.entry(name).serialize()])).toMatchObject({ error: true, reason: 'A MATLAB variable is not allowed in Configurations.' });
    }
    // Architectural Data shares Design Data's namespace, so the would-be Constant is named Struct1.
    expect(d.paste('arch', [d.entry('Struct').serialize()])).toMatchObject({ error: true, reason: "The value for constant 'Struct1' must be scalar and numeric." });
  });

  it('a non-scalar variable pasted into arch is refused with the exact message, and leaves nothing, not even the node parseEntry made', () => {
    const d = open(ARCH);
    const before = d.save();
    const vec = { name: 'Vec', metadata: { uuid: 'seed', namespace: NS_DESIGN, isderived: '0' }, value: [1, 2, 3] };
    const good = { name: 'Good', metadata: { uuid: 's1', namespace: NS_DESIGN, isderived: '0' }, value: 1 };
    const archNames = d.names('arch');
    expect(d.paste('arch', [good, vec])).toEqual({ error: true, reason: "The value for constant 'Vec' must be scalar and numeric.", name: 'Vec' });
    expect(d.names('arch')).toEqual(archNames);
    expect(d.save()).toBe(before);
    expect(d.root.dirty).toBe(false);
  });

  it('a scalar-numeric variable into arch becomes a Constant; the same non-scalar one into design stays a variable', () => {
    const d = open(ARCH);
    d.paste('arch', [{ name: 'K', metadata: { uuid: 'seed', namespace: NS_DESIGN, isderived: '0' }, value: 7 }]);
    d.paste('design', [{ name: 'Vec', metadata: { uuid: 'seed', namespace: NS_DESIGN, isderived: '0' }, value: [1, 2, 3] }]);
    const back = d.reopened();
    expect(back.section('arch').children.find((c: Any) => c.name === 'K').constructor.name).toBe('ConstantNode');
    expect(back.section('design').children.find((c: Any) => c.name === 'Vec').constructor.name).toBe('MatlabVariableNode');
  });

  it('a binary dictionary refuses the whole drop without adding the allowed payload', () => {
    const d = open(BINARY);
    const section = d.root.children.find((s: Any) => s.children.length > 0);
    const good = section.children[0].serialize();
    const bad = { name: 'Illegal', value: { _array_class: 'Simulink.ServiceBus' } };
    const before = section.children.map((c: Any) => c.name);
    expect(section.allowsType('Simulink.ServiceBus')).toBe(false);
    d.session.setActive(d.root, section);
    expect(d.session.pasteEntries(section.id, [good, bad])).toMatchObject({ error: true, reason: 'A "Simulink.ServiceBus" entry is not allowed in Design Data.' });
    expect(section.children.map((c: Any) => c.name)).toEqual(before);
  });

  it('what is handed over must be a list of entries', () => {
    const d = open(DATA);
    for (const bad of [null, 'x', [1], [null], [[]]] as Any[]) {
      expect(d.session.pasteEntries(d.section('design').id, bad)).toEqual({
        error: true,
        reason: 'Cannot paste into "Design Data": what was handed over is not a list of entries. Nothing was pasted.',
      });
    }
    expect(d.session.pasteEntries(d.section('design').id, [])).toEqual({ nodes: [] });
  });
});

describe('a same-document move (removeFirst)', () => {
  it('moves an arch Data Interface into Design Data: gone from arch, a genuine design entry keeping its name', () => {
    const d = open(ARCH);
    const before = d.save();
    const src = d.entry('DataInterface');
    const result = d.paste('design', [src.serialize()], [entrySelectorOf(src)]);
    expect(result.nodes.map((n: Any) => n.name)).toEqual(['DataInterface']);
    expect(d.names('arch')).not.toContain('DataInterface');
    const back = d.reopened();
    const moved = back.section('design').children.find((c: Any) => c.name === 'DataInterface');
    expect(back.names('arch')).not.toContain('DataInterface');
    expect([moved.isDerived, moved.className, moved.kind]).toEqual([false, 'Simulink.Bus', 'Data Interface']);
    // One step: its undo puts the entry back where it was, the save its bytes.
    const at = (d.root.getSection('arch').children as Any[]).length;
    d.session.undo();
    expect(d.save()).toBe(before);
    expect(d.names('arch')).toContain('DataInterface');
    expect(d.names('arch').length).toBe(at + 1);
    expect(d.names('design')).toEqual([]);
    d.session.redo();
    expect(d.names('arch')).not.toContain('DataInterface');
    expect(d.names('design')).toEqual(['DataInterface']);
  });

  it('announces the entries it took out, which leave the index', () => {
    const d = open(ARCH);
    const src = d.entry('DataInterface');
    const deleted: string[] = [];
    d.session.bus.subscribe('node/deleted', (p: Any) => deleted.push(p.node.name + '@' + p.section.name));
    const id = src.id;
    d.paste('design', [src.serialize()], [entrySelectorOf(src)]);
    expect(deleted).toEqual(['DataInterface@arch']);
    expect(d.session.findNodeById(id)).toBeNull();
  });

  it('rows spanning two sections onto arch: both end in arch under their own names (V-002)', () => {
    const text = readFileSync(ARCH, 'utf8').replace('"isderived": "1"', '"isderived": "0"');
    const d = opened(strToU8(text), 'arch.sldd');
    expect(d.names('design')).toEqual(['AliasType']);
    const sources = ['AliasType', 'DataInterface'].map((n) => d.entry(n));
    d.paste('arch', sources.map((s) => s.serialize()), sources.map(entrySelectorOf));
    const back = d.reopened();
    const archNames = back.names('arch');
    expect(archNames).toContain('AliasType');
    expect(archNames).toContain('DataInterface');
    expect(archNames.filter((n: string) => /^(AliasType|DataInterface)\d+$/.test(n)), 'no renamed copies').toEqual([]);
    expect(back.section('arch').children.find((c: Any) => c.name === 'AliasType').isDerived).toBe(true);
    expect(back.names('design'), 'nothing is left in design').toEqual([]);
  });

  it('a source named by no entry is passed by; one its uuid does not tell from another refuses the paste', () => {
    const d = open(DATA);
    const number = d.entry('Number');
    expect(d.paste('other', [number.serialize()], ['Gone']).nodes.map((n: Any) => n.name)).toEqual(['Number']);
    // Two entries now answer to "Number" (Design Data and Other Data): a bare name is ambiguous.
    const before = d.save();
    expect(d.paste('design', [number.serialize()], ['Number'])).toEqual({
      error: true,
      reason: 'Cannot move "Number": two entries of "numeric_json.sldd" have that name, and nothing tells which one is meant. Nothing was pasted.',
      name: 'Number',
    });
    expect(d.save()).toBe(before);
    // Its uuid tells them apart.
    expect(d.paste('design', [number.serialize()], [entrySelectorOf(number)]).nodes.map((n: Any) => n.name)).toEqual(['Number']);
  });

  it('a refused paste puts back what it took out', () => {
    const d = open(ARCH);
    const before = d.save();
    const di = d.entry('DataInterface');
    const vec = { name: 'Vec', value: [1, 2, 3] };
    expect(d.paste('arch', [di.serialize(), vec], [entrySelectorOf(di)])).toMatchObject({ error: true, name: 'Vec' });
    expect(d.names('arch')).toContain('DataInterface');
    expect(d.save()).toBe(before);
    expect(d.session.canUndo()).toBe(false);
  });
});

describe('a non-finite number copied into a dictionary', () => {
  const binaryZip = unzipSync(new Uint8Array(readFileSync(BINARY)));
  /** One DD.ENTRY of Design Data, as MATLAB writes it, around `value`. */
  const entryXml = (name: string, value: string, uuidTail: string) => `<Object Class="DD.ENTRY">
        <P Name="Name" Class="char">${name}</P>
        <P Name="UUID" Class="char">0e0e0e0e-0000-4000-8000-${uuidTail}</P>
        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>
        <P Name="LastMod" Class="char">20261023T120000.000000</P>
        <P Name="LastModBy" Class="char">fixture</P>
        <P Name="IsDerived" Class="char">0</P>
        ${value}
    </Object>
    `;
  const NON_FINITE: [string, string][] = [
    ['nfInf', '<P Name="Value" Class="double">Inf</P>'],
    ['nfNegInf', '<P Name="Value" Class="double">-Inf</P>'],
    ['nfNaN', '<P Name="Value" Class="double">NaN</P>'],
    ['nfStruct', '<P Name="Value" Class="struct"><Element><P Name="a" Class="double">Inf</P></Element></P>'],
    ['nfParam', '<P Name="Value"><Element Class="Simulink.Parameter"><P Name="Value" Class="double">Inf</P></Element></P>'],
  ];
  /** The records a copy of each carries, out of a binary dictionary. */
  function copied(): Map<string, Record<string, unknown>> {
    const xml = strFromU8(binaryZip['data/chunk0.xml']);
    const at = xml.indexOf('<Object Class="DD.ENTRY">');
    const chunk = xml.slice(0, at) + NON_FINITE.map(([n, v], i) => entryXml(n, v, String(i).padStart(12, '0'))).join('') + xml.slice(at);
    const zip = zipSync({ ...binaryZip, 'data/chunk0.xml': strToU8(chunk) });
    const source = opened(zip, 'params.sldd');
    return new Map(NON_FINITE.map(([n]) => [n, cloneForPaste(source.entry(n).serialize())]));
  }
  const written = (text: string, name: string): Any =>
    JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: Any) => e.name === name).value;
  const spelled = (text: string) => ({ _type: 'double', _value: text });

  it("into a JSON dictionary, is written in MATLAB's spelling, at an entry's value, a struct's field and an object's property", () => {
    const payloads = copied();
    const paste = (name: string) => {
      const d = open(DATA);
      expect(d.paste('design', [payloads.get(name)!]).error).toBeUndefined();
      return written(d.save(), name);
    };
    expect(paste('nfInf')).toEqual(spelled('Inf'));
    expect(paste('nfNegInf')).toEqual(spelled('-Inf'));
    expect(paste('nfNaN')).toEqual(spelled('NaN'));
    expect(paste('nfStruct')._elements[0].a).toEqual(spelled('Inf'));
    expect(paste('nfParam')._elements[0]._properties.Value).toEqual(spelled('Inf'));
  });

  it('into a JSON dictionary, is never refused: every one of them is pasted together, never as null', () => {
    const d = open(DATA);
    expect(d.paste('design', [...copied().values()]).error).toBeUndefined();
    const text = d.save();
    expect(text).not.toMatch(/"(?:Value|value|a)":\s*null/);
    for (const [name] of NON_FINITE) expect(written(text, name), name).toBeTruthy();
  });

  it('into a binary dictionary, reads back as the same values', () => {
    const d = open(BINARY);
    const section = d.root.children.find((s: Any) => s.name === 'design');
    d.session.setActive(d.root, section);
    expect(d.session.pasteEntries(section.id, [...copied().values()]).error).toBeUndefined();
    const back = d.reopened();
    expect(back.entry('nfInf').displayValue).toBe('Inf');
    expect(back.entry('nfNegInf').displayValue).toBe('-Inf');
    expect(back.entry('nfNaN').displayValue).toBe('NaN');
  });
});

describe('pasteRefusal of a section', () => {
  it('says what the allow-list refuses without making anything, and with `deep` what the paste would', () => {
    const d = open(ARCH);
    const before = d.save();
    const design = d.section('design').id;
    const arch = d.section('arch').id;
    expect(d.session.pasteRefusal(design, d.entry('ServiceInterface').serialize())).toBe('A "Simulink.ServiceBus" entry is not allowed in Design Data.');
    expect(d.session.pasteRefusal(design, d.entry('DataInterface').serialize())).toBeNull();
    const vec = { name: 'Vec', value: [1, 2, 3] };
    expect(d.session.pasteRefusal(arch, vec)).toBeNull();
    expect(d.session.pasteRefusal(arch, vec, { deep: true })).toBe("The value for constant 'Vec' must be scalar and numeric.");
    expect(d.session.pasteRefusal(arch, { name: 'K', value: 7 }, { deep: true })).toBeNull();
    // Nothing made, published or recorded, and the file as it was.
    expect(d.save()).toBe(before);
    expect(d.root.dirty).toBe(false);
    expect(d.session.canUndo()).toBe(false);
    expect(d.names('arch')).not.toContain('K');
  });
});

describe('what takes no paste', () => {
  it("a dictionary's own id, which names no section, and an id nothing open has", () => {
    const d = open(DATA);
    const name = d.root.name;
    for (const ask of [() => (d.session.pasteEntries(name, [{ name: 'n', value: 1 }]) as Any).reason, () => d.session.pasteRefusal(name, { name: 'n', value: 1 }, { deep: true })]) {
      expect(ask()).toBe(`Cannot paste into "${name}": a dictionary takes a paste into one of its sections, named by its id ("${name}/design"). Nothing was pasted.`);
    }
    expect((d.session.pasteEntries('nope.sldd/design', [{ name: 'n', value: 1 }]) as Any).reason).toBe('Cannot paste into "nope.sldd/design": no source of that id is open. Nothing was pasted.');
  });
});
