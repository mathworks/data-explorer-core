// Copyright 2026 The MathWorks, Inc.
// The named things the plan measures. One scenario per cost the plan claims to
// change, so every step has a before and an after on the same yardstick.
//
// Scenarios measure `dist/`, not `src/` -- that is what consumers actually run,
// and dist/ is committed for exactly that reason (see .gitignore).
//
// A scenario whose corpus role is absent is SKIPPED, never faked. A snapshot
// records which ones ran.
//
// Both large customer dictionaries are measured, not just one. They are opposite
// shapes (see perf/corpus.mjs), and a fast path that helps the entry-count-dominated
// file has not been shown to help the value-size-dominated one.
//
// Scenarios that build a large graph return `{probe, retain}` so retained heap is
// real rather than ~0. See the note in perf/measure.mjs.

import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { filesFor, fileFor } from './corpus.mjs';

const core = await import('../dist/index.js');
const nodeApi = await import('../dist/node/index.js');
// The inflate seam, reached by a DEEP import on purpose: it is not barrel surface, and
// this harness is internal. Importing dist/node/index.js above has already armed the
// native engine as a side effect, so every scenario below measures the engine a Node
// consumer really gets.
const { unzipEntries, nativeInflateAvailable, setNativeInflate } = await import('../dist/datamodel/parser/Inflate.js');

const { readSlddContent, slddChunkContent, normalizeRefNames, parseMat, parseModel, summarizeFiles, scanSldd, scanMat, scanModelStructure, RowCellPool } = core;
const { createSession, loadFromPath } = nodeApi;

/** Read a file as a fresh ArrayBuffer. Buffer pooling makes `.buffer` wrong on its
 *  own: readFileSync on a small file returns a view at a non-zero byteOffset into a
 *  shared 8192-byte pool, so the slice is not optional. */
