// Copyright 2026 The MathWorks, Inc.
//
// A save of a Level-5 MAT-file (`-v6`, `-v7`): the file it was read from, with what was edited
// written fresh and everything else written as the bytes it was read from.
//
// WHY A SPLICE. A MAT-file is a header and a run of top-level records, each one variable, and
// the last one, unnamed, the subsystem that holds every object of the file. Nothing in a record
// points at another record, and nothing in the subsystem names a variable. So a record nobody
// edited can be written back as its own bytes, compressed as it was, which no re-encode
// reproduces: inflated and deflated again by fflate at level 6, 18 of the 78 compressed records
// of test/parity/artifacts/mat/cases.mat come back as they were. And the reader holds what it
// did not read (a record it could not inflate, a class it does not model) only as bytes. This
// is MATLAB's own update model too: measured against MATLAB R2027a, `save -append` copies every
// record it does not replace byte for byte, a compressed one included, keeps the header's text,
// and writes the subsystem last.
//
// What each record of the file becomes, in the file's order (plan):
//
//   the node it became was deleted         nothing
//   unedited                               its own bytes
//   only renamed                           its element with the name replaced (MatWriter.
//                                          elementNamed), compressed again if it was
//   its value edited, a plain value        written fresh (MatlabVariableNode._matStream),
//                                          named, compressed when the file holds any
//                                          compressed record
//   only properties of the MCOS objects    its own bytes, or renamed as above: the edits are
//   it holds edited                        written into the subsystem
//   no node: a record the reader dropped   its own bytes
//   the subsystem                          its own bytes, or, where an object's property was
//                                          edited, its element with the value cells that hold
//                                          them replaced (McosSubsystemEdit), every other byte
//                                          of it as it was, compressed again if it was
//
// and a variable added since the read is written fresh, after the last variable and before the
// subsystem. The header keeps its 116 bytes of text and its version and byte-order mark, and
// bytes 116-123 say where the subsystem now starts, which MATLAB trusts without a scan
// (measured against MATLAB R2027a: a stale offset fails the whole load).
//
// "Unedited" is decided by the node's status, which every edit sets (DataNode._markModified),
// and never by whether a value still has the bytes it was read from: those stay on a variable
// after an edit. "Only renamed" is the status, a name that is not the record's, and no edit of
// the value (DataNode._valueEdited). "Only properties of its objects" is an edited value no edit
// of which reached anything but an object's node or what is under it (DataNode._plainEdited).
//
// AN OBJECT'S PROPERTY. An object is not in the record of the variable that holds it: the record
// holds a handle, the object's id, and the object's properties are value cells of the subsystem
// (McosSubsystemEdit). So a variable whose edits were all of its objects' properties is written as it
// was read, a struct or a cell holding one included, and every such edit is written into the cell
// that holds the property, with the cells MATLAB's own edit changes with it (McosEditRules), by
// MatNode._objectSubsystemEdit. It refuses the save for an edit it cannot write, naming it. Two
// variables that hold one handle hold one object, and an edit of it is MATLAB's handle semantics:
// both load the edited object.
//
// EVERY DOUBT REFUSES THE SAVE. A save that cannot write a variable as what it is throws a
// MatWriteError naming it, and nothing is written: a function handle, a value the reader did not
// decode, or a variable holding an object, edited anywhere but at an object's property, which this
// writer has no encoder for; an object's property edited to what MATLAB would load otherwise, or
// warn of; a variable stored in a form MATLAB does not load as it is, whose value as read is this
// reader's guess at it; a variable stored after the subsystem, where MATLAB does not read it; a
// file whose records do not tile it, or that was opened without them. And before the bytes are
// handed back, every record written anew is read again, and one that does not read back as planned
// refuses the save as well (selfCheck: of a subsystem whose cells were swapped, every cell the bytes
// it was but those written, and those the values written), as does a file that breaks a rule MATLAB
// loads a file by that the file it was read from did not break (MatFileCheck). Both are asked of
// what the save changed, and of where every record stands: a record written as its own bytes is the
// record it was read as, and breaks what that one broke.
//
// The editor takes none of the edits refused for what a variable is or where it stands: its gate
// (MatNode._editRefusal) is built of the refusals exported here (unsavableRefusal,
// structureRefusal, freshRefusal, renameWhy, PAST_SUBSYSTEM, duplicateWhy), and of an object's
// property, of the rules MatNode._objectSubsystemEdit holds a save to (McosEditRules, with the
// node's values read as mcosObjectEdit reads them), so that an edit it takes is one a save writes,
// and the two cannot come to disagree. What is left to refuse at the save is what only a value's
// bytes say: MatWriter's budget, and the two checks of what was written.
import { zlibSync } from 'fflate';
import { inflateZlib } from './Inflate.js';
import { parseMat, functionHandleOf } from './MatParser.js';
import { MatBudgetError, MatWriteError, classPhrase, elementNamed, encodeMatVariable } from './MatWriter.js';
import { checkMatElement, violationsAddedBySplice } from './MatFileCheck.js';
import { integerConversion } from './XmlUtils.js';
import { cellValueAt, readMcosSubsystem } from './McosSubsystemEdit.js';
import { mcosMetaTableOf } from './McosParser.js';
import { validateMatlabName } from '../matlabName.js';
const MI_MATRIX = 14;
const MI_COMPRESSED = 15;
/**
 * The bytes of the MAT-file `matNode` is, as it stands now: what was edited written fresh,
 * everything else as the bytes it was read from. Throws MatWriteError, naming the variable or
 * the file and why, for anything it cannot write as what it is (see the file header), and
 * never hands back bytes that did not read back as planned.
 *
 * `check` is the budget of the check of what was written (MatFileCheck), its own by default:
 * for tests, which cannot make a file a gigabyte past it.
 */
export function serializeMatFile(matNode, check = {}) {
    const file = matNode.name;
    const unsavable = unsavableRefusal(matNode);
    if (unsavable) {
        throw unsavable;
    }
    const records = matNode.records;
    const headerBytes = matNode.headerBytes;
    const subsystem = subsystemOf(matNode, records);
    const plan = planOf(matNode, records, subsystem);
    // Nothing deleted, renamed, edited or added: the file, as it was read.
    if (plan.length === records.length && plan.every((p, i) => p.kind === 'verbatim' && p.record === records[i])) {
        return concat([headerBytes, ...records.map((r) => r.bytes)], fileTooBig(file));
    }
    const structure = structureRefusal(matNode, records, subsystem);
    if (structure) {
        throw structure;
    }
    const assembled = assemble(file, headerBytes, plan, subsystem);
    selfCheck(file, assembled, plan, headerBytes);
    refuseWorse(file, assembled, plan, headerBytes, records, check);
    return assembled.bytes;
}
/**
 * The refusal of every save of `matNode`, an unedited one included, or null: a tree opened
 * without the records a save writes back, one whose bytes the host has since handed away, and
 * a file whose records do not tile it. Asked first by serializeMatFile, and by the editor, which
 * takes no edit of a file no save can write (MatNode._editRefusal).
 */
