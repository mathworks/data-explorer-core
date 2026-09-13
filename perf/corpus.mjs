// Copyright 2026 The MathWorks, Inc.
// Corpus resolution for the performance harness.
//
// The corpus is deliberately NOT in the repository: the dictionaries alone are
// ~150 MB, and `scripts/check-pack.mjs` keeps the tarball to dist/ only. So the
// harness resolves an EXTERNAL corpus and degrades to whatever is present,
// reporting the rest as missing rather than silently measuring less.
//
// NO CONCRETE PATH APPEARS IN THIS FILE, on purpose. Real dictionaries are named
// after the customers they came from, and this tree is public. Every single-file
// role is resolved through `perf/corpus.local.json`, which is gitignored; this file
// declares only the SHAPE each role must have, so the same table works against
// anyone's corpus. `scripts/leak-check.mjs` asserts the manifest's paths never
// appear in a tracked file.
//
// Roots, in precedence order: DEX_PERF_CORPUS, then the manifest's `root`.
//
// The two large dictionaries are BOTH timing targets on purpose: they are the same
// product of the same writer at opposite extremes of shape. One is entry-count
// dominated (~31,000 entries in a 2.6 MB zip), the other value-size dominated
// (~13,700 entries in 4.7 MB). A scanner that wins on one of those has not been
// shown to win on the other, and early probes that used only the first could not
// have told the difference.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, 'corpus.local.json');

/** The gitignored manifest, or an empty one when absent. */
function loadManifest() {
  if (!existsSync(MANIFEST)) return { files: {}, dirs: {} };
  try {
    const raw = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    return { root: raw.root, files: raw.files ?? {}, dirs: raw.dirs ?? {} };
  } catch (e) {
    // A malformed manifest must not read as "corpus absent": that would quietly
    // shrink every run to the two extension sweeps and still print a green table.
    throw new Error(`perf/corpus.local.json is unreadable: ${e.message}`);
  }
}

export const corpusRoot = (manifest = loadManifest()) =>
  resolve(process.env.DEX_PERF_CORPUS ?? manifest.root ?? '.');

// One entry per ROLE the plan measures, not per file. A role that resolves to
// nothing is reported, because some of the plan's conclusions are only as good as
// the fixture behind them -- see `slx-large`.
const ROLES = [
  {
    id: 'sldd-zip-entries',
    what: 'zip .sldd, entry-count dominated',
    kind: 'file',
  },
  {
    id: 'sldd-zip-values',
    what: 'zip .sldd, value-size dominated',
    kind: 'file',
  },
  {
    id: 'sldd-json-entries',
    what: 'json-text spelling of the entry-count-dominated dictionary',
    kind: 'file',
  },
  {
    id: 'sldd-json-values',
    what: 'json-text spelling of the value-size-dominated dictionary',
    kind: 'file',
  },
  {
    // Neither large dictionary has any Dictionary References, so a refs scanner
    // validated only against those would be vacuously correct on an empty list.
    // This role must point at a dictionary that carries a real reference.
    id: 'sldd-refs',
    what: '.sldd with real Dictionary References',
    kind: 'file',
  },
  {
    // The oracle's corpus, separate from the timing targets: breadth beats size when
    // the question is "does the fast path agree everywhere". Resolved by sweeping the
    // whole root, so it needs no manifest entry.
    id: 'sldd-corpus',
    what: 'every .sldd in the corpus -- breadth for the oracle, not timing',
    kind: 'glob',
    at: '.',
    ext: '.sldd',
    // Excludes the oversize fixture below, which no run wants to read ~170 times.
    maxBytes: 64 * 1048576,
  },
  {
    // A CEILING case, not a slow case: `readSlddContent` cannot read it at all. The
    // json-text path builds one string via strFromU8, and a file this size exceeds
    // V8's maximum string length (0x1fffffe8), so it throws "Cannot create a string
    // longer than". A byte-oriented scanner is not subject to that limit, which is a
    // correctness argument for step 2 on top of the speed one.
    id: 'sldd-oversize',
    what: '.sldd past V8 max string length -- unreadable today',
    kind: 'file',
  },
  {
    // The whole root, not one project directory: the `.mat` fixtures are spread over
    // many subdirectories. Scoping this to one of them found 16 of 40 and quietly
    // measured 40% of the corpus.
    id: 'mat-corpus',
    what: 'mixed v5/v7.3 .mat files, the step 3 target',
    kind: 'glob',
    at: '.',
    ext: '.mat',
  },
  {
    id: 'slx-small',
    what: 'small .slx models -- toy sized, see the slx-large gap',
    kind: 'glob',
    atKey: 'slx-small',
    ext: '.slx',
  },
  {
    // The oracle's model corpus, and the counterpart to `sldd-corpus`: breadth, not
    // timing. Separate from `slx-small` because that role is a manifest-named DIRECTORY
    // of toy models, and equivalence has to be checked over every model there is —
    // `scanModelStructure` reads a different set of OPC parts per layout era, and the
    // eras are distinguishable only across a real spread of release vintages. Sweeping
    // the whole root finds 127 where `slx-small` finds 7.
    id: 'slx-corpus',
    what: 'every .slx in the corpus -- breadth for the oracle, not timing',
    kind: 'glob',
    at: '.',
    ext: '.slx',
  },
  {
    id: 'slx-large',
    // Deliberately layout-GENERIC. Where a model's blocks live has moved twice (see
    // the layout table in docs/TODO.md item 1): `blockdiagram.xml` until R2020a, then
    // `simulink/systems/*.xml`, and from R2026b the top-level diagram file is JSON
    // metadata carrying no block content at all. Naming one of those spellings dated
    // this role's description to a release era, so it names the SIZE instead.
    what: 'a .slx whose block XML runs to several MB',
    kind: 'file',
    // Still flagged as a gap, because the flag means "if this is absent, say so
    // loudly" rather than "nobody has built one". Every model-side number in the perf
    // plan before this existed came from 2-3 KB files, so a snapshot taken without it
    // cannot support any claim about model parsing.
    //
    // What a fixture has to have, since it is generated rather than found: block XML
    // in the MB range (~64k blocks across nested subsystems gets there), and — for
    // anything measuring NAME extraction rather than parse cost — block parameters
    // that reference workspace VARIABLES. Literal arithmetic like `1.037 * 403` names
    // nothing, so a model full of it yields zero param usages and measures only the
    // XML walk. THIS role is the literal one; the role below is its counterpart.
    knownGap: true,
  },
  {
    // The same model with one thing changed: every block parameter names a
    // model-workspace variable (`Kp0201 * 102`) instead of being arithmetic, so the
    // parse yields a full payload — 64,002 param usages and 300 workspace vars —
    // over block XML that is the same size as `slx-large`'s to within 0.03 MB.
    //
    // It exists to be COMPARED with `slx-large`, and that comparison is a finding
    // rather than a benchmark: the two parse in the same time (see the plan's
    // slx-large section), which is what says a `.slx` name scanner has no tree to
    // skip. Kept as two roles so that stays measured instead of remembered.
    id: 'slx-large-refs',
    what: 'the same large .slx with every block parameter naming a variable',
    kind: 'file',
    knownGap: true,
  },
];

