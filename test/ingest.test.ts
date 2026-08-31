// test/ingest.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../src/index.js';

function bytes(name: string): ArrayBuffer {
  const p = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
function text(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

describe('ingest() — sniff and dispatch', () => {
  it('textual .sldd string → data source', () => {
    const s = createSession();
    const node = ingest(s, text('object_array_text.sldd'), { filename: 'object_array_text.sldd' });
    expect(node).toBeTruthy();
    expect(s.getDataSourceCount()).toBe(1);
    expect(node.flatten().length).toBeGreaterThan(0);
  });

  it('textual .sldd as parsed object → data source', () => {
    const s = createSession();
    const obj = JSON.parse(text('numeric_json.sldd'));
    const node = ingest(s, obj, { filename: 'numeric_json.sldd' });
    expect(s.getDataSource(node.name)).toBe(node);
  });

  it('.slx ArrayBuffer → model source', () => {
    const s = createSession();
    const node = ingest(s, bytes('model_with_refs.slx'), { filename: 'model_with_refs.slx' });
    expect(node.flatten().length).toBeGreaterThan(0);
  });

  it('binary .sldd ArrayBuffer → data source', () => {
    const s = createSession();
    const node = ingest(s, bytes('object_array_binary.sldd'), { filename: 'object_array_binary.sldd' });
    expect(node.flatten().length).toBeGreaterThan(0);
  });

  it('.mat ArrayBuffer → mat source', () => {
    const s = createSession();
    const node = ingest(s, bytes('mcos/Numeric.mat'), { filename: 'Numeric.mat' });
    expect(node.flatten().length).toBeGreaterThan(0);
  });

  it('unknown extension throws', () => {
    const s = createSession();
    expect(() => ingest(s, 'x', { filename: 'foo.txt' })).toThrow(/unsupported/i);
  });
});
