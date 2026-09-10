// Copyright 2026 The MathWorks, Inc.
//
// Regenerate the MATLAB corpus and report what changed. The corpus is checked in so the
// suite runs without MATLAB, which means it can silently go stale against a newer
// MATLAB. This is the command that catches that: run it when the MATLAB version changes,
// or before trusting a green parity run.
//
//   env DEX_MATLAB_CMD="mw -using Bmain matlab" npm run parity:drift
//
// Exits 0 when the regenerated truth matches what is committed, 1 when it does not,
// printing a per-variable diff. A non-zero exit is NOT necessarily a bug in our code — it
// may be a MATLAB behaviour change, which is exactly the thing worth knowing about.
//
// It compares truth.json and mdl_truth.json, never container bytes. Only the JSON is
// byte-reproducible; cases.mat, cases.slx, both cases.sldd and every file in mdl/ differ
// on EVERY run, because MATLAB stamps each entry — and each model save — with a fresh
// uuid and timestamp. Comparing containers would report drift every single time and train
// the reader to ignore it.
//
// All four corpora are regenerated, because each can go stale independently: gen_truth.m
// for the value corpus, gen_mdl.m for the `.mdl` container corpus, gen_mask.m for the mask
// fixture, and gen_block_params.m for the option-list table. That is four MATLAB launches,
// three of which load Simulink — and the last one copies every block in two libraries — so
// expect this to take many minutes.
//
// The mask corpus is the one most worth this check. Its expectations are entirely
// `Simulink.findVars`' behaviour — which mask parameter types hold an expression, which
// scope a value resolves in, which shadowed definition gets no credit — and none of it is
// derivable from the file, so a release that changed its mind would leave the suite green
// and wrong. It matched on R2025a and R2027a when it was written.
//
// enumBlockParams.ts is checked here too, and it is the one regenerated file that is not a
// fixture at all — the parser imports it, so drift in it changes what a parse RETURNS. A
// release that turns a parameter from an option list into free text (or adds a block whose
// parameters were never scanned) makes the table quietly wrong in the expensive direction:
// a real reference suppressed, with no test to notice. It is compared per BLOCK TYPE so a
// diff names the block that moved rather than reprinting 108 of them.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ARTIFACTS = join(HERE, '..', 'artifacts');
const COMMITTED = join(ARTIFACTS, 'truth.json');
const COMMITTED_MDL = join(ARTIFACTS, 'mdl', 'mdl_truth.json');
// The one fixture a generator writes outside artifacts/, because it belongs with the
// fixtures its own suite reads rather than with a parity corpus.
const COMMITTED_MASK = join(HERE, '..', '..', 'fixtures', 'mask_truth.json');
// The one generated file that is not a fixture: the parser imports it at parse time.
const COMMITTED_ENUM = join(HERE, '..', '..', '..', 'src', 'datamodel', 'parser', 'enumBlockParams.ts');
const LAUNCH = process.env.DEX_MATLAB_CMD || '';

if (!LAUNCH) {
  console.error('DEX_MATLAB_CMD is unset. Set it to the launcher plus its fixed args, e.g.');
  console.error('  env DEX_MATLAB_CMD="mw -using Bmain matlab" npm run parity:drift');
  process.exit(2);
}
if (!existsSync(COMMITTED)) {
  console.error('no committed truth at ' + COMMITTED + ' — run gen_truth.m first (Phase 2)');
  process.exit(2);
}

const out = mkdtempSync(join(tmpdir(), 'dexdrift-'));
const [bin, ...args] = LAUNCH.split(' ');
console.log('regenerating into ' + out);

// Both generators honour an outdir set by the caller before run(...), so this never
// disturbs the committed copy — the regenerated corpus stays in the temp directory and
// is copied over by hand only if the new behaviour is judged correct.
function regenerate(name) {
  const script = join(HERE, name);
  console.log('\n--- ' + name + ' ---');
  execFileSync(
    bin,
    [...args, '-nodesktop', '-batch', `outdir='${out}'; run('${script}')`],
    { stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 },
  );
}

