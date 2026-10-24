// Copyright 2026 The MathWorks, Inc.
//
// A paste into a MAT-file as a host makes one (session.pasteEntries, pasteRefusal): what it copies
// out of a source (each entry's serialize(), carried as the value it is, structuredClone, as the
// extension carries a clipboard payload), the MAT-files it pastes into, and what a paste is held to: the
// variable made reads back, saved and opened again, as the value that was copied.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../../src/index.js';
import { ingest } from '../../src/core/ingest.js';
import * as NodeRegistry from '../../src/datamodel/node/NodeRegistry.js';
import { matVariableOfNode } from '../../src/datamodel/node/container/matPaste.js';
import { variableDifference } from '../../src/datamodel/parser/MatFileWriter.js';
import '../../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The bytes of a fixture, by its path from the repo's root. */
export const fixture = (path: string): Uint8Array => new Uint8Array(readFileSync(ROOT + path));
export const bufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// The sources a paste copies from: a text and a binary dictionary, a MAT-file other than the one
// pasted into, and the MAT-file pasted into itself (MIXED, into a copy of itself).
export const TEXT_CASES = 'test/parity/artifacts/text/cases.sldd';
export const BINARY_CASES = 'test/parity/artifacts/binary/cases.sldd';
export const MAT_CASES = 'test/parity/artifacts/mat/cases.mat';
export const MIXED = 'test/fixtures/mcos-templates/targets/r2027a/mixed.mat';
export const NONE = 'test/fixtures/mcos-templates/targets/r2023b/none.mat';

/** What a host copies of an entry: its serialize() record, a clone of its own. */
export const copyOf = (entry: Any): Any => structuredClone(entry.serialize());

/** Every entry of a source, a dictionary's sections' or a MAT-file's variables, and its copy (null where the copy is refused). */
export function copiesOf(path: string): { file: string; entry: Any; payload: Any | null }[] {
  const root: Any = ingest(createSession(), fixture(path), { filename: path.split('/').pop()! });
  const entries: Any[] = root.constructor.name === 'MatNode' ? root.children : root.children.flatMap((s: Any) => s.children);
  return entries.map((entry) => {
    let payload: Any = null;
    try {
      payload = copyOf(entry);
    } catch {
      payload = null;
    }
    return { file: path, entry, payload };
  });
}

/** A MAT-file opened through a session, as a host opens one, its id 't.mat', and every event the session published. */
export function target(bytes: Uint8Array = fixture(MIXED)) {
  const session = createSession();
  const events: { topic: string; payload: Any }[] = [];
  for (const topic of ['node/added', 'node/deleted', 'node/children-changed', 'node/edited', 'undo/changed', 'active/changed'] as const) {
    session.bus.subscribe(topic, ((payload: Any) => events.push({ topic, payload })) as Any);
  }
  const root: Any = session.addMatSource('t.mat', bufferOf(bytes));
  // The file the host shows, so that the selection-driven forms (undo, canUndo) are of it.
  session.setActiveContext(root);
  events.length = 0;
  const save = (): Uint8Array => (session.serializeSource('t.mat') as { bytes: Uint8Array }).bytes;
  const by = (name: string): Any => root.children.find((c: Any) => c.name === name);
  return { session, root, events, save, by, original: bytes };
}

/** `bytes` opened again, in a session of its own. */
export function reopened(bytes: Uint8Array): Any {
  return createSession().addMatSource('again.mat', bufferOf(bytes));
}

/** Every row a node shows, by key and text: its table's columns and the rows its Property Inspector lays out; then each child's, in order. */
export function rowsOf(node: Any): string[] {
  const props = [...node.getProperties(), ...(node.getPILayout() ?? []).flatMap((g: Any) => g.items)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of props) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    out.push(p.key + ' = ' + node.getPropInfo(p).displayValue);
  }
  node.children.forEach((c: Any, i: number) => out.push(i + ' [' + rowsOf(c).join('; ') + ']'));
  return out;
}

/**
 * Where the value of `variable`, a variable read out of a MAT-file, is not the plain value `payload`
 * copied, compared as the variables a MAT reader hands over for each (matVariableOfNode), or null.
 */
export function plainDifference(payload: Any, variable: Any): string | null {
  const copied = matVariableOfNode(NodeRegistry.parseValue(payload.value, variable.name, null), variable.name);
  if ('why' in copied) {
    return 'the copy is no plain value: ' + copied.why;
  }
  return variableDifference(copied, variable._var, variable.name);
}

/** A string's value as its elements and size, whatever the spelling (a dictionary's `["a"]`, a MAT-file's String bag). */
export function stringValue(node: Any): string {
  return JSON.stringify([node.dims ?? node._dims, node._elements]);
}

/** The node a dictionary's reader makes of a copied value, named `name`. */
export const parsedCopy = (payload: Any, name: string): Any => NodeRegistry.parseValue(payload.value, name, null);