export function unsavableRefusal(matNode) {
    const file = matNode.name;
    const { records, headerBytes } = matNode;
    if (!records || !headerBytes) {
        return new MatWriteError('Cannot save "' + file + '": it was opened without the records a save writes back, so a save would lose every one '
            + 'this package did not read. Nothing was written.');
    }
    // The records are views of the bytes the file was read from, which a host that transfers
    // them to a worker afterwards empties: what was not edited would be written as nothing.
    const gone = headerBytes.byteLength !== 128 ? { offset: 0, length: 128, bytes: headerBytes } : records.find((r) => r.bytes.byteLength !== r.length);
    if (gone) {
        return new MatWriteError('Cannot save "' + file + '": the bytes it was read from are no longer held (the ' + (gone.offset === 0 ? 'header' : 'record at byte ' + gone.offset)
            + ' holds ' + gone.bytes.byteLength + ' of its ' + gone.length + '), so what was not edited could not be written as it was. '
            + 'Nothing was written.');
    }
    if (!matNode.framed) {
        const at = matNode.unframed?.at ?? 128;
        const unframedBytes = headerBytes.buffer.byteLength - headerBytes.byteOffset - at;
        return new MatWriteError('Cannot save "' + file + '": this package could not frame ' + unframedBytes + ' byte(s) of it, from byte ' + at
            + (matNode.unframed ? ' (' + matNode.unframed.reason + ')' : '')
            + ', so a save could not keep them as they are. Nothing was written.');
    }
    return null;
}
// The record `matNode`'s header says its subsystem starts at, or null when it says there is none,
// or names a byte where no unnamed record starts (structureRefusal). By offset, and not by which
// record has no name: a matrix too short for its own flags reads as unnamed too. And unnamed,
// because a variable the header points at is a variable, whose edit is written or refused as
// any other's, and not passed over as the subsystem it is not.
export function subsystemOf(matNode, records) {
    if (matNode.subsystemOffset === 0) {
        return null;
    }
    return records.find((r) => r.offset === matNode.subsystemOffset && r.anonymous) ?? null;
}
// The file's records, each as a save writes it, in the file's order, and every variable added
// since the read just before the subsystem, or at the end of a file with none, in the order they
// were added. A record that became no node (the subsystem, one the reader dropped) is its own
// bytes. One past the subsystem, which MATLAB does not read, is too, and its edit refuses the
// save: written where it is, MATLAB still would not read it, and moved, what MATLAB loads of the
// file would change. Deleting one changes nothing MATLAB loads, and is written.
function planOf(matNode, records, subsystem) {
    const compress = records.some((r) => r.compressed);
    const added = matNode.children.filter((c) => matNode.recordOf(c) === null);
    const plan = [];
    const addAdded = () => {
        for (const node of added) {
            plan.push(freshOf(node, null, compress));
        }
    };
    let pastSubsystem = false;
    const ofObjects = [];
    for (const record of records) {
        if (record === subsystem) {
            addAdded();
            plan.push({ kind: 'verbatim', record });
            pastSubsystem = true;
            continue;
        }
        const node = matNode.nodeOf(record);
        if (!node) {
            plan.push({ kind: 'verbatim', record });
            continue;
        }
        if (node.parent !== matNode) {
            continue;
        }
        const edit = editOf(node, record);
        if (edit === 'none') {
            plan.push({ kind: 'verbatim', record });
        }
        else if (pastSubsystem) {
            throw refusal(node.name, PAST_SUBSYSTEM);
        }
        else if (edit === 'objects') {
            ofObjects.push(node);
            plan.push(node.name !== record.name ? renamedOf(node, record) : { kind: 'verbatim', record });
        }
        else if (edit === 'name') {
            plan.push(renamedOf(node, record));
        }
        else {
            plan.push(freshOf(node, record, compress));
        }
    }
    if (!subsystem) {
        addAdded();
    }
    refuseDuplicates(plan);
    const objects = ofObjects.length > 0 ? matNode._objectSubsystemEdit(ofObjects) : null;
    if (objects) {
        const at = plan.findIndex((p) => p.kind === 'verbatim' && p.record === objects.record);
        // Named, where a refusal names it, for the first variable whose object's edit it writes.
        plan[at] = { kind: 'objects', ...objects, bytes: recordBytes(objects.element, objects.record.compressed, ofObjects[0].name) };
    }
    return plan;
}
// What has happened to the variable `record` became, `node`: decided by its status, which every
// edit sets (DataNode._markModified), and by whether anything but its own rename set it
// (DataNode._valueEdited), and anything but an edit of its objects' properties
// (DataNode._plainEdited). A rename undone leaves the status set and the name the file's: it is
// unedited. Its name is asked whatever the status, so that a rename made around the API, which
// sets none, is still written as one.
function editOf(node, record) {
    const { status, _valueEdited, _plainEdited } = node;
    if (status === 'New') {
        return 'value';
    }
    if (status === 'Modified' && _valueEdited) {
        return _plainEdited ? 'value' : 'objects';
    }
    return node.name !== record.name ? 'name' : 'none';
}
/** Why the edit of a variable stored after the subsystem is refused (planOf, and the editor's gate). */
export const PAST_SUBSYSTEM = "it is stored after the file's objects, where MATLAB does not read it, so it would not be read written there, "
    + 'and moved, it would change what MATLAB loads of the file';
/**
 * The refusal of a save of a file with an unnamed record that is not its subsystem, or whose
 * header puts its subsystem where no unnamed record starts, or null: such a save cannot place
 * what it writes where MATLAB reads it. Measured against MATLAB R2027a, MATLAB lists no variable
 * past the first unnamed record, and a header offset that is not the subsystem's fails the whole
 * load. Asked only of a save that changes the file: one that does not hands back the bytes it was
 * read from. So the editor asks it of every edit (MatNode._editRefusal).
 */
