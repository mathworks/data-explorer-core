// Copyright 2026 The MathWorks, Inc.
import * as NodeRegistry from '../NodeRegistry.js';
import MatlabVariableNode from './MatlabVariableNode.js';
import StructNode from './StructNode.js';
import { mcosPlaceOf } from '../mcosPlace.js';
import { elementCount } from '../../display/DisplayConvention.js';
import { setOwn } from '../../parser/ownKeys.js';
import { isExactToken, parseComplexNum } from '../../parser/XmlUtils.js';
import { MatWriteError, classPhrase } from '../../parser/MatWriter.js';
import { variableDifference } from '../../parser/MatFileWriter.js';
import { cellValueAt, editMcosObjects, objectIdOf, storedProperties, valueCellOf, } from '../../parser/McosSubsystemEdit.js';
import { hasEditRules, objectEditCells, propertyEditRefusal, propertyValueRefusal, savedNameOf, valueMemberRefusal, } from '../../parser/McosEditRules.js';
// The edits of an MCOS object's properties that a MAT-file's save writes into the subsystem, read
// off the object's typed node: the node a decoded Simulink.Parameter or Simulink.Signal became
// (mcosTypedNode.modelOpaqueMcosVariable), at the top of the file, in a struct field, in a cell, or
// as an element of an object array.
//
// WHICH OBJECT. A node is placed where it was built (mcosPlace.setMcosPlace): its variable,
// whose handle names the object by id, and which element of the handle it is. Two variables that
// hold one handle are two nodes of one object, and their edits are one object's (objectSubsystemEdit).
//
// ONE OBJECT, ONE STATE. Simulink.Parameter and Simulink.Signal are handle classes: after `r = h`
// MATLAB holds one object, and `h.Value = 7` is r's Value too. So the nodes of one object show one
// state (mirrorTwins): the first of them an edit is made at or under is the one every later edit of
// the object is made through (McosTwinGroup.master), and after each, by whatever path, the session
// copies what it holds of each property into the others, which are then edited as well and carry
// the edit to the save, which writes it once. The others take no edit of their own: a copy replaces
// the rows of a Value, and an undo of an edit made at one of those rows would undo nothing. Once
// every node of the object holds what the file holds of it again (its edits undone, say), none is
// its master, and the next edit may be made through any of them. An edit made through a node and
// left on the undo stack under a later edit that brought the object back (7, then 5 typed over it)
// is then one a later copy into that node may have replaced the rows of: undone, it changes nothing,
// and what the node shows is what the save writes.
//
// WHAT CHANGED. Each property a node holds an editor's value of is read off the node as the
// variable a save writes (nodePropertyValue), the converter this package already has for each: a
// Value node's own variable (MatlabVariableNode._var), the one its Parameter would make of a Value
// held bare (NodeRegistry.parseValue), a struct Value's fields each so. It is compared with what
// the object's cell holds (McosSubsystemEdit.cellValueAt): equal, it is not written, which is how an
// undone edit writes nothing; otherwise it is an edit, and the rules (McosEditRules) say which
// cells it writes, or refuse it.
//
// WHAT IS TRUSTED. A property is written only if, as the node held it before any edit, it read back
// as the cell exactly (McosObjectState.exact): otherwise what the node holds of it is not what the
// file holds, and a save that wrote it would change what was not edited, an element of a Value
// beside the one edited, say. That is judged the first time the editor asks about the object,
// which every edit of it does before it is made (MatNode._editRefusal), and kept. The node's other
// properties are held to a fingerprint taken then too (fingerprintOf), so that one this package has
// no rule for, changed by a path that asked no rule, refuses the save rather than being dropped
// from it.
const PARAMETER = 'Simulink.Parameter';
const SIGNAL = 'Simulink.Signal';
/** The properties a node of each class holds an editor's value of, as node fields (nodePropertyValue). */
const NODE_PROPERTIES = {
    [PARAMETER]: ['Value', 'Min', 'Max', 'Description', 'Unit'],
    [SIGNAL]: ['Min', 'Max', 'Description', 'Unit', 'DataType'],
};
// What each property is when the object holds no value for it, its class default, as MATLAB saves
// none: an edit away from it would have to add a triple to the object's property list.
const DEFAULTS = {
    Value: emptyDouble(),
    Min: emptyDouble(),
    Max: emptyDouble(),
    Description: charOf(''),
    Unit: charOf(''),
    DataType: charOf('auto'),
};
// The fields of a node, and the keys of its property bag, that hold the properties above or follow
// from them (a Parameter's Dimensions and Complexity follow its Value, ParameterNode._followValueShape,
// and so does its DataType in a MAT-file, shownDataType), or are where the node stands: what an edit a
// save writes changes, left out of the fingerprint.
const OWN_FIELDS_WRITTEN = new Set(['name', 'parent', 'children', 'metadata', 'serial', 'status', 'Value', 'Min', 'Max', 'Description', 'Unit']);
const BAG_KEYS_WRITTEN = {
    [PARAMETER]: ['Value', 'Min', 'Max', 'Description', 'DocUnits', 'Dimensions', 'Complexity'],
    [SIGNAL]: ['Min', 'Max', 'Description', 'DocUnits', 'DataType'],
};
/** The class of a typed node, as its Class column shows it. */
function classOf(node) {
    return String(node.className || '');
}
/** The node of an object at or above `node`, up to and including `entry`, or null for none. */
export function objectNodeAt(entry, node) {
    for (let n = node; n; n = n.parent) {
        if (mcosPlaceOf(n)) {
            return n;
        }
        if (n === entry) {
            break;
        }
    }
    return null;
}
/** Every node of an object at or under `node`. */
export function objectNodesUnder(node) {
    const out = [];
    const stack = [node];
    while (stack.length > 0) {
        const n = stack.pop();
        if (mcosPlaceOf(n)) {
            out.push(n);
        }
        for (let i = n.children.length - 1; i >= 0; i--) {
            stack.push(n.children[i]);
        }
    }
    return out;
}
/**
 * The property of the object at `object` an edit of `key` at `node` changes, or why it changes
 * none a save writes, as a clause. A key of the object's own row names the property (the Property
 * Inspector's lowerCamel keys, `dimensions`, as MATLAB's `Dimensions`). An edit of a value at or
 * under a Simulink.Parameter's Value node, an element, a struct field, a row added or removed, a
 * struct's field renamed, is of its Value; another column of such a row (its Data Type, which would
 * cast the Value; a Description, which no value has) is of nothing a save writes, nor is the name
 * of a row that is not a struct's field (the table offers an editor for none of these). The name of
 * the object's row, which is not the entry's, is where it stands in a struct or a cell, which a save
 * writes as it was read.
 *
 * `describe` false is for an editor drawn, which asks only whether there is one: the clause, which
 * names the node and the object, each a walk to the root and a label a step, is then not made, and
 * `why` is REFUSED. Made for every refused cell of a file of nested shared handles, it tripled the
 * time the file took to show.
 */
