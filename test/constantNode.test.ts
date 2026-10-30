// Copyright 2026 The MathWorks, Inc.
//
// A Constant is an Architectural Data entry that on disk is byte-identical to a
// plain (derived) MATLAB variable — the distinction is purely metadata.isderived.
// ConstantNode specializes MatlabVariableNode with the Constant rules:
//   • Kind is always 'Constant', icon is the arch-flavored one;
//   • no children (a scalar leaf);
//   • Value must be SCALAR and NUMERIC, enforced on edit with a specific message.
// This suite locks those data-model rules down. The host-side forks
// (SectionNode.parseEntry, Design↔Arch conversion, paste gating, addEntry) live
// with the extension's integration tests, since they exercise the presentation
// and structural-edit layers; constantNodeText.test.ts holds the paste ones, and
// the last two describes below the parseEntry and addEntry ones the extension had
// nowhere else (ported from data-explorer-vscode test/constantNode.test.ts at
// 546ba12, ahead of vscode's V4: titles and assertions unchanged, a model a fresh
// core session over the text instead of view's getModel, an entry found by name).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession, getSectionMetadata } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import ConstantNode from '../src/datamodel/node/data/ConstantNode.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { parsedIsScalarNumeric } from '../src/datamodel/parser/MatlabValueParser.js';
import MatlabValueParser from '../src/datamodel/parser/MatlabValueParser.js';
import '../src/datamodel/node/data/NodeClassMap.js';

describe('parsedIsScalarNumeric truth table', () => {
  const scalarNumeric = ['5', '3.14', '-2', 'true', 'false', '1+2i'];
  for (const expr of scalarNumeric) {
    it(`accepts scalar numeric ${expr}`, () => {
      expect(parsedIsScalarNumeric(MatlabValueParser.parse(expr))).toBe(true);
    });
  }
  const notScalarNumeric = ["'hello'", '"world"', '[1 2 3]', '[1 2; 3 4]', '{1, 2}'];
  for (const expr of notScalarNumeric) {
    it(`rejects non-scalar-numeric ${expr}`, () => {
      expect(parsedIsScalarNumeric(MatlabValueParser.parse(expr))).toBe(false);
    });
  }
  it('rejects a null parse (unparseable expression)', () => {
    expect(parsedIsScalarNumeric(null)).toBe(false);
  });
});

describe('MatlabVariableNode.isScalarNumeric', () => {
  it('is true for a scalar double', () => {
    expect(MatlabVariableNode.parse(3.14, 'x', null).isScalarNumeric).toBe(true);
  });
  it('is true for a scalar logical', () => {
    expect(MatlabVariableNode.parse(true, 'b', null).isScalarNumeric).toBe(true);
  });
  it('is false for a char', () => {
    expect(MatlabVariableNode.parse('hi', 'c', null).isScalarNumeric).toBe(false);
  });
  it('is false for a numeric array', () => {
    expect(MatlabVariableNode.parse([1, 2, 3], 'v', null).isScalarNumeric).toBe(false);
  });
  it('is false for a struct', () => {
    const s = MatlabVariableNode.parse(0, 's', null);
    s._kind = 'scalar';
    s._scalarType = 'struct';
    expect(s.isScalarNumeric).toBe(false);
  });
});

describe('ConstantNode identity and structure', () => {
  it('reports Kind "Constant" and the typeConstant icon', () => {
    const c = ConstantNode.createDefault('Const', null);
    expect(c).toBeInstanceOf(ConstantNode);
    expect(c.kind).toBe('Constant');
    expect(c.icon).toBe('typeConstant');
  });

  it('never allows children (a scalar leaf)', () => {
    const c = ConstantNode.createDefault('Const', null);
    expect(c.canAddChild()).toBe(false);
  });

  it('defaultName is "Const"', () => {
    expect(ConstantNode.defaultName).toBe('Const');
  });
});