export function structureRefusal(matNode, records, subsystem) {
    const file = matNode.name;
    const offset = matNode.subsystemOffset;
    if (offset !== 0 && !subsystem) {
        return new MatWriteError('Cannot save "' + file + '": its header places the file\'s objects at byte ' + offset + ', where '
            + (records.some((r) => r.offset === offset) ? 'a variable is' : 'no record starts') + ', so a save cannot say where they are. '
            + 'Nothing was written.');
    }
    const stray = records.find((r) => r.anonymous && r !== subsystem);
    if (stray) {
        return new MatWriteError('Cannot save "' + file + '": the record at byte ' + stray.offset + ' holds a value with no name that is not the '
            + 'file\'s objects, and MATLAB reads no variable past one, so a save cannot place an edit where MATLAB reads it. '
            + 'Nothing was written.');
    }
    return null;
}
// Two records of one name: MATLAB loads one of them (measured against MATLAB R2027a: `load f`
// keeps the last, `load f x` the first). A file that holds two keeps them, as it was read; a
// rename or an addition that would make two is refused, naming the variable. A record the reader
// could not read a name out of is held to none (MatNode._namespaceHolds says why).
function refuseDuplicates(plan) {
    const count = new Map();
    const nameOf = (p) => (p.kind === 'verbatim' || p.kind === 'objects' ? p.record.name : p.name);
    for (const p of plan) {
        count.set(nameOf(p), (count.get(nameOf(p)) ?? 0) + 1);
    }
    for (const p of plan) {
        if ((p.kind === 'renamed' || p.kind === 'fresh') && count.get(p.name) > 1) {
            throw refusal(p.name, duplicateWhy(p.name));
        }
    }
}
/** Why a variable is not written under `name`, which another variable of the file has (refuseDuplicates, and the editor's gate). */
export function duplicateWhy(name) {
    return 'the file holds another variable named "' + name + '", and MATLAB loads only one of them';
}
// The refusal of a save for variable `name`, worded as every refused write is (MatWriter's
// budgetFailure, DataNode's): the variable, why, and that nothing was written.
function refusal(name, why) {
    return new MatWriteError('Cannot write "' + name + '": ' + why + '. Nothing was written.');
}
// A name this writer puts in an element: a valid MATLAB name, by the rule a rename is held to
// (matlabName), which is stricter than MATLAB's and holds for older releases. A variable added
// by a caller that named it itself (MatNode.execAddEntry) has had no other check.
function refuseName(name) {
    const error = validateMatlabName(name);
    if (error) {
        throw refusal(name, 'it is not a name MATLAB can load (' + error + ')');
    }
}
// ---- What a renamed or an edited record is written as -----------------------------------------
// The record of a variable only renamed: its element as read, with the name subelement replaced
// (MatWriter.elementNamed) and every other byte copied, compressed again when it was. An object
// variable, a function handle and a value the reader did not decode are renamed so as well:
// nothing of them but their name is written.
function renamedOf(node, record) {
    const name = node.name;
    refuseName(name);
    const why = renameWhy(record);
    if (why) {
        throw refusal(name, why);
    }
    const element = elementOfRecord(record);
    return { kind: 'renamed', record, name, bytes: recordBytes(elementNamed(element, name), record.compressed, name), element };
}
/**
 * Why the variable read from `record` cannot be renamed, or null where it can: its record is not
 * one whole element whose name can be replaced (elementOfRecord, MatWriter.elementNamed), which a
 * record MATLAB writes always is. Asked by renamedOf, and by a rename before it is made
 * (MatNode._renameRefusal), once a record: the records never change, and asking inflates one.
 */
export function renameWhy(record) {
    let can = renamable.get(record);
    if (can === undefined) {
        const element = elementOfRecord(record);
        can = !!element && elementNamed(element, '') !== null;
        renamable.set(record, can);
    }
    return can ? null : 'the record it was read from, at byte ' + record.offset + ', is not a whole element whose name can be replaced, so it cannot be renamed';
}
const renamable = new WeakMap();
// The record of a value written fresh: `node`'s, an edited variable read from `record` or one
// added since, named, and compressed when the file holds any compressed record, so that a `-v6`
// file, which holds none and is readable by every MATLAB, stays one.
//
// Only a plain MATLAB value is written fresh. A variable that was an object, a string, a function
// handle or a value the reader did not decode is refused when anything but its name changed, as
// is a typed object's node, whatever it holds now: this writer has no encoder for an object, and
// the record's own bytes, which are the only thing it could write, are no longer the value.
function freshOf(node, record, compress) {
    const name = node.name;
    const refused = freshRefusal(node, record);
    if (refused) {
        throw refused;
    }
    const value = valueNodeOf(node);
    const named = elementNamed(globalAsRead(freshElement(value), record), name);
    if (!named) {
        throw refusal(name, 'the element written for it has no name to replace');
    }
    return { kind: 'fresh', record, node: value, name, bytes: recordBytes(named, compress, name) };
}
/**
 * The refusal a save throws for writing `node` fresh, the variable `record` became or one added
 * since (no record), or null where nothing about what it is refuses it: what an edit of anything
 * of it but its own name asks of a save. A name that is no MATLAB name by the rule a rename is
 * held to; a variable that was not a plain value, or whose node is a typed object's (freshOf); one
 * holding what this writer cannot write at any depth (unwritableIn); one with no form at all, a
 * container none of whose elements could be read (_heldNone) or a size that is no count
 * (_refuseNoSize); one holding a container read short at any depth (shortIn); and one stored in
 * a form MATLAB does not load as it is (storedRefusal).
 *
 * One rule for freshOf, which throws it, and for the editor, which takes no edit a save would
 * refuse so (MatNode._editRefusal): the two cannot come to disagree. What it does not judge is
 * what only the value's bytes say, MatWriter's budget among them, which freshElement meets.
 */
export function freshRefusal(node, record) {
    const name = node.name;
    const nameError = validateMatlabName(name);
    if (nameError) {
        return refusal(name, 'it is not a name MATLAB can load (' + nameError + ')');
    }
    const was = record?.variable ? notPlain(record.variable) : null;
    const value = valueNodeOf(node);
    if (was || !value) {
        const what = was ?? classPhrase(String(node.className || 'object'));
        return refusal(name, 'it is ' + what + ', which a MAT-file save writes only as it was read, or renamed, so its edit cannot be saved');
    }
    const unwritable = unwritableIn(value);
    if (unwritable) {
        return refusal(name, unwritable.path + ' is ' + unwritable.what + ', which this package cannot write into a MAT-file');
    }
    if (value._heldNone()) {
        return value._heldNoneRefusal();
    }
    try {
        value._refuseNoSize();
    }
    catch (e) {
        if (e instanceof MatWriteError) {
            return e;
        }
        throw e;
    }
    const short = shortIn(value);
    if (short) {
        return refusal(name, short.path + ' is ' + short.what + ', and a save would write the ones it does not hold as empty');
    }
    // And one stored in a form MATLAB does not load as it is (storedRefusal). Last, so that a
    // refusal that says more of the same damage (a container read short, a value not decoded) is
    // the one given.
    const stored = record ? storedRefusal(record) : null;
    if (stored) {
        return refusal(name, 'it is stored in a form MATLAB does not load as it is (' + stored + '), so there is no value of it a save '
            + 'can be held to: it is written only as it was read, or renamed');
    }
    return null;
}
// The rules of MatFileCheck a variable's own element can break whose break says that what this
// package read of it is not a value MATLAB loads: char data MATLAB does not read as text, or
// reads otherwise (miUINT8 Latin-1 bytes, which this reader decodes as UTF-8, miUTF32, which it
// decodes as UTF-8 too, and CJK in miUINT16, of which MATLAB keeps the low byte of each unit), a
// char's UTF-8 that does not hold its count, a numeric class stored in another's type, a matrix
// its sub-elements do not fill, one MATLAB cannot read where it stands, a data part holding more
// or fewer elements than the dims say. Written fresh, each was this reader's guess at it, which
// MATLAB then loaded in its place: measured on MATLAB's verdict corpus (test/fixtures/mat-check),
// a 1x3 char stored as miUTF32 was written as the 1x12 of its bytes, and 'héllo' stored as miUINT8
// as 'h\uFFFDllo'. Not a name (a fresh one is held to validateMatlabName), nor what only the file
// breaks around the element.
const VALUE_RULES = new Set(['char-type', 'utf8-count', 'int-storage', 'nbytes', 'element', 'data-size']);
// What `record`'s own element breaks of VALUE_RULES, as checkMatElement says it, or null. Of the
// element the reader read, which it holds whole (MatVariable._rawBytes), so nothing is inflated;
// once per record, whose bytes never change.
const storedVerdicts = new WeakMap();
function storedRefusal(record) {
    let verdict = storedVerdicts.get(record);
    if (verdict === undefined) {
        const element = record.variable?._rawBytes;
        const broken = element ? checkMatElement(element).find((v) => VALUE_RULES.has(v.code)) : undefined;
        verdict = broken ? broken.message.replace(/\.$/, '') : null;
        storedVerdicts.set(record, verdict);
    }
    return verdict;
}
/**
 * The first container at or under `at` that holds fewer elements than it declares, read short
 * out of a damaged record (MatParser's "declares 3 cell(s) and only 1 could be read"), with its
 * path and what it holds; null for none. MatWriter writes each element it does not hold as an
 * empty double, a hole (cellBody, structBody), which is a value the file did not hold, and past
 * its budget refuses the save: a 1x600000 cell holding one element was 599,999 of them. So such a
 * variable is written only as it was read, or renamed. A container the node ceiling built without
 * its rows is asked of the variable it was read as, which is what it is written as.
 */
