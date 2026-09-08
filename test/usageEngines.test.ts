// Copyright 2026 The MathWorks, Inc.
//
// The two visibility engines, asked the same question about the same files.
//
// "Which blocks use this definition?" is answered twice in this package, because the two
// answers start from different material and neither can be had from the other: the SESSION
// reads it off registered node trees (DataModel.findUsages, which fills a row's `UsedBy`),
// and the INDEX reads it off file summaries (buildUsageIndex, for a folder nobody opened).
// One rule, two implementations — the shape this repo keeps getting wrong, and got wrong
// here: the session credited every definition a model could REACH rather than the one it
// resolves, followed no dictionary reference, and matched a recorded reference
// case-sensitively.
//
// That is invisible in either suite alone. Each engine was self-consistent and tested
// against its own expectations; only a host that shows both noticed — data-explorer-vscode
// fills the Usage column from the index and falls back to the session for a model it cannot
// find on disk, so a dictionary entry shadowed by a model workspace variable showed an
// empty cell or a link to the block depending on which engine had answered.
//
// So the agreement itself is the thing under test here. Every case below states ONE expected
// answer and asserts both engines give it — a test that fails on the engine that drifted and
// names which one, rather than two suites that pass while disagreeing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { buildUsageIndex, createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { NS_DESIGN } from '../src/datamodel/SectionConstants.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function artifact(rel: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./parity/artifacts/${rel}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// The SID mirrors the name here only because these models hold one block per name, which
// keeps a cell's text and its link target readable side by side. The cases where the two
// genuinely differ — same-named blocks, a blank name — build their own XML at the bottom.
const block = (name: string, type: string, prop: string, value: string): string =>
  `<Block BlockType="${type}" Name="${name}" SID="${name}"><P Name="${prop}">${value}</P></Block>`;

