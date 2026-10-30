// Copyright 2026 The MathWorks, Inc.
//
// A binary dictionary's package as an editor that keeps it holds it: the data part decoded, and every
// other member as the bytes it was read as (the pass-through bag), to be zipped back around the data
// part on a save.
//
// Lifted from data-explorer-vscode src/host/BinarySlddEditorProvider.ts at c73da3c, which keeps its own
// until it adopts this (view-split step 6b): the read is readDisk's (:264-266), `chunkOf` (:273-277)
// and `passThroughParts` (:242-246); the write is writeTo's zip (:1793-1795). fflate is the same
// 0.8.3 there. The functions are the provider's, unchanged; what is new is their names here.
//
// Not core's own reader. parseBinarySldd (BinarySlddParser) reads a package through Inflate's
// unzipEntries, which leaves a member it cannot inflate out with a warning and reads the
// dictionary whole; this is fflate's unzipSync, which throws on such a member, and hands back the
// chunk's text and the bag, which is what an editor keeps between saves.

import { unzipSync, zipSync } from 'fflate';
import { DATA_PART_XML } from './SlddParts.js';

/** A binary dictionary's package, read: its data part decoded, and every other member's bytes. */
export interface BinarySlddPackage {
  /** The dictionary's data part, decoded (vscode's `chunkOf`). */
  chunkXml: string;
  /** Every other member (vscode's `passThroughParts`). */
  parts: Record<string, Uint8Array>;
}

/**
 * Read a binary dictionary's bytes into the data part's text and the other members: what vscode's
 * binary editor holds of a file it opens, reverts or reloads (readDisk). A zip with no data part is
 * refused, as there: `Missing data/chunk0.xml in binary SLDD`. A file that is no zip throws fflate's
 * own error.
 */
export function readBinarySlddPackage(bytes: Uint8Array): BinarySlddPackage {
  const zip = unzipSync(bytes);
  return { chunkXml: chunkOf(zip), parts: passThroughParts(zip) };
}

/**
 * The package's bytes for `chunkXml` around the pass-through `parts`, as vscode's binary editor
 * writes a save (`level` 6) or a hot-exit backup (`level` 1): the parts in their own order, the data
 * part last, zipped by fflate with the options given and its own defaults otherwise (each member
 * stamped with the time of the write).
 */
export function writeBinarySlddPackage(chunkXml: string, parts: Record<string, Uint8Array>, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): Uint8Array {
  const zipEntries: Record<string, Uint8Array> = { ...parts, [DATA_PART_XML]: new TextEncoder().encode(chunkXml) };
  return zipSync(zipEntries, { level });
}

/**
 * Every member of the package but the data part, the bag a save zips back around it.
 *
 * Kept out of the bag because the data part is held as text and re-inserted on the write: a bag that
 * held it too would hold a second copy of the whole payload for as long as the document is open.
 */
function passThroughParts(zip: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const parts: Record<string, Uint8Array> = {};
  for (const [member, data] of Object.entries(zip)) if (member !== DATA_PART_XML) parts[member] = data;
  return parts;
}

/**
 * The data part of a dictionary's zip, decoded, or a refusal: the one rule by which an open and
 * every read that replaces an open document tell a dictionary from a zip that holds none.
 */
function chunkOf(zip: Record<string, Uint8Array>): string {
  const chunk = zip[DATA_PART_XML];
  if (!chunk) throw new Error(`Missing ${DATA_PART_XML} in binary SLDD`);
  return new TextDecoder().decode(chunk);
}