function shortIn(at) {
    const node = valueNodeOf(at);
    if (!node) {
        return null;
    }
    if (node._cutByCeiling && node._matVar) {
        return shortVariableIn(node._matVar, node.matlabPath);
    }
    const declared = (node._dims || []).reduce((a, b) => a * b, 1);
    const isStruct = node._kind === 'scalar' && node._scalarType === 'struct';
    if (node._kind !== 'cell' && !isStruct) {
        return null;
    }
    // A struct array's rows are its elements, and one with no fields past the cap has none: it is
    // written as the bytes it was read from (MatlabVariableNode._unexpandedStruct).
    const holdsElements = node._kind === 'cell' || (declared !== 1 && !node._unexpandedStruct());
    if (holdsElements && node.children.length < declared) {
        return { path: node.matlabPath, what: heldPhrase(node._dims, node._kind === 'cell' ? 'cell' : 'struct array', node.children.length) };
    }
    for (const child of node.children) {
        const below = shortIn(child);
        if (below) {
            return below;
        }
    }
    return null;
}
// shortIn, of a variable as MatParser read it.
function shortVariableIn(v, path) {
    if (!v) {
        return null;
    }
    const dims = dimsOf(v);
    const declared = dims.reduce((a, b) => a * b, 1);
    if (v.className === 'cell') {
        const members = flatValues(v.value);
        const held = members.slice(0, declared).filter(Boolean).length;
        if (held < declared) {
            return { path, what: heldPhrase(dims, 'cell', held) };
        }
        for (let i = 0; i < members.length; i++) {
            const below = shortVariableIn(members[i], path + '{' + (i + 1) + '}');
            if (below) {
                return below;
            }
        }
    }
    if (v.className === 'struct' && v.fields) {
        for (const name of Object.keys(v.fields)) {
            const held = v.fields[name];
            const elements = Array.isArray(held) ? held : [held];
            const present = elements.slice(0, declared).filter(Boolean).length;
            if (present < declared) {
                return { path, what: heldPhrase(dims, 'struct array', present) + ' in its field ' + name };
            }
            for (let e = 0; e < elements.length; e++) {
                const below = shortVariableIn(elements[e], path + (Array.isArray(held) ? '(' + (e + 1) + ')' : '') + '.' + name);
                if (below) {
                    return below;
                }
            }
        }
    }
    return null;
}
function heldPhrase(dims, what, held) {
    return 'a ' + dims.join('x') + ' ' + what + ' holding ' + held + ' of the ' + dims.reduce((a, b) => a * b, 1) + ' elements it declares';
}
// `node` as the node of a plain MATLAB value, or null for a node of another class: a typed
// object's (a ParameterNode, a BusNode). Asked of what the node does rather than of its class,
// which this layer does not import (test/moduleBoundaries): a MatlabVariableNode, and only it,
// writes its value as a MAT stream.
function valueNodeOf(node) {
    const v = node;
    return typeof v._matStream === 'function' && typeof v._matWritable === 'function' ? v : null;
}
// What a variable read as `v` is, in words, when it is not a plain MATLAB value; null when it is.
function notPlain(v) {
    if (v.isOpaque) {
        return classPhrase(v.className || 'object');
    }
    if (functionHandleOf(v) || v.className === 'function_handle') {
        return 'a function handle';
    }
    if (v.className === 'unknown' || v.undecoded) {
        return 'a value that was not decoded';
    }
    return null;
}
// Where an element's array flags keep its flags byte: past the element's tag and the flags' own,
// which MATLAB and MatWriter both write in the long form (8 bytes of tag, then 8 of data), and
// the byte after the class; and its bit for global.
const FLAGS_BYTE = 17;
const GLOBAL_FLAG = 0x04;
// `element`, written fresh for the variable `record` holds, global when that one was
// (MatVariable.isGlobal). The flag is the workspace variable's and not its value's, so no writer
// of a value writes it, and written fresh a variable saved as global was not one: `load(f)` no
// longer declared it global. A rename splice keeps it with the rest of the element. Only the
// top-level element, the one MATLAB sets it on; and on a copy, since the element may be a view
// of the bytes the file was read from (_matStream's own, which then hold it already).
function globalAsRead(element, record) {
    const longFlags = element.byteLength > FLAGS_BYTE && u32At(element, 8) === 6 && u32At(element, 12) === 8;
    if (!record?.variable?.isGlobal || !longFlags || element[FLAGS_BYTE] & GLOBAL_FLAG) {
        return element;
    }
    const out = element.slice();
    out[FLAGS_BYTE] |= GLOBAL_FLAG;
    return out;
}
// The miMATRIX element `node`'s value is, with the empty name a stream's value has: the stream it
// is written as in a dictionary (_matStream), which writes a sparse array no element row edited
// and a struct array with no element rows as the bytes they were read from, and anything else as
// MatWriter writes it, once freshRefusal has found nothing in it this writer cannot write. Refused
// as a dictionary's save refuses it past MatWriter's budget, restated naming the variable
// (_budgetFailure), and for any other refusal of MatWriter's.
function freshElement(node) {
    const stream = node._matStream();
    if (stream) {
        return stream.subarray(8);
    }
    // _matStream answers null for a refusal of MatWriter's other than its budget's: asked again,
    // for its reason.
    try {
        encodeMatVariable(node._var);
    }
    catch (e) {
        if (e instanceof MatBudgetError) {
            throw node._budgetFailure(e);
        }
        if (e instanceof MatWriteError) {
            throw refusal(node.name, e.message);
        }
        throw e;
    }
    throw refusal(node.name, 'no MAT element could be written for it');
}
/**
 * The first node at or under `at` that MatWriter cannot write as what it is (the rule of
 * MatlabVariableNode._matWritable), with its MATLAB path and what it is, or null for none. Asked
 * by freshRefusal, and by the editor of a value about to be typed in (MatNode._valueRefusal).
 *
 * A container the node ceiling built without its rows (_cutByCeiling) is written as the variable
 * it was read as (MatlabVariableNode._var), so that variable is what is asked of it, and not its
 * rows, which _matWritable would find none of to refuse: a cell of function handles, cut, said
 * nothing, and its edit was refused by MatWriter at the save.
 */
