// Copyright 2026 The MathWorks, Inc.
// The contract of the model structure scanner (src/datamodel/parser/ModelStructureScan.ts).
//
// `scanModelStructure` claims to be `parseModel(...)` narrowed to three fields, for a
// fraction of the work. That is one claim, and it can fail three ways:
//
//   WRONG VALUE      -- the dangerous one, because a wrong dictionary link or a dropped
//                       model reference does not look wrong; it draws a graph that is
//                       confidently missing an edge. So the expected values below are
//                       LITERAL, taken from `parseModel` once
//                       (`.scratch/fixture-model-structure.mjs`) and written down. A
//                       comparison computed from `parseModel` inside the test would agree
//                       by construction on the day both are wrong in the same way. The
//                       same fixtures are ALSO compared live, in a separate test, which
//                       catches the opposite failure: `parseModel` moving underneath.
//   NOT ACTUALLY FAST -- checked without a clock. A member the scan does not want is
//                       POISONED, so a read of it cannot go unnoticed: the full parse
//                       throws on that file and the scan still answers. A timing
//                       assertion would be flaky, and a scan quietly wired back to
//                       `parseModel` would pass one on a fixture this small anyway.
//   TOO WIDE A TYPE   -- a result carrying `blockParamUsages` or `rawContents` would be a
//                       trap, since on this path they are empty for a reason that has
//                       nothing to do with the model. The key set is pinned.
//
// Fixture coverage is the point of the table: where these three fields live has moved
// twice, so every era appears with at least one non-empty field —
//   legacy  `simulink/blockdiagram.xml` carries everything (pre-R2020a)
//   systems blocks split to `simulink/systems/*.xml`, diagram file still XML (R2020a+)
//   json    `simulink/blockDiagram.json` (R2026b+)
// plus both `.mdl` generations, which have no zip members at all.
//
// The corpus-wide version of this comparison lives in `perf/oracle-run.mjs` (127 real
// models, order-sensitive, on both inflate engines, with one negative control per
// structural part). This file exists so the claim is checked by `npm test` on a machine
// with no corpus — and it is not merely the small version of that run. The corpus turns
// out to carry no `simulink/graphicalInterface.xml` at all, so the oracle SKIPS that
// member's control and the R2013b–R2019b fixtures in the table below are the only evidence
// that it is load-bearing.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { setNativeInflate, type NativeInflate } from '../src/datamodel/parser/Inflate.js';
import { parseModel, scanModelStructure, type ModelStructure } from '../src/index.js';

/** The real node:zlib engine, injected rather than detected so the fast walk really runs. */
const NATIVE: NativeInflate = {
  raw: (deflated) => inflateRawSync(deflated),
  zlib: (wrapped) => inflateSync(wrapped),
};

afterEach(() => {
  setNativeInflate(undefined); // back to detection, so no test leaks its engine
});

const FIXTURE_ROOT = fileURLToPath(new URL('./', import.meta.url));

