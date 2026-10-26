// Copyright 2026 The MathWorks, Inc.
//
// The edit-bash parity fixtures (test/fixtures/edit-bash) opened through the session as a host opens
// them, edited, saved and opened again: one value at one path, the same in a MAT-file of each
// release and in a text and a binary dictionary.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../../src/index.js';
import '../../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DIR = fileURLToPath(new URL('../fixtures/edit-bash/', import.meta.url));

/** Each format a fixture is in, by the file that holds it. */
export const EDIT_BASH_FILES = {
  mat27: 'r2027a/values.mat',
  mat23: 'r2023b/values.mat',
  json: 'r2027a/values_text.sldd',
  bin: 'r2027a/values_binary.sldd',
  bin23: 'r2023b/values_binary.sldd',
} as const;

export type EditBashFormat = keyof typeof EDIT_BASH_FILES;
export const EDIT_BASH_FORMATS = Object.keys(EDIT_BASH_FILES) as EditBashFormat[];

export interface Opened {
  format: EditBashFormat;
  session: any;
  root: any;
}

function openBytes(format: EditBashFormat, bytes: Uint8Array): Opened {
  const session = createSession();
  const root = ingest(session, bytes, { filename: EDIT_BASH_FILES[format].split('/').pop()! });
  return { format, session, root };
}

/** The fixture of `format`, as read. */
export const openEditBash = (format: EditBashFormat): Opened =>
  openBytes(format, new Uint8Array(readFileSync(DIR + EDIT_BASH_FILES[format])));

/** The node at `path` (its matlabPath), or undefined. */
export const nodeAt = (o: Opened, path: string): any =>
  o.root.flatten().find((n: any) => !n.isContainer && n.matlabPath === path);

/** The text a row shows in column `key`. */
export function shownCell(node: any, key: string): string {
  const cell = node?.toRow()?.[key];
  return cell && typeof cell === 'object' ? String(cell.text ?? cell.label ?? '') : String(cell ?? '');
}

/** The row at `path` as a table shows it: its Value and Class. */
export function shownRow(o: Opened, path: string): { Value: string; Class: string } | null {
  const node = nodeAt(o, path);
  return node ? { Value: shownCell(node, 'Value'), Class: shownCell(node, 'Class') } : null;
}

/** What the value at `path` is: its class (a complex one's own), size, complexity and the text it shows. */
export function valueAt(o: Opened, path: string): { cls: string; dims: number[]; complex: boolean; shown: string | undefined } {
  const n = nodeAt(o, path);
  const complex = n._isComplexValue();
  return { cls: complex ? n._complexClass() : n.className, dims: n.dims, complex, shown: shownRow(o, path)?.Value };
}

/** `text` typed into column `key` of the row at `path`, as a host's editor commits it. */
export function typeInto(o: Opened, path: string, key: string, text: string): unknown {
  const node = nodeAt(o, path);
  if (!node) throw new Error(`no node at ${path}`);
  o.session.setActive(o.root, node);
  return o.session.editProperty(node.id, key, text, shownCell(node, key));
}

/** Add on the row at `path`: the new child, or null where it is refused. */
export function addTo(o: Opened, path: string): any {
  const node = nodeAt(o, path);
  if (!node) throw new Error(`no node at ${path}`);
  return o.session.addChildTo(node.id);
}

/** The session's undo, and redo, of the last edit. */
export function undo(o: Opened): void {
  o.session.setActive(o.root, null);
  o.session.undo();
}

export function redo(o: Opened): void {
  o.session.setActive(o.root, null);
  o.session.redo();
}

/** What a save writes. */
export function saved(o: Opened): Uint8Array {
  const out = o.session.serializeSource(o.root.name);
  return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
}

/** What a save writes, opened again. */
export const reopened = (o: Opened): Opened => openBytes(o.format, saved(o));
