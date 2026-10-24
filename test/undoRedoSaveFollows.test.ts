// Copyright 2026 The MathWorks, Inc.
//
// What a save writes follows the undo stack there and back, in a text dictionary, a binary one and
// a MAT-file alike. One rule (what is in the tree is what is written), three writers, and the undo
// stack between them:
//
//   * session.deleteNodesById of several entries is ONE undoable step: the save after it leaves
//     out exactly the entries deleted; undone, the save is the file as it was read (the text, the
//     chunk, the bytes); redone, it is the save after the delete again, however many times round;
//   * session.addEntry likewise: the save after it holds the entry, which reads back; undone, the
//     file as read; redone, the save after the add again. A dictionary says nothing of an add
//     (session.addEntryRefusal is null whether or not it added), where a MAT-file says why not.
//
// The redo of a batch releases a selection that points into it, as the delete itself did
// (headlessMutation.test.ts): the session never hands out a node the document no longer holds.
// And a batch naming an entry of a source no save writes (a project) is refused whole.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import '../src/datamodel/node/data/NodeClassMap.js';

// The clock is frozen, so the LastMod an added entry is stamped with is one string in every save.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

function bytesOf(rel: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// What a save of each format is, as a string to compare, and the entry names it holds once read
// again.
interface Format {
  file: string;
  path: string;
  /** A class the file takes a new entry of, by session.addEntry. */
  adds: string;
  written: (out: any) => string;
  namesIn: (out: any) => string[];
}

const entryNamesOf = (root: any): string[] => (root.flatten() as any[]).filter((n) => n.isEntry).map((n) => n.name).sort();
const reopenedNames = (file: string, buffer: ArrayBuffer): string[] => entryNamesOf(ingest(createSession(), buffer, { filename: file }));
const bufferOf = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const hex = (u8: Uint8Array): string => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

const FORMATS: Format[] = [
  {
    file: 'cellarr_text.sldd',
    path: './fixtures/cellarr_text.sldd',
    adds: 'Simulink.Parameter',
    written: (out) => out.text,
    namesIn: (out) => reopenedNames('cellarr_text.sldd', bufferOf(new TextEncoder().encode(out.text))),
  },
  {
    file: 'cellarr_binary.sldd',
    path: './fixtures/cellarr_binary.sldd',
    adds: 'Simulink.Parameter',
    // The chunk, which a save writes in the frame it was read in; the zip around it is the archiver's.
    written: (out) => new TextDecoder().decode(unzipSync(out.bytes)['data/chunk0.xml']),
    namesIn: (out) => reopenedNames('cellarr_binary.sldd', bufferOf(out.bytes)),
  },
  {
    file: 'cases.mat',
    path: './parity/artifacts/mat/cases.mat',
    adds: 'MatlabStruct',
    written: (out) => hex(out.bytes),
    // Its variables by the reader itself, the subsystem, which has no name, aside.
    namesIn: (out) => parseMat(bufferOf(out.bytes)).variables.map((v) => v.name).filter((n) => n !== '').sort(),
  },
];

function opened(format: Format) {
  const session = createSession();
  const buffer = bytesOf(format.path);
  const root: any = ingest(session, buffer, { filename: format.file });
  const save = () => session.serializeSource(format.file)!;
  return { session, root, buffer, save };
}

const entriesOf = (root: any): any[] => (root.flatten() as any[]).filter((n) => n.isEntry);

describe('a batch delete, undone and redone, is what each save writes', () => {
  for (const format of FORMATS) {
    it(`${format.file}: the save follows the batch there and back, twice`, () => {
      const { session, root, save } = opened(format);
      const asRead = format.written(save());
      const names = entryNamesOf(root);
      const doomed = entriesOf(root).slice(1, 3);
      expect(doomed).toHaveLength(2);
      const gone = doomed.map((n) => n.name);

      expect(session.deleteNodesById(doomed.map((n) => n.id))).toBe(true);
      const deleted = save();
      const afterDelete = format.written(deleted);
      expect(afterDelete).not.toBe(asRead);
      expect(format.namesIn(deleted)).toEqual(names.filter((n) => !gone.includes(n)));

      session.setActiveContext(root);
      for (let round = 0; round < 2; round++) {
        session.undo();
        expect(entryNamesOf(root)).toEqual(names);
        expect(format.written(save()), `undo ${round + 1}`).toBe(asRead);
        expect(session.canUndo()).toBe(false);
        expect(session.canRedo()).toBe(true);

        session.redo();
        expect(entryNamesOf(root)).toEqual(names.filter((n) => !gone.includes(n)));
        expect(format.written(save()), `redo ${round + 1}`).toBe(afterDelete);
        for (const n of doomed) {
          expect(session.findNodeById(n.id)).toBeNull();
        }
      }
    });
  }

  it('the redo releases a selection that points into the batch, and keeps one that does not', () => {
    const { session, root } = opened(FORMATS[1]);
    const [keep, a, b] = entriesOf(root).slice(0, 3);
    const inside = a.flatten().find((n: any) => n !== a) ?? a;
    expect(session.deleteNodesById([a.id, b.id])).toBe(true);
    session.setActiveContext(root);
    session.undo();
    expect(session.findNodeById(a.id)).toBe(a);

    session.setActive(root, [keep, inside]);
    session.redo();
    expect(session.getEntryNodes()).toEqual([keep]);
    expect(session.getContextNode()).toBe(root);
  });
});

describe('an added entry, undone and redone, is what each save writes', () => {
  for (const format of FORMATS) {
    it(`${format.file}: the save follows the add there and back, twice`, () => {
      const { session, root, save } = opened(format);
      const asRead = format.written(save());
      const names = entryNamesOf(root);

      session.setActiveContext(root);
      const added = session.addEntry('design', format.adds, 'zzAdded') as any;
      expect(added).not.toBeNull();
      expect(added.name).toBe('zzAdded');
      expect(session.addEntryRefusal()).toBeNull();
      const withIt = save();
      const afterAdd = format.written(withIt);
      expect(format.namesIn(withIt)).toEqual([...names, 'zzAdded'].sort());

      for (let round = 0; round < 2; round++) {
        session.undo();
        expect(entryNamesOf(root)).toEqual(names);
        expect(session.findNodeById(added.id)).toBeNull();
        expect(format.written(save()), `undo ${round + 1}`).toBe(asRead);

        session.redo();
        expect(session.findNodeById(added.id)).toBe(added);
        expect(format.written(save()), `redo ${round + 1}`).toBe(afterAdd);
      }
    });
  }

  it('a dictionary says nothing of an add it refused, where a MAT-file says why', () => {
    const dict = opened(FORMATS[0]);
    dict.session.setActiveContext(dict.root);
    expect(dict.session.addEntry('design', 'No.Such.Class')).toBeNull();
    expect(dict.session.addEntryRefusal()).toBeNull();
    const mat = opened(FORMATS[2]);
    mat.session.setActiveContext(mat.root);
    expect(mat.session.addEntry('', 'MatlabStruct', '1bad')).toBeNull();
    expect(mat.session.addEntryRefusal()).toMatch(/^Cannot add/);
  });
});

describe('a batch delete is refused whole', () => {
  it('for entries of a project, which no save writes', () => {
    const s = createSession();
    const info = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
    const prj = s.addProjectSource('MyProj.prj', {
      'resources/project/root/FILESHASHp.xml': info('<Info location="Root" type="Files"/>'),
      'resources/project/FILESHASH/AAAp.xml': info('<Info location="helper.m" type="File"/>'),
      'resources/project/FILESHASH/AAAd.xml': info('<Info/>'),
      'resources/project/FILESHASH/BBBp.xml': info('<Info location="model.slx" type="File"/>'),
      'resources/project/FILESHASH/BBBd.xml': info('<Info/>'),
    }) as any;
    const files = (prj.flatten() as any[]).filter((n) => n.isEntry);
    expect(files.length).toBeGreaterThanOrEqual(2);
    const before = entryNamesOf(prj);
    expect(s.deleteNodesById(files.map((f) => f.id))).toBe(false);
    expect(s.deleteNodesById([files[0].id])).toBe(false);
    expect(entryNamesOf(prj)).toEqual(before);
    for (const f of files) {
      expect(s.findNodeById(f.id)).toBe(f);
    }
    // Nothing was recorded to undo, under the project or anywhere.
    s.setActiveContext(prj);
    expect(s.canUndo()).toBe(false);
  });
});
