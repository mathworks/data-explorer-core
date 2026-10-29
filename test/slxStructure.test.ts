// Copyright 2026 The MathWorks, Inc.
//
// A model's relationships shaped for a graph between files (src/datamodel/parser/SlxStructure.ts).
//
// These came here from the vscode host with the module (its test/slxStructure.test.ts, and
// the parts of its test/mdlFormat.test.ts that drive this module alone), adapted in two ways:
//
//   - The two `.mdl` fixtures vscode keeps on disk are built in memory here, by the same
//     recipe (vscode's test/fixtures/make-fixtures.mjs): the MODERN one frames
//     fixtures/model_with_refs.slx's own parts as a text package, which makes the two a twin
//     pair by construction; the CLASSIC one is the same brace text, written out below. Both
//     came out byte for byte equal to vscode's files when they moved.
//   - The tree side of "the tree and the graph complete a reference the same way" is this
//     package's own `ModelNode`, where vscode went through view's row builder over it.
//
// The corpus sweep reads the parity artifacts too — real MATLAB output across the layout
// eras and both `.mdl` generations — which vscode's fixture folder does not have.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { extractSlxStructure, isModelFile, parseModel, refModelExt, structureFromParsed } from '../src/index.js';
import ModelNode from '../src/datamodel/node/container/ModelNode.js';

const TEST_ROOT = fileURLToPath(new URL('./', import.meta.url));

