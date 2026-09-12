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

const { readSlddContent, slddChunkContent, normalizeRefNames, parseMat, parseModel, summarizeFiles } = core;
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

    list.push({
      id: `sldd.zip.${tag}.unzipDecode`,
      what: `unzip + UTF-8 decode of ${base(path)} -- the floor under any scanner, and the step 1 target`,
      role,
      samples: 3,
      run: () => {
        const xml = new TextDecoder().decode(unzipSync(u8)['data/chunk0.xml']);
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

  const slxLarge = fileFor(corpus, 'slx-large');
  if (slxLarge) {
    list.push({
      id: 'slx.deep.large',
      what: 'parseModel on a large .slx -- the fixture the plan says every model number needs',
      role: 'slx-large',
      samples: 2,
      run: () => {
        const parsed = parseModel(readAsArrayBuffer(slxLarge), base(slxLarge));
        return { probe: 'parsed', retain: parsed };
      },
    });
  }

  return list;
}
