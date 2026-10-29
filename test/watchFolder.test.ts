// Copyright 2026 The MathWorks, Inc.
//
// Following a folder's changes (src/node/watchFolder.ts), over a real temp folder and the
// platform's own `fs.watch` — the events are the platform's, and their shapes differ between
// macOS (FSEvents reports a save as a `rename`), Linux (inotify, a `change`) and Windows, so a stub
// would test this file's idea of them. A short debounce keeps each case quick.
//
// Every case first waits until the watcher is LIVE, by writing a file until it is reported:
// Linux's recursive watch walks the tree before it reports anything, so a write made the moment
// `watchFolder` returns can be lost, and a case that lost it would pass or fail by timing.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WATCH_DEBOUNCE_MS, watchFolder, type FolderWatch } from '../src/node/folder.js';

const DEBOUNCE = 150;
/** Long enough after a burst for any straggling event to have arrived and been reported. */
const SETTLE = DEBOUNCE * 4 + 300;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let open: FolderWatch[] = [];
let made: string[] = [];
afterEach(() => {
  for (const w of open) w.dispose();
  open = [];
  for (const root of made) rmSync(root, { recursive: true, force: true });
  made = [];
});

/** A fresh folder, laid out as a workspace with the folders the watcher must not follow. */
function folder(): {
  root: string;
  at: (...parts: string[]) => string;
  slash: (...parts: string[]) => string;
} {
  const root = mkdtempSync(join(tmpdir(), 'dex-watch-'));
  made.push(root);
  for (const dir of [['models'], ['.git'], ['node_modules', 'pkg'], ['slprj', 'sim'], ['docs']]) {
    mkdirSync(join(root, ...dir), { recursive: true });
  }
  writeFileSync(join(root, 'models', 'engine.slx'), 'v1');
  const base = resolve(root).replace(/\\/g, '/');
  return { root, at: (...parts) => join(root, ...parts), slash: (...parts) => [base, ...parts].join('/') };
}

/** Start watching `root` and wait until it is live; `calls` holds what it reported after that. */
async function watched(
  root: string,
  options: { skipDirectory?: (name: string) => boolean } = {},
): Promise<{ watch: FolderWatch; calls: Array<string[] | undefined>; next: (count: number) => Promise<void> }> {
  const calls: Array<string[] | undefined> = [];
  const watch = watchFolder(root, (paths) => calls.push(paths), { debounceMs: DEBOUNCE, ...options });
  open.push(watch);
  expect(watch.watching, String(watch.error)).toBe(true);
  const next = async (count: number): Promise<void> => {
    for (const started = Date.now(); calls.length < count; await sleep(10)) {
      if (Date.now() - started > 8000) throw new Error(`waited for call ${count}, have ${calls.length}`);
    }
  };
  // Live: a write that is reported. Retried, because the first ones may land before it is — but
  // spaced wider than the debounce, or each write would extend the burst and none be reported.
  for (let i = 0; calls.length === 0; i++) {
    if (i > 20) throw new Error('the watcher never reported the probe write');
    writeFileSync(join(root, 'ready.sldd'), String(i));
    await sleep(DEBOUNCE * 2 + 200);
  }
  await sleep(SETTLE);
  calls.length = 0;
  return { watch, calls, next };
}

describe('watchFolder reports the supported files a burst touched', () => {
  it('reports a created, a saved and a deleted file, each once', { timeout: 30_000 }, async () => {
    const { at, slash, root } = folder();
    const { calls, next } = await watched(root);

    writeFileSync(at('params.sldd'), 'one');
    await next(1);
    await sleep(SETTLE);
    expect(calls).toEqual([[slash('params.sldd')]]);

    writeFileSync(at('params.sldd'), 'two, a longer save');
    await next(2);
    await sleep(SETTLE);
    expect(calls).toEqual([[slash('params.sldd')], [slash('params.sldd')]]);

    unlinkSync(at('params.sldd'));
    await next(3);
    await sleep(SETTLE);
    expect(calls).toEqual([[slash('params.sldd')], [slash('params.sldd')], [slash('params.sldd')]]);
  });

  it('reports a burst once, with each file it touched once, in order', { timeout: 30_000 }, async () => {
    const { at, slash, root } = folder();
    const { calls, next } = await watched(root);

    writeFileSync(at('models', 'plant.slx'), '1');
    writeFileSync(at('b.sldd'), '1');
    writeFileSync(at('a.mat'), '1');
    writeFileSync(at('models', 'plant.slx'), '22');
    writeFileSync(at('models', 'engine.slx'), 'v2');
    await next(1);
    await sleep(SETTLE);

    expect(calls).toEqual([
      [slash('a.mat'), slash('b.sldd'), slash('models', 'engine.slx'), slash('models', 'plant.slx')],
    ]);
  });
});

