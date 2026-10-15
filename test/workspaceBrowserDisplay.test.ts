// Copyright 2026 The MathWorks, Inc.
//
// The Value and Class columns against MATLAB's Workspace browser, the authority the
// 2026-10-15 display ruling names ("follow matlab style for Value display and Class
// display"). The expected texts are MATLAB's own, read from what the browser's column code
// (ClassCol, ValueCol, ObjectValueSummary) answered for the same values in R2027a
// (test/fixtures/display/browser_short.truth.json), wherever this package's spelling of a
// text is MATLAB's. The values are read from the files MATLAB wrote them into
// (dispcat.mat, dispcat_text.sldd, dispcat_bin.sldd), by test/parity/matlab/probe_display.m.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { regenerateEntryXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const here = (name: string): string => fileURLToPath(new URL(`./fixtures/display/${name}`, import.meta.url));
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(here(name)));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const chunkOf = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)['data/chunk0.xml']);

interface BrowserRow { Name: string; Size: string; Class: string; Value: string; IsSummary: boolean }
interface MetaEntry { name: string; class: string; size: number[]; isreal: boolean; issparse: boolean; paramValue: unknown }

const BROWSER = new Map((JSON.parse(readFileSync(here('browser_short.truth.json'), 'utf8')) as BrowserRow[]).map((r) => [r.Name, r]));
const META = new Map((JSON.parse(readFileSync(here('meta.truth.json'), 'utf8')).entries as MetaEntry[]).map((e) => [e.name, e]));

/** MATLAB's row for `name`: what the Workspace browser shows. */
function browser(name: string): BrowserRow {
  const row = BROWSER.get(name);
  expect(row, `${name} is in the truth`).toBeDefined();
  return row!;
}

/** What MATLAB's class(), size() and isreal() say `name` is. */
function meta(name: string): MetaEntry {
  const m = META.get(name);
  expect(m, `${name} is in the truth`).toBeDefined();
  return m!;
}

function open(file: string): { session: any; root: any } {
  const session = createSession();
  const root: any = ingest(session, buffer(bytes(file)), { filename: file });
  return { session, root };
}

/** The entry (or .mat variable) called `name`, wherever its section put it. */
function entry(root: any, name: string): any {
  const found: any[] = [];
  const walk = (n: any): void => {
    if (n !== root && n.name === name && (n.isEntry || n.parent === root)) {
      found.push(n);
    }
    if (!n.isEntry) {
      (n.children || []).forEach(walk);
    }
  };
  walk(root);
  expect(found.length, `${name} in ${root.name}`).toBe(1);
  return found[0];
}

// C-040. MATLAB writes a complex empty into a binary dictionary as a property with no text,
// `<P Name="Value" Class="int16" IsComplex="1" Dimension="1*0"/>`, and it was read as the
// char '' (MatlabVariableNode.parseCdata's char arm), class char. The browser shows `[ ]`,
// as it shows every numeric empty.
describe("a binary dictionary's complex empty is the empty it is", () => {
  const COMPLEX_EMPTY = ['dx_complex_0x0', 'dx_complex_1x0', 'dx_complex_int16_1x0', 'e_single_complex_1x0'];

  for (const name of COMPLEX_EMPTY) {
    it(name, () => {
      const { root } = open('dispcat_bin.sldd');
      const m = meta(name);
      expect([m.isreal, m.size.includes(0)], 'MATLAB holds a complex empty').toEqual([false, true]);
      const node = entry(root, name);
      expect(node.toRow().Value).toBe(browser(name).Value);
      expect([node.className, node.dims, node.children.length]).toEqual([m.class, m.size, 0]);
    });
  }

  it("dx_param_complex_1x0: a Parameter's complex empty Value shows the same", () => {
    // The Parameter's own row is its Value (H1 of the display study, not ruled), and its
    // Value is MATLAB's complex(zeros(1,0)), shown as dx_complex_1x0 is.
    const { root } = open('dispcat_bin.sldd');
    expect(meta('dx_param_complex_1x0').paramValue).toMatchObject({ class: 'double', size: [1, 0], isreal: false });
    const param = entry(root, 'dx_param_complex_1x0');
    expect(param.toRow().Value).toBe(browser('dx_complex_1x0').Value);
  });

  it('written back as MATLAB wrote it, untouched and rebuilt from the model', () => {
    const { session, root } = open('dispcat_bin.sldd');
    const matlab = chunkOf(bytes('dispcat_bin.sldd'));
    expect(chunkOf(session.serializeSource(root.name).bytes)).toBe(matlab);
    for (const name of COMPLEX_EMPTY) {
      const tag = new RegExp(`<P Name="Name" Class="char">${name}</P>[\\s\\S]*?(<P Name="Value"[^>]*/>)`).exec(matlab)![1];
      expect(tag, name).toContain('IsComplex="1"');
      expect(regenerateEntryXml(entry(root, name)), name).toContain(tag);
    }
  });
});