export function unwritableIn(at) {
    const found = unwritableAt(at);
    if (found) {
        return found;
    }
    const node = valueNodeOf(at);
    return node._matWritable() ? null : { path: node.matlabPath, what: 'a value MatWriter has no variable for' };
}
function unwritableAt(at) {
    const node = valueNodeOf(at);
    if (!node) {
        return { path: at.matlabPath, what: classPhrase(String(at.className || 'object')) };
    }
    if (node._isOpaque) {
        return { path: node.matlabPath, what: classPhrase(node._opaqueClassName || 'object') };
    }
    if (node._undecoded) {
        return { path: node.matlabPath, what: 'a value that was not decoded' };
    }
    if (node._scalarType === 'string' || node._scalarType === 'function_handle') {
        return { path: node.matlabPath, what: node._scalarType === 'string' ? 'a string' : 'a function handle' };
    }
    if (node._cutByCeiling && node._matVar) {
        return notPlainIn(node._matVar, node.matlabPath);
    }
    // Only a cell and a struct hold values of their own: an array's rows are its elements.
    if (node._kind === 'cell' || node._scalarType === 'struct') {
        for (const child of node.children) {
            const below = unwritableAt(child);
            if (below) {
                return below;
            }
        }
    }
    return null;
}
// The first member at or under the variable `v`, at `path`, that is not a plain MATLAB value
// (notPlain), with its path, or null: the members of a cell and the fields of a struct, at any
// depth, as MatParser holds them.
function notPlainIn(v, path) {
    if (!v) {
        return null;
    }
    const what = notPlain(v);
    if (what) {
        return { path, what };
    }
    if (v.className === 'cell') {
        const members = flatValues(v.value);
        for (let i = 0; i < members.length; i++) {
            const below = notPlainIn(members[i], path + '{' + (i + 1) + '}');
            if (below) {
                return below;
            }
        }
    }
    if (v.className === 'struct' && v.fields) {
        for (const name of Object.keys(v.fields)) {
            const held = v.fields[name];
            const elements = Array.isArray(held) ? held : [held];
            for (let e = 0; e < elements.length; e++) {
                const below = notPlainIn(elements[e], path + (Array.isArray(held) ? '(' + (e + 1) + ')' : '') + '.' + name);
                if (below) {
                    return below;
                }
            }
        }
    }
    return null;
}
/**
 * The miMATRIX element `record` holds, inflated, or null where it holds no whole one
 * (elementOfRecord): what the subsystem's cells are swapped in (MatNode._mcosSubsystem).
 */
export function subsystemElementOf(record) {
    return elementOfRecord(record);
}
// The miMATRIX element a record holds: its own bytes for a plain one, its payload inflated for a
// compressed one. Null when there is no whole element, or bytes after it: a record that is not
// one MATLAB writes is not one to rename.
function elementOfRecord(record) {
    const bytes = record.bytes;
    if (bytes.byteLength < 8) {
        return null;
    }
    const nbytes = u32At(bytes, 4);
    if (!record.compressed) {
        return u32At(bytes, 0) === MI_MATRIX && 8 + nbytes <= bytes.byteLength ? bytes.subarray(0, 8 + nbytes) : null;
    }
    let inflated;
    try {
        inflated = inflateZlib(bytes.subarray(8, 8 + nbytes));
    }
    catch {
        return null;
    }
    if (inflated.byteLength < 8 || u32At(inflated, 0) !== MI_MATRIX) {
        return null;
    }
    return 8 + u32At(inflated, 4) === inflated.byteLength ? inflated : null;
}
// A top-level record of `element`, the variable `name`'s: the element itself, which MatWriter pads
// to 8 bytes as a plain record must be, or its zlib stream (RFC 1950, which MATLAB requires; level
// 6, MATLAB's default) in an miCOMPRESSED tag, with no padding after it, as MATLAB writes one.
function recordBytes(element, compress, name) {
    return compress ? compressedRecordOf(zlibSync(element, { level: 6 }), name) : element;
}
/**
 * The miCOMPRESSED record of `stream`, the zlib stream of the variable `name`'s element: its tag
 * and the stream. Refused for a stream of 4 GiB or more, whose length the tag's 32 bits cannot
 * say: written, its length would wrap, and the record would declare a few bytes of a stream that
 * goes on. Exported for test/matFileSave.test.ts, which holds it to that without a stream so big.
 */