export function propertyAt(object, node, key, describe = true) {
    const refused = (why) => ({ why: describe ? why() : REFUSED });
    if (node === object) {
        if (key === 'Name' || key === 'name') {
            return refused(() => object.matlabPath + ' is named by where it stands in ' + rootOf(object).name + ', which a save writes as it was read');
        }
        if (key === 'Add') {
            return refused(() => object.matlabPath + ' takes no row added: a save writes its properties, and none of them is one');
        }
        return { property: key.charAt(0).toUpperCase() + key.slice(1) };
    }
    const valueNode = object._valueNode;
    for (let n = node; n && n !== object; n = n.parent) {
        if (n === valueNode && classOf(object) === PARAMETER) {
            if (key !== 'Value' && key !== 'Add' && key !== 'Name' && key !== 'name') {
                return refused(() => node.matlabPath + "'s " + key + ' is not part of the value of ' + object.matlabPath + '.Value, which is all of it a save writes');
            }
            if ((key === 'Name' || key === 'name') && !(node.parent instanceof StructNode)) {
                return refused(() => node.matlabPath + ' is named by where it stands in ' + object.matlabPath + '.Value');
            }
            return { property: 'Value' };
        }
    }
    return refused(() => node.matlabPath + ' is part of ' + object.matlabPath + ', of which a save writes only the properties it takes');
}
/** The `why` of a refusal not described (propertyAt's `describe` false): there is one, and no more. */
export const REFUSED = 'refused';
function rootOf(node) {
    let n = node;
    while (n.parent && !n.parent.isContainer) {
        n = n.parent;
    }
    return n;
}
/**
 * What the object at `node` holds in `subsystem`, read, and the node's fingerprint as it stands;
 * or why no edit of it can be written, as a clause naming it. For MatNode, which keeps one per
 * node from the first time its editor asks.
 */
