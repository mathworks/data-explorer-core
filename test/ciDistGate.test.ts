// Copyright 2026 The MathWorks, Inc.
//
// The committed dist/ is the build of src/, and CI checks that it is.
//
// dist/ is committed because this package is consumed as a git dependency (see
// .gitignore). So what a consumer runs is the committed dist/, not src/. A commit that
// changes src/ without rebuilding ships the old code under the new version, and nothing
// else in the gate notices: verify's own `build` overwrites dist/ in the runner, and
// every later step reads that fresh copy.
//
// Both workflows therefore carry one more step after verify: delete dist/, build it
// again, and fail if the result differs from the committed copy. It deletes first
// because tsc never deletes an output. Built over the committed copy, a file whose
// source is gone stays in dist/ and the comparison passes.
//
// A test cannot run a workflow. This file does the next two things. It reads both
// workflow files and checks that the step is there, where it belongs, and that nothing
// can skip it. Then it takes the step's `run:` script from each file, as the runner
// would receive it, and runs it under `bash -e` (what Actions runs a `run:` step with)
// in a throwaway git repository. That repository has a build that, like tsc, writes
// one output per source and deletes nothing. The script must pass on a dist/ that
// matches, and fail, naming the file, on each of the three ways a dist/ goes stale.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOWS = fileURLToPath(new URL('../.github/workflows/', import.meta.url));

interface Step {
  /** Position in the job's `steps:` list. */
  index: number;
  /** The step's top-level keys (`name`, `run`, `uses`, `if`, ...). */
  keys: string[];
  name: string | undefined;
  /** The `run:` script as the runner receives it. Undefined for a `uses:` step. */
  run: string | undefined;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

// Just enough YAML for these two files: one job, a `steps:` list, and per step either
// an inline value or a `|` block. Full-line comments are dropped. In a `run: |` block
// they are shell comments, so dropping them leaves what the shell runs unchanged.
function stepsOf(workflow: string): Step[] {
  const lines = readFileSync(join(WORKFLOWS, workflow), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
  const lists = lines.flatMap((l, i) => (/^\s*steps:\s*$/.test(l) ? [i] : []));
  expect(lists, `${workflow} has exactly one steps: list`).toHaveLength(1);

  const blocks: string[][] = [];
  let dash = -1;
  for (const line of lines.slice(lists[0]! + 1)) {
    if (dash < 0) dash = indentOf(line);
    if (indentOf(line) < dash) break;
    if (indentOf(line) === dash) {
      expect(line.trimStart().startsWith('- '), `a step starts with "- ": ${line}`).toBe(true);
      blocks.push([line.replace('- ', '  ')]);
    } else {
      blocks.at(-1)!.push(line);
    }
  }

  const keyIndent = dash + 2;
  return blocks.map((body, index) => {
    const keyLines = body.flatMap((l, i) => (indentOf(l) === keyIndent ? [i] : []));
    const keyOf = (i: number): string => body[i]!.trim().split(':')[0]!;
    const valueOf = (i: number): string => {
      const t = body[i]!.trim();
      return t.slice(t.indexOf(':') + 1).trim();
    };
    const find = (key: string): number | undefined => keyLines.find((i) => keyOf(i) === key);

    const n = find('name');
    const r = find('run');
    let run: string | undefined;
    if (r !== undefined) {
      const v = valueOf(r);
      if (v.startsWith('|') || v.startsWith('>')) {
        expect(v, `${workflow}: a run block is a plain "|" block`).toBe('|');
        const block: string[] = [];
        for (const l of body.slice(r + 1)) {
          if (indentOf(l) <= keyIndent) break;
          block.push(l);
        }
        const pad = Math.min(...block.map(indentOf));
        run = block.map((l) => l.slice(pad)).join('\n') + '\n';
      } else {
        run = v;
      }
    }
    return { index, keys: keyLines.map(keyOf), name: n === undefined ? undefined : valueOf(n), run };
  });
}

// The four parts of the gate: delete, rebuild, then the two comparisons, in either order.
// `git diff --exit-code` catches a tracked output that changed or that the rebuild did
// not make again (an orphan). The `--untracked-files=all` status catches an output the
// rebuild made and nobody committed.
const GATE = ['rm -rf dist', 'npm run build', 'git diff --exit-code', '--untracked-files=all -- dist'];

function gateOf(workflow: string): Step {
  const steps = stepsOf(workflow);
  const gates = steps.filter((s) => s.run !== undefined && GATE.every((g) => s.run!.includes(g)));
  expect(
    gates.map((s) => s.index),
    `${workflow} has exactly one step that rebuilds dist/ from clean and compares it with the committed copy`,
  ).toHaveLength(1);
  return gates[0]!;
}

const indexOf = (workflow: string, what: string, pick: (s: Step) => boolean): number => {
  const found = stepsOf(workflow).filter(pick);
  expect(found, `${workflow} has exactly one ${what} step`).toHaveLength(1);
  return found[0]!.index;
};

describe('the step reader is reading these workflows', () => {
  it('finds the steps both workflows already had', () => {
    // A reader that silently found nothing would leave every test below vacuous.
    expect(stepsOf('ci.yml').map((s) => s.run ?? s.keys[0])).toEqual(
      expect.arrayContaining(['uses', 'npm ci', 'npm run verify']),
    );
    const release = stepsOf('release.yml');
    expect(release.map((s) => s.name)).toEqual(
      expect.arrayContaining(['Check tag matches package.json version', 'Verify', 'Create GitHub Release']),
    );
    const tag = release.find((s) => s.name === 'Check tag matches package.json version')!;
    expect(tag.run).toContain('VERSION="${GITHUB_REF_NAME#v}"\n');
    expect(tag.run).toContain('  exit 1\n');
  });
});

describe.each(['ci.yml', 'release.yml'])('%s checks that dist/ is the build of src/', (workflow) => {
  it('rebuilds dist/ from clean, then compares it with the committed copy', () => {
    const run = gateOf(workflow).run!;
    const [rm, build, ...compare] = GATE.map((g) => run.indexOf(g));
    expect(rm, 'deletes dist/ before building it').toBeLessThan(build!);
    for (const c of compare) expect(c, 'compares only after the build').toBeGreaterThan(build!);
  });

  it('is a plain step that nothing skips, ignores or reruns in another shell', () => {
    // An `if:` can skip it, `continue-on-error:` can ignore its red, and `shell:` can
    // drop the `-e` that makes each line's failure the step's failure.
    expect(gateOf(workflow).keys.sort()).toEqual(['name', 'run']);
  });

  it('runs after verify', () => {
    const verify = indexOf(workflow, 'npm run verify', (s) => s.run === 'npm run verify');
    expect(gateOf(workflow).index).toBeGreaterThan(verify);
  });
});

describe('both workflows run the same dist/ check', () => {
  it('has the same name and script in ci.yml and release.yml', () => {
    // So a tag is held to exactly what every PR was held to, and no weaker.
    const [ci, release] = [gateOf('ci.yml'), gateOf('release.yml')];
    expect(release.name).toBe(ci.name);
    expect(release.run).toBe(ci.run);
  });
});

describe('a release is created only after the dist/ check', () => {
  it('runs the check before Create GitHub Release', () => {
    const release = indexOf('release.yml', 'Create GitHub Release', (s) => s.name === 'Create GitHub Release');
    expect(gateOf('release.yml').index).toBeLessThan(release);
  });
});

// ---------------------------------------------------------------------------
// The gate's own script, run.

// git and npm see neither the machine's global git config (hooks, ignorecase) nor the
// npm_* variables of the `npm run test` that started this file.
const ENV: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k) && k !== 'INIT_CWD')),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'dist gate',
  GIT_AUTHOR_EMAIL: 'dist-gate@example.com',
  GIT_COMMITTER_NAME: 'dist gate',
  GIT_COMMITTER_EMAIL: 'dist-gate@example.com',
  NO_UPDATE_NOTIFIER: '1',
};

