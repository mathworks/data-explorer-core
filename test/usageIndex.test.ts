// Copyright 2026 The MathWorks, Inc.
//
// Usage across a SET OF FILES: which blocks refer to a definition, and where a block
// parameter's names resolve, over files a caller has read but has not opened.
//
// session.findUsages answers the same question for sources REGISTERED in a session, and
// cannot answer it for a folder: the answer is read off node trees, so asking about a
// hundred models means holding a hundred trees. This index answers it off file summaries
// instead, and applies the same visibility rule:
//
//   - a name is resolved ONCE per (model, name), so a model workspace variable SHADOWS the
//     dictionary entry of the same name and only the winner collects a usage;
//   - dictionary references are followed transitively;
//   - a reference is matched case-insensitively, as the file systems these live on do.
//
// Those three are what the tests below pin on THIS side. They are also where the session
// used to differ — it credited everything a model could reach, chased no reference, and
// matched a recorded name case-sensitively — and the agreement between the two engines is
// pinned separately, in usageEngines.test.ts, which asks both the same question about the
// same files. The rest here — dedupe, the two directions, the unresolved arm — is the
// contract a host renders a Usage column from.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { buildUsageIndex, summarizeFiles, resolveName, parseModel } from '../src/index.js';
import type { UsageFile, ModelSummary, DataSummary } from '../src/index.js';