export function objectStateOf(subsystem, node) {
    const path = node.matlabPath;
    const place = mcosPlaceOf(node);
    const objectId = place ? objectIdOf(place.variable.mcosHandle, place.index) : null;
    if (objectId === null) {
        return path + " is not one of the file's objects this editor can find";
    }
    const stored = storedProperties(subsystem, objectId);
    if (!stored.ok) {
        return path + "'s object could not be read as a save writes it (" + stored.message + ')';
    }
    if (stored.className !== classOf(node)) {
        return path + ' is shown as ' + classPhrase(classOf(node)) + ", where the file's object is " + classPhrase(stored.className);
    }
    const entries = new Map();
    const cellIndex = new Map();
    for (const p of stored.properties) {
        entries.set(p.savedName, { refusal: p.refusal, value: p.cellIndex === null ? null : cellValueAt(subsystem, p.cellIndex) });
        if (p.cellIndex !== null) {
            cellIndex.set(p.savedName, p.cellIndex);
        }
    }
    const held = { className: stored.className, stored: entries };
    const exact = new Map();
    const asRead = new Map();
    for (const property of NODE_PROPERTIES[stored.className] ?? []) {
        const named = path + '.' + property;
        const one = entries.get(savedNameOf(stored.className, property));
        const reference = one ? one.value : DEFAULTS[property];
        const v = nodePropertyValue(node, property);
        if (typeof v === 'string') {
            exact.set(property, named + ' ' + v);
            continue;
        }
        const difference = reference ? variableDifference(v, reference, named) : named + ' is held in a value that does not read';
        exact.set(property, difference && named + ' is not, as this editor reads it, the value the file holds (' + difference + '), so a save could not write it as it is');
        if (difference) {
            asRead.set(property, v);
        }
    }
    return {
        objectId,
        held,
        cellIndex,
        exact,
        asRead,
        late: !!node._objectEdited,
        fingerprint: fingerprintOf(node),
        dataType: String(node.DataType ?? ''),
    };
}
/**
 * Why no edit of the object at `node` is taken at all, its class being one with no rules
 * (McosEditRules.hasEditRules), as a clause, or null.
 */
export function classRefusal(state, node) {
    return hasEditRules(state.held.className) ? null : propertyEditRefusal(state.held, 'Value', node.matlabPath);
}
/**
 * Why an edit of `property` of the object at `node` is refused whatever its value, as a clause, or
 * null where its value decides: not one the node holds an editor's value of, one the rules refuse
 * for the object (McosEditRules.propertyEditRefusal: at its default, an index, an object), one
 * whose value as the node held it did not read back as the file's (McosObjectState.exact), and one
 * whose value now is of a class the rules write none of (McosEditRules.propertyValueRefusal: a
 * sparse Value, which an edit of an element leaves sparse).
 */
export function propertyRefusal(state, node, property) {
    const path = node.matlabPath;
    const cls = state.held.className;
    if (hasEditRules(cls) && savedNameOf(cls, property) !== null && !NODE_PROPERTIES[cls]?.includes(property)) {
        return path + '.' + property + ' is not one this editor edits in ' + classPhrase(cls);
    }
    const refused = propertyEditRefusal(state.held, property, path) ?? state.exact.get(property) ?? null;
    if (refused) {
        return refused;
    }
    const now = nodePropertyValue(node, property);
    return typeof now === 'string' ? path + '.' + property + ' ' + now : propertyValueRefusal(cls, property, now, path);
}
/**
 * propertyRefusal of each object's node and property, found once and kept until an edit at or under
 * the node (forget): what the editor asks of the object at every row under it, and what a Value of N
 * elements costs N to answer once an edit made its rows the value (it is read as the variable a save
 * writes, MatlabVariableNode._var). What else the answer reads, the object's state, never changes.
 * Kept by a MAT-file (MatNode._nodeEdited) and by a dictionary value's stream (mcosStreamEdit), each
 * told of every edit of a node of it (BaseNode._markSourceDirty), which every setter, undo and copy
 * into a twin makes once it has changed the node.
 */
