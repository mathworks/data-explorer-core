// Copyright 2026 The MathWorks, Inc.

import type { MatVariable } from '../../parser/MatParser.js';
import type { McosObjectData } from '../../parser/McosParser.js';

// The decoded MCOS object of each opaque variable in a parsed tree, held BESIDE the
// variables rather than written into them. A parse can be a host's own object — one it
// registered, built, and may keep after the source is gone — and a field the container
// set on it would be a change to data this package does not own, outliving the source
// it was decoded for. Keyed weakly, so an entry goes when its variable does.
//
// A module of its own, importing nothing at run time, because three layers read it:
// mcosTypedNode.attachMcosDecoded fills it, MatNode and ModelNode read their top-level
// variables out of it, and MatlabVariableNode.parseMatVariable reads every nested one —
// and MatlabVariableNode cannot import mcosTypedNode, which imports it.
const decodedByVariable = new WeakMap<MatVariable, McosObjectData>();

export function setMcosDecoded(variable: MatVariable, decoded: McosObjectData | undefined): void {
  if (decoded) {
    decodedByVariable.set(variable, decoded);
  } else {
    decodedByVariable.delete(variable);
  }
}

// The object its container decoded for `variable`, or undefined: not an opaque, not
// decoded yet, or not resolvable with confidence.
export function mcosDecodedFor(variable: MatVariable): McosObjectData | undefined {
  return decodedByVariable.get(variable);
}

// The opaque variables in a parsed tree whose objects the confidence gate REFUSED
// (McosParser.McosDecodeIssue, `refused`): the bytes say there is an object, and it is not
// the one the variable declares, or not one the table holds. A refused variable has no
// decode, and neither has one there was nothing to decode against; this is what tells the
// two apart. Without a decode, a class the data model knows is shown as its typed node, but
// a refused one is not the object in the file, so it is the plain opaque instead
// (mcosTypedNode.modelOpaqueMcosVariable). Filled and cleared beside the decode, by the
// same attach, so a refusal never outlives the attach that found it.
const refusedVariables = new WeakSet<MatVariable>();

export function setMcosRefused(variable: MatVariable, refused: boolean): void {
  if (refused) {
    refusedVariables.add(variable);
  } else {
    refusedVariables.delete(variable);
  }
}

// Whether the last attach of `variable` refused its objects.
export function mcosRefused(variable: MatVariable): boolean {
  return refusedVariables.has(variable);
}