export function compressedRecordOf(stream, name) {
    if (stream.byteLength > 0xffffffff) {
        throw refusal(name, 'compressed, its element is a stream of ' + stream.byteLength + ' bytes, more than the 4 GiB a record can say it holds');
    }
    return concat([u32le(MI_COMPRESSED), u32le(stream.byteLength), stream], (total) => refusal(name, 'its record would be ' + total + ' bytes, more than this runtime holds in one buffer'));
}
// The header and the planned records, back to back. The header is the file's own: its text
// (bytes 0-115, which MATLAB keeps on `-append` and never reads), and its version and byte-order
// mark (124-127). Bytes 116-123 are the subsystem's new offset, a little-endian uint64, or, in a
// file with no subsystem, the file's own: zeros or spaces, both of which MATLAB reads as none.
function assemble(file, headerBytes, plan, subsystem) {
    const header = headerBytes.slice();
    const parts = [header];
    const offsets = [];
    let subsystemAt = null;
    let at = header.byteLength;
    for (const p of plan) {
        const bytes = bytesOf(p);
        offsets.push(at);
        if ((p.kind === 'verbatim' || p.kind === 'objects') && p.record === subsystem) {
            subsystemAt = at;
        }
        parts.push(bytes);
        at += bytes.byteLength;
    }
    if (subsystemAt !== null) {
        new DataView(header.buffer, header.byteOffset, header.byteLength).setBigUint64(116, BigInt(subsystemAt), true);
    }
    return { bytes: concat(parts, fileTooBig(file)), offsets, subsystemAt };
}
// The bytes a planned record is written as: a record of the file's own, or the ones written for it.
function bytesOf(p) {
    return p.kind === 'verbatim' ? p.record.bytes : p.bytes;
}
// The refusal of a file of `total` bytes, more than one buffer here holds (concat).
function fileTooBig(file) {
    return (total) => new MatWriteError('Cannot save "' + file + '": the file written for it would be ' + total + ' bytes, more than this runtime holds in one buffer. '
        + 'Nothing was written.');
}
// ---- The self-check ---------------------------------------------------------------------------
//
// The bytes about to be handed back, against the plan: the header kept, and saying where the
// subsystem now is; the records the ones planned, back to back from byte 128 to the last byte,
// each at the offset planned and framed as the reader frames one; and every record written anew
// read again by this package's reader, alone: each renamed one named as planned and, but for its
// name, its element byte for byte; each written fresh named as planned and reading back as the
// value it was written from, its class, size and every element. Any difference refuses the save.
//
// A record written as its own bytes is not read again: it is the record the file was read as,
// whole (unsavableRefusal: not one byte of it handed away since), copied by assemble at the
// offset this checks. Reading it again would read the reader's own reading of the same bytes, at
// the cost of inflating every compressed record of the file at every save.
//
// This proves what was written is what was planned, and not that MATLAB loads it: this reader
// reads files MATLAB refuses. That is refuseWorse's to ask, of the other judge.
function selfCheck(file, assembled, plan, headerBytes) {
    const fail = (why) => {
        throw new MatWriteError('Cannot save "' + file + '": the file written for it did not read back as written: ' + why + '. Nothing was written.');
    };
    const { bytes, offsets } = assembled;
    const head = bytes.subarray(0, 128);
    if (!sameBytes(head.subarray(0, 116), headerBytes.subarray(0, 116)) || !sameBytes(head.subarray(124), headerBytes.subarray(124))) {
        return fail('its header is not the one it was read with');
    }
    const subsystemSaid = assembled.subsystemAt ?? 0;
    const offsetSaid = head.subarray(116, 124).every((b) => b === 0x20) ? 0 : Number(new DataView(head.buffer, head.byteOffset + 116, 8).getBigUint64(0, true));
    if (offsetSaid !== subsystemSaid) {
        return fail('its header places its objects at byte ' + offsetSaid + ', and they are at byte ' + subsystemSaid);
    }
    let end = 128;
    plan.forEach((p, i) => {
        const record = bytesOf(p);
        if (offsets[i] !== end) {
            fail('a record was written at byte ' + offsets[i] + ', where the one before it ends at byte ' + end);
        }
        if (p.kind === 'verbatim' && record.byteLength !== p.record.length) {
            fail('the record at byte ' + end + ' holds ' + record.byteLength + ' of the ' + p.record.length + ' bytes it was read as');
        }
        if (!framedAsRead(record) || u32At(bytes, end) !== u32At(record, 0) || u32At(bytes, end + 4) !== u32At(record, 4)) {
            fail('the record at byte ' + end + ' is not framed as the record written there');
        }
        end += record.byteLength;
    });
    if (end !== bytes.byteLength) {
        return fail('it is ' + bytes.byteLength + ' bytes, and its records end at byte ' + end);
    }
    plan.forEach((p, i) => {
        if (p.kind === 'verbatim') {
            return;
        }
        const at = offsets[i];
        const got = readAlone(file, head, bytes.subarray(at, at + p.bytes.byteLength));
        // The subsystem with cells swapped in it: its element the one written, and that element the
        // subsystem it was read as, but for the cells written (subsystemCellsDiffer).
        if (p.kind === 'objects') {
            const element = got && got.anonymous && got.compressed === p.record.compressed ? elementOfRecord(got) : null;
            if (!element || !sameBytes(element, p.element)) {
                fail("the file's objects, at byte " + at + ', are not the element written for them');
            }
            const wrong = subsystemCellsDiffer(elementOfRecord(p.record), p.element, p.cells, "the file's objects");
            if (wrong) {
                fail(wrong);
            }
            return;
        }
        if (!got || got.status !== 'read' || got.anonymous || got.name !== p.name || got.variable?.name !== p.name) {
            fail('the record at byte ' + at + ', written as "' + p.name + '", reads as ' + (got?.status === 'read' ? '"' + got.name + '"' : 'no variable'));
        }
        if (p.kind === 'renamed') {
            const unnamed = (e) => (e && wholeElement(e) ? elementNamed(e, '') : null);
            const was = unnamed(p.element);
            const is = unnamed(got.variable._rawBytes);
            if (!was || !is || !sameBytes(was, is)) {
                fail('"' + p.name + '" is not, but for its name, the element it was read as');
            }
            return;
        }
        const difference = differs(p.node._var, got.variable, p.name);
        if (difference) {
            fail(difference);
        }
        // Global as the variable it was written for was (globalAsRead), and a variable added since not.
        if (!!p.record?.variable?.isGlobal !== !!got.variable?.isGlobal) {
            const is = got.variable?.isGlobal ? 'global, where the variable it was written for was not' : 'not global, where the variable it was written for was';
            fail('"' + p.name + '" reads back ' + is);
        }
    });
}
/**
 * Where `element`, a subsystem a save wrote, is not `original`, the one it was read as, with `cells`
 * written into it, in words of `objects` (what the caller calls them: "the file's objects"), or
 * null where it is: it reads whole as a subsystem (its dims [1 N] its byte count among what that
 * asks); every byte the rewrite copies around the cells is the byte it was (copiedDiffer); its
 * metadata blob is the bytes it was, and so every object's class, property list and the cell each
 * property names; every cell written is a value cell of it, written once, and reads as the value it
 * was written from, and every cell not written is the bytes it was; and McosParser, which every
 * object of the file is shown through, reads the same table of objects out of it. The self-check of
 * a MAT-file's subsystem (selfCheck) and of a dictionary value's stream (mcosStreamEdit), which are
 * one check.
 */