function artifact(rel: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./parity/artifacts/${rel}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function fixtureBytes(name: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// One block, with a SID that is deliberately NOT its name: the SID is what the index keys
// a block by (blockIdentity), so a fixture whose SID equalled its name would let a
// regression to name-keying pass every test in this file.
const block = (name: string, type: string, prop: string, value: string, sid = '1'): string =>
  `<Block BlockType="${type}" Name="${name}" SID="${sid}"><P Name="${prop}">${value}</P></Block>`;

// An in-memory `.slx` holding just what a usage answer needs: the dictionary the model
// links, any other external data source, and blocks whose parameters reference things.
// Built the way blockParamUsages.test.ts and resolveLink.test.ts build one, so it goes
// through the REAL parser rather than through a hand-assembled summary — a summariser
// that reads the wrong field of ParsedSlx is the failure this catches and a hand-built
// summary would not.
function slxModel(opts: {
  dictionary?: string | null;
  externals?: string[];
  blocks: string;
  workspaceMat?: string;
}): ArrayBuffer {
  const diagram: Record<string, unknown> = { ModelUUID: 'u1' };
  if (opts.dictionary) {
    diagram.DataDictionary = opts.dictionary;
  }
  if (opts.workspaceMat) {
    diagram.ModelWorkspace = { WSDataSource: 'MAT-File', WSSourceFileName: opts.workspaceMat };
  }
  const parts: Record<string, Uint8Array> = {
    'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: diagram })),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?><System>${opts.blocks}</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  };
  if (opts.externals && opts.externals.length > 0) {
    parts['simulink/ExternalDataSourceSettings.xml'] = strToU8(
      `<?xml version="1.0" encoding="utf-8"?><ExternalDataSourceSettings>${opts.externals
        .map((s) => `<ExplicitExternalBrokerSources><fullPathToSource>${s}</fullPathToSource></ExplicitExternalBrokerSources>`)
        .join('')}</ExternalDataSourceSettings>`,
    );
  }
  const zipped = zipSync(parts);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

// Any JSON object, as the bytes of a textual `.sldd`. A textual dictionary has no parser
// between the bytes and the reader — `readSlddContent` is `JSON.parse` and nothing else —
// so a file that is valid JSON and short of the shape a dictionary has is expressible
// only this way, and it is a shape a partial write really produces.
function jsonBytes(json: unknown): ArrayBuffer {
  const u8 = strToU8(JSON.stringify(json));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// A textual `.sldd` defining `names` and referencing `refs`. The summariser reads only an
// entry's `name` and the reference list, so this is the whole of what a dictionary is from
// here — and building it by hand is what makes a chain of four dictionaries expressible.
function slddBytes(names: string[], refs: unknown[] = []): ArrayBuffer {
  return jsonBytes({
    __MW_TEXT_PARTS__: {
      '__MW_TEXT_PART__/data/chunk0': {
        __MW_TEXT_content: {
          entries: names.map((name) => ({ name, class: 'Simulink.Parameter' })),
          'Dictionary References': refs,
          AllowAccessBWS: false,
        },
      },
    },
  });
}

// The one data part of a compressed-binary `.sldd`, and two entries for it: one the file
// names and one it does not.
const CHUNK_PART = 'data/chunk0.xml';

const NAMED_ENTRY =
  '    <Object Class="DD.ENTRY">\n'
  + '        <P Name="Name" Class="char">aParam</P>\n'
  + '        <P Name="Value" Class="double">42</P>\n'
  + '    </Object>';

const UNNAMED_ENTRY =
  '    <Object Class="DD.ENTRY">\n'
  + '        <P Name="Value" Class="double">1</P>\n'
  + '    </Object>';

/**
 * A real compressed `.sldd`, unzipped, its data part replaced, rezipped — the technique
 * parseWarnings.test.ts uses, and for the same reason: the bytes under test then differ
 * from a file MATLAB wrote in exactly the one way the test is about, and the entries come
 * back through the REAL binary reader rather than out of a literal written here.
 */
function binarySlddWithChunk(body: string): ArrayBuffer {
  const entries = unzipSync(new Uint8Array(fixtureBytes('compressed.sldd')));
  expect(Object.keys(entries)).toContain(CHUNK_PART); // the fixture really holds it
  entries[CHUNK_PART] = strToU8(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
      + `<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">\n${body}\n</DataSource>`,
  );
  const zipped = zipSync(entries);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

const file = (name: string, bytes: ArrayBuffer, srcId = name): UsageFile => ({ srcId, filename: name, bytes });

// A summary built by hand, for the resolution-order tests: a model workspace is a binary
// mxarray part, so constructing one to hold a chosen NAME is a fixture-authoring exercise
// about MAT encoding rather than about resolution. The real-bytes path is covered by the
// mdlcases.mdl tests at the bottom, which have a genuine model workspace in them.
function summaryOf(over: Partial<ModelSummary> = {}): ModelSummary {
  return {
    srcId: 'm.slx',
    name: 'm',
    workspaceNames: new Set<string>(),
    slddRefs: [],
    matRefs: [],
    masks: [],
    blockParams: [],
    ...over,
  };
}

const dataOf = (srcId: string, names: string[], slddRefs: string[] = []): DataSummary => ({
  srcId,
  names: new Set(names),
  slddRefs,
});

describe('summarizeFiles — one summary per file, dispatched on the filename', () => {
  it('summarises a model, a dictionary and a MAT-file', () => {
    const { models, slddByName, matByName } = summarizeFiles([
      file('m.slx', slxModel({ dictionary: 'params.sldd', blocks: block('G', 'Gain', 'Gain', 'Kp') })),
      file('params.sldd', slddBytes(['Kp', 'Ki'])),
      file('Numeric.mat', fixtureBytes('mcos/Numeric.mat')),
    ]);
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('m');
    expect(models[0].slddRefs).toEqual(['params.sldd']);
    // Name AND sid AND systemPath: a cell reads the name, the index keys on the sid, and
    // the path is where the block sits. A summary that dropped the sid would leave the
    // index no way to tell two `Gain` blocks apart; one that dropped the path would leave
    // a cell no way to SHOW which is which.
    expect(models[0].blockParams).toEqual([
      { blockName: 'G', blockType: 'Gain', property: 'Gain', expression: 'Kp', sid: '1', systemPath: '' },
    ]);
    expect([...(slddByName.get('params.sldd')?.names ?? [])].sort()).toEqual(['Ki', 'Kp']);
    // The MAT fixture holds a named variable and an unnamed one; a nameless definition is
    // not a name a parameter can refer to, so it is not in the summary at all.
    expect([...(matByName.get('numeric.mat')?.names ?? [])]).toEqual(['Numeric']);
  });

  it('keys both maps case-INSENSITIVELY, because a model records what its author typed', () => {
    const { slddByName, matByName } = summarizeFiles([
      file('Params.SLDD', slddBytes(['Kp'])),
      file('Numeric.MAT', fixtureBytes('mcos/Numeric.mat')),
    ]);
    expect(slddByName.has('params.sldd')).toBe(true);
    expect(matByName.has('numeric.mat')).toBe(true);
  });

  it('keeps a dictionary and a MAT-file that share a STEM, because they are two files', () => {
    // `params.sldd` and `params.mat` sit side by side in real projects — a dictionary and the
    // MAT-file a model workspace loads — and a model may reference both. Every key in both
    // maps, and every lookup against them, is a basename WITH its extension, so the two are
    // separate entries that never contend: nothing here needs to choose a winner per stem.
    // Keying on the stem instead would make the second file read seem to replace the first,
    // and the loser's definitions would report as used by nothing.
    // The MAT-file FIRST and the dictionary second, deliberately: that is the order in which
    // a per-stem eviction would take the MAT-file's summary back out again.
    const { slddByName, matByName } = summarizeFiles([
      file('params.mat', fixtureBytes('mcos/Numeric.mat')),
      file('params.sldd', slddBytes(['Kp'])),
    ]);
    expect([...(slddByName.get('params.sldd')?.names ?? [])]).toEqual(['Kp']);
    expect([...(matByName.get('params.mat')?.names ?? [])]).toEqual(['Numeric']);
  });

  it('accepts a full path as the filename, and an opaque srcId beside it', () => {
    // A host's srcId is its own key — a URI, a document handle — and is never parsed. The
    // FILENAME is what decides the kind, which is why they are separate fields.
    const { models } = summarizeFiles([
      {
        srcId: 'vscode-file://host/work/engine.slx?rev=3',
        filename: '/work/models/engine.slx',
        bytes: slxModel({ blocks: block('G', 'Gain', 'Gain', 'Kp') }),
      },
    ]);
    expect(models[0].srcId).toBe('vscode-file://host/work/engine.slx?rev=3');
    expect(models[0].name).toBe('engine');
  });

  it('lets one corrupt file contribute nothing without emptying the rest', () => {
    // A folder scan must not lose every answer to one broken file. This is the same policy
    // the session applies per source, and the reason readSlddContent leaves refusal to
    // its caller.
    const { models, slddByName } = summarizeFiles([
      file('broken.sldd', strToU8('{ not json').buffer as ArrayBuffer),
      file('junk.slx', strToU8('not a zip').buffer as ArrayBuffer),
      file('params.sldd', slddBytes(['Kp'])),
      file('m.slx', slxModel({ blocks: block('G', 'Gain', 'Gain', 'Kp') })),
    ]);
    expect(models.map((m) => m.name)).toEqual(['m']);
    expect([...slddByName.keys()]).toEqual(['params.sldd']);
  });

  it('summarises a dictionary with no content part as one that DEFINES nothing', () => {
    // Not the corrupt case above: this file opens. A textual `.sldd` is handed to
    // JSON.parse and passed straight through, so valid JSON that is not a dictionary is a
    // dictionary with no content part — the shape a partial write leaves, and the one
    // SlddNode reports as `source-empty` (parseWarnings.test.ts hands it the same content
    // object). The summary has to reach the same conclusion: it defines nothing, and
    // it is STILL IN THE MAP. A throw here would be swallowed by the per-file catch and
    // the dictionary would be absent altogether, which is how a caller tells "indexed,
    // defines nothing" from "never indexed" — the second sends a host looking for a file
    // it already handed over.
    const { slddByName } = summarizeFiles([
      file('notes.sldd', jsonBytes({ hello: 'not a dictionary' })),
      file('params.sldd', slddBytes(['Kp'])),
    ]);
    expect(slddByName.has('notes.sldd')).toBe(true);
    expect([...(slddByName.get('notes.sldd')?.names ?? [])]).toEqual([]);
    expect(slddByName.get('notes.sldd')?.slddRefs).toEqual([]);
    // And the dictionary beside it still answers, which is the folder-scan policy again.
    expect([...(slddByName.get('params.sldd')?.names ?? [])]).toEqual(['Kp']);
  });

  it('leaves an entry the bytes never named out of the summary', () => {
    // Real bytes through the real binary reader: a `DD.ENTRY` with no `<P Name="Name">`
    // reads back with an EMPTY name — the reader's default, and not a loss it warns about,
    // both pinned by parseWarnings.test.ts — and an empty name is not a name a block
    // parameter can refer to. So it is not a definition, and it is not in the summary —
    // the same rule matSummary applies to the MAT-file's unnamed variable in the first
    // test in this file, spelled in a second place. Admitting it puts a nameless
    // definition in a published summary, which a host draws as a blank row that links
    // nowhere.
    const { slddByName } = summarizeFiles([
      file('edited.sldd', binarySlddWithChunk(`${NAMED_ENTRY}\n${UNNAMED_ENTRY}`)),
    ]);
    expect([...(slddByName.get('edited.sldd')?.names ?? [])]).toEqual(['aParam']);
  });

  it('ignores a file of no interest rather than failing on it', () => {
    // A caller handing over a whole folder listing is the ordinary case.
    const { models, slddByName, matByName } = summarizeFiles([
      file('README.md', strToU8('# notes').buffer as ArrayBuffer),
      file('work.prj', strToU8('<?xml version="1.0"?><Project/>').buffer as ArrayBuffer),
    ]);
    expect(models).toEqual([]);
    expect(slddByName.size).toBe(0);
    expect(matByName.size).toBe(0);
  });
});

describe('resolveName — MATLAB’s order, first hit wins', () => {
  const sldd = new Map([['params.sldd', dataOf('params.sldd', ['Kp', 'tau'])]]);
  const mat = new Map([['data.mat', dataOf('data.mat', ['Kp', 'span'])]]);

  it('prefers the model’s own workspace over everything it links', () => {
    // THE SHADOWING RULE. `tau` is defined twice and the block reads ONE value, so only
    // one definition is used. Crediting both — which the session's per-definition
    // predicate does — puts a usage on an entry whose value never reaches the block, and
    // a phantom usage is worse than a missing one because a user acts on it.
    const model = summaryOf({ workspaceNames: new Set(['tau']), slddRefs: ['params.sldd'], matRefs: ['data.mat'] });
    expect(resolveName(model, 'tau', sldd, mat)).toEqual({ kind: 'workspace', srcId: 'm.slx' });
  });

  it('prefers the linked dictionary over a linked MAT-file', () => {
    const model = summaryOf({ slddRefs: ['params.sldd'], matRefs: ['data.mat'] });
    expect(resolveName(model, 'Kp', sldd, mat)).toEqual({ kind: 'sldd', srcId: 'params.sldd' });
  });

  it('falls through to a linked MAT-file for a name nothing else defines', () => {
    const model = summaryOf({ slddRefs: ['params.sldd'], matRefs: ['data.mat'] });
    expect(resolveName(model, 'span', sldd, mat)).toEqual({ kind: 'mat', srcId: 'data.mat' });
  });

  it('takes the FIRST linked dictionary, so the dictionary link outranks an external', () => {
    // The order the summary records is the order MATLAB resolves in: the linked data
    // dictionary first, then the externals as the model lists them.
    const two = new Map([
      ['first.sldd', dataOf('first.sldd', ['Kp'])],
      ['second.sldd', dataOf('second.sldd', ['Kp'])],
    ]);
    const model = summaryOf({ slddRefs: ['first.sldd', 'second.sldd'] });
    expect(resolveName(model, 'Kp', two, new Map())).toEqual({ kind: 'sldd', srcId: 'first.sldd' });
  });

  it('follows a dictionary chain, however deep', () => {
    // A definition in a SUB-dictionary is visible to MATLAB and to this. The session's
    // resolveDictionaryReferences is deliberately one level — a host follows a link at a
    // time — but a NAME resolves down the whole chain there too, which is what the session
    // did not do until resolutionOrder replaced its per-definition predicate.
    const chain = new Map([
      ['a.sldd', dataOf('a.sldd', [], ['b.sldd'])],
      ['b.sldd', dataOf('b.sldd', [], ['c.sldd'])],
      ['c.sldd', dataOf('c.sldd', ['deep'])],
    ]);
    const model = summaryOf({ slddRefs: ['a.sldd'] });
    expect(resolveName(model, 'deep', chain, new Map())).toEqual({ kind: 'sldd', srcId: 'c.sldd' });
  });

  it('terminates on a cyclic dictionary hierarchy', () => {
    // A user can make this, and a queue with no seen-set would not come back. Both the
    // hit and the miss have to terminate, so both are asserted.
    const cycle = new Map([
      ['a.sldd', dataOf('a.sldd', ['inA'], ['b.sldd'])],
      ['b.sldd', dataOf('b.sldd', ['inB'], ['a.sldd'])],
    ]);
    const model = summaryOf({ slddRefs: ['a.sldd'] });
    expect(resolveName(model, 'inB', cycle, new Map())).toEqual({ kind: 'sldd', srcId: 'b.sldd' });
    expect(resolveName(model, 'nowhere', cycle, new Map())).toBe(null);
  });

  it('is null for a name nothing the model links defines', () => {
    const model = summaryOf({ slddRefs: ['params.sldd'], matRefs: ['data.mat'] });
    expect(resolveName(model, 'Nope', sldd, mat)).toBe(null);
  });

  it('does not reach a dictionary the model does not link', () => {
    // Two unrelated projects in one folder must not collect each other's usages. That is
    // the whole reason this is not a name match over every file.
    const model = summaryOf({});
    expect(resolveName(model, 'Kp', sldd, mat)).toBe(null);
  });

  it('ignores a reference to a file the caller did not hand over', () => {
    // A model linked to a dictionary nobody read: the reference is skipped, and the name
    // is simply unresolved. Not an error — the file set is whatever the caller had.
    const model = summaryOf({ slddRefs: ['absent.sldd', 'params.sldd'] });
    expect(resolveName(model, 'Kp', sldd, mat)).toEqual({ kind: 'sldd', srcId: 'params.sldd' });
  });
});

describe('buildUsageIndex — the reverse direction, which fills a Usage cell', () => {
  it('names every block that refers to a definition, and which model it is in', () => {
    const index = buildUsageIndex([
      file('a.slx', slxModel({ dictionary: 'params.sldd', blocks: block('Ga', 'Gain', 'Gain', 'Kp') })),
      file('b.slx', slxModel({ dictionary: 'params.sldd', blocks: block('Gb', 'Gain', 'Gain', '2*Kp') })),
      file('params.sldd', slddBytes(['Kp'])),
    ]);
    // `blockName` is what the cell shows, `blockPath` is where the block is, and
    // `linkTarget` is `<sid>@<model>` — the name is not in the target at all, because a
    // name does not identify a block.
    expect(index.usagesOf('params.sldd', 'Kp')).toEqual([
      {
        blockName: 'Ga',
        blockPath: 'Ga',
        blockType: 'Gain',
        paramProperty: 'Gain',
        paramValue: 'Kp',
        modelSrcId: 'a.slx',
        linkTarget: '1@a.slx',
      },
      {
        blockName: 'Gb',
        blockPath: 'Gb',
        blockType: 'Gain',
        paramProperty: 'Gain',
        paramValue: '2*Kp',
        modelSrcId: 'b.slx',
        linkTarget: '1@b.slx',
      },
    ]);
  });

  it('credits every name in an expression, not just the first', () => {
    // `Kp*Ki` really is a usage of both, so both cells name the block. The FORWARD answer
    // is the one that has to pick one, because a parameter has a single origin.
    const index = buildUsageIndex([
      file('m.slx', slxModel({ dictionary: 'params.sldd', blocks: block('G', 'Gain', 'Gain', 'Kp*Ki') })),
      file('params.sldd', slddBytes(['Kp', 'Ki'])),
    ]);
    expect(index.usagesOf('params.sldd', 'Kp').map((u) => u.blockName)).toEqual(['G']);
    expect(index.usagesOf('params.sldd', 'Ki').map((u) => u.blockName)).toEqual(['G']);
  });

  it('reports a block ONCE for a name its parameters mention twice', () => {
    // `Kp+Kp` is one place `Kp` is referenced, not two, and two parameters of the same
    // block that both read it are still one block to name in the cell.
    const index = buildUsageIndex([
      file(
        'm.slx',
        slxModel({
          dictionary: 'params.sldd',
          blocks:
            `<Block BlockType="TransferFcn" Name="F" SID="1">` +
            `<P Name="Numerator">Kp+Kp</P><P Name="Denominator">[Kp 1]</P>` +
            `</Block>`,
        }),
      ),
      file('params.sldd', slddBytes(['Kp'])),
    ]);
    const usages = index.usagesOf('params.sldd', 'Kp');
    expect(usages).toHaveLength(1);
    // The first parameter that reached it is the one reported, and its value is verbatim.
    expect(usages[0].paramValue).toBe('Kp+Kp');
  });

  it('keeps same-named blocks in DIFFERENT models apart', () => {
    // Two models can hold a block of the same name, and a bare block name is not a usable
    // answer for a variable that models share — which is every variable a dictionary
    // exists to hold. The dedupe is on (block, model), and the linkTarget carries the
    // model, so the two are distinguishable by the one fact that identifies them.
    const index = buildUsageIndex([
      file('a.slx', slxModel({ dictionary: 'params.sldd', blocks: block('DragCalc', 'Gain', 'Gain', 'Cd') })),
      file('b.slx', slxModel({ dictionary: 'params.sldd', blocks: block('DragCalc', 'Gain', 'Gain', 'Cd') })),
      file('params.sldd', slddBytes(['Cd'])),
    ]);
    expect(index.usagesOf('params.sldd', 'Cd').map((u) => u.linkTarget)).toEqual(['1@a.slx', '1@b.slx']);
    // Both cells still READ `DragCalc`, which is the name in each file. Two identical
    // labels, two different blocks: that is why the target holds neither of the labels.
    expect(index.usagesOf('params.sldd', 'Cd').map((u) => u.blockName)).toEqual(['DragCalc', 'DragCalc']);
  });

  it('answers with nothing for a definition no block refers to', () => {
    const index = buildUsageIndex([
      file('m.slx', slxModel({ dictionary: 'params.sldd', blocks: block('G', 'Gain', 'Gain', 'Kp') })),
      file('params.sldd', slddBytes(['Kp', 'Unused'])),
    ]);
    expect(index.usagesOf('params.sldd', 'Unused')).toEqual([]);
    expect(index.usagesOf('params.sldd', '')).toEqual([]);
    expect(index.usagesOf('no-such-file.sldd', 'Kp')).toEqual([]);
  });

  it('matches a reference across a difference of CASE', () => {
    // A model links `Params.SLDD` and the file on disk is `params.sldd`; macOS and Windows
    // both consider those the same file, and the session's openSourceNamed used not to. A
    // usage that is plainly there must not go missing over the spelling of a file name.
    const index = buildUsageIndex([
      file('m.slx', slxModel({ dictionary: 'Params.SLDD', blocks: block('G', 'Gain', 'Gain', 'Kp') })),
      file('params.sldd', slddBytes(['Kp'])),
    ]);
    expect(index.usagesOf('params.sldd', 'Kp').map((u) => u.blockName)).toEqual(['G']);
  });

  it('credits a chained sub-dictionary’s entry to the file that DEFINES it', () => {
    const index = buildUsageIndex([
      file('m.slx', slxModel({ dictionary: 'top.sldd', blocks: block('G', 'Gain', 'Gain', 'deep') })),
      file('top.sldd', slddBytes(['other'], ['mid.sldd'])),
      file('mid.sldd', slddBytes([], ['leaf.sldd'])),
      file('leaf.sldd', slddBytes(['deep'])),
    ]);
    expect(index.usagesOf('leaf.sldd', 'deep').map((u) => u.blockName)).toEqual(['G']);
    // NOT grafted into the dictionaries that inherit it: the entry lives in one file, and
    // a cell in another file claiming it would be a claim about where a save writes.
    expect(index.usagesOf('top.sldd', 'deep')).toEqual([]);
    expect(index.usagesOf('mid.sldd', 'deep')).toEqual([]);
  });

  it('follows the chain through a dictionary whose content part carries no entries list', () => {
    // The content part is THERE — so this is not the "no content part" case — and its
    // `entries` key is not, which is what a partial write of that one part leaves behind.
    // The reference list beside it is still read, so a dictionary that has lost its own
    // entries still passes the INHERITANCE through to the file that defines the name.
    // Reading the absent list instead throws, the per-file catch drops `mid.sldd`
    // entirely, and the chain through it breaks: `deep` then reads as used by nothing,
    // which is a user deleting a parameter that a block does read.
    const index = buildUsageIndex([
      file('m.slx', slxModel({ dictionary: 'mid.sldd', blocks: block('G', 'Gain', 'Gain', 'deep') })),
      file(
        'mid.sldd',
        jsonBytes({
          __MW_TEXT_PARTS__: {
            '__MW_TEXT_PART__/data/chunk0': { __MW_TEXT_content: { 'Dictionary References': ['leaf.sldd'] } },
          },
        }),
      ),
      file('leaf.sldd', slddBytes(['deep'])),
    ]);
    expect(index.usagesOf('leaf.sldd', 'deep').map((u) => u.blockName)).toEqual(['G']);
  });

  it('moves a usage DOWN the order when the file that shadowed it is not in the set', () => {
    // The resolution order, and what depends on it, over two files that both define `Kp`:
    // `m.slx` links `first.sldd` and lists `second.sldd` as an external, so the block
    // reads the first one's value and only the first one collects the usage. A link on
    // `second.sldd` would point at an entry whose value never reaches that block.
    //
    // Then the same model with the winner NOT handed over, which is an ordinary folder
    // scan — the file is elsewhere, or the host has not read it. The usage moves down the
    // order rather than vanishing: an entry that a block does read must not report as
    // unused because a file that shadowed it was missing from the set.
    const model = file(
      'm.slx',
      slxModel({ dictionary: 'first.sldd', externals: ['second.sldd'], blocks: block('G', 'Gain', 'Gain', 'Kp') }),
    );
    const both = buildUsageIndex([model, file('first.sldd', slddBytes(['Kp'])), file('second.sldd', slddBytes(['Kp']))]);
    expect(both.usagesOf('first.sldd', 'Kp').map((u) => u.blockName)).toEqual(['G']);
    expect(both.usagesOf('second.sldd', 'Kp')).toEqual([]);
    const without = buildUsageIndex([model, file('second.sldd', slddBytes(['Kp']))]);
    expect(without.usagesOf('second.sldd', 'Kp').map((u) => u.blockName)).toEqual(['G']);
  });

  it('reads a reference in the object form as well as the bare-string form', () => {
    // Which form a dictionary uses is a property of its WRITER. A reader that took only
    // strings followed the chain of one flavour and reported the other as having no
    // references at all — the inherited entries invisible, for the same file saved twice.
    const index = buildUsageIndex([
      file('m.slx', slxModel({ dictionary: 'top.sldd', blocks: block('G', 'Gain', 'Gain', 'shared') })),
      file('top.sldd', slddBytes([], [{ file: 'common.sldd' }])),
      file('common.sldd', slddBytes(['shared'])),
    ]);
    expect(index.usagesOf('common.sldd', 'shared').map((u) => u.blockName)).toEqual(['G']);
  });

  it('resolves a model-workspace MAT-file, which the model records elsewhere', () => {
    // MATLAB keeps this in blockDiagram.json and not in ExternalDataSourceSettings.xml,
    // and it is a link like any other — a summariser that read only the settings part
    // would leave every such variable looking unused.
    const index = buildUsageIndex([
      file('m.slx', slxModel({ blocks: block('G', 'Gain', 'Gain', 'Numeric'), workspaceMat: 'Numeric.mat' })),
      file('Numeric.mat', fixtureBytes('mcos/Numeric.mat')),
    ]);
    expect(index.usagesOf('Numeric.mat', 'Numeric').map((u) => u.blockName)).toEqual(['G']);
  });

  it('resolves each name to the right file when a dictionary and a MAT-file share a stem', () => {
    // Same-stem pair, both linked by one model, one block reading a name from each. The two
    // are different files and resolve independently — the extension is part of every key and
    // every lookup — so neither shadows the other and neither collects the other's usage.
    // A cell that answered `params.mat` for a dictionary entry sends a user to edit the
    // wrong file, and the block does not read the value they would change.
    const index = buildUsageIndex([
      file(
        'm.slx',
        slxModel({
          dictionary: 'params.sldd',
          externals: ['params.mat'],
          blocks:
            block('Kpath', 'Gain', 'Gain', 'Kp', '1') + block('Npath', 'Gain', 'Gain', 'Numeric', '2'),
        }),
      ),
      file('params.mat', fixtureBytes('mcos/Numeric.mat')),
      file('params.sldd', slddBytes(['Kp'])),
    ]);
    expect(index.usagesOf('params.sldd', 'Kp').map((u) => u.blockName)).toEqual(['Kpath']);
    expect(index.usagesOf('params.mat', 'Numeric').map((u) => u.blockName)).toEqual(['Npath']);
    // And neither file answers for the other's name, which is what "resolve independently"
    // costs if the pair is ever collapsed to one entry per stem.
    expect(index.usagesOf('params.mat', 'Kp')).toEqual([]);
    expect(index.usagesOf('params.sldd', 'Numeric')).toEqual([]);
  });

  it('resolves an external dictionary listed in the settings part', () => {
    const index = buildUsageIndex([
      file('m.slx', slxModel({ externals: ['extra.sldd'], blocks: block('G', 'Gain', 'Gain', 'Kx') })),
      file('extra.sldd', slddBytes(['Kx'])),
    ]);
    expect(index.usagesOf('extra.sldd', 'Kx').map((u) => u.blockName)).toEqual(['G']);
  });

  it('reads a compressed-binary dictionary as readily as a textual one', () => {
    // The format is decided on the bytes, so which flavour a dictionary was saved in is
    // not a fact the usage answer depends on. compressed.sldd defines exactly `Kp`.
    const index = buildUsageIndex([
      file('m.slx', slxModel({ dictionary: 'compressed.sldd', blocks: block('G', 'Gain', 'Gain', 'Kp') })),
      file('compressed.sldd', fixtureBytes('compressed.sldd')),
    ]);
    expect(index.usagesOf('compressed.sldd', 'Kp').map((u) => u.blockName)).toEqual(['G']);
  });
});

describe('buildUsageIndex — the forward direction, one origin per parameter', () => {
  it('names where each parameter of a block resolved', () => {
    const index = buildUsageIndex([
      file(
        'm.slx',
        slxModel({
          dictionary: 'params.sldd',
          blocks:
            `<Block BlockType="TransferFcn" Name="F" SID="1">` +
            `<P Name="Numerator">2*Kp</P><P Name="Denominator">[Ki 1]</P>` +
            `</Block>`,
        }),
      ),
      file('params.sldd', slddBytes(['Kp', 'Ki'])),
    ]);
    // Asked by SID, not by the name `F` — see blockIdentity, and paramsOf's own contract.
    expect(index.paramsOf('m.slx', '1')).toEqual([
      {
        property: 'Numerator',
        expression: '2*Kp',
        name: 'Kp',
        originSrcId: 'params.sldd',
        kind: 'sldd',
        linkTarget: 'Kp@params.sldd',
        maskBlock: null,
      },
      {
        property: 'Denominator',
        expression: '[Ki 1]',
        name: 'Ki',
        originSrcId: 'params.sldd',
        kind: 'sldd',
        linkTarget: 'Ki@params.sldd',
        maskBlock: null,
      },
    ]);
  });

  it('keeps the expression and the resolved NAME apart', () => {
    // `2*Kp` is what the file says and `Kp` is what resolved. A caller that showed one
    // while linking the other would be offering a link to a name the file does not hold.
    const index = buildUsageIndex([
      file('m.slx', slxModel({ dictionary: 'params.sldd', blocks: block('G', 'Gain', 'Gain', '2*Kp') })),
      file('params.sldd', slddBytes(['Kp'])),
    ]);
    const [origin] = index.paramsOf('m.slx', '1');
    expect(origin.expression).toBe('2*Kp');
    expect(origin.name).toBe('Kp');
  });

  it('reports an unresolved parameter as a real answer, not as an absence', () => {
    // A model linked to a dictionary nobody handed over: the parameter IS there and refers
    // to something this file set does not hold. Nulls throughout and an empty linkTarget,
    // which is what distinguishes it from a resolved one — a host renders the value with
    // no link rather than dropping the row.
    const index = buildUsageIndex([
      file('m.slx', slxModel({ dictionary: 'absent.sldd', blocks: block('G', 'Gain', 'Gain', 'Kp') })),
    ]);
    expect(index.paramsOf('m.slx', '1')).toEqual([
      { property: 'Gain', expression: 'Kp', name: null, originSrcId: null, kind: null, linkTarget: '', maskBlock: null },
    ]);
  });

  it('answers with nothing for a block or a model it does not hold', () => {
    const index = buildUsageIndex([
      file('m.slx', slxModel({ dictionary: 'params.sldd', blocks: block('G', 'Gain', 'Gain', 'Kp') })),
      file('params.sldd', slddBytes(['Kp'])),
    ]);
    expect(index.paramsOf('m.slx', '99')).toEqual([]);
    expect(index.paramsOf('other.slx', '1')).toEqual([]);
    // Including when asked by the block's NAME, which is not a key here.
    expect(index.paramsOf('m.slx', 'G')).toEqual([]);
  });

  it('is immutable, so there is no cache to go stale', () => {
    // A caller whose files changed builds another index. That is the whole of the
    // invalidation story: no mutation for an event to have to reach, and two indexes over
    // two file sets can be held at once without either aging the other.
    const models = [file('m.slx', slxModel({ dictionary: 'params.sldd', blocks: block('G', 'Gain', 'Gain', 'Kp') }))];
    const before = buildUsageIndex(models);
    const after = buildUsageIndex([...models, file('params.sldd', slddBytes(['Kp']))]);
    expect(before.usagesOf('params.sldd', 'Kp')).toEqual([]);
    expect(after.usagesOf('params.sldd', 'Kp')).toHaveLength(1);
  });
});

describe('on a real model MATLAB wrote', () => {
  // mdlcases.mdl is harvested from MATLAB: its own model workspace defines `tau`, `span`
  // and `inner`, its block parameters read `Kp`, `Ki`, `[tau 1]`, `span` and `inner`, and
  // it records `mdlparams.sldd` as its linked dictionary. `mdlparams.sldd` itself was
  // never harvested — only its NAME is in the model — so params.sldd's bytes stand in
  // under that name, which is exactly what a host does anyway.
  //
  // The point of testing here rather than only on constructed summaries: the workspace is
  // a binary mxarray part, and a summariser that read the wrong field of ParsedSlx would
  // pass every test above.
  function realIndex(dictNames: string[], refs: unknown[] = []) {
    return buildUsageIndex([
      file('mdlcases.mdl', artifact('mdl/mdlcases.mdl')),
      file('mdlparams.sldd', slddBytes(dictNames, refs)),
    ]);
  }

  it('reads the model’s own workspace as the private scope it is', () => {
    const index = realIndex([]);
    expect(index.usagesOf('mdlcases.mdl', 'tau').map((u) => u.blockName)).toEqual(['TF']);
    expect(index.usagesOf('mdlcases.mdl', 'span').map((u) => u.blockName)).toEqual(['Two Lines']);
    expect(index.usagesOf('mdlcases.mdl', 'inner').map((u) => u.blockName)).toEqual(['InnerGain']);
  });

  it('shadows a dictionary entry with the model workspace variable of the same name', () => {
    // The rule, on real bytes: `tau` is in this model's workspace AND in the dictionary it
    // links, and `TF.Denominator=[tau 1]` reads the workspace's. The dictionary's `tau`
    // collects NO usage from this block — it is not the value the block reads.
    const index = realIndex(['tau', 'Kp']);
    expect(index.usagesOf('mdlcases.mdl', 'tau').map((u) => u.blockName)).toEqual(['TF']);
    expect(index.usagesOf('mdlparams.sldd', 'tau')).toEqual([]);
    // And the dictionary still answers for the name only IT defines.
    expect(index.usagesOf('mdlparams.sldd', 'Kp').map((u) => u.blockName)).toEqual(['Const']);
  });

  it('resolves through the model’s recorded dictionary link, and through its chain', () => {
    const index = buildUsageIndex([
      file('mdlcases.mdl', artifact('mdl/mdlcases.mdl')),
      file('mdlparams.sldd', slddBytes(['Kp'], ['common.sldd'])),
      file('common.sldd', slddBytes(['Ki'])),
    ]);
    expect(index.usagesOf('mdlparams.sldd', 'Kp').map((u) => u.blockName)).toEqual(['Const']);
    expect(index.usagesOf('common.sldd', 'Ki').map((u) => u.blockName)).toEqual(['Gain']);
  });

  it('gives a Model block no data parameters — its ModelNameDialog is a FILE', () => {
    // `Child.ModelNameDialog=mdl_child` names the referenced model, not data, and MATLAB
    // agrees: findVars credits nothing for it even when a variable is spelled exactly like
    // the child model (test/parity/matlab/probe_non_data_params.m).
    //
    // It used to be a row here, on the unresolved arm — a real parameter that resolves to
    // no definition — and that reading was wrong twice over. It is not unresolvED but
    // unresolvABLE, so no file set could ever have filled it in; and the fact was already
    // known, resolved, as a model reference. A host given the row painted a link with an
    // empty target: accent-blue, underlined, and going nowhere when clicked.
    const index = realIndex(['Kp', 'Ki']);
    // SID 9 is what the file records for the block named `Child`.
    expect(index.paramsOf('mdlcases.mdl', '9')).toEqual([]);
    // And the thing that DOES carry the fact, off the same bytes, so dropping the row
    // loses nothing: the reference is reported resolved, under the child model's name.
    expect(parseModel(artifact('mdl/mdlcases.mdl'), 'mdlcases.mdl').modelReferences.map((r) => r.modelName)).toEqual([
      'mdl_child',
    ]);
  });

  it('reports the model under the name a block path and a reference record use', () => {
    // `mdlcases`, never `mdlcases.mdl`: a host labelling a Usage cell 'Const(mdlcases)'
    // needs the model NAME, and deriving it from a srcId that may be a URI is not its job.
    expect(realIndex([]).models.map((m) => m.name)).toEqual(['mdlcases']);
  });
});
