// Copyright 2026 The MathWorks, Inc.
// Unit tests for MatNode — the root node of a .mat file. A .mat is a flat bag of
// workspace variables rather than a sectioned document, so MatNode's contract is
// deliberately narrow: it is read-only in the UI sense, reports no sections, and
// its add/remove entry commands must restore both membership AND position on undo
// so a round-trip write keeps variables in their original order.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

function bytes(name: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/mcos/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// Load a .mat through the public session API, which runs the real parser.
function matSource(name: string) {
  const s = createSession();
  return s.addMatSource(name, bytes(name)) as any;
}

describe('MatNode — presentation', () => {
  it('shows the filename and the workspace-file icon', () => {
    const mat = matSource('Param.mat');
    expect(mat.name).toBe('Param.mat');
    expect(mat.displayName).toBe('Param.mat');
    expect(mat.icon).toBe('matlabWorkspaceFile');
  });

  it('is read-only', () => {
    // A .mat carries no schema, so the UI never offers property edits on the root.
    expect(matSource('Param.mat').readOnly).toBe(true);
  });

  it('counts its variables as entries', () => {
    expect(matSource('Param.mat').NumberOfEntries).toBe(1);
    // Three named variables: two objects and a plain double.
    expect(matSource('object_props.mat').NumberOfEntries).toBe(3);
  });

  it('offers only Name, in a single General group', () => {
    const mat = matSource('Param.mat');
    expect(mat.getProperties().map((p: any) => p.key)).toEqual(['Name']);
    expect(mat.getPILayout()).toEqual([{ group: 'General', items: mat.getProperties() }]);
  });

  it('has no sections for any key', () => {
    // Unlike an .sldd or .slx root, a .mat has no Design/Other split, so callers
    // that ask for one must get null rather than a bogus container.
    const mat = matSource('Param.mat');
    expect(mat.getSection('design')).toBeNull();
    expect(mat.getSection('anything')).toBeNull();
  });

  it('keeps the MAT-file header text from the parser', () => {
    expect(matSource('Param.mat').header).toContain('MAT-file');
  });

  it('starts clean', () => {
    expect(matSource('Param.mat').dirty).toBe(false);
  });
});

describe('MatNode — _uniqueName', () => {
  it('returns the base name when nothing owns it', () => {
    expect(matSource('Param.mat')._uniqueName('var')).toBe('var');
  });

  it('appends the first free suffix when the base name is taken', () => {
    const mat = matSource('Param.mat');
    expect(mat._uniqueName('Param')).toBe('Param1');
  });

  it('skips over suffixes already in use', () => {
    const mat = matSource('Param.mat');
    mat.execAddEntry(undefined, 'Param1');
    mat.execAddEntry(undefined, 'Param2');
    expect(mat._uniqueName('Param')).toBe('Param3');
  });
});

describe('MatNode — execAddEntry', () => {
  it('adds a default double under the requested name and marks the file dirty', () => {
    const mat = matSource('Param.mat');
    const { node } = mat.execAddEntry(undefined, 'Kp');
    expect(node.name).toBe('Kp');
    expect(node.parent).toBe(mat);
    expect(mat.children).toContain(node);
    expect(mat.dirty).toBe(true);
  });

  it('generates a unique name when none is supplied', () => {
    const mat = matSource('Param.mat');
    expect(mat.execAddEntry().node.name).toBe('var');
    expect(mat.execAddEntry().node.name).toBe('var1');
  });

  it('undo removes the new variable; redo puts it back', () => {
    const mat = matSource('Param.mat');
    const before = mat.children.length;
    const { node, undo, redo } = mat.execAddEntry(undefined, 'Kp');

    undo();
    expect(mat.children).not.toContain(node);
    expect(mat.children.length).toBe(before);

    redo();
    expect(mat.children).toContain(node);
    expect(mat.children.length).toBe(before + 1);
  });
});

describe('MatNode — execRemoveEntry', () => {
  it('removes the variable and marks the file dirty', () => {
    const mat = matSource('object_props.mat');
    const victim = mat.children[1];
    expect(mat.execRemoveEntry(victim)).toBeTruthy();
    expect(mat.children).not.toContain(victim);
    expect(mat.dirty).toBe(true);
  });

  it('undo restores the variable at its original position', () => {
    // Position matters: a .mat is written back as an ordered variable list, so
    // re-appending at the end would silently reorder the file.
    const mat = matSource('object_props.mat');
    const order = mat.children.map((c: any) => c.name);
    const victim = mat.children[1];
    const { undo, redo } = mat.execRemoveEntry(victim)!;

    undo();
    expect(mat.children.map((c: any) => c.name)).toEqual(order);

    redo();
    expect(mat.children).not.toContain(victim);
  });

  it('returns null for a node it does not own', () => {
    // No command is recorded, so an unrelated node cannot be "undeleted" into
    // this file by a later undo.
    const mat = matSource('Param.mat');
    const other = matSource('Sig.mat');
    expect(mat.execRemoveEntry(other.children[0])).toBeNull();
    expect(mat.dirty).toBe(false);
  });
});

describe('MatNode — getVariables', () => {
  it('skips typed Simulink nodes, which carry no serializable variable', () => {
    // Param.mat holds one Simulink.Parameter, which becomes a ParameterNode from
    // the read-only MCOS path; only the anonymous MCOS blob element remains.
    const mat = matSource('Param.mat');
    expect(mat.children.map((c: any) => c.constructor.name)).toEqual(['ParameterNode']);
    expect(mat._anonymousElements.length).toBe(1);
    expect(mat.getVariables().length).toBe(1);
  });

  it('yields plain variables and keeps the anonymous MCOS element last', () => {
    // object_props.mat: two decoded objects (no `_var`) plus a plain double `a`.
    const mat = matSource('object_props.mat');
    expect(mat.getVariables().map((v: any) => v.name)).toEqual(['a', '']);
  });

  it('includes a newly added variable', () => {
    const mat = matSource('Param.mat');
    mat.execAddEntry(undefined, 'Kp');
    expect(mat.getVariables().map((v: any) => v.name)).toEqual(['Kp', '']);
  });
});

// The whole rank-3 path, end to end on a MATLAB-authored file: MCOS decode ->
// nested object-array property -> ObjectNode container -> one element row per
// object. ndNested.mat is `h.Kids = reshape(arrayfun(@(k) Simulink.Parameter(k),
// 1:12), [2 3 2])`, which MATLAB sizes [2 3 2] with h.Kids(:) holding Values 1..12
// (see fixtures/mcos/NdHolder.m). Every extent had to survive three separate
// truncation sites to get here (defect 9).
describe('MatNode — a rank-3 object array held in a property', () => {
  it('shows the container MATLAB\'s shape and one row per element', () => {
    const mat = matSource('ndNested.mat');
    const h = mat.children.find((c: any) => c.name === 'h');
    expect(h.constructor.name).toBe('ObjectNode');
    const kids = h.children.find((c: any) => c.name === 'Kids');
    expect(kids.dims).toEqual([2, 3, 2]);
    expect(kids.displayValue).toBe('<2x3x2 Simulink.Parameter>');
    expect(kids.children).toHaveLength(12);
    // Column-major subscripts over MATLAB's column-major element list, so the label
    // names the object MATLAB puts at that subscript.
    const pairs = kids.children.map((c: any) => [c.displayName, c.displayValue]);
    expect(pairs[0]).toEqual(['Kids(1,1,1)', '1']);
    expect(pairs[1]).toEqual(['Kids(2,1,1)', '2']);
    expect(pairs[11]).toEqual(['Kids(2,3,2)', '12']);
    expect(new Set(pairs.map((p: string[]) => p[0])).size).toBe(12);
  });
});
