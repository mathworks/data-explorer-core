// Copyright 2026 The MathWorks, Inc.
//
// ContainerNode is the base of every structural node — the .sldd/.slx/.prj/.mat
// roots and all their sections. It contributes exactly three things on top of
// BaseNode, and each one is load-bearing for the host's row builder:
//
//   1. isContainer === true, which BaseNode.toRow reads to decide that a
//      container's children are TOP-LEVEL rows (parent null) rather than rows
//      indented under it. Every section relies on this.
//   2. toRow() === null, so a container never emits a row of its own. The host
//      synthesizes section rows itself (buildRows in the vscode repo) and skips
//      any node whose toRow returns falsy; a container that returned a row would
//      duplicate every section header.
//   3. flatten() that EXCLUDES the container itself, unlike BaseNode.flatten
//      which includes it. buildEntryRows/buildMatRows flatten a subtree and emit
//      a row per node, so including the container would emit a null row (harmless)
//      but including a nested container's own header row would not be.
//
// Subclasses (SectionNode, ModelNode, ProjectNode, SlddNode, MatNode) override
// tableColumnConfig where their columns differ; the inherited default is what the
// dictionary sections and the .mat/.sldd roots actually use, so it is pinned here.
import { describe, it, expect } from 'vitest';
import ContainerNode from '../src/datamodel/node/ContainerNode.js';
import BaseNode from '../src/datamodel/node/BaseNode.js';
import SlddNode from '../src/datamodel/node/container/SlddNode.js';
import '../src/datamodel/node/NodeClassMap.js';

/** A container holding `a` (with one nested child) and `b`. */
function tree(): { box: ContainerNode; a: BaseNode; a1: BaseNode; b: BaseNode } {
  const box = new ContainerNode('box', null);
  const a = box.addChild(new BaseNode('a', null));
  const a1 = a.addChild(new BaseNode('a1', null));
  const b = box.addChild(new BaseNode('b', null));
  return { box, a, a1, b };
}

describe('ContainerNode — the container contract', () => {
  it('declares itself a container', () => {
    expect(new ContainerNode('box', null).isContainer).toBe(true);
    // The flag is what makes children top-level rows: BaseNode.toRow reports a
    // null parent when the parent is a container.
    const { a, a1 } = tree();
    expect(a.toRow()!.parent).toBeNull();
    // A non-container parent still parents its child, so this is specifically the
    // container's effect and not a blanket "top level".
    expect(a1.toRow()!.parent).toBe('box/a');
  });

  it('emits no row of its own', () => {
    // The host emits section header rows itself and skips nodes whose toRow is
    // falsy. A row here would double every section header in the table.
    expect(new ContainerNode('box', null).toRow()).toBeNull();
  });

  it('supplies the default column set the dictionary sections and roots use', () => {
    expect(new ContainerNode('box', null).tableColumnConfig).toEqual({
      columns: ['Name', 'Value', 'DataType', 'Status', 'UsedBy'],
    });
    // Inherited unchanged by the .sldd root, which adds no columns of its own.
    expect(new SlddNode('d.sldd').tableColumnConfig).toEqual({
      columns: ['Name', 'Value', 'DataType', 'Status', 'UsedBy'],
    });
  });
});

describe('ContainerNode.flatten', () => {
  it('returns the descendants depth-first WITHOUT the container itself', () => {
    // The one behavioural difference from BaseNode.flatten, which leads with the
    // node it was called on.
    const { box } = tree();
    expect(box.flatten().map((n) => n.name)).toEqual(['a', 'a1', 'b']);
    expect(BaseNode.prototype.flatten.call(box).map((n: BaseNode) => n.name)).toEqual(['box', 'a', 'a1', 'b']);
  });

  it('returns nothing for an empty container', () => {
    // A section with no entries still gets its header row from the host; it must
    // contribute no entry rows.
    expect(new ContainerNode('empty', null).flatten()).toHaveLength(0);
  });

  it('walks the whole .sldd tree from the root', () => {
    // The real shape this exists for: a root whose immediate children are the four
    // sections, each holding entries.
    const root = new SlddNode('d.sldd');
    root.getSection('design')!.addEntry('Simulink.Parameter', 'Kp');
    root.getSection('config')!.addEntry('Simulink.ConfigSet', 'Cfg');
    const names = root.flatten().map((n) => n.name);
    expect(names).not.toContain('d.sldd');
    expect(names).toContain('Kp');
    expect(names).toContain('Cfg');
  });
});