function findByExt(dir, ext) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return; // unreadable subtree contributes nothing, same as absent
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith(ext)) out.push(p);
    }
  };
  walk(dir);
  return out.sort(); // stable order, so a snapshot is comparable run to run
}

/**
 * Resolve every role against the corpus root.
 * @returns {{root: string, roles: Record<string, object>, missing: string[],
 *            gaps: string[], unconfigured: string[]}}
 */
export function resolveCorpus() {
  const manifest = loadManifest();
  const root = corpusRoot(manifest);
  const roles = {};
  const missing = [];
  const gaps = [];
  // Roles the manifest says nothing about, distinguished from roles it names and the
  // file turns out not to exist. Those are different mistakes: one is "you have not
  // told me where it is", the other is "you told me and it is not there".
  const unconfigured = [];

  for (const role of ROLES) {
    let files = [];
    let configured = true;

    if (role.kind === 'file') {
      const rel = manifest.files[role.id];
      if (rel === undefined) {
        configured = false;
      } else {
        const target = join(root, rel);
        if (existsSync(target) && statSync(target).isFile()) files = [target];
      }
    } else {
      const rel = role.atKey ? manifest.dirs[role.atKey] : role.at;
      if (rel === undefined) {
        configured = false;
      } else {
        const target = join(root, rel);
        if (existsSync(target)) files = findByExt(target, role.ext);
      }
    }

    let excluded = 0;
    if (role.maxBytes !== undefined) {
      const kept = files.filter((f) => statSync(f).size <= role.maxBytes);
      excluded = files.length - kept.length;
      files = kept;
    }

    const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
    const present = files.length > 0;
    roles[role.id] = {
      id: role.id,
      what: role.what,
      files,
      bytes,
      present,
      excluded,
      configured,
      knownGap: role.knownGap === true,
    };
    if (!present) {
      missing.push(role.id);
      if (!configured) unconfigured.push(role.id);
      if (role.knownGap) gaps.push(role.id);
    }
  }

  return { root, roles, missing, gaps, unconfigured };
}

/** Files for one role, or [] when absent. Callers skip on empty rather than throw. */
export function filesFor(corpus, roleId) {
  return corpus.roles[roleId]?.files ?? [];
}

/** The single file for a file-kind role, or null. */
export function fileFor(corpus, roleId) {
  return filesFor(corpus, roleId)[0] ?? null;
}

/** Human-readable coverage report, printed by every harness entry point. */
export function describeCorpus(corpus) {
  const lines = [`corpus root: ${corpus.root}`];
  for (const r of Object.values(corpus.roles)) {
    const mark = r.present
      ? 'ok     '
      : !r.configured
        ? 'unset  '
        : r.knownGap
          ? 'GAP    '
          : 'absent ';
    const size = r.present
      ? `${r.files.length} file(s), ${(r.bytes / 1048576).toFixed(1)} MB` +
        (r.excluded > 0 ? ` (+${r.excluded} over cap)` : '')
      : '--';
    lines.push(`  ${mark} ${r.id.padEnd(18)} ${size.padEnd(30)} ${r.what}`);
  }
  if (corpus.unconfigured.length > 0) {
    lines.push('');
    lines.push(
      `  NOTE: ${corpus.unconfigured.length} role(s) unset in perf/corpus.local.json ` +
        '(see perf/corpus.local.example.json).',
    );
  }
  if (corpus.gaps.length > 0) {
    lines.push('');
    lines.push(
      `  NOTE: ${corpus.gaps.length} known gap(s) unfilled -- any conclusion about ` +
        'that role is unsupported by this run.',
    );
  }
  return lines.join('\n');
}
