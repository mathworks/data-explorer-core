// Copyright 2026 The MathWorks, Inc.
//
// The two ways a model gets into a session answer identically.
//
// A host can hand a session a model's BYTES (`addModelSource`, which parses them) or the PARSE
// it already holds (`addModelSourceParsed`) — the folder cache's shared parse, a worker's — so
// the same bytes reach the same tree by two routes, and every row a host shows comes out of
// whichever route the file happened to take. That is this repo's recurring bug class stated
// exactly: one rule, two paths. usageIndex.test.ts pins the same equality for the SUMMARY half
// of the split; this pins the TREE half, over every model fixture, every `.mdl` framing and the
// parity artifacts included.
//
// These came here from data-explorer-view (its test/parsedRegistration.test.ts), which proved
// the equality through its own row builder over this package's nodes. Here the comparison reads
// the nodes themselves — every node's identity, its row, its Property Inspector object and the
// order of its children — so nothing of view's sits between the tree and the assertion.
// dataModelSources.test.ts › "builds the same .slx tree from a parse as from the bytes" stays as
// the narrow example; this is the sweep.
//
// Deliberately a sweep and not an example. The two routes differ in what they hand the session
// — a buffer against a parsed object — and the parsed route also labels the parse with a
// filename that is NOT the srcId, which is what `parsed.name` carries. Every fixture is
// registered both ways under the SAME srcId, one after the other, so the node ids are directly
// comparable and nothing has to be normalised out of the comparison first.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { createSession, isModelFile, parseModel } from '../src/index.js';
import type { ParseWarning } from '../src/index.js';

type Session = ReturnType<typeof createSession>;

const TEST_ROOT = fileURLToPath(new URL('./', import.meta.url));