export function subsystemCellsDiffer(original, element, cells, objects) {
    const was = original ? readMcosSubsystem(original) : null;
    const is = readMcosSubsystem(element);
    if (!was?.ok || !is.ok) {
        return objects + ' do not read back as a subsystem' + (is.ok ? '' : ' (' + is.message + ')');
    }
    const before = was.subsystem;
    const after = is.subsystem;
    const copied = copiedDiffer(before, after);
    if (copied) {
        return objects + ' read back with ' + copied + ', which no edit wrote, changed';
    }
    if (before.cells.length !== after.cells.length) {
        return objects + ' read back with ' + after.cells.length + ' cells where ' + before.cells.length + ' were written';
    }
    // A cell said written is not compared with what it was, so each is held to be one a swap writes,
    // and once: a value cell, and not the blob, the empty cell after it, or a per-class table.
    const written = new Map(cells.map((c) => [c.cellIndex, c]));
    for (const c of cells) {
        if (!Number.isInteger(c.cellIndex) || c.cellIndex < 2 || c.cellIndex >= 2 + before.valueCells) {
            return objects + ' were written with cell ' + c.cellIndex + ', which is not one of their ' + before.valueCells + ' value cells';
        }
        if (written.get(c.cellIndex) !== c) {
            return objects + ' were written with value cell ' + c.cellIndex + ' twice';
        }
    }
    for (let i = 0; i < before.cells.length; i++) {
        const cell = written.get(i);
        if (cell) {
            const difference = differs(cell.value, cellValueAt(after, i), 'object ' + cell.objectId + "'s " + cell.savedName);
            if (difference) {
                return difference;
            }
        }
        else if (!sameBytes(before.bytes.subarray(before.cells[i].at, before.cells[i].end), after.bytes.subarray(after.cells[i].at, after.cells[i].end))) {
            return i === 0 ? objects + ' read back with another table of them' : objects + ' read back with value cell ' + i + ', which no edit wrote, changed';
        }
    }
    const tableOf = (bytes) => JSON.stringify(mcosMetaTableOf(bytes));
    if (tableOf(original) !== tableOf(element)) {
        return objects + ' read back, as this package shows them, as another table of objects';
    }
    return null;
}
// What of the bytes McosSubsystemEdit's rewrite copies as they were read is not, in `after`, the
// bytes it was in `before`, as words, or null: the element's flags and name; the payload's 8-byte
// preamble and whatever follows the struct in it, its length included; every sub-element of the
// struct but the MCOS field's value, which stays where it was among them; the FileWrapper__ opaque's
// flags, name, type and class; and the cell array's flags, dims and name. What the rewrite writes
// anew around them is tags, each restating its byte count, and the element's dims, which reading
// whole holds to the bytes they frame (readMcosSubsystem).
const STRUCT_PARTS = ['flags', 'dims', 'name', 'field-name width', 'field names'];
function copiedDiffer(before, after) {
    const sub = (s, layer, i) => s.bytes.subarray(layer.subs[i].at, layer.subs[i].end);
    const payload = (s) => s.outer.subs[3];
    const preamble = (s) => s.bytes.subarray(payload(s).data, payload(s).data + 8);
    const tail = (s) => s.bytes.subarray(s.struct.end, payload(s).data + payload(s).bytes);
    if (before.struct.subs.length !== after.struct.subs.length || before.mcosField !== after.mcosField) {
        return 'the fields of their struct';
    }
    const ranges = [
        ['the flags of their element', sub(before, before.outer, 0), sub(after, after.outer, 0)],
        ['the name of their element', sub(before, before.outer, 2), sub(after, after.outer, 2)],
        ['the preamble of their payload', preamble(before), preamble(after)],
    ];
    before.struct.subs.forEach((_, i) => {
        if (i !== before.mcosField) {
            const what = i < 5 ? 'the ' + STRUCT_PARTS[i] + ' of their struct' : 'the value of field ' + (i - 4) + ' of their struct';
            ranges.push([what, sub(before, before.struct, i), sub(after, after.struct, i)]);
        }
    });
    ['flags', 'name', 'type', 'class'].forEach((what, i) => {
        ranges.push(['the ' + what + ' of their FileWrapper__', sub(before, before.opaque, i), sub(after, after.opaque, i)]);
    });
    ['flags', 'dims', 'name'].forEach((what, i) => {
        ranges.push(['the ' + what + ' of their cell array', sub(before, before.cellArray, i), sub(after, after.cellArray, i)]);
    });
    ranges.push(['the bytes after their struct', tail(before), tail(after)]);
    for (const [what, was, is] of ranges) {
        if (!sameBytes(was, is)) {
            return what;
        }
    }
    return null;
}
// Whether `record` is framed as MatParser frames a record of a file it calls framed: its tag's 8
// bytes and exactly the bytes they declare, which for a plain record are a whole number of 8-byte
// words; and a tag that is neither the zero one the reader stops at nor a small element's.
function framedAsRead(record) {
    if (record.byteLength < 8) {
        return false;
    }
    const type = u32At(record, 0);
    const n = u32At(record, 4);
    if (8 + n !== record.byteLength) {
        return false;
    }
    return type === MI_COMPRESSED || (n % 8 === 0 && !(type === 0 && n === 0) && !(type >>> 16 !== 0 && (type & 0xffff) !== 0));
}
// The one record of a file of `header` and `record`, as this package's reader reads it, or null
// where it reads that file as anything else.
function readAlone(file, header, record) {
    // The whole of a buffer of its own (concat), which the reader may take as it is.
    const alone = concat([header, record], fileTooBig(file));
    let parsed;
    try {
        parsed = parseMat(alone.buffer);
    }
    catch {
        return null;
    }
    return parsed.framed && parsed.records.length === 1 ? parsed.records[0] : null;
}
// Whether `element` is one miMATRIX element, its tag and exactly the bytes it declares.
function wholeElement(element) {
    return element.byteLength >= 8 && u32At(element, 0) === MI_MATRIX && 8 + u32At(element, 4) === element.byteLength;
}
// The bytes about to be handed back, judged by the rules MATLAB loads a file by (MatFileCheck),
// which this package's reader does not hold a file to: the save is refused when they break a rule
// the file they were read from did not break. A file that was read breaking one (two variables of
// one name, say) may still be saved, edited elsewhere, as long as the save adds nothing to it.
// Compared by rule and variable, not by offset, which every edit before a record moves; a
// variable renamed is compared under the name the file it was read from gave it.
//
// Judged where the save changed the file (violationsAddedBySplice): every record written anew and
// the record it replaces, the header, and where every record stands. A record written as its own
// bytes breaks what it broke as read, and the two are the same answer; so a save costs what it
// changed, and a file too big for the check's budget whole can still be saved where its edits
// are small. Phase 2, which writes the subsystem anew, hands it in as a record written in place of
// the subsystem's (MatSplicedRecord `replaces`), and it is checked whole as every written one is.
function refuseWorse(file, assembled, plan, headerBytes, records, check) {
    const index = new Map(records.map((r, i) => [r, i]));
    const renamed = new Map();
    const written = plan.map((p, i) => {
        if (p.kind === 'verbatim') {
            return { kept: index.get(p.record) };
        }
        if ((p.kind === 'renamed' || p.kind === 'fresh') && p.record?.name && p.record.name !== p.name) {
            renamed.set(p.name, p.record.name);
        }
        const at = assembled.offsets[i];
        return { written: assembled.bytes.subarray(at, at + p.bytes.byteLength), replaces: p.record ? index.get(p.record) : null };
    });
    const added = violationsAddedBySplice(
    // A compressed record's inflate, as the reader holds it (MatVariable._rawBytes): inflateZlib's
    // of the record's own bytes, so that the check does not inflate the file again.
    { header: headerBytes, records: records.map((r) => ({ bytes: r.bytes, inflated: r.compressed ? r.variable?._rawBytes : null })) }, { header: assembled.bytes.subarray(0, 128), records: written }, renamed, check);
    const broken = added.filter((v) => v.code !== 'budget');
    if (broken.length > 0) {
        const more = broken.length - 1;
        throw new MatWriteError('Cannot save "' + file + '": the file written for it breaks a rule MATLAB loads a file by, which the file it was read '
            + 'from does not: ' + broken[0].message + (more > 0 ? ' It breaks ' + more + ' more as well.' : '') + ' Nothing was written.');
    }
    if (added.length > 0) {
        // The check stopped before it had judged all of what the save wrote: nothing is known
        // broken, and nothing is known to load.
        throw new MatWriteError('Cannot save "' + file + '": the file written for it could not be verified within the check\'s budget against the rules '
            + 'MATLAB loads a file by (' + added[0].message.replace(/\.$/, '') + '), so it is not known to load. Nothing was written.');
    }
}
/**
 * Where the value read back, `read`, is not the value `model` it was written from, in words naming
 * it under `at`, or null where it is that value: the same class, complexity, storage and size, the
 * same members of a cell, the same fields of a struct in the same order, and each element the same
 * number as its class holds it. MatWriter's own rules are taken as the model's meaning, not its
 * result: an integer element as MATLAB converts it to the class, a single's as a float32, a member
 * a cell or a struct does not hold as the empty double written for it. The self-check's (selfCheck)
 * judge of a value written fresh, and the editor's of an object's property against the cell the
 * file holds it in (mcosObjectEdit).
 */
