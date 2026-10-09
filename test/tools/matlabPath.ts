// Copyright 2026 The MathWorks, Inc.
//
// Shared by the MCOS fixture suites, whose truth files key every record by the MATLAB
// path that reaches it, and which need one definition of "the node a path names".

// The node a MATLAB path names: `s.sub.q`, `c{4}{1}`, `sa(2).p`. A struct field is the
// child of that name; a cell element `{i}` and a struct-array element `(i)` are the
// i-th child, which is how both containers lay their elements out (MATLAB's linear
// index, column-major).
export function nodeAt(variables: any, path: string): any {
  const head = /^[A-Za-z]\w*/.exec(path);
  if (!head) throw new Error(`not a MATLAB path: ${path}`);
  const pick = (parent: any, test: (c: any, i: number) => boolean, what: string) => {
    const hit = parent.children.find(test);
    if (!hit) {
      throw new Error(`${path}: no ${what} under ${parent.name}; have ${parent.children.map((c: any) => c.name).join(', ')}`);
    }
    return hit;
  };
  let node = pick(variables, (c) => c.name === head[0], `variable ${head[0]}`);
  let rest = path.slice(head[0].length);
  while (rest) {
    const seg = /^(?:\.(\w+)|\{(\d+)\}|\((\d+)\))/.exec(rest);
    if (!seg) throw new Error(`cannot read "${rest}" in ${path}`);
    if (seg[1] !== undefined) {
      node = pick(node, (c) => c.name === seg[1], `field ${seg[1]}`);
    } else {
      const at = Number(seg[2] ?? seg[3]) - 1;
      node = pick(node, (_c, i) => i === at, `element ${at + 1}`);
    }
    rest = rest.slice(seg[0].length);
  }
  return node;
}