function sh(cwd: string, cmd: string, ...args: string[]): void {
  const r = spawnSync(cmd, args, { cwd, env: ENV, encoding: 'utf8' });
  expect(r.status, `${cmd} ${args.join(' ')}: ${r.stdout}${r.stderr}${r.error ?? ''}`).toBe(0);
}

const commitAll = (repo: string, message: string): void => {
  sh(repo, 'git', 'add', '-A');
  sh(repo, 'git', 'commit', '-q', '-m', message);
};

// Like tsc: one output per source, and nothing in dist/ is ever deleted.
const BUILD = [
  "import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';",
  "mkdirSync('dist', { recursive: true });",
  'for (const f of readdirSync("src")) {',
  "  writeFileSync(`dist/${f.replace(/\\.ts$/, '.js')}`, readFileSync(`src/${f}`, 'utf8').toUpperCase());",
  '}',
  '',
].join('\n');

/**
 * Runs `script` the way Actions runs a `run:` step (`bash -e`), in a fresh repository
 * whose committed dist/ is a clean build of its src/ until `stale` changes that.
 */
function runGate(script: string, stale: (repo: string) => void): { status: number | null; log: string } {
  const root = mkdtempSync(join(tmpdir(), 'dist-gate-'));
  try {
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'dist-gate-probe', private: true, scripts: { build: 'node build.mjs' } }),
    );
    writeFileSync(join(repo, 'build.mjs'), BUILD);
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 2;\n');
    sh(repo, 'git', 'init', '-q');
    sh(repo, process.execPath, 'build.mjs');
    commitAll(repo, 'src and its build');
    stale(repo);

    writeFileSync(join(root, 'gate.sh'), script);
    const r = spawnSync('bash', ['-e', join(root, 'gate.sh')], { cwd: repo, env: ENV, encoding: 'utf8' });
    return { status: r.status, log: `${r.stdout}${r.stderr}${r.error ?? ''}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe.each(['ci.yml', 'release.yml'])("%s's dist/ step, run", (workflow) => {
  const script = (): string => gateOf(workflow).run!;

  it('passes when the committed dist/ is the build of src/', { timeout: 60_000 }, () => {
    const { status, log } = runGate(script(), () => {});
    expect(status, log).toBe(0);
  });

  it('fails, naming the file, when src/ changed and dist/ was not rebuilt', { timeout: 60_000 }, () => {
    const { status, log } = runGate(script(), (repo) => {
      writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 10;\n');
      commitAll(repo, 'src only');
    });
    expect(status, log).not.toBe(0);
    expect(log).toContain('dist/a.js');
  });

  it('fails, naming the file, when dist/ holds an output whose source is gone', { timeout: 60_000 }, () => {
    // Only the clean rebuild sees this one: tsc built over dist/ leaves the file there.
    const { status, log } = runGate(script(), (repo) => {
      rmSync(join(repo, 'src', 'b.ts'));
      commitAll(repo, 'src only');
    });
    expect(status, log).not.toBe(0);
    expect(log).toContain('dist/b.js');
  });

  it('fails, naming the file, when the build makes an output nobody committed', { timeout: 60_000 }, () => {
    // Only the untracked-files check sees this one: no tracked file differs.
    const { status, log } = runGate(script(), (repo) => {
      writeFileSync(join(repo, 'src', 'c.ts'), 'export const c = 3;\n');
      commitAll(repo, 'src only');
    });
    expect(status, log).not.toBe(0);
    expect(log).toContain('dist/c.js');
  });
});
