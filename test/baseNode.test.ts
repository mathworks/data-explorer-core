// Copyright 2026 The MathWorks, Inc.
//
// BaseNode is the root of every node class: it owns the tree (parent/children,
// add/remove/replace/flatten), the synthetic display name for positional
// elements, and the default answers each subclass narrows. Those defaults are a
// real contract, not filler — a subclass that forgets to override `serialize`
// silently drops its data, and `icon`/`displayValue` are what a node renders as
// when nothing more specific applies.
//
// The tree operations are the part worth testing hardest. They are shared by
// every add/remove/undo path in the app, and their failure mode is a corrupted
// tree (an orphan still listed as a child, or a child whose parent pointer lies)
// rather than an exception — so the assertions here check BOTH directions of
// every link.
//
// Subclass behaviour lives with the subclass: DataNode's setProperty in
// minMaxConstraint.test.ts / dataNodeXml.test.ts, container behaviour in
// sectionNode-related suites, PI assembly in the piOther/schema suites.
import { describe, it, expect } from 'vitest';
import BaseNode from '../src/datamodel/node/BaseNode.js';
import type { PropClass } from '../src/datamodel/node/BaseNode.js';

// A minimal parent whose _kind/_dims make its children positional elements, the
// way a bare array/cell/string node does.
function elementParent(kind: string, dims: number[], name = 'v'): BaseNode {
  const p = new BaseNode(name, null);
  p._kind = kind;
  p._dims = dims;
  return p;
}

function withChildren(parent: BaseNode, count: number): BaseNode[] {
  const kids: BaseNode[] = [];
  for (let i = 1; i <= count; i++) {
    kids.push(parent.addChild(new BaseNode(String(i), null)));
  }
  return kids;
}

describe('BaseNode defaults every subclass narrows', () => {
  it('answers with the neutral fallbacks', () => {
    const n = new BaseNode('x', null);
    expect(n.icon).toBe('wsDefault');
    expect(n.className).toBe('');
    expect(n.displayValue).toBe('');
    expect(n.disabled).toBe(false);
    expect(n.isObjectPropertyBag).toBe(false);
    expect(n.getProperties()).toEqual([]);
  });

  it('falls back to the class identity for Kind and Data Type', () => {
    // A base node has no friendlier name and no distinct data type, so both
    // columns echo the class. DataNode narrows dataType to a real type only.
    class Classy extends BaseNode {
      get className(): string {
        return 'Simulink.Thing';
      }
    }
    const n = new Classy('x', null);
    expect(n.kind).toBe('Simulink.Thing');
    expect(n.dataType).toBe('Simulink.Thing');
  });

  it('serializes to null, so a subclass that forgets to override writes nothing', () => {
    // Returning null rather than {} is deliberate: the section serializer skips
    // null, so an un-overridden node is omitted instead of emitting an empty
    // entry that would overwrite real data in the saved file.
    expect(new BaseNode('x', null).serialize()).toBeNull();
  });

  it('refuses to add children by default', () => {
    const n = new BaseNode('x', null);
    expect(n.canAddChild()).toBe(false);
    expect(n.addChildNode()).toBeNull();
    expect(n.children).toEqual([]);
  });
});

describe('BaseNode.id', () => {
  it('is the slash-joined path from the root', () => {
    const root = new BaseNode('root', null);
    const mid = root.addChild(new BaseNode('mid', null));
    const leaf = mid.addChild(new BaseNode('leaf', null));
    expect(root.id).toBe('root');
    expect(mid.id).toBe('root/mid');
    expect(leaf.id).toBe('root/mid/leaf');
  });

  it('tracks a re-parent, since it is computed rather than stored', () => {
    const a = new BaseNode('a', null);
    const b = new BaseNode('b', null);
    const child = a.addChild(new BaseNode('c', null));
    expect(child.id).toBe('a/c');
    b.addChild(child);
    expect(child.id).toBe('b/c');
  });
});

