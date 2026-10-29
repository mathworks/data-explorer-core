// Copyright 2026 The MathWorks, Inc.
//
// How `watchFolder` spells a reported path from the root it was given (src/node/watchFolder.ts),
// with `fs.watch` replaced so the events can be handed to it directly.
//
// Stubbed rather than run on a real tree for one case above all: a root of `/`, which the
// platform's recursive watch would walk whole. The others ride along because a stub makes them
// exact. What the real watch reports is test/watchFolder.test.ts's business.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** The listener the last `watch` call was given — what the platform would call per event. */
let emit: ((eventType: string, name: string | null) => void) | undefined;

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    watch: (_root: string, _options: unknown, listener: (eventType: string, name: string | null) => void) => {
      emit = listener;
      return Object.assign(new EventEmitter(), { close: () => {} });
    },
  };
});

const { watchFolder } = await import('../src/node/folder.js');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const made: string[] = [];
afterEach(() => {
  emit = undefined;
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** What one event under `root` is reported as. */
async function reported(root: string, name: string): Promise<Array<string[] | undefined>> {
  const calls: Array<string[] | undefined> = [];
  const watch = watchFolder(root, (paths) => calls.push(paths), { debounceMs: 0 });
  expect(watch.watching, String(watch.error)).toBe(true);
  emit?.('rename', name);
  await sleep(20);
  watch.dispose();
  return calls;
}

describe('watchFolder names a file from the root it was given', () => {
  it('drops trailing slashes from the root, so a path has one / between segments', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dex-watch-paths-'));
    made.push(root);
    const base = resolve(root).replace(/\\/g, '/');
    for (const given of [root, `${root}/`, `${root}///`]) {
      expect(await reported(given, 'models/engine.slx'), given).toEqual([[`${base}/models/engine.slx`]]);
    }
  });

  it('keeps a filesystem root as its one /', async () => {
    // `/` is the one path `resolve` leaves ending in a separator; adding another would report
    // `//engine.slx`, which names the same file and matches no listing's path.
    expect(await reported('/', 'engine.slx')).toEqual([['/engine.slx']]);
    expect(await reported('/', 'models/plant.sldd')).toEqual([['/models/plant.sldd']]);
  });

  it('turns a backslash in a reported name into /', async () => {
    // Windows reports names with its own separator; the paths a host is given use `/` throughout.
    const root = mkdtempSync(join(tmpdir(), 'dex-watch-paths-'));
    made.push(root);
    const base = resolve(root).replace(/\\/g, '/');
    expect(await reported(root, 'models\\engine.slx')).toEqual([[`${base}/models/engine.slx`]]);
  });
});