// gen_mask.m is a FUNCTION, not a script, so it takes its output directory as an argument
// rather than off a pre-set variable. Its second argument — the cross-format `.mdl` pair —
// is deliberately not passed: that export needs a release old enough to still write a
// pre-R2012 `.mdl`, and the pair is asserted against itself, not against this truth.
function regenerateFn(call) {
  console.log('\n--- ' + call + ' ---');
  execFileSync(
    bin,
    [...args, '-nodesktop', '-batch', `addpath('${HERE}'); ${call}`],
    { stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 },
  );
}

regenerate('gen_truth.m');
regenerate('gen_mdl.m');
regenerateFn(`gen_mask('${out}')`);
regenerate('gen_block_params.m');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const fresh = readJson(join(out, 'truth.json'));
const old = readJson(COMMITTED);

// The MATLAB version is reported, NOT counted as drift: a version change is the usual
// REASON for running this, so counting it would put a guaranteed hit in front of the
// findings that matter. Print it so every diff below is read against the right release.
try {
  const vOld = readJson(join(ARTIFACTS, 'meta.json')).version;
  const vNew = readJson(join(out, 'meta.json')).version;
  console.log('\ncommitted corpus written by MATLAB ' + vOld);
  console.log('regenerated by                    ' + vNew);
} catch {
  // A missing or unreadable meta.json is not worth failing over — the value comparison
  // below is the actual check, and it does not depend on knowing the version.
  console.log('\n(could not read meta.json from one side; comparing values anyway)');
}

let drift = 0;
for (const section of ['vars', 'objArr']) {
  const a = old[section] || {};
  const b = fresh[section] || {};
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const sa = JSON.stringify(a[name] ?? null);
    const sb = JSON.stringify(b[name] ?? null);
    if (sa !== sb) {
      drift++;
      console.log('\nDRIFT ' + section + '.' + name);
      console.log('  committed:   ' + sa);
      console.log('  regenerated: ' + sb);
    }
  }
}
// Both refusal maps. A change here is the MOST interesting kind of drift: it means
// MATLAB lifted (or added) a storage restriction, which retires — or adds — a skip.
for (const key of ['slddRejected', 'slxRejected']) {
  const ra = JSON.stringify(old.notes?.[key] ?? {});
  const rb = JSON.stringify(fresh.notes?.[key] ?? {});
  if (ra !== rb) {
    drift++;
    console.log('\nDRIFT notes.' + key);
    console.log('  committed:   ' + ra);
    console.log('  regenerated: ' + rb);
  }
}

// The `.mdl` corpus. Its truth is recorded from the MODEL rather than from any one file,
// so drift here means MATLAB now describes the diagram itself differently — which is a
// finding about every flavour at once, not about one container.
if (!existsSync(COMMITTED_MDL)) {
  console.log('\n(no committed mdl_truth.json; skipping the .mdl corpus)');
} else {
  const freshMdl = readJson(join(out, 'mdl', 'mdl_truth.json'));
  const oldMdl = readJson(COMMITTED_MDL);
  // `matlab` and each model's `release` record which MATLAB wrote the corpus. Reported
  // above, never counted: a release change is the reason for the run, not a finding.
  const models = new Set([...Object.keys(oldMdl), ...Object.keys(freshMdl)].filter((k) => k !== 'matlab'));
  for (const model of models) {
    const a = oldMdl[model] ?? {};
    const b = freshMdl[model] ?? {};
    const sections = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'release'));
    for (const section of sections) {
      // The workspace is compared per VARIABLE so the diff names the one that moved;
      // every other section is small enough to read whole.
      const parts = section === 'workspace'
        ? [...new Set([...Object.keys(a.workspace ?? {}), ...Object.keys(b.workspace ?? {})])]
            .map((n) => ['workspace.' + n, a.workspace?.[n], b.workspace?.[n]])
        : [[section, a[section], b[section]]];
      for (const [label, va, vb] of parts) {
        const sa = JSON.stringify(va ?? null);
        const sb = JSON.stringify(vb ?? null);
        if (sa !== sb) {
          drift++;
          console.log('\nDRIFT mdl.' + model + '.' + label);
          console.log('  committed:   ' + sa);
          console.log('  regenerated: ' + sb);
        }
      }
    }
  }
}