export class McosPropertyVerdicts {
    constructor() {
        this._byNode = new WeakMap();
    }
    of(state, node, property) {
        let held = this._byNode.get(node);
        if (!held) {
            held = new Map();
            this._byNode.set(node, held);
        }
        let verdict = held.get(property);
        if (verdict === undefined) {
            verdict = propertyRefusal(state, node, property);
            held.set(property, verdict);
        }
        return verdict;
    }
    /** An edit at `edited`: what was found of every node at or above it is forgotten. */
    forget(edited) {
        for (let n = edited; n; n = n.parent) {
            this._byNode.delete(n);
        }
    }
}
/**
 * The value of `property` the node of an object holds now, as the variable a save writes, nameless;
 * or why it holds none, as the rest of a clause about the property. `field`, when given, is what the
 * node would hold instead, as the node holds it: a bound as a number or undefined, text as a string,
 * a Value as the value node an edit would make (MatNode._editValueRefusal).
 */
export function nodePropertyValue(node, property, field) {
    const own = node;
    const held = field ? field.value : property === 'Value' ? undefined : own[property];
    switch (property) {
        case 'Value':
            if (isElementEdit(held)) {
                return elementEditValue(node, held);
            }
            return valueVariable(field ? held : bareValueNode(node));
        case 'Min':
        case 'Max':
            if (typeof held === 'number') {
                return doubleOf(held);
            }
            return held === undefined || held === null || (Array.isArray(held) && held.length === 0) ? emptyDouble() : 'is not held as a number';
        case 'Description':
        case 'Unit':
        case 'DataType':
            return typeof held === 'string' ? charOf(held) : 'is not held as text';
        default:
            return 'is not one this editor edits in an object';
    }
}
/**
 * Why `value`, a node built of the text an edit typed into `node`, a field of the struct Value of
 * the Parameter at `object` (or a row under one), is what such a field holds no cell of, as a
 * clause, or null: text, which MATLAB refuses in a Parameter's struct, and anything else the rules
 * do not write (McosEditRules.valueMemberRefusal).
 */
export function memberRefusal(object, node, value) {
    const v = valueVariable(value);
    const what = typeof v === 'string' ? v.replace(/^holds /, '') : valueMemberRefusal(v);
    return what ? node.matlabPath + ' would be ' + what + ', which this editor does not write into ' + classPhrase(classOf(object)) + "'s Value" : null;
}
function isElementEdit(x) {
    return x !== null && typeof x === 'object' && 'element' in x && 'scalar' in x;
}
// The Value the Parameter at `node` would hold once `edit` is made: its Value's variable, the
// element replaced, at the slot its row has among the array's rows, which is the order the variable
// holds them in (MatlabVariableNode._buildVarObject). Of an element of an array in a struct Value,
// the Value as it is: a struct is not held to a range.
function elementEditValue(node, edit) {
    const valueNode = node._valueNode;
    const now = valueVariable(valueNode ?? bareValueNode(node));
    if (typeof now === 'string' || !valueNode || edit.element.parent !== valueNode) {
        return now;
    }
    const k = valueNode.children.indexOf(edit.element);
    const values = Array.isArray(now.value) ? now.value.slice() : [now.value];
    if (k < 0 || k >= values.length) {
        return now;
    }
    const s = edit.scalar;
    values[k] = !now.isComplex
        ? s
        : typeof s === 'number' || isExactToken(s)
            ? { re: s, im: 0 }
            : parseComplexNum(String(s), now.className) ?? { re: 0, im: 0 };
    return { ...now, value: values.length === 1 && !Array.isArray(now.value) ? values[0] : values };
}
// A Parameter's Value node, or the node it would make of a Value it holds bare (a number, a logical,
// text, none), which a Value with no rows to show is (ParameterNode._adoptValueNode).
function bareValueNode(node) {
    const p = node;
    return p._valueNode ?? NodeRegistry.parseValue(p.Value === undefined ? [] : p.Value, 'Value', null);
}
// The variable a value node is written as: a plain value's own (MatlabVariableNode._var), and a
// struct's built of its fields so; or why it is none.
function valueVariable(node) {
    if (node instanceof MatlabVariableNode) {
        if (node._undecoded || node._isOpaque) {
            return 'holds ' + (node._undecoded ? 'a value that was not decoded' : classPhrase(node._opaqueClassName || 'object'));
        }
        const v = node._var;
        return v.name === '' ? v : { ...v, name: '' };
    }
    if (node instanceof StructNode) {
        return structVariable(node);
    }
    return 'holds ' + classPhrase(classOf(node) || 'value') + ', which this editor does not write into an object';
}
// A struct Value's variable: a scalar's fields, each its child's variable, and an array's, each the
// list of every element's, in the element order the rows hold (column-major, StructNode.parse).
function structVariable(node) {
    const fields = node.serial._fields ?? [];
    const dims = node.dims;
    const n = elementCount(dims);
    const out = {};
    const memberOf = (holder, field) => {
        const child = holder.children.find((c) => c.name === field);
        return child ? valueVariable(child) : 'holds a struct that lacks its field ' + field;
    };
    if (n === 1 && !node._isElementNode) {
        for (const field of fields) {
            const v = memberOf(node, field);
            if (typeof v === 'string') {
                return v;
            }
            setOwn(out, field, v);
        }
    }
    else {
        if (node.children.length !== n) {
            return 'holds a struct array of ' + n + ' elements with ' + node.children.length + ' rows';
        }
        for (const field of fields) {
            const each = [];
            for (const element of node.children) {
                const v = memberOf(element, field);
                if (typeof v === 'string') {
                    return v;
                }
                each.push(v);
            }
            setOwn(out, field, each);
        }
    }
    return { name: '', className: 'struct', dimensions: dims.slice(), isComplex: false, isLogical: false, value: null, fields: out };
}
/**
 * Every edit of the object at `node`: each property the node holds an editor's value of whose
 * value is not the cell's, with `pending`, an edit about to be made, in place of what the node holds
 * of it; or why one cannot be written, as a clause. A property the node holds no value of a save can
 * write (a Value of a class it has no converter for) is not one the editor offered, and is taken as
 * it was read; one held at its default is an edit only where the node holds another value.
 */