describe('ConstantNode value validation on edit', () => {
  it('accepts a scalar numeric value', () => {
    const c = ConstantNode.createDefault('K', null);
    expect(c.setProperty('Value', '42')).toBe(true);
    expect(c.displayValue).toBe('42');
  });

  it('rejects a non-scalar (array) value with the exact message', () => {
    const c = ConstantNode.createDefault('K', null);
    const result = c.setProperty('Value', '[1 2 3]');
    expect(result).not.toBe(true);
    expect((result as any).error).toBe(true);
    expect((result as any).reason).toBe("The value for constant 'K' must be scalar and numeric.");
    // Rejected edits leave the value untouched.
    expect(c.displayValue).toBe('0');
  });

  it('rejects a char value with the exact message', () => {
    const c = ConstantNode.createDefault('MyConst', null);
    const result = c.setProperty('Value', "'hello'");
    expect(result).not.toBe(true);
    expect((result as any).reason).toBe("The value for constant 'MyConst' must be scalar and numeric.");
  });

  it('rejects an unparseable value as an invalid expression', () => {
    const c = ConstantNode.createDefault('K', null);
    const result = c.setProperty('Value', 'int8(5)');
    expect(result).not.toBe(true);
    expect((result as any).reason).toBe('Invalid MATLAB expression');
  });

  it('a well-formed scalar Constant is value-editable', () => {
    const c = ConstantNode.createDefault('K', null);
    expect(c.valueEditable).toBe(true);
  });

  it('delegates non-Value edits (e.g. Name) to the generic DataNode path', () => {
    // Properties other than Value (name, description, data type) must not hit
    // the scalar-numeric validator. Without the explicit delegation the Constant
    // would reject a perfectly valid Name rename with an "invalid expression" error.
    const c = ConstantNode.createDefault('K', null);
    expect(c.setProperty('Name', 'NewK')).toBe(true);
    expect(c.name).toBe('NewK');
  });
});

// ---- Ported from data-explorer-vscode test/constantNode.test.ts at 546ba12 -----------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

// The design/arch namespace URI, read from the core barrel.
const NS_DESIGN = getSectionMetadata('design').namespace;

// The runtime class name, as the extension's suite checked it (it could not use `instanceof` across
// the package boundary).
const classOf = (n: any): string | undefined => n?.constructor?.name;

const archText = readFileSync('test/fixtures/arch.sldd', 'utf8');

// view's getModel(uri, 'arch.sldd', archText) after invalidate(uri): a fresh session over the text.
function model(_uri: string): any {
  const bytes = new TextEncoder().encode(archText);
  return ingest(createSession(), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: 'arch.sldd' });
}
// The first row of that name, section headers aside: what buildRows(m).find(...) then findNode gives.
function entryNode(_uri: string, m: any, name: string) {
  return (m.flatten() as any[]).find((n) => !n.isContainer && n.name === name);
}
function sectionOf(m: any, name: string) {
  return m.children.find((s: any) => s.name === name);
}

describe('SectionNode.parseEntry forks on isderived', () => {
  it('a derived Bus stays a BusNode (only plain variables become Constants)', () => {
    const uri = 'test://bus-fork.sldd';
    const m = model(uri);
    const di = entryNode(uri, m, 'DataInterface');
    expect(classOf(di)).toBe('BusNode');
  });
});

describe('Add Constant via addEntry', () => {
  it('adds a scalar-numeric Constant to the arch section', () => {
    const uri = 'test://add-const.sldd';
    const m = model(uri);
    const arch = sectionOf(m, 'arch');
    const node = arch.addEntry('Constant');
    expect(classOf(node)).toBe('ConstantNode');
    expect(node.kind).toBe('Constant');
    expect((node.metadata as any).isderived).toBe('1');
    expect((node.metadata as any).namespace).toBe(NS_DESIGN);
    expect(node.isScalarNumeric).toBe(true);
    expect(node.canAddChild()).toBe(false);
  });

  it('a Constant cannot be added to the design section', () => {
    const uri = 'test://add-const-design.sldd';
    const m = model(uri);
    const design = sectionOf(m, 'design');
    expect(design.addEntry('Constant')).toBeNull();
  });
});
