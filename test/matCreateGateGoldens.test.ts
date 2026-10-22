// Copyright 2026 The MathWorks, Inc.
//
// The creation live gate, held byte for byte: test/fixtures/mat-create-gate/cases.json. Each case
// is a file core saved after a user created variables of every class it offers, edited every row a
// new object's node offers, added and removed a Bus's elements, deleted new variables (some made
// between others it kept and edited after), and edited objects the file held, all through the
// session as a host makes them; and MATLAB loaded each
// saved file in R2027a, R2023b and R2024b (each case's `verdicts`) with no warning its original
// does not give, every new variable equal to MATLAB's own object of its class with the same edits,
// every edited one equal to its original with them, every other one equal to its original, each
// variable alone equal, and a save of what it loaded reloading equal. Here the same steps must
// save that file again, byte for byte.
//
// Of the files whose original is cases.mat, written by MATLAB R2027a and holding a LookupTable,
// R2023b and R2024b ran every check but the last ('PASS_NO_RESAVE'): each of them crashes on a save
// of what it loads of that original, untouched, and a load of that save.

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
  verdicts: Record<string, 'PASS' | 'PASS_NO_RESAVE'>;
}
const DOC = JSON.parse(readFileSync(TEST + 'fixtures/mat-create-gate/cases.json', 'utf8')) as { cases: GateCase[] };

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function opened(path: string) {
  const b = readFileSync(TEST + path);
  const session = createSession();
  const root: any = session.addMatSource('f.mat', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const by = (name: string): any => root.children.find((c: any) => c.name === name);
  const edit = (node: any, prop: string, value: string) => {
    session.setActive(root, node);
    expect(session.editProperty(node.id, prop, value), `${node.matlabPath} ${prop} = ${value}`).toBe(true);
  };
  const add = (cls: string, name: string): any => {
    session.setActiveContext(root);
    const node = session.addEntry('', cls, name);
    expect(node, cls).not.toBeNull();
    return node;
  };
  const addElement = (bus: any): any => {
    const row = session.addChildTo(bus.id);
    expect(row, bus.name).not.toBeNull();
    return row;
  };
  const remove = (node: any) => {
    session.setActive(root, node);
    expect(session.deleteNodeById(node.id), node.matlabPath).toBe(true);
  };
  const save = (): Uint8Array => (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;
  return { by, edit, add, addElement, remove, save };
}
type Opened = ReturnType<typeof opened>;

// Every class a MAT-file creates an object of (MAT_CREATABLE_CLASSES).
const CLASSES = ['Simulink.Parameter', 'Simulink.Signal', 'Simulink.Bus', 'Simulink.NumericType', 'Simulink.AliasType', 'Simulink.ValueType', 'string'];

// Every row each new object's node offers, edited.
const EDITED: Record<string, (o: Opened, n: any) => void> = {
  'Simulink.Parameter': (o, n) => {
    for (const [k, v] of [['Value', '[1 2; 3 4]'], ['Min', '-1'], ['Max', '9'], ['Unit', 'm'], ['Description', 'a parameter'], ['storageClass', 'ExportedGlobal']]) o.edit(n, k, v);
  },
  'Simulink.Signal': (o, n) => {
    for (const [k, v] of [['DataType', 'single'], ['Min', '-2'], ['Max', '2'], ['Unit', 'V'], ['Description', 'a signal'], ['complexity', 'complex'], ['dimensionsMode', 'Variable'], ['storageClass', 'ImportedExtern']]) o.edit(n, k, v);
  },
  'Simulink.Bus': (o, n) => {
    o.edit(n, 'Description', 'a bus');
    o.addElement(n);
    const e = o.addElement(n);
    for (const [k, v] of [['Name', 'x'], ['DataType', 'int16'], ['Min', '-1'], ['Max', '9'], ['Unit', 'V'], ['Description', 'element x'], ['complexity', 'complex'], ['dimensionsMode', 'Variable']]) o.edit(e, k, v);
  },
  'Simulink.NumericType': (o, n) => o.edit(n, 'Description', 'a numeric type'),
  'Simulink.AliasType': (o, n) => {
    o.edit(n, 'BaseType', 'int16');
    o.edit(n, 'Description', 'an alias');
  },
  'Simulink.ValueType': (o, n) => {
    for (const [k, v] of [['DataType', 'int8'], ['Min', '-3'], ['Max', '3'], ['Unit', 'A'], ['Description', 'a value type'], ['complexity', 'complex'], ['dimensionsMode', 'Variable']]) o.edit(n, k, v);
  },
  string: (o, n) => o.edit(n, 'Value', '"hello 温度"'),
};

const TARGETS: Record<string, string> = {
  r2023b_none: 'fixtures/mcos-templates/targets/r2023b/none.mat',
  r2023b_param: 'fixtures/mcos-templates/targets/r2023b/param.mat',
  r2023b_mixed: 'fixtures/mcos-templates/targets/r2023b/mixed.mat',
  r2023b_bus2: 'fixtures/mcos-templates/targets/r2023b/bus2.mat',
  r2027a_none: 'fixtures/mcos-templates/targets/r2027a/none.mat',
  r2027a_param: 'fixtures/mcos-templates/targets/r2027a/param.mat',
  r2027a_mixed: 'fixtures/mcos-templates/targets/r2027a/mixed.mat',
  r2027a_bus2: 'fixtures/mcos-templates/targets/r2027a/bus2.mat',
  cases: 'parity/artifacts/mat/cases.mat',
};

// Each case's steps, by the name before its `__`.
const STEPS: Record<string, (o: Opened) => void> = {
  // One of every class, as created, and a plain variable and a struct.
  all_default: (o) => {
    CLASSES.forEach((cls, i) => o.add(cls, 'n' + i));
    o.add('MatlabVariable', 'nvar');
    o.add('MatlabStruct', 'nstruct');
  },
  all_edited: (o) =>
    CLASSES.forEach((cls, i) => {
      const node = o.add(cls, 'e' + i);
      EDITED[cls]?.(o, node);
    }),
  // A Bus the file holds: an element added and edited, and its first removed.
  bus_add_remove: (o) => {
    const bb = o.by('bb');
    const e = o.addElement(bb);
    o.edit(e, 'Name', 'z');
    o.edit(e, 'DataType', 'uint8');
    o.edit(e, 'Description', 'added');
    o.remove(bb.children[0]);
  },
  // Elements added to and removed from a Bus the file holds, new objects, and edits of others it holds.
  mixed_edits: (o) => {
    const b0 = o.by('b0');
    o.addElement(b0);
    o.addElement(b0);
    o.remove(b0.children[0]);
    o.edit(o.add('Simulink.Parameter', 'pnew'), 'Value', '5');
    o.edit(o.by('p1'), 'Value', '-2');
    o.edit(o.by('sig0'), 'Min', '-1');
    o.addElement(o.add('Simulink.Bus', 'bnew'));
    o.edit(o.add('string', 'snew'), 'Value', '"s"');
  },
  // Every element of a Bus removed; a new variable deleted beside one kept; a variable deleted.
  bus_emptied: (o) => {
    const bb = o.by('bb');
    for (const c of [...bb.children]) o.remove(c);
    const gone = o.add('Simulink.Signal', 'gone');
    o.add('string', 'kept');
    o.remove(gone);
    o.remove(o.by('x'));
  },
  // New objects made around two deleted, edited before and after the deletes: the creations
  // rebuilt without them (MatNode._liveCreation), which writes the file a session that never made
  // them writes (below).
  rebuild_mix: (o) => {
    o.edit(o.add('Simulink.Parameter', 'g0'), 'Value', '7');
    const bk = rebuiltBus(o);
    const g1 = o.add('Simulink.Signal', 'g1');
    const vt = o.add('Simulink.ValueType', 'vt');
    o.edit(vt, 'DataType', 'int8');
    o.edit(o.add('string', 'sk'), 'Value', '"k"');
    o.remove(o.by('g0'));
    o.remove(g1);
    o.edit(vt, 'Description', 'after');
    o.edit(bk.children[0], 'DataType', 'uint16');
    o.edit(o.add('Simulink.Parameter', 'pk'), 'Value', '3');
  },
};

// rebuild_mix's Bus, two elements added and the second renamed.
function rebuiltBus(o: Opened): any {
  const bk = o.add('Simulink.Bus', 'bk');
  o.addElement(bk);
  o.edit(o.addElement(bk), 'Name', 'y');
  return bk;
}

describe('each file the creation gate judged saves again, byte for byte', () => {
  it('covers every case of the gate, each passed in every release it ran in', () => {
    expect(DOC.cases).toHaveLength(22);
    for (const c of DOC.cases) {
      expect(STEPS[c.name.split('__')[0]], c.name).toBeDefined();
      expect(TARGETS[c.name.split('__')[1]], c.name).toBe(c.original);
      expect(Object.keys(c.verdicts).sort(), c.name).toEqual(['R2023b', 'R2024b', 'R2027a']);
      const resaved = c.original !== TARGETS.cases;
      expect(Object.entries(c.verdicts).every(([r, v]) => v === (resaved || r === 'R2027a' ? 'PASS' : 'PASS_NO_RESAVE')), c.name).toBe(true);
    }
  });

  for (const c of DOC.cases) {
    it(c.name, () => {
      const o = opened(c.original);
      STEPS[c.name.split('__')[0]](o);
      expect(sha(o.save())).toBe(c.sha256);
    });
  }

  // So the file a session writes that never made the deleted ones is the one judged too.
  for (const c of DOC.cases.filter((x) => x.name.startsWith('rebuild_mix__'))) {
    it(c.name + ', made without the objects it deletes', () => {
      const o = opened(c.original);
      const bk = rebuiltBus(o);
      const vt = o.add('Simulink.ValueType', 'vt');
      o.edit(vt, 'DataType', 'int8');
      o.edit(o.add('string', 'sk'), 'Value', '"k"');
      o.edit(vt, 'Description', 'after');
      o.edit(bk.children[0], 'DataType', 'uint16');
      o.edit(o.add('Simulink.Parameter', 'pk'), 'Value', '3');
      expect(sha(o.save())).toBe(c.sha256);
    });
  }
});