export function objectEditsOf(state, node, pending) {
    const cls = state.held.className;
    const path = node.matlabPath;
    const edits = [];
    for (const property of NODE_PROPERTIES[cls] ?? []) {
        const named = path + '.' + property;
        const v = pending?.property === property ? pending.value : nodePropertyValue(node, property);
        const exact = state.exact.get(property) ?? null;
        const asRead = state.asRead.get(property);
        if (typeof v === 'string') {
            // No value a save writes: as it was read, where it was none then either.
            if (asRead || exact === null) {
                return { why: named + ' ' + v };
            }
            continue;
        }
        const held = state.held.stored.get(savedNameOf(cls, property));
        const reference = held ? held.value : DEFAULTS[property];
        if (reference && !variableDifference(v, reference, named)) {
            continue;
        }
        if (exact !== null) {
            // Never the file's: unedited where it is what the node held before any edit.
            if (!state.late && asRead && !variableDifference(v, asRead, named)) {
                continue;
            }
            return { why: exact };
        }
        const refused = propertyEditRefusal(state.held, property, path);
        if (refused) {
            return { why: refused };
        }
        edits.push({ property, value: v });
    }
    return { edits };
}
/**
 * The DataType the Simulink.Parameter at `node` loads with once saved, as its node is to show it
 * (ParameterNode._followSourceDataType): the text the save co-writes into its DataType cell with an
 * edit of its Value, as MATLAB's own `p.Value = v` re-derives it (McosEditRules: an int16 v makes
 * it 'int16', a double v over an int16 Value 'auto'), or else the DataType as it was read. Null for
 * another class, or where the node's edits cannot be written, which the save refuses anyway.
 *
 * Only a DataType the object holds a cell for is co-written. One it holds none for is at its class
 * default, which MATLAB re-derives from the Value as it loads the object, and is shown as read, as a
 * file read again shows it.
 */
