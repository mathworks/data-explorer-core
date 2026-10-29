// Copyright 2026 The MathWorks, Inc.
//
// What the binary save gate says, word for word (src/edit/binarySaveGate.ts).
//
// A refused save shows the user this text and nothing else, and the vscode host's integration
// suites read it too, so a wording change is a change in what the product says — made on a save
// path, where a user is deciding whether their edits are safe. binarySaveGate.test.ts asserts each
// refusal by its opening and its gist; this file asserts each of the nine whole, letter for letter,
// with the five-part cap and its "and N more", so that no rewording happens by accident.
//
// The tenth text a refused binary save can show, "Refusing to save: the document did not re-parse
// (…)", is the vscode host's own (its BinarySlddEditorProvider.writeTo), not this module's, and
// is pinned there.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import {
  DATA_PART_XML,
  EVERY_ENTRY,
  SavedChunk,
  createSession,
  entryKey,
  entrySelectorOf,
  findEntryInsertionPoint,
  keptPartsViolations,
  parseBinarySlddParts,
  savedChunkRefusal,
  scanChunkEntries,
  chunkEntryKey,
  serializeEntryToXml,
  spliceEntryObject,
  type Session,
} from '../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const zip = unzipSync(new Uint8Array(readFileSync(repo('test/parity/artifacts/binary/params.sldd'))));
const PARAMS = new TextDecoder().decode(zip[DATA_PART_XML]);
const META: Record<string, Uint8Array> = {};
for (const [k, v] of Object.entries(zip)) if (k !== DATA_PART_XML) META[k] = v;

let session: Session;
beforeEach(() => {
  session = createSession();
});

function open(xml: string) {
  const model: any = session.addDataSource('texts.sldd', parseBinarySlddParts(xml, META, []), { path: 'texts.sldd' });
  const entry = (name: string) =>
    (model.children as any[]).flatMap((s: any) => s.children as any[]).find((e: any) => e.name === name);
  return { model, saved: new SavedChunk(xml), entry };
}
const keyOf = (node: any) => entryKey(node.name, typeof node.metadata?.uuid === 'string' ? node.metadata.uuid : null);
function edit(chunk: string, node: any, mutate: () => unknown): string {
  const selector = entrySelectorOf(node);
  session.mutateSubtree(node, mutate);
  return spliceEntryObject(chunk, node, selector)!;
}
function entryText(chunk: string, name: string) {
  const e = scanChunkEntries(chunk).entries.find((x) => x.name === name)!;
  const text = chunk.slice(e.start, e.end);
  return { text, key: chunkEntryKey(e), with: (next: string) => chunk.slice(0, e.start) + next + chunk.slice(e.end) };
}

const FAULT =
  'This is a fault in the editor, not in your edits: undo them or revert the file, and report it.';

