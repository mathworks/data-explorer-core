// Copyright 2026 The MathWorks, Inc.
//
// A CoderInfo MATLAB R2024b and earlier save (and every object made from the R2023b templates) is
// a 'handle' opaque, whose StorageClass, Identifier and Alignment this package shows as read
// (McosParser). Only a MAT-file's save writes an edit of one (into the opaque: MatNode). Every
// other venue that holds such an object shows its values, and takes no edit of them: a binary
// dictionary's value held as a MAT stream (read-only as an encoded value), and a model workspace,
// which no save writes. Nor do the editors a MAT-file offers of a node's read-only rows
// (BaseNode.sourceOfferedEditor) reach them.
//
// Both venues are built here of R2023b's own objects (mat-edits-gate/r23/mix.mat), each one's
// element and the file's subsystem as one MAT stream: in a binary dictionary's entry, and as a
// model's workspace of a struct of them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, unzlibSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { parseMat, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { subsystemElementOf } from '../src/datamodel/parser/MatFileWriter.js';
import { elementNamed, encodeMatVariable, withObjectMembers } from '../src/datamodel/parser/MatWriter.js';

const TEST = fileURLToPath(new URL('.', import.meta.url));
const read = (rel: string) => new Uint8Array(readFileSync(TEST + rel));
const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const MIX = read('fixtures/mat-edits-gate/r23/mix.mat');
const parsed = parseMat(bufferOf(MIX));
const subsystem = subsystemElementOf(parsed.records.find((r) => r.offset === parsed.subsystemOffset)!)!;

// The element of the variable `name` of mix.mat, inflated and named ''.
function elementOf(name: string): Uint8Array {
  const b = parsed.records.find((r) => r.name === name)!.bytes;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const element = v.getUint32(0, true) === 15 ? unzlibSync(b.subarray(8, 8 + v.getUint32(4, true))) : b;
  return elementNamed(element, '')!;
}

// A MAT stream of `element` and mix.mat's subsystem, as a dictionary or a model workspace holds one.
function streamOf(element: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + element.length + subsystem.length);
  out.set([0x00, 0x01, 0x49, 0x4d, 0, 0, 0, 0]);
  out.set(element, 8);
  out.set(subsystem, 8 + element.length);
  return out;
}

function allNodes(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(root);
  return out;
}

const CODER_KEYS = ['storageClass', 'alignment', 'identifier'];

/** What each of the objects `names` under `root` takes: its CoderInfo's shown values, each key's editability, and an edit's answer. */
function venue(session: any, root: any, names: string[]) {
  const all = allNodes(root);
  return names.map((name) => {
    const node = all.find((n) => n.name === name && /^Simulink\./.test(n.className ?? ''));
    expect(node, name).toBeDefined();
    const props = [...node.getProperties(), ...(node.getPILayout() ?? []).flatMap((g: any) => g.items)];
    const info = (key: string) => node.getPropInfo(props.find((p: any) => p.key === key));
    session.setActive(root, node);
    return {
      name,
      shown: info('storageClass').displayValue,
      editable: [...CODER_KEYS, 'initialValue', 'sampleTime', 'dimensions'].filter((k) => props.some((p: any) => p.key === k)).filter((k) => info(k).editable),
      edit: session.editProperty(node.id, 'storageClass', 'ImportedExtern'),
      status: node.status,
    };
  });
}