export function shownDataType(state, node) {
    if (state.held.className !== PARAMETER) {
        return null;
    }
    const found = objectEditsOf(state, node);
    if ('why' in found) {
        return null;
    }
    if (!found.edits.some((e) => e.property === 'Value')) {
        return state.dataType;
    }
    const ruled = objectEditCells(state.held, found.edits, node.matlabPath);
    if (!ruled.ok) {
        return null;
    }
    const written = ruled.cells.find((c) => c.savedName === 'DataType');
    return written && typeof written.value.value === 'string' ? written.value.value : state.dataType;
}
/** What a node holds that a save does not write, as text to compare: see the file header. */
export function fingerprintOf(node) {
    const cls = classOf(node);
    const own = {};
    for (const key of Object.keys(node)) {
        if (!key.startsWith('_') && !OWN_FIELDS_WRITTEN.has(key) && key !== 'DataType') {
            own[key] = node[key];
        }
    }
    const bag = { ...node.serial?._properties };
    for (const key of BAG_KEYS_WRITTEN[cls] ?? []) {
        delete bag[key];
    }
    try {
        return JSON.stringify([own, bag], (_k, x) => (typeof x === 'bigint' ? x.toString() + 'n' : x));
    }
    catch (e) {
        return 'not fingerprinted: ' + (e instanceof Error ? e.message : String(e));
    }
}
/**
 * The nodes of each object two or more of `nodes` are, of a class whose properties a save writes,
 * each a twin showing what the file holds of the object (twinOf): the groups of a MAT-file
 * (MatNode._twinGroups) and of a dictionary value's stream (mcosStreamEdit), found before any edit
 * of one. `stateOf` is what the editor judged of a node (MatNode._objectState), made now for one
 * it has not judged yet.
 */
export function twinGroupsOf(nodes, stateOf) {
    const byId = new Map();
    for (const node of nodes) {
        const place = mcosPlaceOf(node);
        const id = place ? objectIdOf(place.variable.mcosHandle, place.index) : null;
        if (id !== null) {
            byId.set(id, [...(byId.get(id) ?? []), node]);
        }
    }
    const groups = [];
    for (const same of byId.values()) {
        if (same.length < 2) {
            continue;
        }
        const members = [];
        for (const node of same) {
            const state = stateOf(node);
            if (typeof state !== 'string' && hasEditRules(state.held.className)) {
                members.push(twinOf(node, state));
            }
        }
        if (members.length > 1) {
            groups.push({ members, master: null, diverged: null });
        }
    }
    return groups;
}
/** Each node of `groups`, and the group it is in: what the editor looks a node's twins up by. */
export function twinGroupByNode(groups) {
    const byNode = new Map();
    for (const group of groups) {
        for (const { node } of group.members) {
            byNode.set(node, group);
        }
    }
    return byNode;
}
/** The groups of `groups` with a node at or under `root`, or one `root` is at or under: the objects an edit there can reach. */
export function twinsTouching(groups, root) {
    return groups.filter((g) => g.members.some((m) => isAtOrUnder(m.node, root) || isAtOrUnder(root, m.node)));
}
/**
 * Why `object`, a node of `group`, takes no edit of its own, as a clause, or null: an edit of the
 * object was made through another node of it, its master, through which every later one is made
 * (mirrorTwins). `inTree` says whether a node is in its file's tree still, which a master is not
 * once its variable is deleted.
 */
export function twinMasterRefusal(group, object, inTree) {
    const master = group.master;
    if (!master || master === object) {
        return null;
    }
    const one = object.matlabPath + ' is one object with ' + master.matlabPath + ' (one handle), and ' + master.matlabPath;
    const why = inTree(master)
        ? one + ' holds an edit of it: the object is edited through ' + master.matlabPath + ', and ' + object.matlabPath + ' shows each edit'
        : one + ', which holds an edit of it, is deleted: ' + object.matlabPath + ' takes no edit of its own until that delete is undone, or the file is read again';
    return group.diverged ? why + ' (' + group.diverged + ')' : why;
}
function isAtOrUnder(node, root) {
    for (let n = node; n; n = n.parent) {
        if (n === root) {
            return true;
        }
    }
    return false;
}
/** A node of the object `state` describes, as one of its twins, showing what the file holds of it. */
export function twinOf(node, state) {
    const shown = new Map();
    for (const property of NODE_PROPERTIES[state.held.className] ?? []) {
        const held = state.held.stored.get(savedNameOf(state.held.className, property));
        shown.set(property, state.asRead.get(property) ?? (held ? held.value ?? nodePropertyValue(node, property) : DEFAULTS[property]));
    }
    return { node, state, shown };
}
/**
 * Brings the nodes `members` of one object back in step after an edit at or under one of them
 * (MatNode._mirrorTwins, and a dictionary value's stream's, mcosStreamEdit). The first edit of the
 * object makes the node it reached the group's master (the first in the tree, of two an edit made
 * around the session reached at once); then each property another node holds a value of the master
 * does not is copied from the master into it (copyObjectProperty), and it is marked edited
 * (DataNode._markModified), as it is: what MATLAB loads of it changed, and if the master is deleted,
 * it still carries the edit to the save. Answers the nodes copied into. With the master out of the
 * tree (its variable deleted), nothing is copied. And once every node of the group, in the tree or
 * not, holds what the file holds of the object again, the group has no master: the next edit makes
 * one of whichever node it is made through.
 *
 * A copy is made only where it reads back as the value copied, as the save reads both
 * (nodePropertyValue); one that would not is not made, said in `group.diverged`, and tried again
 * after the next edit. Each node's property is read once a call: a Value is read as the variable a
 * save writes, which costs each of its elements.
 */
