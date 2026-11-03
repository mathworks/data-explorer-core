// Copyright 2026 The MathWorks, Inc.
// A MatNode need not be the root of its source. A model's Model Workspace is to be one, under the
// model, and every rule of a MAT-file's editor then applies to it as it does to a file: the edit
// rule BaseNode.sourceEditRefusal asks of the first container above an entry, and the session's
// paste, Add and delete. What differs is what it is under and what it is called: an edit marks the
// root's document dirty and is undone in it, the MatNode forgets what it found of the edited entry
// as a root MatNode does, a paste reaches it by its node id, and its refusals name it as it says
// (_saveLabel, _namespaceLabel, _noun).

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import MatNode from '../src/datamodel/node/container/MatNode.js';
import ContainerNode from '../src/datamodel/node/ContainerNode.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';

class ChildMat extends MatNode {
  get _noun(): string {
    return 'model workspace';
  }
  get _saveLabel(): string {
    return this.parent ? this.parent.name : this.name;
  }
  get _namespaceLabel(): string {
    return 'Model Workspace';
  }
}

// What a model will be to its workspace: the root of the document, dirty when it or the workspace is.
class Root extends ContainerNode {
  own = false;
  constructor(name: string) {
    super(name, null);
  }
  get dirty(): boolean {
    return this.own || (this.children[0] as MatNode | undefined)?.dirty === true;
  }
  set dirty(value: boolean) {
    this.own = value;
    const child = this.children[0] as MatNode | undefined;
    if (!value && child) {
      child.dirty = false;
    }
  }
  getSection(key: string): unknown {
    return this.children.find((c) => c.name === key) ?? null;
  }
}

function parsedCases(): ReturnType<typeof parseMat> {
  const b = readFileSync(fileURLToPath(new URL('./parity/artifacts/mat/cases.mat', import.meta.url)));
  return parseMat(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

function childSession(parsed = parsedCases()) {
  const root = new Root('m.slx');
  const child = MatNode._populate(new ChildMat('workspace'), parsed);
  root.addChild(child);
  const s = createSession();
  s.addParsedSource('m.slx', root as any);
  s.setActiveContext(root as any);
  return { s, root, child };
}

const variable = (child: MatNode, name: string): any => child.children.find((c) => c.name === name);

describe('a MatNode under another node', () => {
  it('builds the subclass it is handed, with the variables a root MatNode of the same parse has', () => {
    const { child } = childSession();
    const file = MatNode.fromParsed(parsedCases(), 'cases.mat');
    expect(child).toBeInstanceOf(ChildMat);
    expect(child.children.map((c) => c.name)).toEqual(file.children.map((c) => c.name));
    expect(child.readOnly).toBe(false);
  });

  it("takes an edit, marks the root's document dirty, files the undo there, and forgets what it found of the entry", () => {
    const { s, root, child } = childSession();
    const node = variable(child, 'scalarD');
    const before = node.displayValue;
    const forget = vi.spyOn(child, '_nodeEdited');
    s.setActive(root as any, node);
    expect(s.editProperty(node.id, 'Value', '7')).toBe(true);
    expect(node.displayValue).toBe('7');
    expect(forget).toHaveBeenCalledWith(node);
    expect(root.dirty).toBe(true);
    expect(s.canUndo()).toBe(true);
    s.undo();
    expect(node.displayValue).toBe(before);
  });

  it('takes a paste by its node id, as one undo step of the root', () => {
    const { s, root, child } = childSession();
    const payload = { name: 'pasted', metadata: null, value: 3 };
    expect(s.pasteRefusal(child.id, payload)).toBeNull();
    const made = s.pasteEntries(child.id, [payload]) as any;
    expect(made.error).toBeUndefined();
    expect(made.nodes.map((n: any) => n.name)).toEqual(['pasted']);
    expect(made.nodes[0].parent).toBe(child);
    expect(root.dirty).toBe(true);
    expect(s.canUndo()).toBe(true);
    s.undo();
    expect(variable(child, 'pasted')).toBeUndefined();
  });

  it('takes no paste where its root is no document this session edits', () => {
    const shown = new (class extends ContainerNode {
      constructor() {
        super('shown.prj', null);
      }
    })();
    const child = MatNode._populate(new ChildMat('workspace'), parsedCases());
    shown.addChild(child);
    const s = createSession();
    s.addParsedSource('shown.prj', shown as any);
    const payload = { name: 'pasted', metadata: null, value: 3 };
    const refusal = 'Cannot paste into "Model Workspace": it is in "shown.prj", which this editor shows but does not edit. Nothing was pasted.';
    expect(s.pasteRefusal(child.id, payload)).toBe(refusal);
    expect((s.pasteEntries(child.id, [payload]) as any).reason).toBe(refusal);
    expect(variable(child, 'pasted')).toBeUndefined();
  });

  it('names itself in the paste it refuses', () => {
    const { s, child } = childSession();
    const made = s.pasteEntries(child.id, [{ name: 'a', metadata: null, value: 1 }], { removeFirst: ['kp'] }) as any;
    expect(made.reason).toBe(
      'Cannot paste into "Model Workspace": a model workspace takes no entries out before a paste, as a move within it is no move. Nothing was pasted.',
    );
  });

  it('adds a variable through the section key of its root', () => {
    const { s, root, child } = childSession();
    const added = s.addEntry('workspace', '', 'fresh') as any;
    expect(added?.parent).toBe(child);
    expect(root.dirty).toBe(true);
    s.undo();
    expect(variable(child, 'fresh')).toBeUndefined();
  });

  it('deletes a variable, and puts it back on undo', () => {
    const { s, child } = childSession();
    const node = variable(child, 'kp');
    expect(s.deleteNodeById(node.id)).toBe(true);
    expect(variable(child, 'kp')).toBeUndefined();
    s.undo();
    expect(variable(child, 'kp')).toBe(node);
  });

  it('says it holds no node of another, by its own label', () => {
    const { child } = childSession();
    const other = MatNode.fromParsed(parsedCases(), 'cases.mat');
    expect(child.removeEntryRefusal(other.children[0])).toBe('"Model Workspace" holds no such variable');
  });

  it('names its save label in the refusal of a tree no save can write', () => {
    const parsed = parsedCases();
    const { s, root, child } = childSession({ header: parsed.header, variables: parsed.variables } as any);
    const node = variable(child, 'scalarD');
    expect(child.readOnly).toBe(true);
    s.setActive(root as any, node);
    const r = s.editProperty(node.id, 'Value', '7') as any;
    expect(r.reason).toMatch(/Cannot edit "m\.slx": it was opened without the records a save writes back/);
    expect(r.reason).not.toMatch(/"workspace"/);
  });

  it('refuses a class it creates no variable of, saying what it is', () => {
    const { s, child } = childSession();
    expect(s.addEntry('workspace', 'Simulink.Nothing')).toBeNull();
    expect(s.addEntryRefusal(child.id, 'Simulink.Nothing')).toMatch(/a model workspace takes a new variable of a plain value, a struct, or one of /);
  });
});
