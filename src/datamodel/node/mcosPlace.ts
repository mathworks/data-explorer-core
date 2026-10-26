// Copyright 2026 The MathWorks, Inc.

import type { MatVariable } from '../parser/MatParser.js';

// Which object of the file's subsystem each typed node is: the opaque variable it was built
// of, and which element of the objects that variable's handle names (0 for a scalar, k for the
// element k of an object array, column-major), so that its id is `objectIdOf(variable.mcosHandle,
// index)`. Set where a decoded object becomes its node (mcosTypedNode.modelOpaqueMcosVariable),
// at the top of a file, in a struct field, in a cell, as an element of an object array, and read
// by a MAT-file's save, which writes an edit of one of its properties into the subsystem cell
// that holds it (MatNode._objectSubsystemEdit). A node set nowhere is no object a save can find,
// and takes no edit of its properties.
//
// Beside the node rather than on it, for the reason the decode is beside its variable
// (data/mcosDecodedTable): a field on a node is a field every writer of it would meet. Here, and
// not beside the decode, because DataNode reads it (DataNode._markModified), and this folder
// imports none of data/.
const placeByNode = new WeakMap<object, McosPlace>();

/** Where a typed node's object is: its variable, and the element of the variable's handle. */
export interface McosPlace {
  variable: MatVariable;
  index: number;
}

export function setMcosPlace(node: object, variable: MatVariable, index: number): void {
  placeByNode.set(node, { variable, index });
}

/** Where the object `node` was built of is, or undefined for a node built of none. */
export function mcosPlaceOf(node: object): McosPlace | undefined {
  return placeByNode.get(node);
}

// Which enumeration value of the file a node was built of (mcosTypedNode.modelOpaqueMcosVariable):
// the opaque variable whose class-17 element holds it in place of the handle every other object
// has. Not a place: an enumeration value is no object of the subsystem whose properties an edit
// writes, which a placed node is (mcosObjectEdit.objectNodeAt). Read by a MAT-file's save, which
// writes it as the element it was read as beside the plain members of a struct or a cell it
// writes fresh (MatlabVariableNode._objectMemberOf).
const enumerationByNode = new WeakMap<object, MatVariable>();

export function setMcosEnumeration(node: object, variable: MatVariable): void {
  enumerationByNode.set(node, variable);
}

/** The variable of the enumeration value `node` was built of, or undefined for a node built of none. */
export function mcosEnumerationOf(node: object): MatVariable | undefined {
  return enumerationByNode.get(node);
}