// The mask fixture. Compared per variable AND per mask, keyed by name plus source, because
// the whole point of the model is that one name (`o1`) is defined in two scopes at once —
// keying on the name alone would compare the two entries against each other.
if (!existsSync(COMMITTED_MASK)) {
  console.log('\n(no committed mask_truth.json; skipping the mask fixture)');
} else {
  const freshMask = readJson(join(out, 'mask_truth.json'));
  const oldMask = readJson(COMMITTED_MASK);
  const byKey = (t, key) => new Map((t.vars ?? []).map((v) => [v.name + ' @ ' + v.source, v[key]]));
  for (const [label, key] of [['users', 'users'], ['sourceType', 'sourceType']]) {
    const a = byKey(oldMask, key);
    const b = byKey(freshMask, key);
    for (const name of new Set([...a.keys(), ...b.keys()])) {
      const sa = JSON.stringify(a.get(name) ?? null);
      const sb = JSON.stringify(b.get(name) ?? null);
      if (sa !== sb) {
        drift++;
        console.log('\nDRIFT mask.' + name + '.' + label);
        console.log('  committed:   ' + sa);
        console.log('  regenerated: ' + sb);
      }
    }
  }
  // The masks themselves: the names, the values and — the release-sensitive part — the
  // TYPE of each parameter, which is what decides whether its value names data at all.
  const masksOf = (t) => new Map((t.masks ?? []).map((m) => [m.block, JSON.stringify(m)]));
  const ma = masksOf(oldMask);
  const mb = masksOf(freshMask);
  for (const block of new Set([...ma.keys(), ...mb.keys()])) {
    if (ma.get(block) !== mb.get(block)) {
      drift++;
      console.log('\nDRIFT mask.masks.' + block);
      console.log('  committed:   ' + (ma.get(block) ?? null));
      console.log('  regenerated: ' + (mb.get(block) ?? null));
    }
  }
}

// The option-list table. Read out of the TS rather than imported, because node cannot
// import a `.ts` and the generator's output format is one fixed line per block type. A
// line that stops matching is itself a finding: the generator changed shape and nothing
// below is comparing what it thinks it is, so an empty parse is reported, not passed over.
if (!existsSync(COMMITTED_ENUM)) {
  console.log('\n(no committed enumBlockParams.ts; skipping the option-list table)');
} else {
  const parseEnum = (p) => {
    const table = new Map();
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = /^ {2}'?([A-Za-z0-9_$-]+)'?: \[(.*)\],$/.exec(line);
      if (m) table.set(m[1], m[2]);
    }
    return table;
  };
  const oldEnum = parseEnum(COMMITTED_ENUM);
  const freshEnum = parseEnum(join(out, 'enumBlockParams.ts'));
  if (oldEnum.size === 0 || freshEnum.size === 0) {
    drift++;
    console.log(`\nDRIFT enumBlockParams: parsed ${oldEnum.size} committed / ${freshEnum.size} regenerated`);
    console.log('  one side parsed as EMPTY — the generator\'s output format moved; fix this comparison.');
  }
  for (const bt of new Set([...oldEnum.keys(), ...freshEnum.keys()])) {
    if (oldEnum.get(bt) !== freshEnum.get(bt)) {
      drift++;
      console.log('\nDRIFT enumBlockParams.' + bt);
      console.log('  committed:   ' + (oldEnum.get(bt) ?? '<absent>'));
      console.log('  regenerated: ' + (freshEnum.get(bt) ?? '<absent>'));
    }
  }
}

if (drift === 0) {
  console.log('\nno drift: the committed corpus matches this MATLAB.');
  process.exit(0);
}
console.log('\n' + drift + ' item(s) drifted. Review each, then re-copy the artifacts from');
console.log(out + ' if the new behaviour is correct —');
console.log('and update DESIGN.md if the CONVENTION changed, not just the value.');
process.exit(1);