describe('BaseNode.addChild', () => {
  it('appends by default and adopts the child', () => {
    const p = new BaseNode('p', null);
    const c = new BaseNode('c', null);
    expect(p.addChild(c)).toBe(c);
    expect(p.children).toEqual([c]);
    expect(c.parent).toBe(p);
  });

  it('inserts at an explicit index', () => {
    const p = new BaseNode('p', null);
    const [a, b] = withChildren(p, 2);
    const mid = p.addChild(new BaseNode('mid', null), 1);
    expect(p.children).toEqual([a, mid, b]);
    expect(mid.parent).toBe(p);
  });

  it('appends when the index is negative or absent', () => {
    // A negative index would make splice count from the END, silently inserting
    // in the wrong place; the guard sends it down the append path instead.
    const p = new BaseNode('p', null);
    const [a] = withChildren(p, 1);
    const tail = p.addChild(new BaseNode('t', null), -1);
    expect(p.children).toEqual([a, tail]);
  });

  it('inserts at 0, which is a real index and not treated as absent', () => {
    const p = new BaseNode('p', null);
    const [a] = withChildren(p, 1);
    const head = p.addChild(new BaseNode('h', null), 0);
    expect(p.children).toEqual([head, a]);
  });

  it('moves a child that already has a parent, rather than cloning it', () => {
    const from = new BaseNode('from', null);
    const to = new BaseNode('to', null);
    const c = from.addChild(new BaseNode('c', null));
    to.addChild(c);
    expect(c.parent).toBe(to);
    expect(to.children).toEqual([c]);
    // NOTE the old parent still lists it — addChild adopts but does not detach.
    // Callers that move a node must removeChild first; this pins the current
    // contract so a change to it is a deliberate decision, not a surprise.
    expect(from.children).toEqual([c]);
  });
});

describe('BaseNode.removeChild', () => {
  it('detaches the child in both directions', () => {
    const p = new BaseNode('p', null);
    const [a, b] = withChildren(p, 2);
    p.removeChild(a);
    expect(p.children).toEqual([b]);
    expect(a.parent).toBeNull();
  });

  it('ignores a node that is not a child, leaving both untouched', () => {
    const p = new BaseNode('p', null);
    const [a] = withChildren(p, 1);
    const stranger = new BaseNode('s', null);
    const otherParent = new BaseNode('o', null);
    otherParent.addChild(stranger);
    p.removeChild(stranger);
    expect(p.children).toEqual([a]);
    // Crucially the stranger's parent pointer is NOT cleared — clearing it would
    // corrupt an unrelated subtree.
    expect(stranger.parent).toBe(otherParent);
  });
});

describe('BaseNode._replaceWith', () => {
  it('swaps the node for a new one at the same position', () => {
    const p = new BaseNode('p', null);
    const [a, b, c] = withChildren(p, 3);
    const fresh = new BaseNode('fresh', null);
    expect(b._replaceWith(fresh)).toBe(true);
    expect(p.children).toEqual([a, fresh, c]);
    expect(fresh.parent).toBe(p);
    // The replaced node is fully detached, so a stale reference cannot walk back
    // into the live tree.
    expect(b.parent).toBeNull();
  });

  it('refuses when the node has no parent', () => {
    const orphan = new BaseNode('o', null);
    const fresh = new BaseNode('f', null);
    expect(orphan._replaceWith(fresh)).toBe(false);
    expect(fresh.parent).toBeNull();
  });

  it('refuses when the parent does not actually list the node', () => {
    // Reachable if a caller cleared children without clearing parent pointers.
    // Returning false rather than appending keeps the inconsistency from
    // spreading into the tree.
    const p = new BaseNode('p', null);
    const stale = new BaseNode('stale', null);
    stale.parent = p;
    const fresh = new BaseNode('f', null);
    expect(stale._replaceWith(fresh)).toBe(false);
    expect(p.children).toEqual([]);
  });
});

describe('BaseNode.flatten', () => {
  it('returns the subtree in depth-first order, the node itself first', () => {
    //   root ─ a ─ a1
    //        │   └ a2
    //        └ b
    const root = new BaseNode('root', null);
    const a = root.addChild(new BaseNode('a', null));
    a.addChild(new BaseNode('a1', null));
    a.addChild(new BaseNode('a2', null));
    root.addChild(new BaseNode('b', null));
    expect(root.flatten().map((n) => n.name)).toEqual(['root', 'a', 'a1', 'a2', 'b']);
  });

  it('returns just the node when it is a leaf', () => {
    const leaf = new BaseNode('leaf', null);
    expect(leaf.flatten()).toEqual([leaf]);
  });

  it('flattens from the node down, not from the root', () => {
    const root = new BaseNode('root', null);
    const a = root.addChild(new BaseNode('a', null));
    a.addChild(new BaseNode('a1', null));
    expect(a.flatten().map((n) => n.name)).toEqual(['a', 'a1']);
  });
});

