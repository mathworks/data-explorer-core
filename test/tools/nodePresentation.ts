// Copyright 2026 The MathWorks, Inc.
//
// Shared by the nested-MCOS suites, which compare a node with its twin elsewhere in the
// tree and need one definition of "presents the same".

// What a node presents, everywhere a host can look: its own accessors, its table row,
// and the same for every descendant. Two things are left out on purpose, both of them
// about WHERE the node sits rather than what it is. Its row's identity (`ID`, `parent`)
// is a path. Its own Name cell is its name, and the state that comes with the position:
// an entry is not `disabled` and a struct field is, a top-level name can be edited and
// a field's or a cell element's cannot. The node's own name also prefixes an ELEMENT's
// label (`objArr(1)` against `objArrTop(1)`), so that prefix is cut from descendants'
// labels, and from nothing else.
export function presentation(node: any, rootLabel: string, isRoot = true): unknown {
  const row = { ...node.toRow() };
  delete row.ID;
  delete row.parent;
  const label: unknown = row.Name?.label;
  if (isRoot) {
    delete row.Name;
  } else if (typeof label === 'string' && label.startsWith(rootLabel) && /^[({]/.test(label.slice(rootLabel.length))) {
    row.Name = { ...row.Name, label: '…' + label.slice(rootLabel.length) };
  }
  return {
    constructor: node.constructor.name,
    className: node.className,
    dataType: node.dataType,
    displayValue: node.displayValue,
    icon: node.icon,
    valueEditable: node.valueEditable,
    dims: node.dims,
    row,
    children: node.children.map((c: any) => ({ name: c.name, ...(presentation(c, rootLabel, false) as object) })),
  };
}