function modelBuffer(relative: string): ArrayBuffer {
  const b = readFileSync(`${FIXTURE_ROOT}${relative}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/**
 * Every model fixture and the structure it holds, by layout era.
 *
 * `null` / `[]` entries are kept rather than pruned: a scan that returned nothing at all
 * would agree with a table of only the empty rows, so the empties are what make the
 * non-empty ones mean something — and half the tree really has no relationships.
 */
const FIXTURES: Record<string, { era: string; expected: ModelStructure }> = {
  // ---- legacy: one XML part carries the diagram, the refs and the dictionary link ----
  'parity/artifacts/slx_layouts/slxcases_R2013b.slx': {
    era: 'legacy',
    expected: {
      // No dictionary: R2013b predates `DataDictionary`, and the block path is spelled
      // with the model name where later releases write `$bdroot`.
      dataDictionary: null,
      modelReferences: [{ blockPath: 'slxcases_R2013b/Child', modelName: 'slx_child' }],
      externalDataSources: [],
    },
  },
  'parity/artifacts/slx_layouts/slxcases_R2018a.slx': {
    era: 'legacy',
    expected: {
      dataDictionary: 'slxparams.sldd',
      modelReferences: [{ blockPath: '$bdroot/Child', modelName: 'slx_child' }],
      externalDataSources: [],
    },
  },
  'parity/artifacts/slx_layouts/slxws_R2018a.slx': {
    era: 'legacy',
    // The MAT-file model workspace, which is NOT in ExternalDataSourceSettings.xml —
    // it is a property of the diagram, and this row is what holds that path in place.
    expected: { dataDictionary: null, modelReferences: [], externalDataSources: ['slxws_data.mat'] },
  },
  'parity/artifacts/slx_layouts/slxcfgref_R2013b.slx': {
    era: 'legacy',
    expected: { dataDictionary: null, modelReferences: [], externalDataSources: [] },
  },
  // ---- systems: blocks moved out, the diagram part stayed XML ------------------------
  'parity/artifacts/slx_layouts/slxcases_R2021a.slx': {
    era: 'systems',
    expected: {
      dataDictionary: 'slxparams.sldd',
      modelReferences: [{ blockPath: '$bdroot/Child', modelName: 'slx_child' }],
      externalDataSources: [],
    },
  },
  'parity/artifacts/slx_layouts/slxcases_R2025a.slx': {
    era: 'systems',
    expected: {
      dataDictionary: 'slxparams.sldd',
      modelReferences: [{ blockPath: '$bdroot/Child', modelName: 'slx_child' }],
      externalDataSources: [],
    },
  },
  'parity/artifacts/slx_layouts/slxcfgref_R2025a.slx': {
    era: 'systems',
    expected: { dataDictionary: 'slxcfgref_dict.sldd', modelReferences: [], externalDataSources: [] },
  },
  'parity/artifacts/slx_layouts/slxws_R2021a.slx': {
    era: 'systems',
    expected: { dataDictionary: null, modelReferences: [], externalDataSources: ['slxws_data.mat'] },
  },
  'parity/artifacts/mdl/mdlmask.slx': {
    era: 'systems',
    expected: { dataDictionary: null, modelReferences: [], externalDataSources: [] },
  },
  // ---- json: the diagram part is 1300 bytes of metadata, blocks elsewhere ------------
  'fixtures/model_with_refs.slx': {
    era: 'json',
    // The only fixture with all three fields non-empty, which is why the poisoned-member
    // test below uses it: nothing about its answer can be right by accident.
    expected: {
      dataDictionary: 'params.sldd',
      modelReferences: [{ blockPath: 'ctrl/plant', modelName: 'plant.slx' }],
      externalDataSources: ['signals.mat'],
    },
  },
  'parity/artifacts/slx_layouts/slxcases.slx': {
    era: 'json',
    expected: {
      dataDictionary: 'slxparams.sldd',
      modelReferences: [{ blockPath: '$bdroot/Child', modelName: 'slx_child' }],
      externalDataSources: [],
    },
  },
  'parity/artifacts/slx_layouts/slxcfgref.slx': {
    era: 'json',
    expected: { dataDictionary: 'slxcfgref_dict.sldd', modelReferences: [], externalDataSources: [] },
  },
  'parity/artifacts/slx_layouts/slxws.slx': {
    era: 'json',
    expected: { dataDictionary: null, modelReferences: [], externalDataSources: ['slxws_data.mat'] },
  },
  'fixtures/maskUsage.slx': {
    era: 'json',
    expected: { dataDictionary: null, modelReferences: [], externalDataSources: [] },
  },
  // ---- .mdl: no zip members to filter, so the scan is the full parse -----------------
  'parity/artifacts/mdl/mdlcases.mdl': {
    era: 'mdl',
    expected: {
      dataDictionary: 'mdlparams.sldd',
      modelReferences: [{ blockPath: '$bdroot/Child', modelName: 'mdl_child' }],
      externalDataSources: [],
    },
  },
  'parity/artifacts/mdl/mdlcases_R2011b.mdl': {
    era: 'mdl',
    // The classic brace format: references, and no dictionary because the release has none.
    expected: {
      dataDictionary: null,
      modelReferences: [{ blockPath: '$bdroot/Child', modelName: 'mdl_child' }],
      externalDataSources: [],
    },
  },
  'parity/artifacts/mdl/mdlcases_R2017b.mdl': {
    era: 'mdl',
    expected: {
      dataDictionary: 'mdlparams.sldd',
      modelReferences: [{ blockPath: '$bdroot/Child', modelName: 'mdl_child' }],
      externalDataSources: [],
    },
  },
};

const eraOf = (era: string): string[] => Object.keys(FIXTURES).filter((f) => FIXTURES[f].era === era);

describe('scanModelStructure — the values, literally, in every layout era', () => {
  for (const era of ['legacy', 'systems', 'json', 'mdl']) {
    it.each(eraOf(era))(`${era}: %s`, (relative) => {
      expect(scanModelStructure(modelBuffer(relative), relative)).toEqual(FIXTURES[relative].expected);
    });
  }

  it('covers every era with at least one non-empty field, so the table is not vacuous', () => {
    // The table's value rests on this: an era represented only by empty rows would be an
    // era where a scanner that read nothing would pass.
    for (const era of ['legacy', 'systems', 'json', 'mdl']) {
      const informative = eraOf(era).filter((f) => {
        const e = FIXTURES[f].expected;
        return e.dataDictionary !== null || e.modelReferences.length > 0 || e.externalDataSources.length > 0;
      });
      expect(informative.length, `era ${era}`).toBeGreaterThan(0);
    }
  });
});

describe('scanModelStructure — it agrees with parseModel, live', () => {
  it('on every model fixture in the repo, not just the ones in the table', () => {
    // Walks the tree so a fixture added later is covered without being remembered here.
    const models = modelsUnder(FIXTURE_ROOT);
    expect(models.length).toBeGreaterThanOrEqual(Object.keys(FIXTURES).length);
    for (const relative of models) {
      const buffer = modelBuffer(relative);
      let reference: ModelStructure;
      try {
        const parsed = parseModel(buffer, relative);
        reference = {
          dataDictionary: parsed.dataDictionary,
          modelReferences: parsed.modelReferences,
          externalDataSources: parsed.externalDataSources,
        };
      } catch {
        // A fixture the full parser refuses is not this scanner's subject: it exists to
        // agree with `parseModel`, and there is nothing to agree with here.
        continue;
      }
      expect(scanModelStructure(buffer, relative), relative).toEqual(reference);
    }
  });

  it('gives the same answer on either inflate engine', () => {
    // The filtered read has two implementations — the central-directory walk when a
    // native engine is armed, fflate's own `filter` otherwise, which is what a browser
    // consumer runs. Two paths, one contract, so both are compared to the same table.
    for (const engine of [NATIVE, null]) {
      setNativeInflate(engine);
      for (const relative of Object.keys(FIXTURES)) {
        expect(scanModelStructure(modelBuffer(relative), relative), relative).toEqual(
          FIXTURES[relative].expected,
        );
      }
    }
  });
});

describe('scanModelStructure — the result type stays narrow', () => {
  it('carries exactly the three fields and nothing that would be empty by accident', () => {
    // Returning the partial `ParsedSlx` would type-check and pass every test above while
    // handing a caller `blockParamUsages: []` for a model full of them.
    const result = scanModelStructure(modelBuffer('fixtures/model_with_refs.slx'), 'model_with_refs.slx');
    expect(Object.keys(result).sort()).toEqual([
      'dataDictionary',
      'externalDataSources',
      'modelReferences',
    ]);
  });
});

describe('scanModelStructure — it really does not read the rest of the model', () => {
  // No clock, no counter: the parts the scan says it skips are made UNREADABLE. A read of
  // them cannot then be a silent slowdown — it is a thrown error, on a file the full
  // parser genuinely cannot open and this one answers for.
  const POISONED = 'simulink/systems/system_1.xml';

  function withPoisonedBlockPart(relative: string): ArrayBuffer {
    const original = unzipSync(new Uint8Array(modelBuffer(relative)));
    // Compressible on purpose, so the writer deflates it rather than storing it: a stored
    // member is never inflated by anyone and would make this test pass vacuously.
    const rebuilt = zipSync({ ...original, [POISONED]: strToU8('<System><Block/></System>'.repeat(400)) });
    return poisonMember(rebuilt, POISONED);
  }

  it.each([['node:zlib', NATIVE], ['fflate', null]] as Array<[string, NativeInflate | null]>)(
    'answers from a file whose block part will not inflate (%s)',
    (_label, engine) => {
      const relative = 'fixtures/model_with_refs.slx';
      const poisoned = withPoisonedBlockPart(relative);
      setNativeInflate(engine);

      // The control: the full parser cannot open this file at all. Without this the test
      // below would pass on an intact archive and prove nothing.
      expect(() => parseModel(poisoned, relative)).toThrow();

      // And the scan gives the same three fields as the intact file.
      expect(scanModelStructure(poisoned, relative)).toEqual(FIXTURES[relative].expected);
    },
  );
});

describe('scanModelStructure — what it refuses', () => {
  it('raises the model reader\'s own error for bytes that are no model at all', () => {
    // Not a zip, so it goes to the `.mdl` reader — and the message a user sees is the one
    // `parseModel` would have given, spelled in exactly one place.
    const notAModel = strToU8('this is not a model').buffer as ArrayBuffer;
    let fromParse = '';
    let fromScan = '';
    try {
      parseModel(notAModel, 'x.mdl');
    } catch (err) {
      fromParse = (err as Error).message;
    }
    try {
      scanModelStructure(notAModel, 'x.mdl');
    } catch (err) {
      fromScan = (err as Error).message;
    }
    expect(fromScan).toBe(fromParse);
  });

  it('raises the same error as parseModel for a zip that is not a model package', () => {
    // A well-formed zip with none of the parts in it. Neither reader throws — a short
    // parse is still a parse — so what is asserted is that both say the same nothing.
    const empty = zipSync({ 'notes.txt': strToU8('hello') }).slice().buffer as ArrayBuffer;
    const parsed = parseModel(empty, 'x.slx');
    expect(scanModelStructure(empty, 'x.slx')).toEqual({
      dataDictionary: parsed.dataDictionary,
      modelReferences: parsed.modelReferences,
      externalDataSources: parsed.externalDataSources,
    });
  });
});

// ---- helpers ------------------------------------------------------------------------

/** Every `.slx` and `.mdl` under `test/`, as paths relative to it. */
function modelsUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = `${dir}${entry.name}`;
      if (entry.isDirectory()) walk(`${full}/`);
      else if (/\.(slx|mdl)$/i.test(entry.name)) out.push(full.slice(root.length));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Overwrite one member's compressed bytes with 0xFF, in place, keeping every header
 * intact so the archive is still perfectly walkable.
 *
 * 0xFF is not arbitrary: the low three bits of a raw deflate stream are BFINAL and a
 * two-bit BTYPE, and `11` is the reserved value. Every inflate implementation refuses it
 * — node:zlib and fflate alike — so the member is unreadable by construction rather than
 * by luck, which a flipped bit in the middle of a stream would be.
 */
function poisonMember(archive: Uint8Array, target: string): ArrayBuffer {
  const out = archive.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
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
      // Loud rather than vacuous: a stored member cannot fail to inflate, so if the
      // writer chose to store this one the test is no longer testing anything.
      expect(method, `${target} must be deflated for this test to mean anything`).toBe(8);
      out.fill(0xff, dataAt, dataAt + compressedSize);
      return out.buffer as ArrayBuffer;
    }
    p = dataAt + compressedSize;
  }
  throw new Error(`no local header for ${target} — the archive layout is not what this helper assumes`);
}
