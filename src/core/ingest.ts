// src/core/ingest.ts
// Copyright 2026 The MathWorks, Inc.
//
// Universal ingest: take any supported file's content (bytes, text, or a parsed
// object) plus its filename, sniff the type, and dispatch to the right session
// source-adder. Environment-independent — NO fs. The `path -> bytes` step lives
// in the Node-only `src/node/` subpath; this layer never touches the filesystem.

import { unzipSync, strFromU8 } from 'fflate';
import { basenameOf, extOf, isMatFile, isModelFile, isProjectFile, isSlddFile } from '../datamodel/fileKinds.js';
import { readSlddContent } from '../datamodel/parser/SlddContent.js';
import type { ParseWarning } from '../datamodel/parser/ParseWarning.js';
import type { Session } from './DataModel.js';
import type { ISourceNode, SourceMeta } from './NodeInterfaces.js';

export type IngestContent = ArrayBuffer | Uint8Array | string | Record<string, unknown>;

export interface IngestOptions {
  filename: string;
  meta?: Partial<SourceMeta>;
}

function toArrayBuffer(content: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (content instanceof ArrayBuffer) return content;
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
}

function requireBinary(content: IngestContent, ext: string): ArrayBuffer {
  if (content instanceof ArrayBuffer || content instanceof Uint8Array) return toArrayBuffer(content);
  throw new Error(`ingest: "${ext}" requires binary content (ArrayBuffer or Uint8Array), got ${typeof content}`);
}

export function ingest(session: Session, content: IngestContent, opts: IngestOptions): ISourceNode {
  const { filename, meta } = opts;
  const id = basenameOf(filename); // no fs
  // Only for the error messages below. The DISPATCH goes through the shared kind tests
  // (fileKinds), so `Params.SLDD` — which MATLAB and Windows both write — ingests as the
  // dictionary it is rather than falling through to "unsupported extension".
  const ext = extOf(filename);

  if (isSlddFile(filename)) {
    // Already-parsed object → textual data source directly.
    if (typeof content === 'object' && !(content instanceof ArrayBuffer) && !(content instanceof Uint8Array)) {
      return session.addDataSource(id, content as Record<string, unknown>, meta);
    }
    // String → textual .sldd JSON.
    if (typeof content === 'string') {
      return session.addDataSource(id, JSON.parse(content), meta);
    }
    // Bytes → whichever of the two on-disk `.sldd` formats they are, decided by
    // `readSlddContent` on the BYTES. Not decided here, and not decided by the name: both
    // formats carry the same extension, so a reader that guesses from the name reads a
    // compressed dictionary as JSON and fails with a misleading "invalid zip data".
    //
    // This is the one branch of this function that parses anything itself, and therefore
    // the one that has to carry a reader's diagnostics onward by hand: every other dispatch
    // hands raw content to a session adder that does its own parsing and collects its own
    // warnings inside. The sink is created here, filled in by the reader, and handed to
    // `addDataSource`, which appends the node layer's warnings to the SAME list before
    // attaching it to the source — so a host sees one list per file, whichever layer the
    // loss happened in.
    const warnings: ParseWarning[] = [];
    const parsed = readSlddContent(toArrayBuffer(content), warnings);
    return session.addDataSource(id, parsed, meta, warnings);
  }

  // Both model extensions go to the same adder: a `.mdl` is a Simulink model like a
  // `.slx` is, and which generation of content the bytes hold is decided there, not
  // by the name (see parseModel).
  if (isModelFile(filename)) {
    return session.addModelSource(id, requireBinary(content, ext), meta);
  }

  if (isMatFile(filename)) {
    return session.addMatSource(id, requireBinary(content, ext), meta);
  }

  if (isProjectFile(filename)) {
    const entries = unzipSync(new Uint8Array(requireBinary(content, ext)));
    const files: Record<string, string> = {};
    for (const [name, bytesU8] of Object.entries(entries)) files[name] = strFromU8(bytesU8);
    return session.addProjectSource(id, files, meta);
  }

  throw new Error(`ingest: unsupported extension "${ext}" for "${filename}" (expected .sldd/.slx/.mdl/.mat/.prj)`);
}
