// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-view test/editors/multiLineDescription.test.ts (9) and
// test/multiLineDescriptionRows.test.ts › "is what the row holds" (3), at ce62a24. There each file
// is opened in view's editing engine for its format; here it is opened in a core session, and each
// edit and save is the core calls that engine makes: a MAT-file's is session.editProperty, saved
// by session.serializeSource; a text dictionary's is cellEdit, its entry written back by
// reserializeEntry over the span findEntrySpan finds; a binary dictionary's is cellEdit, its entry
// spliced into the chunk by spliceEntryObject, the chunk held to the save gate (savedChunkRefusal)
// and zipped by writeBinarySlddPackage. A save is then read with core's reader, and opened again as
// the first open was. Every assertion is view's: the Descriptions compared code by code.
//
// The files are MATLAB's own: the same three Simulink.Parameter objects in a MAT-file, a text
// dictionary and a binary one, whose Descriptions MATLAB wrote with an LF (pLF), with a CR LF
// (pCRLF; MATLAB's text dictionary writes it as LF, the other two keep it) and on one line (pOne).
// The MAT-file and the binary dictionary are view's test-integration/fixtures/multiline ones,
// copied to test/fixtures/multiline/ byte for byte; the text dictionary is the same file as
// test/fixtures/vscode-c73da3c/multiline_r2027a_text.sldd, which cellEditHost.test.ts reads.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SavedChunk,
  cellEdit,
  changedEntryKeys,
  createSession,
  detectIndent,
  entrySelectorOf,
  findEntrySpan,
  parseBinarySldd,
  parseBinarySlddParts,
  readBinarySlddPackage,
  reserializeEntry,
  savedChunkRefusal,
  spliceEntryObject,
  writeBinarySlddPackage,
} from '../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const LF = "two\nlines, it's";
const CRLF = 'first line\r\nsecond line';

const fixture = (...path: string[]): Uint8Array => new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', ...path)));
const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** The Description's character codes, so a failure shows which line break went where. */
const codes = (text: string): string => [...text].map((c) => c.charCodeAt(0)).join(' ');

/** A dictionary's entry of that name. */
const entryOf = (dict: any, name: string): any => {
  const entry = (dict.children as any[]).flatMap((s) => s.children ?? []).find((e) => e.name === name);
  if (!entry) throw new Error(`the dictionary has no entry "${name}"`);
  return entry;
};

/** A MAT-file's variable of that name. */
const variableOf = (mat: any, name: string): any => {
  const variable = (mat.children as any[]).find((v) => v.name === name);
  if (!variable) throw new Error(`the MAT-file has no variable "${name}"`);
  return variable;
};

/** One file opened for editing, as a host holds it. */
interface Doc {
  /** The Description of the row of the entry or variable of that name. */
  description(name: string): string;
  /** That row's Description edited to `newValue`: what core answered. */
  edit(name: string, newValue: string): unknown;
  /** Whether any edit reached the document since it was opened. */
  edited(): boolean;
  /** Whether core holds the file as changed. */
  dirty(): boolean;
  /** Save, and answer the bytes the file then holds. */
  save(): Uint8Array;
}

interface Format {
  name: string;
  file: string[];
  /** pCRLF's Description as MATLAB wrote it. */
  crlf: string;
  open(bytes: Uint8Array): Doc;
  /** The Description of the entry or variable `name` core reads from saved bytes, in a session of its own. */
  readBack(bytes: Uint8Array, name: string): string;
}

/** A MAT-file, edited as the session edits one, and saved as it writes one. */
function openMat(bytes: Uint8Array): Doc {
  const srcId = 'multiline.mat';
  const session: any = createSession();
  const mat: any = session.addMatSource(srcId, buffer(bytes), { path: srcId });
  let steps = 0;
  session.bus.subscribe('undo/changed', (e: any) => {
    if (e.srcId === srcId) steps++;
  });
  return {
    description: (name) => variableOf(mat, name).toRow().Description,
    edit: (name, newValue) => {
      const node = variableOf(mat, name);
      session.setActive(mat, node);
      return session.editProperty(node.id, 'Description', newValue, String(node.toRow().Description));
    },
    edited: () => steps > 0,
    dirty: () => mat.dirty,
    save: () => {
      const out: any = session.serializeSource(srcId);
      expect(out?.kind).toBe('binary');
      return new Uint8Array(out.bytes);
    },
  };
}

/** A text dictionary, held as its text, each edited entry written back over its own span. */
function openText(bytes: Uint8Array): Doc {
  const srcId = 'multiline.sldd';
  const session: any = createSession();
  let text = new TextDecoder().decode(bytes);
  const dict: any = session.addDataSource(srcId, JSON.parse(text), { path: srcId });
  let writes = 0;
  return {
    description: (name) => entryOf(dict, name).toRow().Description,
    edit: (name, newValue) => {
      const entry = entryOf(dict, name);
      const selector = entrySelectorOf(entry);
      const { result, unchanged } = cellEdit(entry, entry, 'Description', newValue, session);
      if (result !== true || unchanged) return result;
      const span = findEntrySpan(text, selector);
      if (!span) throw new Error(`no span for "${name}" in the text`);
      text = text.slice(0, span.offset) + reserializeEntry(entry, detectIndent(text)) + text.slice(span.offset + span.length);
      writes++;
      return result;
    },
    edited: () => writes > 0,
    dirty: () => dict.dirty,
    save: () => new TextEncoder().encode(text),
  };
}