describe("a 'handle' opaque CoderInfo outside a MAT-file", () => {
  it('a binary dictionary holding one as a MAT stream shows its storage class, and takes no edit of it', () => {
    const z = unzipSync(read('fixtures/sldd-stream-objects/stream_objects_binary.sldd'));
    let xml = Buffer.from(z['data/chunk0.xml']).toString('latin1');
    for (const [entry, cls, bytes] of [['pSp', 'Simulink.Parameter', streamOf(elementOf('p'))], ['sigH', 'Simulink.Signal', streamOf(elementOf('sig'))]] as const) {
      const re = new RegExp('(<P Name="Name" Class="char">' + entry + '</P>[\\s\\S]*?<P Name="Value" Class=")[^"]*(" Encoding="hex" EncodedLength=")\\d+(">)([^<]*)(<)');
      const before = xml;
      xml = xml.replace(re, (_m, a, b, c, _d, e) => a + cls + b + bytes.length + c + '\n' + Buffer.from(bytes).toString('hex').toUpperCase() + '\n' + e);
      expect(xml, entry).not.toBe(before);
    }
    z['data/chunk0.xml'] = new Uint8Array(Buffer.from(xml, 'latin1'));
    const bytes = zipSync(z);
    const session = createSession();
    const root: any = ingest(session, bufferOf(bytes), { filename: 'objects.sldd' });
    const seen = venue(session, root, ['pSp', 'sigH']);
    for (const s of seen) {
      expect(s.editable, s.name).toEqual([]);
      expect(s.edit, s.name).toMatchObject({ error: true, reason: expect.stringMatching(/stored as an encoded MATLAB value/) });
      expect(s.status, s.name).toBe('');
    }
    // What it shows is what the opaque holds, as a MAT-file holding the same object shows it.
    const mat: any = createSession().addMatSource('mix.mat', bufferOf(MIX));
    const own = (n: string) => mat.children.find((c: any) => c.name === n);
    const sc = (n: any) => n.getPropInfo(n.getProperties().find((p: any) => p.key === 'storageClass')).displayValue;
    expect(seen.map((s) => s.shown)).toEqual([sc(own('p')), sc(own('sig'))]);
  });

  it('a model workspace holding one shows its storage class, and takes no edit of it, as no save writes one', () => {
    const fields: Record<string, MatVariable> = {};
    for (const name of ['p', 'sig', 'lt', 'b']) {
      const r = parsed.records.find((q) => q.name === name)!;
      fields[name] = { name: '', className: r.variable?.className ?? 'Simulink.Parameter', dimensions: [1, 1], isComplex: false, isLogical: false, value: null, fields: null, isOpaque: true, _objectElement: elementOf(name) } as MatVariable;
    }
    const struct: MatVariable = { name: '', className: 'struct', dimensions: [1, 1], isComplex: false, isLogical: false, value: null, fields: fields as unknown as MatVariable['fields'] };
    const element = withObjectMembers((v: MatVariable) => (v as { _objectElement?: Uint8Array })._objectElement ?? null, () => encodeMatVariable(struct));
    const z = unzipSync(read('fixtures/mcos/typed_ws.slx'));
    z['simulink/modelWorkspace.mxarray'] = streamOf(element);
    const session = createSession();
    const root: any = ingest(session, bufferOf(zipSync(z)), { filename: 'ws.slx' });
    const seen = venue(session, root, ['p', 'sig']);
    for (const s of seen) {
      expect(s.editable, s.name).toEqual([]);
      expect(s.edit, s.name).toMatchObject({ error: true, reason: expect.stringMatching(/its CoderInfo is held as MATLAB's own handle data/) });
      expect(s.status, s.name).toBe('');
    }
    expect(seen.map((s) => s.shown)).not.toContain('');
  });

  it('a MAT-file holding one takes its storage class, and writes it into the opaque', () => {
    const session = createSession();
    const root: any = session.addMatSource('mix.mat', bufferOf(MIX));
    const [p] = venue(session, root, ['p']);
    expect([p.edit, p.status]).toEqual([true, 'Modified']);
    const saved = (session.serializeSource('mix.mat') as { bytes: Uint8Array }).bytes;
    const again: any = createSession().addMatSource('saved.mat', bufferOf(saved));
    const node = again.children.find((c: any) => c.name === 'p');
    expect(node.getPropInfo(node.getProperties().find((q: any) => q.key === 'storageClass')).displayValue).toBe('ImportedExtern');
  });
});