function detach(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function onDisk(relative: string): ArrayBuffer {
  return detach(readFileSync(join(TEST_ROOT, relative)));
}

// --- the two `.mdl` fixtures, built ----------------------------------------------------

// The MODERN `.mdl`: the same parts as the `.slx`, written as text with delimiter lines
// instead of a zip, and `metadata/coreProperties.xml` base64'd to cover the binary-part
// path (a real `.mdl` carries its .mxarray model workspace that way).
const BASE64_PARTS = new Set(['metadata/coreProperties.xml']);

function opcTextPackage(parts: Record<string, Uint8Array>, modelName: string): ArrayBuffer {
  const enc = new TextEncoder();
  const chunks = [
    // A banner and a small legacy Model stub precede the package marker, as save_system
    // writes them. The parser skips both.
    enc.encode(
      `# MathWorks OPC Text Package\nModel {\n  Name                    "${modelName}"\n  Version                 25.0\n}\n__MWOPC_PACKAGE_BEGIN__\n`,
    ),
  ];
  for (const path of Object.keys(parts)) {
    const b64 = BASE64_PARTS.has(path);
    chunks.push(enc.encode(`__MWOPC_PART_BEGIN__ /${path}${b64 ? ' BASE64' : ''}\n`));
    chunks.push(b64 ? enc.encode(Buffer.from(parts[path]).toString('base64')) : parts[path]);
    // Exactly ONE newline after the content: it belongs to the framing, not to the part.
    chunks.push(enc.encode('\n'));
  }
  chunks.push(enc.encode('__MWOPC_PACKAGE_END__\n'));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

// The CLASSIC (pre-R2012) `.mdl`: nested braces, sharing no framing with the above. One of
// each relationship — a linked dictionary, a model reference named WITHOUT an extension
// (which is what forces the parent-extension rule: it must resolve to plant.mdl), and a
// MAT-file workspace source.
const CLASSIC_MDL = `Model {
  Name                    "legacy_ctrl"
  Version                 7.8
  Creator                 "fixture"
  LastModifiedDate        "Fri Sep 04 10:15:32 2026"
  DataDictionary          "params.sldd"
  WSDataSource            "MAT-File"
  WSSourceFileName        "signals.mat"
  GraphicalInterface {
    NumModelReferences      1
    ModelReference {
      ModelRefBlockPath       "legacy_ctrl/Plant|plant"
    }
  }
  System {
    Name                    "legacy_ctrl"
    Block {
      BlockType               Gain
      Name                    "Gain1"
      Gain                    "Kp"
    }
    Block {
      BlockType               Constant
      Name                    "Setpoint"
      Value                   "Uo"
    }
  }
}
`;

const SLX_TWIN = 'model_with_refs.slx';
const MODERN = 'model_with_refs.mdl';
const CLASSIC = 'legacy_ctrl.mdl';

const BUILT: Record<string, () => ArrayBuffer> = {
  [MODERN]: () => opcTextPackage(unzipSync(new Uint8Array(onDisk(`fixtures/${SLX_TWIN}`))), 'model_with_refs'),
  [CLASSIC]: () => detach(strToU8(CLASSIC_MDL)),
};

/** A fixture by name: one of the two built above, or a file under test/fixtures/. */
function buf(name: string): ArrayBuffer {
  return BUILT[name] ? BUILT[name]() : onDisk(`fixtures/${name}`);
}

// Build a real .slx (a zip of the parts the parser reads) so these cases go through the
// actual parser rather than a hand-made ParsedSlx shape.
function slx(parts: Record<string, string>): ArrayBuffer {
  const entries: Record<string, Uint8Array> = {};
  for (const key in parts) entries[key] = strToU8(parts[key]);
  return detach(zipSync(entries));
}

const DATA_SOURCES_XML =
  `<?xml version="1.0"?><ExternalDataSourceSettings><ExplicitExternalBrokerSources>` +
  `<fullPathToSource>signals.mat</fullPathToSource>` +
  `</ExplicitExternalBrokerSources></ExternalDataSourceSettings>`;

describe('extractSlxStructure', () => {
  it('extracts linked dictionary, model references, and external data sources', () => {
    const s = extractSlxStructure(buf(SLX_TWIN), SLX_TWIN);
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.modelReferences).toContain('plant.slx');
    expect(s.externalDataSources).toContain('signals.mat');
  });

  it('returns empty relationships for a corrupt buffer without throwing', () => {
    const s = extractSlxStructure(new ArrayBuffer(4), 'bad.slx');
    expect(s.dataDictionary).toBeNull();
    expect(s.modelReferences).toEqual([]);
    expect(s.externalDataSources).toEqual([]);
  });

  it('returns empty relationships for an empty buffer without throwing', () => {
    const s = extractSlxStructure(new ArrayBuffer(0), 'empty.slx');
    expect(s.dataDictionary).toBeNull();
    expect(s.modelReferences).toEqual([]);
    expect(s.externalDataSources).toEqual([]);
  });

  it('maps model references to bare model-name strings (not objects)', () => {
    const s = extractSlxStructure(buf(SLX_TWIN), SLX_TWIN);
    for (const ref of s.modelReferences) {
      expect(typeof ref).toBe('string');
    }
  });

  it('always returns arrays (never undefined) for the list fields', () => {
    const s = extractSlxStructure(new ArrayBuffer(4), 'bad.slx');
    expect(Array.isArray(s.modelReferences)).toBe(true);
    expect(Array.isArray(s.externalDataSources)).toBe(true);
  });

  it('appends .slx to a bare model name so basename resolution can match it', () => {
    // MATLAB records a reference as "plant"; the workspace file is "plant.slx". Without
    // the suffix a graph never links the two, so the model shows no referenced models
    // even though it has one.
    const s = extractSlxStructure(
      slx({
        'simulink/graphicalInterface.json': JSON.stringify({
          ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant' }],
        }),
      }),
      'bare.slx',
    );
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('keeps a model name that already ends in .slx exactly as-is', () => {
    // Double-suffixing to "plant.slx.slx" would break the same graph lookup.
    const s = extractSlxStructure(
      slx({
        'simulink/graphicalInterface.json': JSON.stringify({
          ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant.slx' }],
        }),
      }),
      'suffixed.slx',
    );
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('keeps every other relationship when one model reference has no ModelName', () => {
    // Regression: reading .modelName off such a reference threw, and the catch then
    // returned the all-empty structure — so ONE malformed reference made the model appear
    // to have no linked dictionary and no external data at all.
    const s = extractSlxStructure(
      slx({
        'simulink/blockDiagram.json': JSON.stringify({
          BlockDiagram: { DataDictionary: 'params.sldd', ModelUUID: 'u' },
        }),
        'simulink/graphicalInterface.json': JSON.stringify({
          ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant' }, { BlockPath: 'ctrl/x' }],
        }),
        'simulink/ExternalDataSourceSettings.xml': DATA_SOURCES_XML,
      }),
      'partial.slx',
    );
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.externalDataSources).toEqual(['signals.mat']);
    // The good reference survives; the nameless one is dropped, not invented.
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('drops a model reference whose ModelName is empty instead of naming it ".slx"', () => {
    // A bare ".slx" resolves to no file, so it would surface in a host's tree as a phantom
    // Model Reference row the user cannot open.
    const s = extractSlxStructure(
      slx({
        'simulink/blockDiagram.json': JSON.stringify({ BlockDiagram: { DataDictionary: 'd.sldd' } }),
        'simulink/graphicalInterface.json': JSON.stringify({
          ModelReferences: [{ BlockPath: 'a/b', ModelName: '' }],
        }),
      }),
      'empty-name.slx',
    );
    expect(s.modelReferences).toEqual([]);
    expect(s.dataDictionary).toBe('d.sldd');
  });

  it('reports no linked dictionary as null for a model that has none', () => {
    // A graph keys the dictionary edge off this field; '' or undefined would draw an edge
    // to a nonexistent file.
    const s = extractSlxStructure(
      slx({ 'simulink/blockDiagram.json': JSON.stringify({ BlockDiagram: { ModelUUID: 'u' } }) }),
      'nodict.slx',
    );
    expect(s.dataDictionary).toBeNull();
  });

  it('keeps the relationships of a model whose BLOCK part cannot be inflated', () => {
    // What reading through `scanModelStructure` rather than `parseModel` buys: the block
    // parts are never read, so bytes that cannot be inflated cannot fail to inflate. The
    // full parse throws on this archive, and a catch around it returned the all-empty
    // structure — a model with damaged block XML showed no linked dictionary and no
    // references, which is indistinguishable from a model that genuinely has none.
    //
    // The unreadability is by construction rather than by luck: the low three bits of a
    // raw deflate stream are BFINAL and a two-bit BTYPE, and `11` is the reserved value,
    // so 0xFF is refused by every inflate implementation.
    const archive = slx({
      'simulink/blockDiagram.json': JSON.stringify({
        BlockDiagram: { DataDictionary: 'params.sldd', ModelUUID: 'u' },
      }),
      'simulink/graphicalInterface.json': JSON.stringify({
        ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant' }],
      }),
      'simulink/ExternalDataSourceSettings.xml': DATA_SOURCES_XML,
      // Compressible on purpose, so the writer deflates rather than stores it: a stored
      // member is never inflated by anyone and would make this case vacuous.
      'simulink/systems/system_1.xml': '<System><Block/></System>'.repeat(400),
    });

    const s = extractSlxStructure(poison(archive, 'simulink/systems/system_1.xml'), 'damaged.slx');
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.modelReferences).toEqual(['plant.slx']);
    expect(s.externalDataSources).toEqual(['signals.mat']);
  });
});

// --- `.mdl`: three on-disk forms, and only one of them a zip ----------------------------

describe('extractSlxStructure on a MODERN .mdl', () => {
  it('reads the same relationships as its .slx twin, byte-for-byte identical parts', () => {
    // The two share one part set, so any difference here is the FRAMING: if the delimiter
    // walk lost a part or kept the framing newline as part data, the JSON parts stop
    // parsing and these fields go empty/null.
    const mdl = extractSlxStructure(buf(MODERN), MODERN);
    const twin = extractSlxStructure(buf(SLX_TWIN), SLX_TWIN);
    expect(mdl).toEqual(twin);
    expect(mdl.dataDictionary).toBe('params.sldd');
    expect(mdl.modelReferences).toEqual(['plant.slx']);
    expect(mdl.externalDataSources).toEqual(['signals.mat']);
  });

  it('is built as a text package with a base64 part, so the case above is not a zip twice', () => {
    // A guard on the built fixture, which vscode's on-disk copy did not need: a builder
    // that quietly returned the zip would make the twin comparison above compare the
    // `.slx` with itself.
    const text = new TextDecoder().decode(new Uint8Array(buf(MODERN)));
    expect(text).toContain('__MWOPC_PACKAGE_BEGIN__');
    expect(text).toContain('__MWOPC_PART_BEGIN__ /metadata/coreProperties.xml BASE64');
    expect((parseModel(buf(MODERN), MODERN) as { release?: string }).release).toBe('R2026b');
  });
});

describe('extractSlxStructure on a CLASSIC .mdl', () => {
  it('reads the brace format’s dictionary, reference, and external data source', () => {
    const s = extractSlxStructure(buf(CLASSIC), CLASSIC);
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.externalDataSources).toEqual(['signals.mat']);
  });

  it('completes a bare reference with .mdl — the PARENT’s extension, not .slx', () => {
    // The classic format records `legacy_ctrl/Plant|plant`, i.e. the model name `plant`
    // with no extension. A legacy hierarchy is legacy throughout, so the file on disk is
    // plant.mdl; naming it plant.slx would resolve to nothing and the model would show a
    // phantom unresolved reference.
    const s = extractSlxStructure(buf(CLASSIC), CLASSIC);
    expect(s.modelReferences).toEqual(['plant.mdl']);
  });

  it('is not thrown off by a ZIP-shaped reader: no relationships would be empty', () => {
    // Guard against reaching past the byte sniff to `parseSlx`, which throws "invalid zip
    // data" on classic-brace text; the catch then returns the all-empty structure, and a
    // legacy model silently shows no relationships at all — no error anywhere.
    const s = extractSlxStructure(buf(CLASSIC), CLASSIC);
    expect(s.dataDictionary).not.toBeNull();
    expect(s.modelReferences.length).toBeGreaterThan(0);
  });
});

describe('the BYTES decide the format, not the filename', () => {
  it('parses modern-.mdl text handed over under a .slx name', () => {
    // Real workspaces contain renamed and mislabelled files. The scan sniffs the ZIP magic
    // and falls back to the text reader, so this opens rather than failing with "invalid
    // zip data".
    const s = extractSlxStructure(buf(MODERN), 'mislabelled.slx');
    expect(s.dataDictionary).toBe('params.sldd');
  });

  it('parses a real ZIP .slx handed over under a .mdl name', () => {
    const s = extractSlxStructure(buf(SLX_TWIN), 'mislabelled.mdl');
    expect(s.dataDictionary).toBe('params.sldd');
    // The reference is already suffixed in the fixture, so the parent-extension rule does
    // not fire and cannot double-suffix it.
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('still returns empty relationships for bytes that are neither', () => {
    const s = extractSlxStructure(new ArrayBuffer(4), 'bad.mdl');
    expect(s).toEqual({ dataDictionary: null, modelReferences: [], externalDataSources: [] });
  });
});

// The one rule that has to hold on TWO paths, pinned BETWEEN them rather than on each side
// on its own.
//
// A model names its references without an extension. This package completes the bare name
// for the TREE (`ModelNode.fromParsed` → `addReferenceEntry`, with the parent's extension)
// and again for the GRAPH (`extractSlxStructure`), because a graph resolves edges by
// filename and so cannot use a bare name either. When two completions of one rule drift,
// the reference row a user SEES and the edge that actually RESOLVES name two different
// files, and neither side looks wrong by itself. So this compares the two answers, for every
// container, and then ties both to the rule.
describe('the tree and the graph complete a bare reference the same way', () => {
  const treeRefs = (bytes: ArrayBuffer, name: string): string[] =>
    ModelNode.fromParsed(parseModel(bytes, name), name)
      .getSection('references')!
      .children.map((c) => c.name)
      .sort();

  const graphRefs = (bytes: ArrayBuffer, name: string): string[] =>
    [...extractSlxStructure(bytes, name).modelReferences].sort();

  // The reference names as the FILE records them — before either path completes them.
  const rawRefs = (bytes: ArrayBuffer, name: string): string[] =>
    (parseModel(bytes, name).modelReferences ?? [])
      .map((r) => r.modelName)
      .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);

  for (const fixture of [MODERN, CLASSIC, SLX_TWIN]) {
    it(`names the same reference files on both paths for ${fixture}`, () => {
      const bytes = buf(fixture);
      const tree = treeRefs(bytes, fixture);
      // A fixture with no references would make this test pass while pinning nothing.
      expect(tree.length, `${fixture} must HAVE a model reference`).toBeGreaterThan(0);
      expect(graphRefs(bytes, fixture)).toEqual(tree);
    });

    it(`applies the completion rule itself to ${fixture}, not just consistently`, () => {
      // Ties both paths to the RULE rather than only to each other — two completions that
      // drifted the SAME way would still agree with one another. A name already complete is
      // left alone, a bare one takes the parent's container; both arms occur across these
      // fixtures (MODERN records `plant.slx` outright, CLASSIC a bare `plant`).
      const bytes = buf(fixture);
      const want = rawRefs(bytes, fixture)
        .map((n) => (isModelFile(n) ? n : n + refModelExt(fixture)))
        .sort();
      expect(want.length, `${fixture} must HAVE a model reference`).toBeGreaterThan(0);
      expect(treeRefs(bytes, fixture)).toEqual(want);
      expect(graphRefs(bytes, fixture)).toEqual(want);
    });
  }

  it('completes from the NAME it was given, even when the bytes are another format', () => {
    // The FORMAT comes from the bytes; the extension to COMPLETE with has to come from the
    // name, because the name is what the file is called on disk and so what a sibling
    // reference will be called too. Classic-brace bytes under a `.slx` name therefore
    // yield `.slx` references — on both paths.
    const bytes = buf(CLASSIC);
    expect(graphRefs(bytes, 'renamed.slx')).toEqual(['plant.slx']);
    expect(treeRefs(bytes, 'renamed.slx')).toEqual(['plant.slx']);
  });

  it('leaves an already-suffixed reference alone on both paths', () => {
    // MODERN records `plant.slx` outright, so the completion must not fire; one that
    // appended unconditionally would produce `plant.slx.mdl` here.
    const bytes = buf(MODERN);
    expect(graphRefs(bytes, 'shouted.MDL')).toEqual(['plant.slx']);
    expect(treeRefs(bytes, 'shouted.MDL')).toEqual(['plant.slx']);
  });
});

// The two ways a host can reach a model's relationships, and the one answer they owe each
// other.
//
// `extractSlxStructure` scans the BYTES; `structureFromParsed` reads the same three fields
// off a `ParsedSlx` the host is already holding. `scanModelStructure` makes the two
// equivalent at its own boundary (test/modelStructureScan.test.ts), so what is left to this
// module is the SHAPING, and that is what this compares. It has to be compared rather than
// argued: the route taken depends on nothing a user can see — whether some tab happened to
// parse the file first — so two routes that disagreed would make a model's edges depend on
// the order a window was restored in.
//
// Exhaustive over the corpus rather than illustrative, and read from the directories rather
// than listed, so a model added for some other suite is swept here too.
describe('a structure derived from a parse equals a scan of the same bytes', () => {
  // Recursive, and with this package's own predicate: `mcos/`, `sparse/` and the parity
  // artifacts' era folders hold models too.
  const modelsUnder = (dir: string): string[] =>
    (readdirSync(join(TEST_ROOT, dir), { recursive: true }) as string[])
      .filter((name) => isModelFile(name))
      .map((name) => `${dir}/${name}`)
      .sort();
  const CORPUS: Array<{ name: string; bytes: () => ArrayBuffer }> = [
    ...[...modelsUnder('fixtures'), ...modelsUnder('parity/artifacts')].map((path) => ({
      name: path,
      bytes: () => onDisk(path),
    })),
    ...Object.entries(BUILT).map(([name, bytes]) => ({ name, bytes })),
  ];

  it('has a corpus worth sweeping', () => {
    // A guard on the test itself: without it every comparison below passes vacuously over
    // an empty list, and the cases that actually pull the routes apart could all be missing.
    expect(modelsUnder('fixtures').length).toBeGreaterThan(4);
    expect(modelsUnder('parity/artifacts').length).toBeGreaterThan(20);
    // A `.mdl` of each generation, because the reference-name completion is the parent's
    // OWN extension and this is the only format where that is not `.slx`.
    expect(CORPUS.filter((m) => m.name.endsWith('.mdl')).length).toBeGreaterThan(4);
    // And a model of each shape the three fields can take.
    const all = CORPUS.map((m) => extractSlxStructure(m.bytes(), m.name));
    expect(all.filter((s) => s.modelReferences.length > 0).length).toBeGreaterThan(1);
    expect(all.filter((s) => s.dataDictionary !== null).length).toBeGreaterThan(1);
    expect(all.filter((s) => s.externalDataSources.length > 0).length).toBeGreaterThan(1);
    // A bare reference under a `.mdl` parent somewhere in it, so the completion's `.mdl`
    // arm is swept and not only pinned on the one built fixture.
    const completedAsMdl = CORPUS.filter((m) => m.name.endsWith('.mdl')).some((m) =>
      extractSlxStructure(m.bytes(), m.name).modelReferences.some((r) => r.endsWith('.mdl')),
    );
    expect(completedAsMdl).toBe(true);
  });

  it('gives every model the same three fields, field for field', () => {
    for (const { name, bytes } of CORPUS) {
      const b = bytes();
      expect(structureFromParsed(parseModel(b, name), name), name).toEqual(extractSlxStructure(b, name));
    }
  });

  // The sweep above cannot see a change to the shaping itself — both routes go through the
  // one shaping function, so a completion dropped there moves both answers together and they
  // stay equal. So the completion is pinned ABSOLUTELY on the derived route as well, on the
  // fixtures that spell a reference the different ways.
  it('completes a bare reference name with the .mdl of the model that RECORDS it', () => {
    // `legacy_ctrl.mdl` records `plant`, and its siblings are `.mdl` files: labelling that
    // reference `plant.slx` resolves to nothing at all.
    const s = structureFromParsed(parseModel(buf(CLASSIC), CLASSIC), CLASSIC);
    expect(s.modelReferences).toEqual(['plant.mdl']);
  });

  it('completes a bare reference name with .slx for an .slx parent', () => {
    const s = structureFromParsed(
      parseModel(
        slx({
          'simulink/graphicalInterface.json': JSON.stringify({
            ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant' }],
          }),
        }),
        'bare.slx',
      ),
      'bare.slx',
    );
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('leaves a reference that already names a model file alone, whatever the parent is', () => {
    // `model_with_refs.mdl` records `plant.slx` — so the parent is a `.mdl` and the
    // completion must not fire. Appending the parent's extension anyway would name
    // `plant.slx.mdl`.
    const s = structureFromParsed(parseModel(buf(MODERN), MODERN), MODERN);
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('is NOT interchangeable for a package the scan can read and the parse cannot', () => {
    // Why a host keeps the read as a fallback instead of routing everything through a
    // parse: the two routes are equal on every model that PARSES, and the scan reads
    // strictly fewer parts — so a package whose block XML cannot be inflated has a scan and
    // no parse at all. There is nothing to derive from for that file, and the relationships
    // it does have are still a graph's to draw.
    const archive = slx({
      'simulink/blockDiagram.json': JSON.stringify({
        BlockDiagram: { DataDictionary: 'params.sldd', ModelUUID: 'u' },
      }),
      'simulink/graphicalInterface.json': JSON.stringify({
        ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant' }],
      }),
      'simulink/systems/system_1.xml': '<System><Block/></System>'.repeat(400),
    });
    const damaged = poison(archive, 'simulink/systems/system_1.xml');

    expect(() => parseModel(damaged, 'damaged.slx')).toThrow();
    expect(extractSlxStructure(damaged, 'damaged.slx').modelReferences).toEqual(['plant.slx']);
  });
});

/**
 * Overwrite one member's compressed bytes with 0xFF in place, leaving every header intact
 * so the archive is still perfectly walkable.
 */
function poison(archive: ArrayBuffer, target: string): ArrayBuffer {
  const out = new Uint8Array(archive.slice(0));
  const view = new DataView(out.buffer);
  const utf8 = new TextDecoder();
  let p = 0;
  while (p + 30 <= out.byteLength && view.getUint32(p, true) === 0x04034b50) {
    const method = view.getUint16(p + 8, true);
    const compressedSize = view.getUint32(p + 18, true);
    const nameLength = view.getUint16(p + 26, true);
    const extraLength = view.getUint16(p + 28, true);
    const name = utf8.decode(out.subarray(p + 30, p + 30 + nameLength));
    const dataAt = p + 30 + nameLength + extraLength;
    if (name === target) {
      // Loud rather than vacuous: if the writer stored this member there is nothing to
      // fail to inflate and the case above proves nothing.
      expect(method, `${target} must be deflated for this case to mean anything`).toBe(8);
      out.fill(0xff, dataAt, dataAt + compressedSize);
      return out.buffer as ArrayBuffer;
    }
    p = dataAt + compressedSize;
  }
  throw new Error(`no local header for ${target} -- the archive layout is not what this helper assumes`);
}
