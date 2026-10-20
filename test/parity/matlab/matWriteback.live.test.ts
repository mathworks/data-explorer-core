// Copyright 2026 The MathWorks, Inc.
//
// The MAT-file save, loaded by MATLAB: probe_mat_writeback.mjs opens MATLAB's own `.mat` files
// through the session, edits them as a host does (values, elements, fields, cell members,
// reshapes, class changes, renames and deletes of plain variables, objects, strings and
// function handles, added variables and fields, several at once, `-v6` files), saves each with
// session.serializeSource, and writes the same edit as MATLAB statements beside it;
// probe_mat_writeback.m loads each original, makes the edit in MATLAB, loads the save, and
// compares the two to the leaf, with no warning allowed and MATLAB's own re-save of the save
// loading the same. Twelve of the cases are negative controls, which pass only when the
// comparison reports a difference planted in MATLAB's half. See the two scripts.
//
// Tier 2: skipped wholesale when DEX_MATLAB_CMD is unset, as writeback.live.test.ts is, so CI
// and external contributors stay green. Set it to the launcher plus its fixed args, and
// DEX_MATLAB_CWD to where the launcher must run from:
//   env DEX_MATLAB_CMD="mw -using Bmain matlab" npx vitest run test/parity/matlab/matWriteback.live.test.ts
//
// The JS half reads the BUILT package (dist/), so build first: a stale dist/ is a stale verdict.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matlabAvailable } from '../fidelity/roundTripHarness.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));

// One launch for every case. A cold launch has taken up to 10 minutes on a network sandbox
// (writeback.live.test.ts measured 276s on one), and the cases take about a minute more.
const MATLAB_TIMEOUT = 900_000;

describe('live MAT-file write-back', () => {
  if (!matlabAvailable()) {
    it.skip('DEX_MATLAB_CMD unset — live gate skipped', () => {});
    return;
  }

  let manifest: Array<{ id: string; js: string; refused: string }> = [];
  let out = '';
  beforeAll(() => {
    // A directory of its own under /tmp: the MATLAB half cds there before it writes anything.
    const dir = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'dex-matwb-'));
    execFileSync(process.execPath, [join(HERE, 'probe_mat_writeback.mjs')], {
      env: { ...process.env, PROBE_OUT: dir },
      encoding: 'utf8',
    });
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const [bin, ...args] = (process.env.DEX_MATLAB_CMD as string).split(' ');
    out = execFileSync(bin, [...args, '-nodesktop', '-batch', `PROBE_OUT='${dir}'; run('${join(HERE, 'probe_mat_writeback.m')}')`], {
      cwd: process.env.DEX_MATLAB_CWD || undefined,
      env: { ...process.env, PROBE_OUT: dir },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: MATLAB_TIMEOUT,
    });
  }, MATLAB_TIMEOUT);

  it('core saves every case, and each save passes the JS half', () => {
    expect(manifest.length).toBeGreaterThanOrEqual(90);
    expect(manifest.filter((r) => r.js || r.refused).map((r) => [r.id, r.js || r.refused])).toEqual([]);
  });

  it('MATLAB loads every save as the session edited it, with no warning', () => {
    const results = [...out.matchAll(/^RESULT (\S+) (PASS|FAIL)(.*)$/gm)];
    // One verdict per case, in order: a case the MATLAB half never reached is not a pass.
    expect(results.map((m) => m[1])).toEqual(manifest.map((r) => r.id));
    expect(results.filter((m) => m[2] === 'FAIL').map((m) => m[1] + m[3])).toEqual([]);
    expect(out).toContain(`PROBE_MAT_WRITEBACK DONE pass=${manifest.length} fail=0`);
  });
});