export function mirrorTwins(group, members) {
    const cls = members[0].state.held.className;
    const properties = NODE_PROPERTIES[cls] ?? [];
    const read = new Map();
    const valueOf = (m, property) => {
        let of = read.get(m);
        if (!of) {
            of = new Map();
            read.set(m, of);
        }
        let v = of.get(property);
        if (v === undefined) {
            v = nodePropertyValue(m.node, property);
            of.set(property, v);
        }
        return v;
    };
    if (!group.master) {
        const changed = members.find((m) => properties.some((p) => !sameHeld(valueOf(m, p), m.shown.get(p), p)));
        group.master = changed ? changed.node : null;
    }
    const master = members.find((m) => m.node === group.master);
    const copied = new Set();
    if (master) {
        group.diverged = null;
        for (const property of properties) {
            const want = valueOf(master, property);
            for (const m of members) {
                if (m === master || sameHeld(valueOf(m, property), want, property)) {
                    continue;
                }
                const why = copyObjectProperty(master.node, m.node, property, want);
                if (why) {
                    group.diverged ??= m.node.matlabPath + ' could not be shown as ' + master.node.matlabPath + "'s edit leaves their object (" + why + '), and shows it as it was before';
                    continue;
                }
                copied.add(m.node);
            }
        }
        // Each node in the tree holds the master's now; one out of it, what it held as it left.
        const atFile = (m) => properties.every((p) => sameHeld(members.includes(m) ? valueOf(master, p) : nodePropertyValue(m.node, p), m.shown.get(p), p));
        if (!group.diverged && atFile(master) && group.members.every(atFile)) {
            group.master = null;
        }
    }
    for (const node of copied) {
        node._markModified();
    }
    return [...copied];
}
// Whether two readings of one property (nodePropertyValue) are one value.
function sameHeld(a, b, property) {
    if (typeof a === 'string' || typeof b === 'string' || a === undefined || b === undefined) {
        return a === b;
    }
    return variableDifference(a, b, property) === null;
}
/**
 * Copies `property` of the object at `from` into `to`, another node of the same object, as `from`
 * holds it, or answers why it does not, as a clause, having changed nothing: a bound or text by its
 * field; a Simulink.Parameter's Value as the node its Value is (built from what that node writes,
 * NodeRegistry.parseValue, the form both nodes were built of when read), with the Dimensions,
 * Complexity and DataType that follow it (ParameterNode._followValueShape). Not where the copy would
 * not read back as the value it copies. `want` is `from`'s, as nodePropertyValue reads it.
 */