describe('watchFolder leaves out what listFolder would not list', () => {
  it('reports nothing for a change in a hidden folder, node_modules or slprj', { timeout: 30_000 }, async () => {
    const { at, root } = folder();
    const { calls } = await watched(root);

    writeFileSync(at('.git', 'objects.sldd'), '1');
    writeFileSync(at('node_modules', 'pkg', 'fixture.slx'), '1');
    writeFileSync(at('slprj', 'sim', 'cache.slx'), '1');
    mkdirSync(at('node_modules', 'pkg', 'new'));
    await sleep(SETTLE);

    expect(calls).toEqual([]);
  });

  it('reports nothing for a file whose kind it does not open', { timeout: 30_000 }, async () => {
    const { at, root } = folder();
    const { calls } = await watched(root);

    // `model.slx.autosave` is what MATLAB writes and removes beside a model while it is open.
    writeFileSync(at('notes.txt'), '1');
    writeFileSync(at('Cargo.toml'), '1');
    writeFileSync(at('models', 'engine.slx.autosave'), '1');
    unlinkSync(at('models', 'engine.slx.autosave'));
    await sleep(SETTLE);

    expect(calls).toEqual([]);
  });

  it('follows another rule for which folders to leave out, when given one', { timeout: 30_000 }, async () => {
    const { at, slash, root } = folder();
    const { calls, next } = await watched(root, { skipDirectory: (name) => name === 'docs' });

    writeFileSync(at('docs', 'skipped.sldd'), '1');
    writeFileSync(at('node_modules', 'pkg', 'followed.sldd'), '1');
    await next(1);
    await sleep(SETTLE);

    expect(calls).toEqual([[slash('node_modules', 'pkg', 'followed.sldd')]]);
  });
});

describe('watchFolder reports a folder’s change as "anything may have changed"', () => {
  it('reports a renamed folder with no paths', { timeout: 30_000 }, async () => {
    // The files went with it, and no platform sends an event per file for that.
    const { at, root } = folder();
    const { calls, next } = await watched(root);

    renameSync(at('models'), at('renamed'));
    await next(1);
    await sleep(SETTLE);

    expect(calls).toEqual([undefined]);
  });

  it('reports a created and a deleted folder with no paths', { timeout: 30_000 }, async () => {
    const { at, root } = folder();
    const { calls, next } = await watched(root);

    mkdirSync(at('fresh'));
    await next(1);
    await sleep(SETTLE);
    rmSync(at('docs'), { recursive: true });
    await next(2);
    await sleep(SETTLE);

    expect(calls).toEqual([undefined, undefined]);
  });
});

describe('watchFolder stops cleanly', () => {
  it('fires nothing after dispose, for a burst in flight or a write after it', { timeout: 30_000 }, async () => {
    const { at, root } = folder();
    const { watch, calls } = await watched(root);

    writeFileSync(at('params.sldd'), 'in flight');
    watch.dispose();
    writeFileSync(at('params.sldd'), 'after');
    await sleep(SETTLE);

    expect(calls).toEqual([]);
    expect(watch.watching).toBe(false);
    expect(watch.error).toBeUndefined();
    expect(() => watch.dispose()).not.toThrow();
  });

  it('says it is not watching a folder it cannot watch, and does not throw', () => {
    const { at } = folder();
    for (const root of [at('nowhere'), at('models', 'engine.slx')]) {
      const watch = watchFolder(root, () => {
        throw new Error('nothing should be reported');
      });
      expect(watch.watching, root).toBe(false);
      expect(watch.error, root).toBeInstanceOf(Error);
      expect(() => watch.dispose()).not.toThrow();
    }
  });

  it('waits 300 ms by default, and refuses a wait that is not one', () => {
    expect(WATCH_DEBOUNCE_MS).toBe(300);
    const { root } = folder();
    expect(() => watchFolder(root, () => {}, { debounceMs: -1 })).toThrow(RangeError);
    expect(() => watchFolder(root, () => {}, { debounceMs: Number.NaN })).toThrow(RangeError);
  });
});