describe('the nine refusals, verbatim', () => {
  it('a chunk the scan cannot read, compared whole', () => {
    const broken = PARAMS.replace('<DataSource', '<!DOCTYPE x><DataSource');
    expect(savedChunkRefusal(new SavedChunk(PARAMS), broken, new Set([EVERY_ENTRY]), null)).toBe(
      'Refusing to save: the check that a save keeps what no edit changed cannot read this dictionary’s data ' +
        'part entry by entry, so it compared the whole of it with the file as last opened or saved, and they ' +
        'differ. Undo the edits or revert the file, and make the change in MATLAB.',
    );
  });

  it('an entry written with other bytes, though no edit changed it', () => {
    const d = open(PARAMS);
    const node = d.entry('scalarD');
    const after = edit(PARAMS, node, () => node.setProperty('Value', '42'));
    expect(savedChunkRefusal(d.saved, after, new Set(), d.model)).toBe(
      'Refusing to save: entry "scalarD" would be written with bytes other than the file’s, though no edit ' +
        `changed it. ${FAULT}`,
    );
  });

  it('an entry added, though no edit added it', () => {
    const d = open(PARAMS);
    const node = d.model.children.find((s: any) => s.name === 'design').addEntry('Simulink.Parameter');
    const at = findEntryInsertionPoint(PARAMS)!;
    const added = PARAMS.slice(0, at) + serializeEntryToXml(node) + PARAMS.slice(at);
    expect(savedChunkRefusal(d.saved, added, new Set(), d.model)).toBe(
      `Refusing to save: entry "${node.name}" would be added, though no edit added it. ${FAULT}`,
    );
  });

  it('an edited entry the dictionary the edits were made to does not hold', () => {
    const d = open(PARAMS);
    const e = entryText(PARAMS, 'scalarD');
    const renamed = e.with(e.text.replace('>scalarD<', '>renamed<'));
    expect(savedChunkRefusal(d.saved, renamed, new Set([e.key]), d.model)).toBe(
      'Refusing to save: entry "renamed" in the text to be saved is not in the dictionary the edits were made ' +
        'to, so the check cannot tell what the edits changed in it. Undo the edits to it to save the rest.',
    );
  });

  it('an edited entry that matches more than one entry of the dictionary', () => {
    const { text, key } = entryText(PARAMS, 'MyAlias');
    const twice = PARAMS.replace(text, text + '\n    ' + text);
    const d = open(twice);
    const second = scanChunkEntries(twice).entries.filter((x) => x.name === 'MyAlias')[1];
    const edited = twice.slice(0, second.start) + text.replace('>int32<', '>int16<') + twice.slice(second.end);
    expect(savedChunkRefusal(d.saved, edited, new Set([key]), d.model)).toBe(
      'Refusing to save: entry "MyAlias" in the text to be saved matches more than one entry of the ' +
        'dictionary, so the check cannot tell what the edits changed in it. Undo the edits to it to save the rest.',
    );
  });

  it('an edit that also changes parts it did not touch, naming at most five and counting the rest', () => {
    const d = open(PARAMS);
    const gravity = d.entry('gravity');
    const after = edit(PARAMS, gravity, () => gravity.setProperty('Description', 'g'));
    const e = entryText(after, 'gravity');
    let text = e.text;
    for (const [from, to] of [
      ['>9.81<', '>9.8<'],
      ['>real<', '>complex<'],
      ['>1.0 1.0<', '>1.0 2.0<'],
      ['>double<', '>single<'],
      ['>0.0<', '>1.0<'],
      ['>100.0<', '>99.0<'],
      ['>m/s^2<', '>ft/s^2<'],
    ]) {
      text = text.replace(from, to);
    }
    // The parts are the check's own answer; what is pinned is how the refusal frames and caps them.
    const parts = keptPartsViolations(gravity, text);
    expect(parts).toHaveLength(7);
    expect(savedChunkRefusal(d.saved, e.with(text), new Set([keyOf(gravity)]), d.model)).toBe(
      'Refusing to save: the edit to entry "gravity" would also change parts of it the edit did not touch (' +
        `${parts.slice(0, 5).join('; ')}; and 2 more). Undo the edit to "gravity" to save the rest.`,
    );
    // And under the cap, every part and no count.
    const one = entryText(after, 'gravity').text.replace('>9.81<', '>9.8<');
    const single = keptPartsViolations(gravity, one);
    expect(single).toHaveLength(1);
    expect(savedChunkRefusal(d.saved, e.with(one), new Set([keyOf(gravity)]), d.model)).toBe(
      'Refusing to save: the edit to entry "gravity" would also change parts of it the edit did not touch (' +
        `${single[0]}). Undo the edit to "gravity" to save the rest.`,
    );
  });

  it('an edited entry the check cannot be held to', () => {
    const xml = PARAMS.replace('<P Name="Value" Class="uint8">200</P>', '<P Name="Value" Class="uint8">200</P><?keep me?>');
    const d = open(xml);
    const node = d.entry('u8Scalar');
    const after = edit(xml, node, () => node.setProperty('Value', '7'));
    expect(savedChunkRefusal(d.saved, after, new Set([keyOf(node)]), d.model)).toBe(
      'Refusing to save: the edit to entry "u8Scalar" cannot be checked: the file spells that entry in a way ' +
        'the check cannot read (a processing instruction inside it, for example), so it cannot confirm that the ' +
        'rest of the entry stays as the file has it. Undo the edit to "u8Scalar" to save the rest, or make it in ' +
        'MATLAB.',
    );
  });

  it('an entry dropped, though no edit removed it', () => {
    const { text } = entryText(PARAMS, 'MyAlias');
    const twice = PARAMS.replace(text, text + '\n    ' + text);
    expect(savedChunkRefusal(new SavedChunk(twice), PARAMS, new Set(), null)).toBe(
      `Refusing to save: entry "MyAlias" would be dropped from the file, though no edit removed it. ${FAULT}`,
    );
  });

  it('a change outside the entries', () => {
    const d = open(PARAMS);
    const settings = PARAMS.replace(
      '<P Name="AccessBaseWorkspace" Class="logical">0</P>',
      '<P Name="AccessBaseWorkspace" Class="logical">1</P>',
    );
    expect(savedChunkRefusal(d.saved, settings, new Set([EVERY_ENTRY]), d.model)).toBe(
      'Refusing to save: the parts of the data part outside its entries (the dictionary’s own settings and ' +
        'references) would change, though no edit changes them. This is a fault in the editor, not in your ' +
        'edits: undo them or revert the file, and report it.',
    );
  });

  it('calls an entry with no name "(an entry with no name)"', () => {
    const { text } = entryText(PARAMS, 'MyAlias');
    const nameless = text.replace(/<P Name="Name"[^>]*>MyAlias<\/P>/, '');
    expect(nameless).not.toBe(text);
    const withNameless = PARAMS.replace(text, text + '\n    ' + nameless);
    expect(savedChunkRefusal(new SavedChunk(withNameless), PARAMS, new Set(), null)).toBe(
      `Refusing to save: entry (an entry with no name) would be dropped from the file, though no edit removed it. ${FAULT}`,
    );
  });
});