// The same builders the two suites use, so these files go through the real parsers: an
// engine that reads the wrong field of a parse result is exactly what a hand-built summary
// or a hand-assembled tree would hide.
function slxModel(opts: { dictionary?: string | null; blocks: string; workspaceMat?: string }): ArrayBuffer {
  const diagram: Record<string, unknown> = { ModelUUID: 'u1' };
  if (opts.dictionary) {
    diagram.DataDictionary = opts.dictionary;
  }
  if (opts.workspaceMat) {
    diagram.ModelWorkspace = { WSDataSource: 'MAT-File', WSSourceFileName: opts.workspaceMat };
  }
  const zipped = zipSync({
    'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: diagram })),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?><System>${opts.blocks}</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

// A textual `.sldd`. `entries` is either a bare name (a design entry) or a name plus the
// section it belongs to, which is what makes "the same name in two sections at once"
// expressible — see the derived case at the bottom.
function slddBytes(
  entries: (string | { name: string; derived: boolean })[],
  refs: unknown[] = [],
): ArrayBuffer {
  const json = {
    __MW_TEXT_PARTS__: {
      '__MW_TEXT_PART__/data/chunk0': {
        __MW_TEXT_content: {
          entries: entries.map((entry) => {
            const { name, derived } = typeof entry === 'string' ? { name: entry, derived: false } : entry;
            return {
              name,
              class: 'Simulink.Parameter',
              metadata: { namespace: NS_DESIGN, isderived: derived ? '1' : '0' },
            };
          }),
          'Dictionary References': refs,
          AllowAccessBWS: false,
        },
      },
    },
  };
  const u8 = strToU8(JSON.stringify(json));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

interface File {
  name: string;
  bytes: ArrayBuffer;
}

const file = (name: string, bytes: ArrayBuffer): File => ({ name, bytes });

// The block names each engine credits to one definition.
//
// The srcId is the file's name in both engines, which is what makes them comparable at all:
// a session keys sources by the name they were ingested under, and the index answers with
// the srcId it was handed. `nodeId` is the same definition addressed the way a session
// addresses it, because the session's answer is read off the ROW a host renders — the
// projection where the divergence actually reached a user — and not off findUsages.
function bothEngines(files: File[], nodeId: string, srcId: string, name: string): { session: string[]; index: string[] } {
  const session = createSession();
  for (const f of files) {
    ingest(session, f.bytes, { filename: f.name });
  }
  const node: any = session.findNodeById(nodeId);
  expect(node, `session holds no node ${nodeId}`).not.toBe(null);
  const cell: any = node.toRow().UsedBy;
  const index = buildUsageIndex(files.map((f) => ({ srcId: f.name, filename: f.name, bytes: f.bytes })));
  return {
    // No cell at all is the session's way of saying "nothing uses this", so it reads as the
    // empty list the index answers with — the two shapes differ, the answers must not.
    session: (cell?.links ?? []).map((l: any) => l.text),
    index: index.usagesOf(srcId, name).map((u) => u.blockName),
  };
}

// One expected answer, asserted of both engines.
function expectBoth(files: File[], nodeId: string, srcId: string, name: string, expected: string[]): void {
  const { session, index } = bothEngines(files, nodeId, srcId, name);
  expect(session, `session's UsedBy for ${nodeId}`).toEqual(expected);
  expect(index, `index's usagesOf(${srcId}, ${name})`).toEqual(expected);
}

// The same two answers read as `label -> linkTarget`, for the cases where WHICH BLOCK a
// link reaches is the thing that has to agree. The label and the target are two different
// rules (blockIdentity) applied in two different engines, so there are four spellings that
// could drift apart and only one of them is visible in the text alone.
function expectBothLinks(files: File[], nodeId: string, srcId: string, name: string, expected: string[]): void {
  const session = createSession();
  for (const f of files) {
    ingest(session, f.bytes, { filename: f.name });
  }
  const node: any = session.findNodeById(nodeId);
  expect(node, `session holds no node ${nodeId}`).not.toBe(null);
  const cell: any = node.toRow().UsedBy;
  expect(
    (cell?.links ?? []).map((l: any) => `${l.text} -> ${l.linkTarget}`),
    `session's UsedBy links for ${nodeId}`,
  ).toEqual(expected);
  const index = buildUsageIndex(files.map((f) => ({ srcId: f.name, filename: f.name, bytes: f.bytes })));
  expect(
    index.usagesOf(srcId, name).map((u) => `${u.blockName} -> ${u.linkTarget}`),
    `index's usagesOf(${srcId}, ${name})`,
  ).toEqual(expected);
}

// The same two answers read as `label @ path`, for the cases where WHERE the block is has
// to agree. A third rule (blockIdentity.joinBlockPath) applied in two more places: the
// session joins the parser's `systemPath` as it collects a usage, the index joins it as it
// builds one, and a host that fills a cell from either must get the same qualifier.
function expectBothPaths(files: File[], nodeId: string, srcId: string, name: string, expected: string[]): void {
  const session = createSession();
  for (const f of files) {
    ingest(session, f.bytes, { filename: f.name });
  }
  expect(
    session.findUsages(nodeId).map((u: any) => `${u.blockName} @ ${u.blockPath}`),
    `session's findUsages for ${nodeId}`,
  ).toEqual(expected);
  const index = buildUsageIndex(files.map((f) => ({ srcId: f.name, filename: f.name, bytes: f.bytes })));
  expect(
    index.usagesOf(srcId, name).map((u) => `${u.blockName} @ ${u.blockPath}`),
    `index's usagesOf(${srcId}, ${name})`,
  ).toEqual(expected);
}

// mdlcases.mdl is harvested from MATLAB: its own model workspace defines `tau`, `span` and
// `inner`, its block parameters read `Kp`, `Ki`, `[tau 1]`, `span` and `inner`, and it
// records `mdlparams.sldd` as its linked dictionary. That dictionary was never harvested —
// only its NAME is in the model file — so bytes built here stand in under that name, which
// is what a host does anyway.
const MODEL = () => file('mdlcases.mdl', artifact('mdl/mdlcases.mdl'));

describe('shadowing — a model workspace variable and a dictionary entry of one name', () => {
  const files = [MODEL(), file('mdlparams.sldd', slddBytes(['tau', 'Kp']))];

  it('credits the model workspace, which is what the block reads', () => {
    expectBoth(files, 'mdlcases.mdl/workspace/tau', 'mdlcases.mdl', 'tau', ['TF']);
  });

  it('credits the shadowed dictionary entry with NOTHING', () => {
    // `TF.Denominator = [tau 1]` resolves to the model's own `tau`. The dictionary's `tau`
    // is not the value that block reads, so a usage against it is a claim about code that
    // does not run — and the session used to make exactly that claim, because it asked
    // "could this model reach this entry?" per entry instead of resolving the name once.
    expectBoth(files, 'mdlparams.sldd/design/tau', 'mdlparams.sldd', 'tau', []);
  });

  it('still credits the dictionary for a name only IT defines', () => {
    // Shadowing is per name, not per file: the same dictionary keeps its own answers.
    expectBoth(files, 'mdlparams.sldd/design/Kp', 'mdlparams.sldd', 'Kp', ['Const']);
  });
});

describe('chaining — a definition in a dictionary the linked one references', () => {
  const files = [
    MODEL(),
    file('mdlparams.sldd', slddBytes(['Kp'], ['common.sldd'])),
    file('common.sldd', slddBytes(['Ki'])),
  ];

  it('credits the sub-dictionary’s entry to the file that defines it', () => {
    // `Ki` is read by a block in mdlcases.mdl and defined two files away: the model links
    // mdlparams.sldd, which references common.sldd. MATLAB resolves down the chain. The
    // session used to stop at the linked dictionary and leave this cell empty, because
    // resolveDictionaryReferences is one level deep by design — a rule about following a
    // LINK that had been mistaken for the rule about resolving a NAME.
    expectBoth(files, 'common.sldd/design/Ki', 'common.sldd', 'Ki', ['Gain']);
  });

  it('terminates on a cyclic hierarchy, and still finds the definition', () => {
    // A user can make a dictionary hierarchy cyclic, and a chase without a seen-set would
    // not come back. Both engines carry one; this is the test that says so.
    const cyclic = [
      file('cyc.slx', slxModel({ dictionary: 'a.sldd', blocks: block('K', 'Constant', 'Value', 'bvar') })),
      file('a.sldd', slddBytes([], ['b.sldd'])),
      file('b.sldd', slddBytes(['bvar'], ['a.sldd'])),
    ];
    expectBoth(cyclic, 'b.sldd/design/bvar', 'b.sldd', 'bvar', ['K']);
  });
});

describe('case — a dictionary link spelled differently from the file', () => {
  it('resolves a reference across a difference of case', () => {
    // The model records `mdlparams.sldd`; the file is opened as `MDLPARAMS.SLDD`, which is
    // what a host reading a real folder on macOS or Windows hands over. The session's
    // matcher was exact for the name a model recorded, so this entry's cell was empty while
    // the index's answer was full.
    const files = [MODEL(), file('MDLPARAMS.SLDD', slddBytes(['Kp']))];
    expectBoth(files, 'MDLPARAMS.SLDD/design/Kp', 'MDLPARAMS.SLDD', 'Kp', ['Const']);
  });
});

describe('what shadowing must NOT take away', () => {
  it('credits every definition at the winning position, not just one of them', () => {
    // A dictionary can hold one name in two sections at once — a design entry and its
    // derived counterpart — and both are the same resolution, so both are used by the
    // block. Resolving a name to one FILE must not silently become resolving it to one
    // NODE: this is the case that tells the difference.
    const files = [MODEL(), file('mdlparams.sldd', slddBytes(['Kp', { name: 'Kp', derived: true }]))];
    expectBoth(files, 'mdlparams.sldd/design/Kp', 'mdlparams.sldd', 'Kp', ['Const']);
    // The index answers per FILE, so it has nothing to say about the second node; the
    // session addresses it separately, and it carries the same cell.
    const session = createSession();
    for (const f of files) {
      ingest(session, f.bytes, { filename: f.name });
    }
    const derived: any = session.findNodeById('mdlparams.sldd/arch/Kp');
    expect(derived, 'the derived entry must exist to be asked about').not.toBe(null);
    expect((derived.toRow().UsedBy?.links ?? []).map((l: any) => l.text)).toEqual(['Const']);
  });

  it('leaves a model linked to nothing out of it', () => {
    // Resolution order decides WHICH visible definition wins; it does not widen what is
    // visible. A model that links no dictionary sees no dictionary, however the name reads.
    const files = [
      file('loose.slx', slxModel({ dictionary: null, blocks: block('L', 'Constant', 'Value', 'Kp') })),
      file('mdlparams.sldd', slddBytes(['Kp'])),
    ];
    expectBoth(files, 'mdlparams.sldd/design/Kp', 'mdlparams.sldd', 'Kp', []);
  });

  it('credits a .mat a model declares as its workspace source', () => {
    const files = [
      file('ws.slx', slxModel({ blocks: block('K', 'Constant', 'Value', 'kp'), workspaceMat: 'signals.mat' })),
      file('signals.mat', artifact('mat/cases.mat')),
    ];
    expectBoth(files, 'signals.mat/kp', 'signals.mat', 'kp', ['K']);
  });
});

// Which block a Usage link reaches, on the two file shapes that made a name unusable as an
// identity. Both engines label a block with blockLabel and target it with blockKey, in
// their own code — so agreement here is agreement about the RULE, not about one call site.
describe('identity — a link reaches one block, named by its SID', () => {
  it('keeps same-named blocks in ONE model apart', () => {
    // f14.slx's shape: `Gain` in two subsystems, both reading the same parameter. Keyed by
    // name they merged into a single row and a single link, so a user could reach only
    // whichever of them the merge happened to keep.
    const files = [
      file(
        'twogains.slx',
        slxModel({
          dictionary: 'p.sldd',
          blocks:
            `<Block BlockType="Gain" Name="Gain" SID="15"><P Name="Gain">Kp</P></Block>` +
            `<Block BlockType="Gain" Name="Gain" SID="24"><P Name="Gain">Kp</P></Block>`,
        }),
      ),
      file('p.sldd', slddBytes(['Kp'])),
    ];
    expectBothLinks(files, 'p.sldd/design/Kp', 'p.sldd', 'Kp', [
      'Gain -> 15@twogains.slx',
      'Gain -> 24@twogains.slx',
    ]);
  });

  it('names a block whose label the user cleared after its SID', () => {
    // `Name="&#xA;"` — f14.slx's Constant reading `Uo`. Two engines, one stand-in: a cell
    // with no text is a link nobody can click, and an empty label in one engine and a SID
    // in the other is the same defect one step later.
    const files = [
      file(
        'blank.slx',
        slxModel({
          dictionary: 'p.sldd',
          blocks: `<Block BlockType="Constant" Name="&#xA;" SID="65"><P Name="Value">Uo</P></Block>`,
        }),
      ),
      file('p.sldd', slddBytes(['Uo'])),
    ];
    expectBothLinks(files, 'p.sldd/design/Uo', 'p.sldd', 'Uo', ['<SID: 65> -> 65@blank.slx']);
  });

  it('agrees on the name-based fallback for a file that records no SID', () => {
    // No SID anywhere, as in a classic `.mdl` before R2010b: both engines fall back to the
    // name, in the same place, so neither invents an identity the other does not have.
    const files = [
      file(
        'nosid.slx',
        slxModel({
          dictionary: 'p.sldd',
          blocks: `<Block BlockType="Constant" Name="K"><P Name="Value">Uo</P></Block>`,
        }),
      ),
      file('p.sldd', slddBytes(['Uo'])),
    ];
    expectBothLinks(files, 'p.sldd/design/Uo', 'p.sldd', 'Uo', ['K -> K@nosid.slx']);
  });

  it('places both of two same-named blocks, in the same words', () => {
    // The other half of the merge blockIdentity undid. Two rows named `Gain` are now two
    // rows, correctly — and identical on screen, so each cell needs the subsystem to say
    // which is which. That qualifier is worth nothing if the engine that answered decides
    // how it reads, which is the failure this suite exists to catch.
    const files = [
      file(
        'twosystems.slx',
        slxModel({
          dictionary: 'p.sldd',
          blocks:
            `<Block BlockType="Gain" Name="Gain" SID="15"><P Name="Gain">Kp</P></Block>` +
            `<Block BlockType="SubSystem" Name="Controller" SID="20"><System>` +
            `<Block BlockType="Gain" Name="Gain" SID="24"><P Name="Gain">Kp</P></Block>` +
            `</System></Block>`,
        }),
      ),
      file('p.sldd', slddBytes(['Kp'])),
    ];
    expectBothPaths(files, 'p.sldd/design/Kp', 'p.sldd', 'Kp', ['Gain @ Gain', 'Gain @ Controller/Gain']);
  });

  it('places a block whose label the user cleared by its stand-in, in both engines', () => {
    // The path is built from the LABEL, so the two rules compose — and they have to
    // compose the same way twice, or one engine says `Controller/<SID: 65>` and the other
    // `Controller/`.
    const files = [
      file(
        'blanknested.slx',
        slxModel({
          dictionary: 'p.sldd',
          blocks:
            `<Block BlockType="SubSystem" Name="Controller" SID="20"><System>` +
            `<Block BlockType="Constant" Name="&#xA;" SID="65"><P Name="Value">Uo</P></Block>` +
            `</System></Block>`,
        }),
      ),
      file('p.sldd', slddBytes(['Uo'])),
    ];
    expectBothPaths(files, 'p.sldd/design/Uo', 'p.sldd', 'Uo', ['<SID: 65> @ Controller/<SID: 65>']);
  });

  it('resolves the link it hands out back to the block that holds the usage', () => {
    // The round trip both engines promise, on the blank-name case: the session resolves its
    // own target, and the index's target is the same string — so a host that got its cell
    // from the index can hand it to the session and reach the block.
    const files = [
      file(
        'blank.slx',
        slxModel({
          dictionary: 'p.sldd',
          blocks: `<Block BlockType="Constant" Name="&#xA;" SID="65"><P Name="Value">Uo</P></Block>`,
        }),
      ),
      file('p.sldd', slddBytes(['Uo'])),
    ];
    const session = createSession();
    for (const f of files) {
      ingest(session, f.bytes, { filename: f.name });
    }
    const index = buildUsageIndex(files.map((f) => ({ srcId: f.name, filename: f.name, bytes: f.bytes })));
    const target = index.usagesOf('p.sldd', 'Uo')[0].linkTarget;
    const back: any = session.resolveLink(target);
    expect(back.status).toBe('resolved');
    expect(back.node.id).toBe('blank.slx/blocks/65');
    expect(back.node.displayName).toBe('<SID: 65>');
  });
});
