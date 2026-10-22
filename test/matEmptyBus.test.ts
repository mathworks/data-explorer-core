// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Bus of no element, as a .mat holds one: MATLAB saves the Elements of every default
// Bus, and of one whose last element was removed, as an empty object array (the handle
// [0xDD000000 2 0 0 <BusElement class row>], no id). It read as ONE element, with no name and no
// properties: the class row taken for an object id, which named the Bus itself. A Bus created
// from MATLAB's default (McosTemplateMerge) showed that row too.
//
// The files are test/fixtures/mcos-templates': a default Bus merged into a file with no
// subsystem (MATLAB R2023b's own append of it, byte for byte), and a Bus whose one element was
// removed, into files R2023b and R2027a wrote; each loads in MATLAB R2023b, R2024b and R2027a as
// a Bus with no element.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import type { BaseNode } from '../src/datamodel/node/BaseNode.js';

const DIR = new URL('./fixtures/mcos-templates/merged/', import.meta.url);

function variable(file: string, name: string): BaseNode {
  const s = createSession();
  const src = s.addMatSource(file, new Uint8Array(readFileSync(new URL(file, DIR))).buffer) as unknown as BaseNode;
  const hit = src.children.find((c) => c.name === name);
  if (!hit) throw new Error(`${file} shows no ${name}`);
  return hit;
}

const elementsOf = (bus: BaseNode): unknown =>
  ((bus.serial._rawVal as { _elements: { _properties: Record<string, unknown> }[] })._elements[0]._properties).Elements_internal;

describe('a Bus of no element, in a .mat', () => {
  for (const [file, name] of [['r2023b/D_Simulink_Bus__none.mat', 'bnew'], ['r2023b/D_Simulink_Bus__param.mat', 'bnew'], ['r2023b/BR0__mixed.mat', 'b0'], ['r2027a/BR0__mixed.mat', 'b0']]) {
    it(`${file}: ${name} shows no element, and holds an empty BusElement array`, () => {
      const bus = variable(file, name);
      expect(bus.className).toBe('Simulink.Bus');
      expect(bus.children.map((c) => c.name)).toEqual([]);
      expect(elementsOf(bus)).toEqual({ _array_class: 'Simulink.BusElement', _array_type: 'MATLABArray', _dimensions: [0, 0], _mw_element_type: 'MATLABArray', _elements: [] });
    });
  }

  it('and a Bus of elements still shows each of them', () => {
    expect(variable('r2023b/BN2__none.mat', 'bnew').children.map((c) => c.name)).toEqual(['a', 'a1']);
    expect(variable('r2027a/BX2__mixed.mat', 'b0').children.map((c) => c.name)).toEqual(['only', 'a', 'a1']);
    expect(variable('r2023b/BR1__bus2.mat', 'bb').children.map((c) => c.name)).toEqual(['e2']);
  });
});
