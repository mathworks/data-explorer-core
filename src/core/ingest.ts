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
    // Bytes → JSON text if it parses (leading '{'), else binary .sldd (zip).
    const buf = toArrayBuffer(content);
    const head = new Uint8Array(buf.slice(0, 1))[0];
    if (head === 0x7b /* '{' */) {
      const str = strFromU8(new Uint8Array(buf));
      return session.addDataSource(id, JSON.parse(str), meta);
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