export function variableDifference(model, read, at) {
    return differs(model, read, at);
}
function differs(model, read, at) {
    const m = model ?? EMPTY_DOUBLE;
    const r = read ?? EMPTY_DOUBLE;
    const cls = classOf(m);
    const said = (what, was, is) => at + ': its ' + what + ' reads back as ' + is + ' where ' + was + ' was written';
    if (classOf(r) !== cls) {
        return said('class', cls, classOf(r));
    }
    const md = dimsOf(m);
    if (md.join('x') !== r.dimensions.join('x')) {
        return said('size', md.join('x'), r.dimensions.join('x'));
    }
    if (!!m.isComplex !== !!r.isComplex || !!m.isSparse !== !!r.isSparse) {
        return said('storage', storageOf(m), storageOf(r));
    }
    const n = md.reduce((a, b) => a * b, 1);
    if (m.isSparse) {
        return sparseDiffers(m, r, cls, at);
    }
    if (cls === 'cell') {
        const mc = flatValues(m.value);
        const rc = flatValues(r.value);
        for (let i = 0; i < n; i++) {
            const d = differs(mc[i], rc[i], at + '{' + (i + 1) + '}');
            if (d) {
                return d;
            }
        }
        return null;
    }
    if (cls === 'struct') {
        const mf = m.fields ?? {};
        const rf = r.fields ?? {};
        const names = Object.keys(mf);
        if (names.join(',') !== Object.keys(rf).join(',')) {
            return said('fields', names.join(', ') || 'none', Object.keys(rf).join(', ') || 'none');
        }
        for (let e = 0; e < n; e++) {
            for (const name of names) {
                const d = differs(memberOf(mf[name], e, n), memberOf(rf[name], e, n), at + (n === 1 ? '' : '(' + (e + 1) + ')') + '.' + name);
                if (d) {
                    return d;
                }
            }
        }
        return null;
    }
    if (cls === 'char') {
        const was = String(m.value ?? '');
        const is = String(r.value ?? '');
        return was === is ? null : said('text', JSON.stringify(was), JSON.stringify(is));
    }
    const mv = flatValues(m.value);
    const rv = flatValues(r.value);
    if (mv.length !== n || rv.length !== n) {
        return said('element count', String(mv.length), String(rv.length));
    }
    const same = sameNumberFor(cls);
    for (let i = 0; i < n; i++) {
        for (const part of m.isComplex ? ['re', 'im'] : ['re']) {
            const was = partOf(mv[i], part);
            const is = partOf(rv[i], part);
            if (!same(was, is)) {
                return said('element ' + (i + 1) + (m.isComplex ? ' (' + (part === 're' ? 'real' : 'imaginary') + ' part)' : ''), String(was), String(is));
            }
        }
    }
    return null;
}
// A sparse array's non-zeros, compared as a set of (row, column) to value: the order a writer
// puts them in is its own, and an explicit zero is not a non-zero MATLAB keeps.
function sparseDiffers(m, r, cls, at) {
    const ms = m.sparse;
    const rs = r.sparse;
    if (!ms || !rs) {
        return at + ': it holds no non-zeros to compare';
    }
    const same = sameNumberFor(cls);
    const entries = (s) => {
        const out = new Map();
        for (let k = 0; k < s.row.length; k++) {
            const re = s.re[k];
            const im = s.im ? s.im[k] : 0;
            if (re !== 0 || im !== 0) {
                out.set(s.row[k] + ',' + s.col[k], [re, im]);
            }
        }
        return out;
    };
    const was = entries(ms);
    const is = entries(rs);
    if (was.size !== is.size) {
        return at + ': it reads back with ' + is.size + ' non-zero(s) where ' + was.size + ' were written';
    }
    for (const [where, [re, im]] of was) {
        const got = is.get(where);
        if (!got || !same(re, got[0]) || !same(im, got[1])) {
            const [row, col] = where.split(',').map(Number);
            return at + ': its non-zero at (' + (row + 1) + ',' + (col + 1) + ') does not read back as written';
        }
    }
    return null;
}
const EMPTY_DOUBLE = { name: '', className: 'double', dimensions: [0, 0], isComplex: false, isLogical: false, value: null, fields: null };
const INTEGER_CLASS = /^u?int(?:8|16|32|64)$/;
// MATLAB's class of `v`: a logical array is class uint8 with the logical flag, in a file and in
// the variable the node layer hands MatWriter.
function classOf(v) {
    return v.isLogical || v.className === 'logical' ? 'logical' : v.className;
}
function storageOf(v) {
    return (v.isSparse ? 'sparse' : 'full') + (v.isComplex ? ' complex' : ' real');
}
// Whether two elements of class `cls` are the one number the class holds: an integer class's as
// MATLAB converts a value to it (integerConversion: rounded, saturated, NaN as 0), a logical's as a
// uint8, a single's as a float32, and a double's as itself, NaN equal to NaN and -0 not to 0.
function sameNumberFor(cls) {
    if (INTEGER_CLASS.test(cls) || cls === 'logical') {
        const to = integerConversion(cls === 'logical' ? 'uint8' : cls);
        return (a, b) => String(to(a)) === String(to(b));
    }
    if (cls === 'single') {
        return (a, b) => Object.is(Math.fround(Number(a)), Math.fround(Number(b)));
    }
    return (a, b) => Object.is(Number(a), Number(b));
}
// One part of a numeric element: a complex one is `{re, im}`, and a real one its real part, with
// an imaginary part of 0.
function partOf(x, part) {
    if (x !== null && typeof x === 'object' && 're' in x) {
        return x[part];
    }
    return part === 're' ? x : 0;
}
// Element `e` of `n` of a struct field: a struct array holds one variable per element, a 1x1
// struct the variable itself (MatVariable.fields).
function memberOf(held, e, n) {
    return Array.isArray(held) ? held[e] : n === 1 ? held : undefined;
}
// A MAT element has at least two dimensions; a variable may say fewer (MatWriter.dimsOf).
function dimsOf(v) {
    const d = (v.dimensions || []).slice();
    while (d.length < 2) {
        d.push(1);
    }
    return d;
}
// The values of a variable as one list: MatParser leaves a 1x1 a bare value and an empty one null.
function flatValues(value) {
    if (value === null || value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}
// ---- Bytes ------------------------------------------------------------------------------------
// `parts`, back to back in a buffer of their own; or, past the most bytes the runtime holds in one
// buffer, `tooBig`'s refusal of that many, rather than the RangeError the runtime throws, which
// says nothing of what was being written.
function concat(parts, tooBig) {
    let total = 0;
    for (const p of parts) {
        total += p.byteLength;
    }
    let out;
    try {
        out = new Uint8Array(total);
    }
    catch (e) {
        if (e instanceof RangeError) {
            throw tooBig(total);
        }
        throw e;
    }
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.byteLength;
    }
    return out;
}
function u32le(n) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, n >>> 0, true);
    return out;
}
function u32At(bytes, at) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);
}
function sameBytes(a, b) {
    if (a.byteLength !== b.byteLength) {
        return false;
    }
    for (let i = 0; i < a.byteLength; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}
//# sourceMappingURL=MatFileWriter.js.map