function readAsArrayBuffer(path) {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const entryCount = (json) => slddChunkContent(json)?.entries?.length ?? 0;

const base = (p) => p.split('/').pop();

/**
 * Which inflate engine this run measured. Recorded in every snapshot, because a
 * before/after that silently ran the SAME engine twice would show a 0% change and be
 * read as "step 1 did nothing" rather than "the measurement was not set up".
 */
export function inflateEngine() {
  return nativeInflateAvailable() ? 'node:zlib' : 'fflate';
}

/**
 * Force the engine, so a before/after can isolate ONE variable.
 *
 * `setNativeInflate(null)` is not an approximation of the pre-seam package: it calls
 * the very same `fflate.unzipSync` / `unzlibSync` the four call sites called before the
 * seam existed. So `DEX_PERF_INFLATE=fflate` measures the old cost in the NEW tree --
 * same harness, same scenario list, same process conditions, engine the only
 * difference. A cross-branch diff cannot claim that, because it moves the harness too.
 */
export function forceInflateEngine(name) {
  if (name === 'fflate') setNativeInflate(null);
  else if (name === 'node:zlib' || name === 'native') setNativeInflate(NATIVE_FOR_PERF);
  else if (name) throw new Error(`unknown DEX_PERF_INFLATE=${name} (want 'fflate' or 'node:zlib')`);
}

// Built here rather than trusting detection, so `DEX_PERF_INFLATE=node:zlib` means the
// same thing on a host where getBuiltinModule is missing.
const zlibForPerf = await import('node:zlib');
const NATIVE_FOR_PERF = {
  raw: (d) => zlibForPerf.inflateRawSync(d),
  zlib: (w) => zlibForPerf.inflateSync(w),
  // Present so that `DEX_PERF_INFLATE=node:zlib` measures the SAME engine a Node consumer
  // gets from dist/node/index.js. Omitting it would leave the forced engine a head-less
  // one, and `mat.scan.corpus` would then be slower when forced to the very engine it
  // already runs on by default -- a difference in the harness read as a difference in the
  // code (Z_SYNC_FLUSH: treat a truncated prefix as an end rather than an error).
  zlibHead: (p) => zlibForPerf.inflateSync(p, { finishFlush: zlibForPerf.constants.Z_SYNC_FLUSH }),
};

/**
 * Build the scenario list for a resolved corpus.
 * Each: {id, what, role, samples, run}
 */
export function scenarios(corpus) {
  const list = [];

  // ---- the two large customer dictionaries, zip spelling ------------------------
  for (const [role, tag] of [
    ['sldd-zip-entries', 'entries'],
    ['sldd-zip-values', 'values'],
  ]) {
    const path = fileFor(corpus, role);
    if (!path) continue;
    const bytes = readAsArrayBuffer(path);
    const u8 = new Uint8Array(bytes);

    list.push({
      id: `sldd.zip.${tag}.deep`,
      what: `readSlddContent on ${base(path)} -- what all three workspace-load call sites pay today`,
      role,
      samples: 2,
      run: () => {
        const json = readSlddContent(bytes, []);
        return { probe: entryCount(json), retain: json };
      },
    });

    // Two measurements of the same work, on purpose.
    //
    // `unzipDecode` calls fflate DIRECTLY and so is a FIXED CONTROL: it does not route
    // through the seam and must therefore not move across steps. If it does move, the
    // machine drifted and every other delta in the snapshot is suspect. Reading a
    // step-1 win into this row would be reading it into a number step 1 cannot touch.
    //
    // `unzipDecodeSeam` is the one step 1 changes.
    list.push({
      id: `sldd.zip.${tag}.unzipDecode`,
      what: `unzip + decode of ${base(path)} via fflate directly -- FIXED CONTROL, bypasses the seam`,
      role,
      samples: 3,
      run: () => {
        const xml = new TextDecoder().decode(unzipSync(u8)['data/chunk0.xml']);
        return { probe: xml.length, retain: xml };
      },
    });

    list.push({
      id: `sldd.zip.${tag}.unzipDecodeSeam`,
      what: `unzip + decode of ${base(path)} through the inflate seam -- the step 1 target`,
      role,
      samples: 3,
      run: () => {
        const xml = new TextDecoder().decode(unzipEntries(u8)['data/chunk0.xml']);
        return { probe: xml.length, retain: xml };
      },
    });

    list.push({
      id: `usage.summarizeFiles.${tag}`,
      what: `summarizeFiles over ${base(path)} -- the third full-parse call site, the one inside core`,
      role,
      samples: 2,
      run: () => {
        const out = summarizeFiles([{ srcId: 'perf', filename: base(path), bytes }]);
        return { probe: out ? 'summarized' : 'empty', retain: out };
      },
    });

    // The step 2 target. Paired with `.deep` above deliberately: `.deep` is the cost
    // being removed and this is what replaces it, so the two rows in one snapshot ARE
    // the speedup — no comparison against a baseline from another machine or another
    // day, which is where the step-1 write-up went wrong once already.
    //
    // `probe` is the name COUNT rather than a truthiness check, because a scanner that
    // silently returned nothing would otherwise post a spectacular time.
    list.push({
      id: `sldd.zip.${tag}.scan`,
      what: `scanSldd on ${base(path)} -- names + refs only, the step 2 replacement for .deep`,
      role,
      samples: 3,
      run: () => {
        const out = scanSldd(bytes, []);
        return { probe: `${out.names.length} names, ${out.refs.length} refs`, retain: out };
      },
    });
  }

  // ---- the same dictionaries, json-text spelling --------------------------------
  for (const [role, tag] of [
    ['sldd-json-entries', 'entries'],
    ['sldd-json-values', 'values'],
  ]) {
    const path = fileFor(corpus, role);
    if (!path) continue;
    const bytes = readAsArrayBuffer(path);
    list.push({
      id: `sldd.json.${tag}.deep`,
      what: `readSlddContent on ${base(path)} -- the uncompressed spelling, JSON.parse bound`,
      role,
      samples: 2,
      run: () => {
        const json = readSlddContent(bytes, []);
        return { probe: entryCount(json), retain: json };
      },
    });

    // Timed even though step 2 deliberately does NOT optimise this spelling, because a
    // claim that it changes nothing here is a claim, and this is the row that checks it.
    // Expect it to track `sldd.json.*.deep`: same JSON.parse, then a walk of the result.
    list.push({
      id: `sldd.json.${tag}.scan`,
      what: `scanSldd on ${base(path)} -- json-text keeps JSON.parse, so this must NOT beat .deep by much`,
      role,
      samples: 2,
      run: () => {
        const out = scanSldd(bytes, []);
        return { probe: `${out.names.length} names, ${out.refs.length} refs`, retain: out };
      },
    });
  }

  // ---- the references case ------------------------------------------------------
  // Neither large dictionary has references, so without this the refs path is timed
  // and validated against an empty list.
  const refsPath = fileFor(corpus, 'sldd-refs');
  if (refsPath) {
    const bytes = readAsArrayBuffer(refsPath);
    list.push({
      id: 'sldd.refs.deep',
      what: `readSlddContent on ${base(refsPath)} -- the only timing target carrying real Dictionary References`,
      role: 'sldd-refs',
      samples: 3,
      run: () => {
        const content = slddChunkContent(readSlddContent(bytes, []));
        const refs = content ? normalizeRefNames(content['Dictionary References']) : [];
        return { probe: `${content?.entries?.length ?? 0} entries, ${refs.length} refs`, retain: content };
      },
    });
  }

  // ---- row materialization ------------------------------------------------------
  const rowsPath = fileFor(corpus, 'sldd-json-entries');
  if (rowsPath) {
    list.push({
      id: 'rows.materialize',
      what: 'flatten + toRow() for every node -- the step 4 and step 7 target',
      role: 'sldd-json-entries',
      samples: 2,
      run: () => {
        const session = createSession();
        const src = loadFromPath(session, rowsPath);
        const rows = [];
        for (const section of src.children ?? []) {
          for (const entry of section.children ?? []) {
            const flat = entry.flatten ? entry.flatten() : [entry];
            for (const node of flat) rows.push(node.toRow());
          }
        }
        return { probe: rows.length, retain: rows };
      },
    });
    // The same pass with a cell pool, which is what step 4 changed. Kept as a SECOND
    // scenario rather than folded into the one above so the unpooled number stays
    // comparable to every baseline recorded before the pool existed: this pair is the
    // measurement, and `rows.materialize` staying flat is half of it.
    list.push({
      id: 'rows.materialize.pooled',
      what: 'the same rows, sharing one cell per distinct value (RowCellPool)',
      role: 'sldd-json-entries',
      samples: 2,
      run: () => {
        const session = createSession();
        const src = loadFromPath(session, rowsPath);
        const pool = new RowCellPool();
        const rows = [];
        for (const section of src.children ?? []) {
          for (const entry of section.children ?? []) {
            const flat = entry.flatten ? entry.flatten() : [entry];
            for (const node of flat) rows.push(node.toRow(pool));
          }
        }
        return { probe: `${rows.length} rows, ${pool.size} distinct cells`, retain: rows };
      },
    });
  }

  // ---- MAT ----------------------------------------------------------------------
  const mats = filesFor(corpus, 'mat-corpus');
  if (mats.length > 0) {
    list.push({
      id: 'mat.deep.corpus',
      what: `parseMat over ${mats.length} .mat files -- v7.3 files throw and are counted, not hidden`,
      role: 'mat-corpus',
      samples: 2,
      run: () => {
        let ok = 0;
        let refused = 0;
        for (const f of mats) {
          try {
            parseMat(readAsArrayBuffer(f));
            ok++;
          } catch {
            refused++;
          }
        }
        return `${ok} parsed, ${refused} refused`;
      },
    });

    // The step 3 target, paired with `mat.deep.corpus` above the way `sldd.zip.*.scan` is
    // paired with `.deep`: the two rows in ONE snapshot are the speedup, so nothing has to
    // be compared against a baseline from another machine or another day.
    //
    // Deliberately identical to the scenario above in every way but the call — same file
    // list, same `readAsArrayBuffer` inside the timed region, same try/catch. A scan that
    // only looked faster because it skipped the file reads would not be measuring anything.
    //
    // `probe` counts NAMES, not files: a scanner that returned empty lists would otherwise
    // post a spectacular time, and the v7.3 files that `parseMat` throws on must keep
    // throwing here (`scanMat` refuses them so `parseMat` speaks) — the refused count is in
    // the probe for exactly that reason.
    list.push({
      id: 'mat.scan.corpus',
      what: `scanMat over ${mats.length} .mat files -- names only, the step 3 replacement for mat.deep.corpus`,
      role: 'mat-corpus',
      samples: 3,
      run: () => {
        let ok = 0;
        let refused = 0;
        let names = 0;
        for (const f of mats) {
          try {
            names += scanMat(readAsArrayBuffer(f)).names.length;
            ok++;
          } catch {
            refused++;
          }
        }
        return `${ok} scanned, ${refused} refused, ${names} names`;
      },
    });
  }

  // ---- SLX ----------------------------------------------------------------------
  const slxSmall = filesFor(corpus, 'slx-small');
  if (slxSmall.length > 0) {
    list.push({
      id: 'slx.deep.small',
      what: `parseModel over ${slxSmall.length} small .slx files -- toy sized, see the slx-large gap`,
      role: 'slx-small',
      samples: 3,
      run: () => {
        let n = 0;
        for (const f of slxSmall) {
          parseModel(readAsArrayBuffer(f), base(f));
          n++;
        }
        return n;
      },
    });
  }

  // Two large models, measured as a PAIR. They are the same size in block XML and differ
  // only in whether a block parameter names a variable, so the gap between these two rows
  // is the cost of resolving and recording 64,002 param usages -- which is how the plan
  // establishes that a `.slx` name scanner has no tree to skip. One row alone cannot say
  // that, which is why both are here.
  //
  // `probe` counts the PAYLOAD rather than reporting 'parsed'. A parse that silently
  // returned an empty model would otherwise post an excellent time and read as healthy --
  // the same trap the scan scenarios avoid by counting names. The part count comes along
  // because the literal model's payload is legitimately zero, so on that row it is the
  // part count that proves anything was read at all.
  const payload = (parsed) =>
    `${parsed.blockParamUsages?.length ?? 0} usages, ${parsed.workspace?.length ?? 0} vars, ` +
    `${Object.keys(parsed.rawContents ?? {}).length} parts`;

  for (const [role, id, what] of [
    ['slx-large', 'slx.deep.large', 'parseModel on a large .slx -- the fixture the plan says every model number needs'],
    ['slx-large-refs', 'slx.deep.large.refs', 'parseModel on the same model with every block parameter naming a variable'],
  ]) {
    const file = fileFor(corpus, role);
    if (!file) continue;
    list.push({
      id,
      what,
      role,
      samples: 2,
      run: () => {
        const parsed = parseModel(readAsArrayBuffer(file), base(file));
        return { probe: payload(parsed), retain: parsed };
      },
    });
  }

  // ---- SLX structure: step 8's before and after, on the same files ------------------
  //
  // The corpus sweep is the HEADLINE pair, and it is a pair rather than one row for the
  // same reason the two large models are: `slx.deep.corpus` is the cost a host pays today
  // to draw a model's relationships, and `slx.structure.corpus` is the cost of the three
  // fields it actually reads. Neither number means anything without the other.
  //
  // It sweeps `slx-corpus` (the whole root) and not `slx-small` (7 toy models), because
  // where these three fields live has moved twice and only a real spread of release
  // vintages exercises more than one era. See the oracle's carrier census.
  const structure = (s) =>
    `${s.dataDictionary === null ? 0 : 1} dd, ${s.modelReferences.length} refs, ` +
    `${s.externalDataSources.length} eds`;

  const slxCorpus = filesFor(corpus, 'slx-corpus');
  if (slxCorpus.length > 0) {
    // The probe counts the PAYLOAD across the sweep, which is what keeps this row honest:
    // a scanner that returned three empty fields for every model would post a superb time,
    // and the two large-model rows below cannot catch that because their models genuinely
    // have nothing in any of the three. This row is where the non-emptiness is visible.
    const sweep = (read) => () => {
      let files = 0;
      let refused = 0;
      let dd = 0;
      let refs = 0;
      let eds = 0;
      for (const f of slxCorpus) {
        try {
          const s = read(f);
          if (s.dataDictionary !== null) dd++;
          refs += s.modelReferences.length;
          eds += s.externalDataSources.length;
          files++;
        } catch {
          refused++;
        }
      }
      return `${files} read, ${refused} refused, ${dd} dd, ${refs} refs, ${eds} eds`;
    };

    list.push({
      id: 'slx.deep.corpus',
      what: `parseModel over ${slxCorpus.length} .slx files -- the cost of three fields today`,
      role: 'slx-corpus',
      samples: 2,
      run: sweep((f) => parseModel(readAsArrayBuffer(f), base(f))),
    });
    list.push({
      id: 'slx.structure.corpus',
      what: `scanModelStructure over ${slxCorpus.length} .slx files -- the step 8 replacement for slx.deep.corpus`,
      role: 'slx-corpus',
      samples: 2,
      run: sweep((f) => scanModelStructure(readAsArrayBuffer(f), base(f))),
    });
  }

  // And the extreme-size case, paired one-for-one with the two `slx.deep.large` rows
  // above so the ratio is read off the same file. The probe here is legitimately
  // `0 dd, 0 refs, 0 eds` on both fixtures -- they are generated block XML with no
  // relationships at all -- so these two rows measure the SKIP and say nothing about the
  // answer. That evidence is the corpus row above, and `perf/oracle-run.mjs`.
  for (const [role, id] of [
    ['slx-large', 'slx.structure.large'],
    ['slx-large-refs', 'slx.structure.large.refs'],
  ]) {
    const file = fileFor(corpus, role);
    if (!file) continue;
    list.push({
      id,
      what: `scanModelStructure on the ${role} fixture -- the step 8 replacement for ${id.replace('.structure.', '.deep.')}`,
      role,
      samples: 2,
      run: () => structure(scanModelStructure(readAsArrayBuffer(file), base(file))),
    });
  }

  return list;
}
