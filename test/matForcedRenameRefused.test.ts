// Copyright 2026 The MathWorks, Inc.
//
// A rename the session refuses is one the save refuses, in the same words: the rename forced
// around the session (the node's name set and marked, as matEditGate.test.ts forces one), the save
// throws a MatWriteError naming the variable by its new name, saying why as the session said it,
// and writes nothing. The fixture sweep of matEditGate.test.ts forces renames to names MATLAB
// takes, of records MATLAB wrote; these are the two refusals it meets none of:
//
//   - a name MATLAB cannot load (MatFileWriter.refuseName, by the rule a rename is held to,
//     matlabName.validateMatlabName), of a variable read from the file, of one added since and
//     written fresh, and of one created as an object since, written as the element naming it;
//   - a record holding bytes past its element (MatFileWriter.renameWhy), which has no element of
//     its own a new name can be put in.

import { describe, it, expect } from 'vitest';
import { zlibSync } from 'fflate';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { serializeMatFile } from '../src/datamodel/parser/MatFileWriter.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { createSession } from '../src/index.js';
import { CLASS, matFile, numericVar, u32le } from './tools/matBytes.js';

const scalar = (name: string, value: number) => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [value] });

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function opened(bytes: ArrayBuffer) {
  const session = createSession();
  const root: any = session.addMatSource('f.mat', bytes);
  const rename = (node: any, name: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, 'Name', name);
  };
  return { session, root, rename };
}

/** `node` renamed to `name` around the session, as a rename that asked no gate would leave it. */
function forceRename(node: any, name: string): void {
  node.name = name;
  node._markModified('name');
}

/** The save's refusal of `root`, which it must refuse with a MatWriteError. */
function refusalOf(root: any): string {
  try {
    serializeMatFile(root);
  } catch (e) {
    expect(e).toBeInstanceOf(MatWriteError);
    return (e as Error).message;
  }
  throw new Error('the save wrote the file');
}

// What the session's rename says of each name, which is matlabName's rule.
const INVALID: [string, string][] = [
  ['1bad', 'Invalid MATLAB name. Must start with a letter and contain only letters, digits, and underscores'],
  ['a b', 'Invalid MATLAB name. Must start with a letter and contain only letters, digits, and underscores'],
  ['end', "'end' is a reserved MATLAB keyword"],
  ['x'.repeat(64), 'Name exceeds maximum length of 63 characters'],
];

describe('a name MATLAB cannot load: refused by the rename, and by the save of one forced around it', () => {
  for (const [name, why] of INVALID) {
    it(JSON.stringify(name.length > 20 ? name.slice(0, 8) + '...' : name), () => {
      const bytes = matFile([scalar('a', 1), scalar('b', 2)]);
      const { root, rename } = opened(bytes);
      const node = root.children[0];
      expect(rename(node, name)).toEqual({ error: true, reason: why, invalidValue: name, validValue: 'a' });
      expect([node.name, root.dirty]).toEqual(['a', false]);
      // Forced around it, the save says the same, naming the variable by the name it would write.
      forceRename(node, name);
      expect(refusalOf(root)).toBe('Cannot write "' + name + '": it is not a name MATLAB can load (' + why + '). Nothing was written.');
    });
  }

  it('of a variable added since the read, refused as it is added, and at the save when renamed so', () => {
    const { root } = opened(matFile([scalar('a', 1)]));
    const [name, why] = INVALID[0];
    expect(root.execAddEntry(undefined, name)).toBeNull();
    expect(root.addEntryRefusal()).toBe('Cannot add a variable to "f.mat": \'' + name + "' is not a name MATLAB can load (" + why + ').');
    const added = root.execAddEntry(undefined, 'x');
    expect(added.node.name).toBe('x');
    added.node.name = name;
    expect(refusalOf(root)).toBe('Cannot write "' + name + '": it is not a name MATLAB can load (' + why + '). Nothing was written.');
    // Named again as MATLAB can load it, it is written.
    added.node.name = 'x';
    expect(parseMat(arrayBufferOf(serializeMatFile(root))).variables.map((v) => v.name)).toEqual(['a', 'x']);
  });

  it('of a variable created as an object since the read, which a save writes as the element naming it', () => {
    const { root } = opened(matFile([scalar('a', 1)]));
    const created = root.execAddEntry('Simulink.Parameter', 'p');
    expect(created?.node.name).toBe('p');
    const [name, why] = INVALID[2];
    created.node.name = name;
    expect(refusalOf(root)).toBe('Cannot write "' + name + '": it is not a name MATLAB can load (' + why + '). Nothing was written.');
    created.node.name = 'p';
    const back = parseMat(arrayBufferOf(serializeMatFile(root)));
    expect(back.variables.map((v) => [v.name, v.className])).toEqual([['a', 'double'], ['p', 'Simulink.Parameter'], ['', expect.any(String)]]);
  });
});

describe('a record holding bytes past its element: refused by the rename, and by the save of one forced around it', () => {
  it('in the same words, and its value is still written', () => {
    // A compressed record whose stream inflates to the element and 8 bytes more: the reader reads
    // the element, and a save has no element of the record's own to put a new name in.
    const stream = zlibSync(new Uint8Array([...scalar('a', 1), ...new Uint8Array(8)]));
    const record = new Uint8Array([...u32le(15), ...u32le(stream.length), ...stream]);
    const bytes = matFile([record, scalar('b', 2)]);
    const why = 'the record it was read from, at byte 128, is not a whole element whose name can be replaced, so it cannot be renamed';

    const { root, rename } = opened(bytes);
    const node = root.children[0];
    expect(rename(node, 'a2')).toEqual({ error: true, reason: 'Cannot edit "a": ' + why + '.', invalidValue: 'a2', validValue: 'a' });
    expect(root._renameRefusal(node)).toBe('Cannot edit "a": ' + why + '.');
    forceRename(node, 'a2');
    expect(refusalOf(root)).toBe('Cannot write "a2": ' + why + '. Nothing was written.');

    // Its name as read, and its value edited, it is written fresh: a whole element of its own.
    const again = opened(bytes);
    const a = again.root.children[0];
    again.session.setActive(again.root, a);
    expect(again.session.editProperty(a.id, 'Value', '5')).toBe(true);
    const out = again.session.serializeSource('f.mat') as { bytes: Uint8Array };
    expect(parseMat(arrayBufferOf(out.bytes)).variables.map((v) => [v.name, v.value])).toEqual([['a', 5], ['b', 2]]);
  });
});