describe('BaseNode.displayName for positional elements', () => {
  it('subscripts a vector element with a single index', () => {
    const p = elementParent('array', [1, 3]);
    const kids = withChildren(p, 3);
    expect(kids.map((k) => k.displayName)).toEqual(['v(1)', 'v(2)', 'v(3)']);
  });

  it('braces a cell element', () => {
    const p = elementParent('cell', [1, 2], 'c');
    expect(withChildren(p, 2).map((k) => k.displayName)).toEqual(['c{1}', 'c{2}']);
  });

  it('uses row,col subscripts once BOTH dimensions exceed one', () => {
    // A 2x3 array is column-major in MATLAB but our children are row-major, so
    // the subscript is derived from the row-major index: element 4 of a 2x3 is
    // (2,1). A 1xN or Nx1 stays single-subscript.
    const p = elementParent('array', [2, 3]);
    expect(withChildren(p, 6).map((k) => k.displayName)).toEqual([
      'v(1,1)',
      'v(1,2)',
      'v(1,3)',
      'v(2,1)',
      'v(2,2)',
      'v(2,3)',
    ]);
  });

  it('uses row,col braces for a cell matrix, in MATLAB COLUMN-major order', () => {
    // A cell's element list is column-major (MatParser's cell branch does not
    // transpose, unlike its numeric branch), so element 1 is (2,1), not (1,2).
    // This expectation used to read c{1,2} for element 1, which on this square
    // fixture produced the right label SET while pairing every off-diagonal
    // element with the wrong value. Verified against MATLAB's own cell2x3 in
    // test/cellElementOrder.test.ts.
    const p = elementParent('cell', [2, 2], 'c');
    expect(withChildren(p, 4).map((k) => k.displayName)).toEqual(['c{1,1}', 'c{2,1}', 'c{1,2}', 'c{2,2}']);
  });

  it('emits a three-part subscript for a rank-3 array, not a row index past the rows', () => {
    const p = elementParent('array', [2, 3, 2], 'A');
    const got = withChildren(p, 12).map((k) => k.displayName);
    expect(got).toEqual([
      'A(1,1,1)', 'A(1,2,1)', 'A(1,3,1)', 'A(2,1,1)', 'A(2,2,1)', 'A(2,3,1)',
      'A(1,1,2)', 'A(1,2,2)', 'A(1,3,2)', 'A(2,1,2)', 'A(2,2,2)', 'A(2,3,2)',
    ]);
  });

  it('emits a three-part BRACED subscript for a rank-3 cell', () => {
    const p = elementParent('cell', [2, 2, 2], 'C');
    const got = withChildren(p, 8).map((k) => k.displayName);
    expect(got[0]).toBe('C{1,1,1}');
    expect(got[7]).toBe('C{2,2,2}');
    expect(got.some((s) => /\{3,|\{4,/.test(s))).toBe(false);
  });

  it('nests the parent subscript, so a matrix inside a cell reads as one path', () => {
    const outer = elementParent('cell', [1, 2], 'c');
    const inner = outer.addChild(new BaseNode('1', null));
    inner._kind = 'array';
    inner._dims = [1, 2];
    const leaves = withChildren(inner, 2);
    expect(inner.displayName).toBe('c{1}');
    expect(leaves.map((l) => l.displayName)).toEqual(['c{1}(1)', 'c{1}(2)']);
  });

  it('prefers an explicit _displayName alias over the raw name', () => {
    // Struct-array elements carry a `Name(i)` alias rather than a positional
    // parent, so the alias is the display name.
    const n = new BaseNode('0', null);
    n._displayName = 'S(2)';
    expect(n.displayName).toBe('S(2)');
  });

  it('falls back to the plain name outside an element parent', () => {
    const p = new BaseNode('p', null);
    expect(p.addChild(new BaseNode('field', null)).displayName).toBe('field');
  });
});

describe('BaseNode name editability and element marking', () => {
  it('grays and locks a positional element name', () => {
    const p = elementParent('array', [1, 2]);
    const [first] = withChildren(p, 2);
    expect(first.isIndexedName).toBe(true);
    expect(first.isElementName).toBe(true);
    expect(first.nameEditable).toBe(false);
  });

  it('grays and locks a struct-array element, which has no element parent', () => {
    const n = new BaseNode('0', null);
    n._displayName = 'S(1)';
    expect(n.isIndexedName).toBe(false);
    expect(n.isElementName).toBe(true);
    expect(n.nameEditable).toBe(false);
  });

  it('locks a class-property name without graying it', () => {
    // A property of a MATLAB class object cannot be renamed (the class definition
    // fixes it), but it is NOT a positional element — so it must not render gray.
    class Bag extends BaseNode {
      get isObjectPropertyBag(): boolean {
        return true;
      }
    }
    const bag = new Bag('obj', null);
    const prop = bag.addChild(new BaseNode('Gain', null));
    expect(prop.nameEditable).toBe(false);
    expect(prop.isElementName).toBe(false);
  });

  it('leaves an ordinary node renamable and ungrayed', () => {
    const p = new BaseNode('p', null);
    const field = p.addChild(new BaseNode('f', null));
    expect(field.nameEditable).toBe(true);
    expect(field.isElementName).toBe(false);
  });
});

describe('BaseNode.valueEditable', () => {
  it('refuses to edit a summarised value', () => {
    // A value the table had to collapse (<1x40 double>) is not the real value, so
    // handing it to an editor would let the user overwrite data with the summary.
    class Summary extends BaseNode {
      get displayValue(): string {
        return '<1x40 double>';
      }
    }
    expect(new Summary('x', null).valueEditable).toBe(false);
  });

  it('allows an ordinary or empty value', () => {
    class Val extends BaseNode {
      get displayValue(): string {
        return '5';
      }
    }
    expect(new Val('x', null).valueEditable).toBe(true);
    // The base displayValue is '', which must stay editable — a node with no
    // value yet is exactly where a user types one.
    expect(new BaseNode('x', null).valueEditable).toBe(true);
  });

  it('allows a value that merely contains angle brackets', () => {
    class Partial extends BaseNode {
      get displayValue(): string {
        return 'a<b';
      }
    }
    expect(new Partial('x', null).valueEditable).toBe(true);
  });
});

describe('BaseNode.getPropInfo', () => {
  const atom = (over: Partial<PropClass> = {}): PropClass =>
    ({
      key: 'Gain',
      displayName: 'Gain',
      editor: 'text',
      format: (v: unknown) => (v === undefined ? '' : String(v)),
      ...over,
    }) as PropClass;

  it('reads the field named by the key and formats it', () => {
    const n = new BaseNode('x', null) as BaseNode & { Gain?: number };
    n.Gain = 5;
    const info = n.getPropInfo(atom());
    expect(info.displayValue).toBe('5');
    expect(info.value).toBe(5);
    expect(info.editable).toBe(true);
  });

  it('prefers a readValue hook over the field lookup', () => {
    const n = new BaseNode('x', null);
    expect(n.getPropInfo(atom({ readValue: () => 'computed' })).displayValue).toBe('computed');
  });

  it('reads the raw value through nodeProperty when the JS field differs', () => {
    const n = new BaseNode('theName', null);
    const info = n.getPropInfo(atom({ key: 'Name', nodeProperty: 'name', readValue: (x) => x.displayName }));
    expect(info.value).toBe('theName');
  });

  it('marks a label editor read-only', () => {
    expect(new BaseNode('x', null).getPropInfo(atom({ editor: 'label' })).editable).toBe(false);
  });

  it('gates Name on nameEditable and Value on valueEditable', () => {
    // The generic editor flag is necessary but not sufficient: these two keys
    // additionally consult the node, so a locked element name cannot be edited
    // just because its atom says 'text'.
    const p = elementParent('array', [1, 2]);
    const [el] = withChildren(p, 2);
    expect(el.getPropInfo(atom({ key: 'Name' })).editable).toBe(false);

    class Summary extends BaseNode {
      get displayValue(): string {
        return '<1x40 double>';
      }
    }
    expect(new Summary('x', null).getPropInfo(atom({ key: 'Value' })).editable).toBe(false);
  });

  it('carries dropdown options only when the atom supplies them', () => {
    const n = new BaseNode('x', null);
    expect(n.getPropInfo(atom()).options).toBeUndefined();
    expect(n.getPropInfo(atom({ readOptions: () => ['a', 'b'] })).options).toEqual(['a', 'b']);
  });
});

describe('BaseNode.toRow', () => {
  it('fills every base column from the node when no prop supplies it', () => {
    const n = new BaseNode('x', null);
    const row = n.toRow()!;
    expect(row.ID).toBe('x');
    expect(row.parent).toBeNull();
    expect(row.Status).toBe('');
    expect(row.Name).toEqual({
      label: 'x',
      iconId: 'wsDefault',
      disabled: false,
      editable: true,
      element: false,
    });
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(true);
    expect(row.DataType).toBe('');
    expect(row.Class).toBe('');
    expect(row.Kind).toBe('');
    expect(row.Description).toBe('');
  });

  it('reports the parent id, except when the parent is a container', () => {
    // A section is a container: its entries are top-level rows with no parent, so
    // the table does not indent them under the section.
    const plain = new BaseNode('p', null);
    expect(plain.addChild(new BaseNode('c', null)).toRow()!.parent).toBe('p');

    const section = new BaseNode('sec', null) as BaseNode & { isContainer?: boolean };
    section.isContainer = true;
    expect(section.addChild(new BaseNode('e', null)).toRow()!.parent).toBeNull();
  });

  it('omits a prop whose column is null, keeping it PI-only', () => {
    class PIOnly extends BaseNode {
      getProperties(): PropClass[] {
        return [
          {
            key: 'Hidden',
            displayName: 'Hidden',
            column: null,
            editor: 'text',
            format: () => 'x',
          } as PropClass,
        ];
      }
    }
    expect(new PIOnly('n', null).toRow()!.Hidden).toBeUndefined();
  });

  it('gives a generic editable column the cell shape, and a dedicated one a bare string', () => {
    // The webview renders the dedicated columns through their own branches and
    // manages editability itself; only generic columns need the object form.
    class Cols extends BaseNode {
      getProperties(): PropClass[] {
        return [
          { key: 'alignment', displayName: 'Alignment', editor: 'text', format: () => '8' } as PropClass,
          { key: 'DataType', displayName: 'Data Type', editor: 'text', format: () => 'double' } as PropClass,
        ];
      }
    }
    const row = new Cols('n', null).toRow()!;
    expect(row.alignment).toEqual({ text: '8', editable: true, editor: 'text', options: undefined });
    expect(row.DataType).toBe('double');
  });

  it('renders a select-editor Value as a combobox cell with its options', () => {
    class Sel extends BaseNode {
      getProperties(): PropClass[] {
        return [
          {
            key: 'Value',
            displayName: 'Value',
            editor: 'select',
            format: () => 'Auto',
            readOptions: () => ['Auto', 'ExportedGlobal'],
          } as PropClass,
        ];
      }
    }
    const row = new Sel('n', null).toRow()!;
    expect(row.Value).toEqual({
      text: 'Auto',
      editable: true,
      editor: 'select',
      options: ['Auto', 'ExportedGlobal'],
    });
    expect(row._valueEditable).toBe(true);
  });

  it('routes a prop to the column named by `column`, not by `key`', () => {
    class Aliased extends BaseNode {
      getProperties(): PropClass[] {
        return [
          { key: 'ConfigName', displayName: 'Name', column: 'Name', editor: 'text', format: () => 'shown' } as PropClass,
        ];
      }
    }
    const row = new Aliased('n', null).toRow()!;
    expect((row.Name as { label: string }).label).toBe('shown');
    expect(row.ConfigName).toBeUndefined();
  });

  it('takes a Status from the node when it has one', () => {
    const n = new BaseNode('n', null) as BaseNode & { status?: string };
    n.status = 'modified';
    expect(n.toRow()!.Status).toBe('modified');
  });
});

describe('BaseNode.getPILayout / toPIObject', () => {
  it('has no layout for a class with no schema, so the PI shows nothing curated', () => {
    // className '' matches no schema class; returning null lets a subclass
    // author its own groups instead.
    expect(new BaseNode('x', null).getPILayout()).toBeNull();
    expect(new BaseNode('x', null).toPIObject()).toBeNull();
  });

  it('resolves the declarative schema layout for a schema-backed class', () => {
    class Param extends BaseNode {
      get className(): string {
        return 'Simulink.Parameter';
      }
    }
    const layout = new Param('p', null).getPILayout();
    expect(layout).not.toBeNull();
    expect(layout!.length).toBeGreaterThan(0);
    expect(layout!.every((g) => typeof g.group === 'string' && Array.isArray(g.items))).toBe(true);
  });
});
