// Copyright 2026 The MathWorks, Inc.
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
const placeByNode = new WeakMap();
export function setMcosPlace(node, variable, index) {
    placeByNode.set(node, { variable, index });
}
/** Where the object `node` was built of is, or undefined for a node built of none. */
export function mcosPlaceOf(node) {
    return placeByNode.get(node);
}
//# sourceMappingURL=mcosPlace.js.map