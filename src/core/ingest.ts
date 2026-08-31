// src/core/ingest.ts
// Copyright 2026 The MathWorks, Inc.
//
// Universal ingest: take any supported file's content (bytes, text, or a parsed
// object) plus its filename, sniff the type, and dispatch to the right session
// source-adder. Environment-independent — NO fs. The `path -> bytes` step lives
// in the Node-only `src/node/` subpath; this layer never touches the filesystem.

import { unzipSync, strFromU8 } from 'fflate';
import { parseBinarySldd } from '../datamodel/parser/BinarySlddParser.js';
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

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot).toLowerCase();
}

// True when these bytes open a JSON object, ignoring a leading UTF-8 BOM and any
// leading whitespace. A binary .sldd is a zip, which starts with 'PK', so the
// first significant byte cleanly separates the two textual/binary .sldd forms.
function isJsonText(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3; // UTF-8 BOM
  }
  while (i < bytes.length) {
    const b = bytes[i];
    // space, tab, LF, CR, FF, VT
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0c || b === 0x0b) {
      i++;
      continue;
    }
    return b === 0x7b /* '{' */;
  }
  return false;
}

export function ingest(session: Session, content: IngestContent, opts: IngestOptions): ISourceNode {
  const { filename, meta } = opts;
  const id = filename.replace(/^.*[\\/]/, ''); // basename, no fs
  const ext = extOf(filename);

  if (ext === '.sldd') {
    // Already-parsed object → textual data source directly.
    if (typeof content === 'object' && !(content instanceof ArrayBuffer) && !(content instanceof Uint8Array)) {
      return session.addDataSource(id, content as Record<string, unknown>, meta);
    }
    // String → textual .sldd JSON.
    if (typeof content === 'string') {
      return session.addDataSource(id, JSON.parse(content), meta);
    }
    // Bytes → JSON text if it looks like JSON, else binary .sldd (zip). A textual
    // .sldd may legitimately lead with a UTF-8 BOM and/or whitespace, so skip
    // those before sniffing for '{' — otherwise such a file is misrouted to the
    // zip parser and fails with a misleading "invalid zip data".
    const buf = toArrayBuffer(content);
    const bytes = new Uint8Array(buf);
    if (isJsonText(bytes)) {
      return session.addDataSource(id, JSON.parse(strFromU8(bytes)), meta);
    }
    return session.addDataSource(id, parseBinarySldd(buf), meta);
  }

  if (ext === '.slx') {
    return session.addModelSource(id, requireBinary(content, ext), meta);
  }

  if (ext === '.mat') {
    return session.addMatSource(id, requireBinary(content, ext), meta);
  }

  if (ext === '.prj') {
    const entries = unzipSync(new Uint8Array(requireBinary(content, ext)));
    const files: Record<string, string> = {};
    for (const [name, bytesU8] of Object.entries(entries)) files[name] = strFromU8(bytesU8);
    return session.addProjectSource(id, files, meta);
  }

  throw new Error(`ingest: unsupported extension "${ext}" for "${filename}" (expected .sldd/.slx/.mat/.prj)`);
}