export function copyObjectProperty(from, to, property, want = nodePropertyValue(from, property)) {
    const source = from;
    const target = to;
    if (property !== 'Value') {
        target[property] = source[property];
        return null;
    }
    const fromValue = from._valueNode ?? null;
    // A copy of its own: the master's value written holds the lists its node edits in place (a
    // struct's field names), so adopted as it was, a field the master deleted next was gone from the
    // twin's value but not its rows, and no later copy was made, the two reading alike.
    const raw = fromValue ? structuredClone(fromValue.serializeValue()) : undefined;
    const made = fromValue ? NodeRegistry.parseValue(raw, 'Value', null) : null;
    const got = made ? valueVariable(made) : want;
    const difference = typeof want === 'string' || typeof got === 'string' ? (want === got ? null : 'it holds no value a save writes') : variableDifference(got, want, 'Value');
    if (difference) {
        return difference;
    }
    const parameter = to;
    if (fromValue) {
        parameter._adoptValueNode(raw);
    }
    else {
        parameter._valueNode = null;
        parameter.children = [];
    }
    parameter.Value = source.Value;
    parameter._followValueShape();
    return null;
}
/**
 * The subsystem element with every edit of the objects at `nodes` written into its cells, and the
 * cells written; or null where none of them holds an edit (each as it was read, or edited back).
 * Throws MatWriteError, naming the variable an object is in and why, for an object or an edit it
 * cannot write: one its editor would not have offered, one the rules refuse, two nodes of one object
 * edited to two values of one property, one a path the editor did not judge changed.
 *
 * `stateOf` is what the editor judged of each node (MatNode._objectState), and `entryOf` the
 * variable a node is in, for the message.
 */
export function objectSubsystemEdit(subsystem, nodes, stateOf, entryOf) {
    const refuse = (node, why) => {
        throw new MatWriteError('Cannot write "' + entryOf(node) + '": ' + why + '. Nothing was written.');
    };
    // Each object's edits, merged over the nodes that are it, and the node each edit came from.
    const byObject = new Map();
    for (const node of nodes) {
        const state = stateOf(node);
        if (typeof state === 'string') {
            refuse(node, state);
        }
        const s = state;
        if (!hasEditRules(s.held.className)) {
            refuse(node, propertyEditRefusal(s.held, 'Value', node.matlabPath));
        }
        const followed = s.held.className === PARAMETER ? shownDataType(s, node) : null;
        if (fingerprintOf(node) !== s.fingerprint || (followed !== null && node.DataType !== followed)) {
            refuse(node, node.matlabPath + ' holds an edit of a property a save does not write into ' + classPhrase(s.held.className));
        }
        const found = objectEditsOf(s, node);
        if ('why' in found) {
            refuse(node, found.why);
        }
        const object = byObject.get(s.objectId) ?? { state: s, node, edits: new Map() };
        byObject.set(s.objectId, object);
        for (const { property, value } of found.edits) {
            const other = object.edits.get(property);
            if (other && variableDifference(value, other.value, node.matlabPath + '.' + property)) {
                refuse(node, node.matlabPath + ' and ' + other.node.matlabPath + ' are one object, whose ' + property + ' they were edited to two values of');
            }
            object.edits.set(property, { value, node });
        }
    }
    const objects = [];
    const cells = [];
    for (const [objectId, { state, node, edits }] of byObject) {
        if (edits.size === 0) {
            continue;
        }
        const ruled = objectEditCells(state.held, [...edits].map(([property, { value }]) => ({ property, value })), node.matlabPath);
        if (!ruled.ok) {
            refuse(edits.get(ruled.property)?.node ?? node, ruled.message);
        }
        const written = [];
        for (const { savedName, value } of ruled.cells) {
            let cell;
            try {
                cell = valueCellOf(value);
            }
            catch (e) {
                if (e instanceof MatWriteError) {
                    return refuse(node, node.matlabPath + '.' + savedName + ' could not be written (' + e.message + ')');
                }
                throw e;
            }
            written.push({ savedName, cell });
            cells.push({ objectId, cellIndex: state.cellIndex.get(savedName), savedName, value });
        }
        objects.push({ objectId, edits: written });
    }
    if (objects.length === 0) {
        return null;
    }
    const result = editMcosObjects(subsystem, objects);
    if (!result.ok) {
        return refuse(nodes[0], "the file's objects could not be written (" + result.message + ')');
    }
    return { element: result.bytes, cells };
}
function emptyDouble() {
    return { name: '', className: 'double', dimensions: [0, 0], isComplex: false, isLogical: false, value: [], fields: null };
}
function doubleOf(x) {
    return { name: '', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: x, fields: null };
}
function charOf(text) {
    return { name: '', className: 'char', dimensions: text === '' ? [0, 0] : [1, text.length], isComplex: false, isLogical: false, value: text, fields: null };
}
//# sourceMappingURL=mcosObjectEdit.js.map