/** A binary dictionary, held as its chunk, each edited entry spliced into it, saved through the gate. */
function openBinary(bytes: Uint8Array): Doc {
  const srcId = 'multiline.sldd';
  const session: any = createSession();
  const { chunkXml, parts } = readBinarySlddPackage(bytes);
  const dict: any = session.addDataSource(srcId, parseBinarySlddParts(chunkXml, parts, []), { path: srcId });
  const savedChunk = new SavedChunk(chunkXml);
  let chunk = chunkXml;
  let writes = 0;
  return {
    description: (name) => entryOf(dict, name).toRow().Description,
    edit: (name, newValue) => {
      const entry = entryOf(dict, name);
      const selector = entrySelectorOf(entry);
      const { result, unchanged } = cellEdit(entry, entry, 'Description', newValue, session);
      if (result !== true || unchanged) return result;
      const after = spliceEntryObject(chunk, entry, selector);
      if (after === null) throw new Error(`no <Object> for "${name}" in the chunk`);
      chunk = after;
      writes++;
      return result;
    },
    edited: () => writes > 0,
    dirty: () => dict.dirty,
    save: () => {
      expect(savedChunkRefusal(savedChunk, chunk, changedEntryKeys(savedChunk.xml, chunk), session.getDataSource(srcId)), 'the save gate').toBeNull();
      return writeBinarySlddPackage(chunk, { ...parts }, 6);
    },
  };
}

/** A dictionary's entry of that name core reads from `bytes` (either format), in a session of its own. */
function readSldd(bytes: Uint8Array, name: string): string {
  const content = bytes[0] === 0x7b ? JSON.parse(new TextDecoder().decode(bytes)) : parseBinarySldd(buffer(bytes));
  return entryOf(createSession().addDataSource('readback.sldd', content, { path: 'readback.sldd' }), name).toRow().Description;
}

const FORMATS: Format[] = [
  {
    name: 'a MAT-file',
    file: ['multiline', 'multiline_r2027a.mat'],
    crlf: CRLF,
    open: openMat,
    readBack: (bytes, name) =>
      variableOf(createSession().addMatSource('readback.mat', buffer(bytes), { path: 'readback.mat' }), name).toRow().Description,
  },
  { name: 'a text dictionary', file: ['vscode-c73da3c', 'multiline_r2027a_text.sldd'], crlf: 'first line\nsecond line', open: openText, readBack: readSldd },
  { name: 'a binary dictionary', file: ['multiline', 'multiline_r2027a_binary.sldd'], crlf: CRLF, open: openBinary, readBack: readSldd },
];

describe('A multi-line Description is written exactly as typed, in every format a host edits', () => {
  for (const format of FORMATS) {
    it(`in ${format.name}: a line added to a two-line Description is saved, and reopens, exactly`, () => {
      const doc = format.open(fixture(...format.file));
      expect(doc.description('pLF'), 'the Description MATLAB wrote').toBe(LF);
      const typed = `${LF}\nand a third`;
      expect(doc.edit('pLF', typed), 'the edit was taken').toBe(true);
      expect(doc.edited(), 'the edit reached the document').toBe(true);

      const saved = doc.save();
      expect(codes(format.readBack(saved, 'pLF')), 'a fresh read of the saved file').toBe(codes(typed));
      const reopened = format.open(saved);
      expect(codes(reopened.description('pLF')), 'the saved file opened again').toBe(codes(typed));
      expect(reopened.description('pOne'), 'the other entries as MATLAB wrote them').toBe('one line');
    });

    it(`in ${format.name}: an edit of a CR LF Description keeps the line break the file held`, () => {
      const doc = format.open(fixture(...format.file));
      expect(codes(doc.description('pCRLF')), 'the Description MATLAB wrote').toBe(codes(format.crlf));
      const typed = format.crlf.replace('second line', 'second line, edited');
      expect(doc.edit('pCRLF', typed), 'the edit was taken').toBe(true);
      expect(doc.edited(), 'the edit reached the document').toBe(true);
      const saved = doc.save();
      expect(codes(format.readBack(saved, 'pCRLF')), 'a fresh read of the saved file').toBe(codes(typed));
      const reopened = format.open(saved);
      expect(codes(reopened.description('pCRLF')), 'the saved file opened again').toBe(codes(typed));
    });

    it(`in ${format.name}: an edit that repeats a multi-line Description writes nothing`, () => {
      const doc = format.open(fixture(...format.file));
      for (const name of ['pLF', 'pCRLF']) {
        expect(doc.edit(name, doc.description(name)), `${name}: nothing was refused either`).toBe(true);
      }
      expect(doc.edited(), 'no edit reached the document').toBe(false);
      expect(doc.dirty(), 'the document is clean').toBe(false);
    });
  }
});

for (const format of FORMATS) {
  describe(`a multi-line Description in ${format.name}, as MATLAB wrote it`, () => {
    it('is what the row holds', () => {
      const doc = format.open(fixture(...format.file));
      expect(doc.description('pLF')).toBe(LF);
      expect(doc.description('pCRLF')).toBe(format.crlf);
      expect(doc.description('pOne')).toBe('one line');
    });
  });
}
