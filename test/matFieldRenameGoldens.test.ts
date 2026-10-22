// Copyright 2026 The MathWorks, Inc.
//
// The struct field rename live gate, held byte for byte: test/fixtures/mat-field-rename/cases.json.
// Each case is a file core saved after a user renamed fields of the structs MATLAB R2023b or R2027a
// wrote into a -v7 or a -v6 file (a field of a struct, of a nested one, of a struct array in every
// element, a field holding an object, one renamed and then edited, a name of 63 characters, a
// rename undone), all through the session as a host makes them. MATLAB loaded each saved file in
// R2027a, R2023b and R2024b (each case's `verdicts`) with no warning its original does not give,
// every renamed variable equal to the original with MATLAB's own rename of the same fields, each
// field in its place, every other variable equal to its original, each variable alone equal, and a
// save of what it loaded reloading equal. Its negative control, a file whose rename the gate is
// told is another, was caught in each. Here the same steps must save that file again, byte for byte.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

const TEST = fileURLToPath(new URL('.', import.meta.url));

interface GateCase {
  name: string;
  original: string;
  sha256: string;
  verdicts: Record<string, 'PASS' | 'CAUGHT'>;
}
const DOC = JSON.parse(readFileSync(TEST + 'fixtures/mat-field-rename/cases.json', 'utf8')) as { cases: GateCase[] };

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function opened(path: string) {
  const b = readFileSync(TEST + path);
  const session = createSession();
  const root: any = session.addMatSource('f.mat', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const flat = (n: any, acc: any[] = []): any[] => (acc.push(n), n.children.forEach((c: any) => flat(c, acc)), acc);
  const prop = (path: string, key: string, value: string) => {
    const node = flat(root).find((n) => n !== root && n.matlabPath === path);
    expect(node, path).toBeDefined();
    session.setActive(root, node);
    expect(session.editProperty(node.id, key, value), `${path} ${key} = ${value}`).toBe(true);
  };
  const rename = (path: string, name: string) => prop(path, 'Name', name);
  const save = (): Uint8Array => (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;
  return { session, prop, rename, save };
}
type Opened = ReturnType<typeof opened>;

const LONG = 'f' + 'x'.repeat(61) + 'z';

// Each case's steps, by the name before its `__`.
const STEPS: Record<string, (o: Opened) => void> = {
  s_first: (o) => o.rename('s.a', 'alpha'),
  n_deep: (o) => {
    o.rename('n.inner.y.z', 'zed');
    o.rename('n.inner', 'in2');
  },
  // In one element of a struct array, and so in each.
  sa_b: (o) => o.rename('sa(2).b', 'beta'),
  sm_v: (o) => o.rename('sm(2,1).v', 'w'),
  // A field holding a Simulink.Parameter, and one holding a Signal in a nested struct.
  so_obj: (o) => {
    o.rename('so.p', 'param');
    o.rename('so.sub.q', 'sig');
  },
  so_plain: (o) => o.rename('so.k', 'kk'),
  edit_after: (o) => {
    o.rename('s.b', 'bee');
    o.prop('s.bee', 'Value', "'new'");
    o.rename('n.top', 't2');
    o.prop('n.t2', 'Value', '5');
  },
  long: (o) => o.rename('s.c', LONG),
  undo_mix: (o) => {
    o.rename('s.a', 'q');
    o.rename('sa(1).a', 'aa');
    o.session.undo();
  },
  all: (o) => {
    o.rename('s.d', 'dd');
    o.rename('n.inner.x', 'xx');
    o.rename('sa(1).a', 'a1');
    o.rename('sm(1,1).v', 'vv');
    o.rename('so.bus', 'b2');
  },
  // The negative control: the file is core's rename of s.a to alpha; the gate was told beta.
  ctl_wrong_name: (o) => o.rename('s.a', 'alpha'),
};

describe('each file the struct field rename gate judged saves again, byte for byte', () => {
  it('covers every case of the gate, each passed in every release it ran in, and its control caught', () => {
    expect(DOC.cases).toHaveLength(41);
    for (const c of DOC.cases) {
      expect(STEPS[c.name.split('__')[0]], c.name).toBeDefined();
      expect(c.original, c.name).toBe('fixtures/mat-field-rename/targets/' + c.name.split('__')[1] + '.mat');
      const verdict = c.name.startsWith('ctl_') ? 'CAUGHT' : 'PASS';
      expect(c.verdicts, c.name).toEqual({ R2027a: verdict, R2023b: verdict, R2024b: verdict });
    }
  });

  for (const c of DOC.cases) {
    it(c.name, () => {
      const o = opened(c.original);
      STEPS[c.name.split('__')[0]](o);
      expect(sha(o.save())).toBe(c.sha256);
    });
  }
});