function bytesOf(relative: string): ArrayBuffer {
  const b = readFileSync(join(TEST_ROOT, relative));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

// Every model under these folders, read from the directories rather than listed, so a model
// added for some other suite is covered here too. Recursive, with this package's own
// predicate: `mcos/`, `sparse/` and the parity artifacts' era folders hold models as well.
// Every `.mdl` framing is in here as well as `.slx`, which matters: a classic `.mdl` has no
// `rawContents` and no `zipEntries`, so it is the case where the parsed route hands the
// session the most nulls.
const modelsUnder = (dir: string): string[] =>
  (readdirSync(join(TEST_ROOT, dir), { recursive: true }) as string[])
    .filter((name) => isModelFile(name))
    .map((name) => `${dir}/${name}`)
    .sort();
const MODELS = [...modelsUnder('fixtures'), ...modelsUnder('folder-fixtures'), ...modelsUnder('parity/artifacts')];

// Every model on disk reads with no warning at all (parseWarnings.test.ts pins that), so over
// them alone the losses sweep below compares `[]` with `[]`. These are real models damaged in
// one place each, as parseWarnings.test.ts damages them, so the sweep has losses to compare:
// one per framing, and one whose message quotes the filename it was parsed with.
const latin1 = (relative: string) => new TextDecoder('latin1').decode(new Uint8Array(bytesOf(relative)));

function latin1Bytes(text: string): ArrayBuffer {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out.buffer;
}

function damaged(relative: string, mutate: (text: string) => string): () => ArrayBuffer {
  return () => {
    const text = latin1(relative);
    const out = mutate(text);
    expect(out).not.toBe(text); // the damage took
    return latin1Bytes(out);
  };
}

const UNCLOSED = '{ "unclosed": ';

const DAMAGED: Record<string, () => ArrayBuffer> = {
  // `.slx`: one configuration set's part does not parse.
  'damaged/slxcases_configSet1.slx': () => {
    const entries = unzipSync(new Uint8Array(bytesOf('parity/artifacts/slx_layouts/slxcases.slx')));
    expect(Object.keys(entries)).toContain('simulink/configSet1.json');
    entries['simulink/configSet1.json'] = strToU8(UNCLOSED);
    const zipped = zipSync(entries);
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  },
  // An OPC text package `.mdl`: the same part, in text framing.
  'damaged/mdlcases_configSet1.mdl': damaged('parity/artifacts/mdl/mdlcases.mdl', (t) =>
    t.replace(/(\n__MWOPC_PART_BEGIN__ \/simulink\/configSet1\.json\n)[^]*?(?=\n__MWOPC_)/, `$1${UNCLOSED}`),
  ),
  // A classic `.mdl`: the model workspace's uuencoded record does not decode.
  'damaged/mdlcases_R2017b_workspace.mdl': damaged('parity/artifacts/mdl/mdlcases_R2017b.mdl', (t) =>
    t.replace(/(\n\s*Data\s+)"[^]*?(?=\n {2}\})/, '$1"AAAA"'),
  ),
  // A Simulink text package `.mdl` none of whose parts is one a model is read from: the
  // `source-empty` whose message quotes the filename.
  'damaged/mdltext_renamed.mdl': damaged('parity/artifacts/mdltext/mdltext.mdl', (t) =>
    t.replace(/\n__MWSL_PART_BEGIN__ \//g, '\n__MWSL_PART_BEGIN__ /renamed/'),
  ),
};

const CORPUS: Array<[string, () => ArrayBuffer]> = [
  ...MODELS.map((name): [string, () => ArrayBuffer] => [name, () => bytesOf(name)]),
  ...Object.entries(DAMAGED),
];

// A fresh registration under `srcId`, from whichever end. The de-register is what makes the two
// comparable: the same srcId means the same node ids, and the session keys one source per srcId.
function fromBytes(session: Session, srcId: string, name: string, bytes: ArrayBuffer): any {
  session.removeDataSource(srcId);
  return session.addModelSource(srcId, bytes, { path: name });
}

function fromParsed(session: Session, srcId: string, name: string, path: string, bytes: ArrayBuffer): any {
  session.removeDataSource(srcId);
  // The filename the parse is made with is the PATH, and it is neither the srcId nor the
  // name the meta records — so a fixture passing below is also evidence that
  // `parsed.name` reaches nothing a host shows.
  return session.addModelSourceParsed(srcId, parseModel(bytes, path), { path: name });
}

// A read that throws is an answer too, and the two routes must give the same one.
function read(f: () => unknown): unknown {
  try {
    return { value: f() };
  } catch (err) {
    return { threw: err instanceof Error ? err.message : String(err) };
  }
}

// A property as data: its own fields and what the node answers for it. A schema property's
// functions are made per node, so the two trees' are never the same object; what they compute
// is compared through `getPropInfo`, which is what a host reads them by.
function propOf(n: any, p: any): unknown {
  return {
    key: p?.key,
    displayName: p?.displayName,
    column: p?.column,
    editor: p?.editor,
    nodeProperty: p?.nodeProperty,
    sourceKeys: p?.sourceKeys,
    sourceEditable: p?.sourceEditable,
    info: read(() => n.getPropInfo(p)),
  };
}

// What a host reads off one node, and off every node under it in order: the identity getters,
// the row a table draws, every property and its value, the Property Inspector's object and
// layout, and the two capability questions a context menu asks. View's rows were made of
// these; reading them directly keeps the comparison at least as strict as view's was.
function treeOf(n: any): unknown {
  return {
    type: n.constructor.name,
    id: read(() => n.id),
    name: read(() => n.name),
    displayName: read(() => n.displayName),
    icon: read(() => n.icon),
    className: read(() => n.className),
    kind: read(() => n.kind),
    dataType: read(() => n.dataType),
    displayValue: read(() => n.displayValue),
    disabled: read(() => n.disabled),
    nameEditable: read(() => n.nameEditable),
    valueEditable: read(() => n.valueEditable),
    isEntry: read(() => n.isEntry),
    isContainer: read(() => n.isContainer),
    status: read(() => n.status),
    row: read(() => n.toRow()),
    properties: read(() => (n.getProperties() as unknown[]).map((p) => propOf(n, p))),
    pi: read(() => n.toPIObject()),
    layout: read(() =>
      (n.getPILayout() as { group: string; items: unknown[] }[] | null)?.map((g) => ({
        group: g.group,
        items: g.items.map((p) => propOf(n, p)),
      })) ?? null,
    ),
    canAddChild: read(() => (typeof n.canAddChild === 'function' ? n.canAddChild() : null)),
    canRemoveChild: read(() => (typeof n.canRemoveChild === 'function' ? n.canRemoveChild() : null)),
    children: ((n.children ?? []) as unknown[]).map(treeOf),
  };
}

// What the model itself keeps from its parse, beyond the nodes: the header fields, the
// references the usage engine resolves through, and the raw parts a save writes back. A route
// that dropped one would leave every row above identical and the model unsaveable or unlinked.
function recordOf(m: any): unknown {
  return {
    release: m.release,
    creator: m.creator,
    lastModified: m.lastModified,
    uuid: m.uuid,
    dataDictionary: m.dataDictionary,
    workspaceDataSource: m.workspaceDataSource,
    blockParamUsages: m.blockParamUsages,
    masks: m.masks,
    rawContents: m.rawContents,
    zipEntries: m._zipEntries,
  };
}

// `ISourceNode.warnings` is ABSENT on a clean read rather than empty.
function warningsOf(node: any): ParseWarning[] {
  return Array.isArray(node?.warnings) ? (node.warnings as ParseWarning[]) : [];
}

describe('registering a model from a parse equals registering it from its bytes', () => {
  it('has a corpus worth sweeping', () => {
    // Without this every comparison below could pass over an empty list.
    expect(MODELS.length).toBeGreaterThan(20);
    // view's eight, which are what this sweep was first written over.
    for (const name of [
      'fixtures/legacy_ctrl.mdl',
      'fixtures/model_with_refs.mdl',
      'folder-fixtures/chain_model.slx',
      'folder-fixtures/model_with_refs.slx',
      'folder-fixtures/shadow_pair.slx',
      'folder-fixtures/shadow_ws.slx',
      'folder-fixtures/shared_gain.slx',
      'folder-fixtures/sid_blocks.slx',
    ]) {
      expect(MODELS).toContain(name);
    }
    // A `.mdl` of each framing: the classic brace text, the OPC text package and the
    // Simulink text package.
    const mdlText = MODELS.filter((m) => m.endsWith('.mdl')).map((m) => latin1(m));
    expect(mdlText.some((t) => t.startsWith('Model {'))).toBe(true);
    expect(mdlText.some((t) => t.includes('__MWOPC_PACKAGE_BEGIN__'))).toBe(true);
    expect(mdlText.some((t) => t.includes('__MWSL_PACKAGE_BEGIN__'))).toBe(true);
    // And every damaged model reads with the loss it was damaged for, so the losses sweep
    // compares lists that are not empty on both sides.
    const s = createSession();
    const codes = Object.entries(DAMAGED).map(([name, bytes]) =>
      warningsOf(fromBytes(s, `probe://${name}`, name, bytes())).map((w) => w.code),
    );
    expect(codes).toEqual([['part-unreadable'], ['part-unreadable'], ['part-unreadable'], ['source-empty']]);
  });

  it.each(CORPUS)('gives %s the same rows either way', (name, bytesOfModel) => {
    const session = createSession();
    const srcId = `eq://${name}`;
    const bytes = bytesOfModel();

    const bytesNode = fromBytes(session, srcId, name, bytes);
    const viaBytes = treeOf(bytesNode) as { children: unknown[] };
    const bytesRecord = recordOf(bytesNode);
    const bytesMeta = { ...bytesNode.meta };
    const parsedNode = fromParsed(session, srcId, name, `/fx/${name}`, bytes);

    // Non-vacuity first: an empty tree on both sides would compare equal and say nothing.
    // Every model has at least its sections.
    expect(viaBytes.children.length).toBeGreaterThan(0);
    expect(treeOf(parsedNode)).toEqual(viaBytes);
    expect(recordOf(parsedNode)).toEqual(bytesRecord);
    // And the recorded meta, which the tree cannot show: the session resolves a link target by
    // srcId, then by `meta.path`'s basename (openSourceNamed's rank 2), so a route that forgot
    // to pass the path would leave the tree identical and every cross-file link into this
    // model dead for a host keyed by uri.
    expect(parsedNode.meta).toEqual(bytesMeta);
    expect(session.getDataSource(srcId)).toBe(parsedNode);
  });

  it.each(CORPUS)('reports the same losses for %s either way', (name, bytesOfModel) => {
    const session = createSession();
    const srcId = `warn://${name}`;
    const path = `/fx/${name}`;
    const bytes = bytesOfModel();

    const viaBytes = warningsOf(fromBytes(session, srcId, name, bytes));
    const viaParsed = warningsOf(fromParsed(session, srcId, name, path, bytes));

    // The CODES first, as they are what a host acts on: view refuses `source-unreadable` and
    // nothing else.
    expect(viaParsed.map((w) => w.code)).toEqual(viaBytes.map((w) => w.code));
    // Then the rest of each warning, with the one difference that is real put back rather
    // than glossed over: two of the `.mdl` reader's messages quote the filename the parse was
    // made with, and the two routes parse with different ones (the srcId against the path).
    // The parts named and every other word must agree.
    expect(viaParsed.map((w) => ({ ...w, message: w.message.replaceAll(path, srcId) }))).toEqual(viaBytes);
  });

  it('marks a model that read short as unreadable through the parsed route too', () => {
    // A modern `.mdl` truncated after its package marker leaves only the legacy
    // `Model { Version }` stub, which parses into an empty model with a `source-unreadable`
    // warning. The parsed route has to carry that warning onto the node as the bytes route
    // does: it is the only thing a host has to refuse the file by, and a route that dropped it
    // would hand the host a five-empty-section tree that looks like a file that opened.
    const b = new TextEncoder().encode('__MWOPC_PACKAGE_BEGIN__\n\nModel {\n  Version 12.0\n}\n');
    const bytes = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const session = createSession();
    const srcId = 'eq://trunc.mdl';

    const bytesNode = fromBytes(session, srcId, 'trunc.mdl', bytes);
    const viaBytes = treeOf(bytesNode);
    const parsedNode = fromParsed(session, srcId, 'trunc.mdl', '/fx/trunc.mdl', bytes);

    expect(warningsOf(bytesNode).map((w) => w.code)).toEqual(['source-unreadable']);
    expect(warningsOf(parsedNode).map((w) => w.code)).toEqual(['source-unreadable']);
    // One of the two messages that quote the filename, so here the routes' sentences differ,
    // each naming what it was parsed as: the bytes route parses with the srcId.
    expect(warningsOf(bytesNode)[0].message).toMatch(/^"eq:\/\/trunc\.mdl" begins an OPC text package/);
    expect(warningsOf(parsedNode)[0].message).toMatch(/^"\/fx\/trunc\.mdl" begins an OPC text package/);
    expect(treeOf(parsedNode)).toEqual(viaBytes);
    // The session KEEPS it, either way. Refusing it is the host's call (view's registry
    // de-registers a source that carries `source-unreadable`), and the session's part is only
    // that both routes leave the host the same thing to refuse.
    expect(session.hasDataSource(srcId)).toBe(true);
  });
});
