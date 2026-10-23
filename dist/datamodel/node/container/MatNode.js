// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import MatlabVariableNode from '../data/MatlabVariableNode.js';
import MatlabValueParser from '../../parser/MatlabValueParser.js';
import { attachMcosDecoded, modelOpaqueMcosVariable } from '../data/mcosTypedNode.js';
import { mcosDecodedFor } from '../data/mcosDecodedTable.js';
import { reasonOf } from '../../parser/ParseWarning.js';
import { functionHandleOf } from '../../parser/MatParser.js';
import PropName from '../../prop/PropName.js';
import { MAT_NODE_CEILING } from '../../display/DisplayConvention.js';
import { buildUnderCeiling, buildUncut, chargeNodes } from '../data/matNodeCeiling.js';
import { PAST_SUBSYSTEM, duplicateWhy, freshRefusal, renameWhy, structureRefusal, subsystemElementOf, subsystemOf, unsavableRefusal, unwritableIn, } from '../../parser/MatFileWriter.js';
import { MatWriteError } from '../../parser/MatWriter.js';
import { cloneSubsystem, measuredVersion, readSubsystem, stringObjectOf, writeSubsystem } from '../../parser/McosSubsystemCodec.js';
import { CREATABLE_MCOS_CLASSES, createAppendSession, createTemplateSubsystem, mergeTemplateObject, newObjectVariable, } from '../../parser/McosTemplateMerge.js';
import { editedObjects, elementValue } from '../../parser/McosObjectWrite.js';
import * as NodeRegistry from '../NodeRegistry.js';
import { objectIdOf } from '../../parser/McosSubsystemEdit.js';
import { memberRefusal, objectNodeAt, objectNodesUnder, mirrorTwins, twinGroupByNode, twinGroupsOf, twinMasterRefusal, twinsTouching, } from '../data/mcosObjectEdit.js';
import { matClassRefusal, matEditsRefusal, matObjectStateOf, matObjectSubsystemEdit, matPropertyAt, matShownDataType, projectedBusState, spotValue, matBagEditorOf, matBagEditorsOf, matBagEditorShown, matOffersSpot, matNumericTypeAfter, BUS_ELEMENTS, ELEMENTS_SAVED, MatSpotVerdicts, } from '../data/matObjectEdit.js';
import { mcosPlaceOf, setMcosPlace } from '../mcosPlace.js';
import { validateMatlabName } from '../../matlabName.js';
import { owningEntryOf } from '../DataNode.js';
import { propertyChoices } from '../../parser/McosPropertyRules.js';
import { sourceLeaf, writeSourcePath } from '../../schema/index.js';
import { basenameOf } from '../../fileKinds.js';
export default class MatNode extends ContainerNode {
    constructor(name) {
        super(name, null);
        // Why the last execAddEntry added nothing (addEntryRefusal), or null.
        this._addRefused = null;
        // Each variable an edit put another in place of (_retype), and that one: what a save follows to
        // write the variable in place of the record it replaced (_replacementOf).
        this._replaced = new Map();
        this.header = '';
        this.dirty = false;
        this._valueVerdicts = new WeakMap();
        this._nameCounts = null;
        this._countedAt = -1;
        this._entriesVersion = 0;
        this._objectStates = new WeakMap();
        this._busProjections = new WeakMap();
        this._propertyVerdicts = new MatSpotVerdicts();
        this._anonymousElements = [];
        this.headerBytes = null;
        this.records = null;
        this.subsystemOffset = 0;
        this.framed = false;
        this.unframed = null;
        this._recordNodes = new Map();
        this._nodeRecords = new Map();
    }
    /**
     * The record `node` was read from, or null for a node no record became: a variable added
     * since the file was read, or any node of a tree with no records (`records` null).
     */
    recordOf(node) {
        return this._nodeRecords.get(node) ?? null;
    }
    /**
     * The node `record` became, whether or not it is still in the tree (a deleted one's
     * `parent` is not this), or null for a record that became no node: the subsystem or
     * another unnamed element (`_anonymousElements`), and a record the reader dropped.
     */
    nodeOf(record) {
        return this._recordNodes.get(record) ?? null;
    }
    get displayName() {
        return this.name;
    }
    // Saved by serializeSource (MatFileWriter), so a file is read-only only when no save of it
    // can be written: opened without its records, its bytes handed away since, its records not
    // tiling it, or its subsystem not where its header says (_fileRefusal).
    get readOnly() {
        return this._fileRefusal() !== null;
    }
    // An edit of `node`, which is a variable of this file or a node under one (BaseNode.
    // _markSourceDirty): what the gate found of that variable's value is forgotten, and of no other,
    // since nothing a save refuses of a value written fresh is about another variable
    // (freshRefusal). Which names two of them share is counted apart (_namespaceHolds). Forgetting
    // every variable's at every edit re-walked every variable a table showed after each, and each
    // of N renames counted N names again.
    //
    // But for an object other nodes of the file are too (_twinGroups: `r = h`), whose edit is one of
    // every variable holding it, which MATLAB loads it in, whether or not it was copied into their
    // nodes (_mirrorTwins, which marks each of them edited, and so comes here for each, where the
    // session made the edit): what was found of each of those variables is forgotten as well. A
    // variable holding an object is refused written fresh whatever the object's properties
    // (freshRefusal), so nothing found of it changes; it is forgotten all the same, so that nothing
    // kept of a variable is older than the last edit of what MATLAB loads of it.
    //
    // And what was found of the properties of every object at or above `node` is forgotten
    // (McosPropertyVerdicts): an object's twins are each told of the copy into them.
    _nodeEdited(node) {
        const entry = owningEntryOf(node);
        if (entry && entry.parent === this) {
            this._valueVerdicts.delete(entry);
        }
        this._propertyVerdicts.forget(node);
        for (const group of twinsTouching(this._twins ?? [], node)) {
            for (const m of group.members) {
                const twin = this._entryOf(m.node);
                if (twin) {
                    this._valueVerdicts.delete(twin);
                }
            }
        }
    }
    addChild(child, index) {
        super.addChild(child, index);
        this._valueVerdicts.delete(child);
        this._entriesMoved(null, child.name);
        return child;
    }
    removeChild(child) {
        const before = this.children.length;
        super.removeChild(child);
        if (this.children.length < before) {
            this._valueVerdicts.delete(child);
            this._entriesMoved(child.name, null);
        }
    }
    // One of my variables renamed (DataNode.setProperty): its name's count moves with it.
    _entryRenamed(oldName, newName) {
        this._entriesMoved(oldName, newName);
    }
    // A variable of this file stopped being called `gone`, and one started being called `came`
    // (either null): one removed, added or renamed. The version moves, and the counts, when they
    // are of the version before, move with it and go on holding.
    _entriesMoved(gone, came) {
        const held = this._nameCounts !== null && this._countedAt === this._entriesVersion;
        this._entriesVersion++;
        if (!held) {
            return;
        }
        const counts = this._nameCounts;
        if (gone !== null) {
            const left = (counts.get(gone) ?? 0) - 1;
            if (left > 0) {
                counts.set(gone, left);
            }
            else {
                counts.delete(gone);
            }
        }
        if (came !== null) {
            counts.set(came, (counts.get(came) ?? 0) + 1);
        }
        this._countedAt = this._entriesVersion;
    }
    // ---- The edits a save of this file can write ----------------------------------------------
    //
    // The editor takes no edit a save of this file would then refuse (MatFileWriter), so that none
    // is made that cannot be kept: the baseline is that no edit taken is one a save then refuses,
    // or writes as something else. One rule, this one, asked by every path an edit takes
    // (BaseNode.sourceEditRefusal): the editors of the table and of the Property Inspector
    // (BaseNode.getPropInfo, nameEditable, valueEditable, descriptionEditable), the gates of a
    // child added or removed (DataNode._encodedReadOnly), each class's setter
    // (DataNode._refuseEncodedEdit, DataNode's rename), and the session's editProperty. Built of the
    // writer's own refusals (unsavableRefusal, structureRefusal, freshRefusal, PAST_SUBSYSTEM,
    // duplicateWhy), so that the two cannot come to disagree.
    /**
     * Why an edit of `key` at `node`, which is `entry` or a node under it, is refused, as a
     * message naming the variable or the file, or null where a save of this file writes it.
     * `key` is 'Name' for `node`'s own name, and a property's key for anything else: 'Value'
     * for a value typed in, a child added or removed, and an element's or a field's edit.
     *
     *   - every edit, of a file no save of which can be written (_fileRefusal), its variables'
     *     delete and the addition of one included (execRemoveEntry, execAddEntry);
     *   - every edit of a variable stored after the subsystem, its name included: MATLAB does
     *     not read it there, and moved, what MATLAB loads would change. It can be deleted;
     *   - a variable's own name: taken, and written as its record with the name replaced;
     *   - a struct field's name, where the struct's fields take a rename (_renamesFieldsOf): an edit
     *     of the struct's value, which writes it fresh under its rows' names, the field's value as it
     *     was read (an MCOS object's, as the element it was read as);
     *   - a property of an MCOS object, at the top of the file, in a struct field or a cell, or an
     *     element of an object array (anything at or under its node, mcosObjectEdit.objectNodeAt),
     *     which a save writes into the subsystem cell that holds it and leaves the variable's
     *     record as it was: taken where the rules for the object take it whatever its value
     *     (_objectKeyRefusal; _editValueRefusal judges the value);
     *   - anything else, which writes the variable fresh: refused where the writer refuses that
     *     (freshRefusal: an object's typed node, a string, a function handle, a value not
     *     decoded, and a variable holding one at any depth), or where another variable of the
     *     file has its name;
     *   - and Add ('Add', MatlabVariableNode.canAddChild) on a struct that is not 1x1 or is an
     *     element of one, which is written, but not as the tree shows it. Add gives a struct a
     *     field row of its own: the rows of a struct array are its elements, so the row was an
     *     element of no fields the save did not write; a 0x0 struct's field was written with no
     *     element to hold it, which reads back as no field; and a field added to one element of
     *     a struct array is written into every element, as MATLAB adds one, `[]` in the others,
     *     which the tree did not show.
     */
    _editRefusal(entry, node, key, describe = true) {
        const file = this._fileRefusal();
        if (file) {
            return file;
        }
        const record = this.recordOf(entry);
        const subsystem = this._subsystemRecord();
        if (record && subsystem && record.offset > subsystem.offset) {
            return cannotEdit(entry.name, PAST_SUBSYSTEM);
        }
        if (node === entry && (key === 'Name' || key === 'name')) {
            return null;
        }
        // A field's name is its struct's: renamed, the struct is written fresh under its rows' names,
        // and the field's value as it was read (an object's, as the element it was read as). So it is
        // judged as an edit of the struct's value, where the struct's fields take a rename at all.
        if ((key === 'Name' || key === 'name') && node.parent && this._renamesFieldsOf(entry, node.parent)) {
            return this._editRefusal(entry, node.parent, 'Value', describe);
        }
        const object = objectNodeAt(entry, node);
        if (object) {
            return this._objectKeyRefusal(entry, object, node, key, describe);
        }
        // At or under an MCOS object a save writes as the element it was read as, beside a plain value
        // of the variable it writes fresh (MatlabVariableNode._objectMemberOf): an object array's own
        // row, a string's, an opaque object's. Its element names the file's objects, and nothing of it
        // but an object's property, which objectNodeAt finds, is an edit a save writes.
        for (let n = node; n && n !== entry; n = n.parent) {
            if (MatlabVariableNode._objectMemberOf(n)) {
                return cannotEdit(entry.name, n.matlabPath + ' is ' + (n === node ? '' : 'part of ') + 'an object of the file, which a save writes as it was read: '
                    + 'only the properties of an object it takes are written into the file\'s objects');
            }
        }
        let verdict = this._valueVerdicts.get(entry);
        if (verdict === undefined) {
            const refused = freshRefusal(entry, record);
            verdict = refused ? editRefusalOf(refused) : null;
            this._valueVerdicts.set(entry, verdict);
        }
        if (!verdict && this._namespaceHolds(entry.name) > 1) {
            verdict = cannotEdit(entry.name, duplicateWhy(entry.name));
        }
        if (!verdict && key === 'Add') {
            const array = [node, node.parent].find((n) => isStruct(n) && n._dims.reduce((a, b) => a * b, 1) !== 1);
            if (array) {
                return cannotEdit(entry.name, array.matlabPath + ' is a ' + array._dims.join('x') + ' struct, whose fields a save writes into every element of it or none, '
                    + 'and Add gives one struct a field of its own');
            }
        }
        return verdict;
    }
    /**
     * Whether the fields of `struct`, `entry` or a node under it, take a rename
     * (BaseNode.sourceRenamesFields): where `struct` holds fields (MatlabVariableNode._holdsFields) a
     * save writes fresh under its rows' names, which is anywhere but at or under an MCOS object, whose
     * value a save writes into the file's objects by the rules for them, or as it was read
     * (objectNodeAt, MatlabVariableNode._objectMemberOf). Whether a save writes the variable at all
     * is _editRefusal's, of the field's Name.
     */
    _renamesFieldsOf(entry, struct) {
        if (!(struct instanceof MatlabVariableNode) || !struct._holdsFields() || objectNodeAt(entry, struct)) {
            return false;
        }
        for (let n = struct; n; n = n === entry ? null : n.parent) {
            if (MatlabVariableNode._objectMemberOf(n)) {
                return false;
            }
        }
        return true;
    }
    /**
     * Why an edit of `key` at `node`, at or under `object`, the node of an MCOS object in `entry`, is
     * refused whatever its value, or null where the value decides (_editValueRefusal): the edit of a
     * variable one of two of one name (duplicateWhy), of a part of the object that is no property a
     * save writes (matObjectEdit.matPropertyAt), of a file whose objects a save cannot read, of an
     * object it cannot find in them, and of a property the rules refuse (propertyRefusal). The
     * object's state is what this asks first, and is made then (_objectState). With `describe` false
     * (an editor drawn, BaseNode.sourceEditRefused) a part of the object refused is not described
     * (propertyAt): every other refusal is said as it is.
     */
    _objectKeyRefusal(entry, object, node, key, describe = true) {
        if (this._namespaceHolds(entry.name) > 1) {
            return cannotEdit(entry.name, duplicateWhy(entry.name));
        }
        const state = this._objectStateNow(object);
        if (typeof state === 'string') {
            return cannotEdit(entry.name, state);
        }
        const unruled = matClassRefusal(state, object);
        if (unruled) {
            return cannotEdit(entry.name, unruled);
        }
        const at = matPropertyAt(state, object, node, key, describe);
        const refused = ('why' in at ? at.why : this._propertyVerdicts.of(state, object, at.key, this._sharingOf(object))) ?? this._twinRefusal(object);
        return refused ? cannotEdit(entry.name, refused) : null;
    }
    /**
     * Which other node of the file the object at `object` is too, and how (matObjectEdit.MatSharing):
     * a Parameter's or a Signal's twins (_twinGroups), each shown the edits of the others; any other
     * object another node holds the handle of, which would show none. Null for one no other node is.
     */
    _sharingOf(object) {
        const group = this._twinGroupOf(object);
        const twin = group?.members.find((m) => m.node !== object)?.node;
        if (twin) {
            return { kind: 'twins', with: twin };
        }
        if (this._objectNodesById === undefined) {
            this._objectNodesById = new Map();
            for (const n of this._objectNodesOfFile()) {
                const place = mcosPlaceOf(n);
                const id = place ? objectIdOf(place.variable.mcosHandle, place.index) : null;
                if (id !== null) {
                    this._objectNodesById.set(id, [...(this._objectNodesById.get(id) ?? []), n]);
                }
            }
        }
        const place = mcosPlaceOf(object);
        const id = place ? objectIdOf(place.variable.mcosHandle, place.index) : null;
        const other = id === null ? undefined : this._objectNodesById.get(id)?.find((n) => n !== object);
        return other ? { kind: 'value', with: other } : null;
    }
    /**
     * Why no edit of the object at `object` is taken for the other nodes that are the same object
     * (_twinGroups), each of which an edit is copied into (_mirrorTwins), as a clause, or null: an
     * edit of the object was made through another of them, its master, through which every later one
     * is made; or one of them is in a variable no edit of which a save writes, stored after the
     * subsystem, or one of two of one name.
     */
    _twinRefusal(object) {
        const group = this._twinGroupOf(object);
        if (!group) {
            return null;
        }
        const mastered = twinMasterRefusal(group, object, (n) => this._entryOf(n) !== null);
        if (mastered) {
            return mastered;
        }
        const subsystem = this._subsystemRecord();
        for (const { node } of group.members) {
            const entry = this._entryOf(node);
            if (node === object || !entry) {
                continue;
            }
            const record = this.recordOf(entry);
            const why = record && subsystem && record.offset > subsystem.offset
                ? "is stored after the file's objects, where MATLAB does not read it, so a save writes no edit of it"
                : this._namespaceHolds(entry.name) > 1
                    ? 'shares its name with another variable of the file, and MATLAB loads only one of them'
                    : null;
            if (why) {
                return object.matlabPath + ' is one object with ' + node.matlabPath + ' (one handle), so an edit of it is an edit of the variable ' + entry.name + ' too, which ' + why;
            }
        }
        return null;
    }
    /**
     * The nodes of each object two or more nodes of this file are, two variables holding one handle
     * (`r = h`) or a struct holding it in two fields, of a class whose properties a save writes; found
     * once, the first time an editor asks, which is before any edit of one: each node's state is made
     * then (_objectState), and what it shows of the object (mcosObjectEdit.twinOf). A node a variable's
     * delete takes out of the tree is still in its group, and is passed over while it is out
     * (_attachedTwins).
     */
    _twinGroups() {
        if (this._twins === undefined) {
            this._twins = twinGroupsOf(this._objectNodesOfFile(), (n) => this._objectState(n));
            this._twinOf = twinGroupByNode(this._twins);
        }
        return this._twins;
    }
    // The nodes of every object the file's records hold, those of a variable deleted since included:
    // so that which nodes are one object does not depend on whether a delete came before it was first
    // asked, and an object one of whose holders is deleted is still one, which its undo shows.
    _objectNodesOfFile() {
        const out = objectNodesUnder(this);
        for (const node of this._recordNodes.values()) {
            if (node.parent !== this) {
                out.push(...objectNodesUnder(node));
            }
        }
        return out;
    }
    /** The group of the nodes that are the object `object` is, or null where no other node is it. */
    _twinGroupOf(object) {
        if (!mcosPlaceOf(object)) {
            return null;
        }
        this._twinGroups();
        return this._twinOf.get(object) ?? null;
    }
    /** The members of `group` in the tree now, or none where fewer than two are. */
    _attachedTwins(group) {
        const attached = group.members.filter((m) => this._entryOf(m.node) !== null);
        return attached.length > 1 ? attached : [];
    }
    /**
     * The nodes an edit at or under `root` is copied into (_mirrorTwins) that are not at or under it:
     * the other nodes of every object at or above or under `root`, for the session to keep its index of
     * them as it keeps the index of `root` (DataModel.mutateSubtree).
     */
    _twinsOutside(root) {
        const out = [];
        for (const group of this._twinsTouching(root)) {
            for (const { node } of this._attachedTwins(group)) {
                if (!isAtOrUnder(node, root)) {
                    out.push(node);
                }
            }
        }
        return out;
    }
    /**
     * After an edit at or under `root`, made by any path: every other node of an object it reached
     * shows the object as the edit left it (mcosObjectEdit.mirrorTwins), and is edited so. Answers the
     * nodes copied into. Asked by the session after every edit it makes or wraps (DataModel.mutateSubtree,
     * addChildTo, deleteNodeById, and the undo and redo of each).
     */
    _mirrorTwins(root) {
        const copied = [];
        for (const group of this._twinsTouching(root)) {
            const members = this._attachedTwins(group);
            if (members.length > 1) {
                copied.push(...mirrorTwins(group, members));
            }
        }
        return copied;
    }
    // The groups with a node at or under `root`, or one `root` is at or under: the objects an edit
    // there can reach, asked twice an edit (DataModel.mutateSubtree). None in a file with no
    // subsystem, which holds no object; the groups are found the first time this is asked, before
    // the first edit's mutation (sourceTwinsOutside), and most files have none.
    _twinsTouching(root) {
        if (!this._subsystemRecord()) {
            return [];
        }
        const groups = this._twinGroups();
        return groups.length === 0 ? [] : twinsTouching(groups, root);
    }
    // The variable `node` is in, `node` itself for one, or null for a node not in this file's tree:
    // a variable is in it while its parent is this file, which a delete clears (removeChild).
    _entryOf(node) {
        let n = node;
        while (n.parent && n.parent !== this) {
            n = n.parent;
        }
        return n.parent === this ? n : null;
    }
    /**
     * Why `value`, what an edit of `key` at `node` (of `entry`) is about to make the property hold,
     * as the node would hold it (a bound as a number or undefined, text as a string, a Value as the
     * value node the edit makes), cannot be written into this file, or null where it can, or where
     * `node` is no object's. Judged with the object's other edits as the save will judge them
     * (McosPropertyRules.planPropertyEdits): a Min above its Max, a Value out of its DataType's range.
     * Asked by the setters before they set it (BaseNode.sourceValueRefusal), so that the edit is not
     * taken, rather than taken and then refused by the save.
     */
    _editValueRefusal(entry, node, key, value) {
        const object = objectNodeAt(entry, node);
        if (!object) {
            return null;
        }
        const keyRefused = this._objectKeyRefusal(entry, object, node, key);
        if (keyRefused) {
            return keyRefused;
        }
        const state = this._objectStateNow(object);
        const at = matPropertyAt(state, object, node, key);
        if (at.key === BUS_ELEMENTS) {
            return null;
        }
        // A struct row of a Value takes a row added or removed, and an edit of each of its fields: a
        // value typed over it whole is text no setter makes a value of.
        if (at.key === 'Value' && typeof value === 'string' && node !== object && node.className === 'struct') {
            return cannotEdit(entry.name, node.matlabPath + ' is a struct, which takes an edit of each of its fields, and not a value typed over it whole');
        }
        const spot = state.spots.get(at.key);
        const pending = spotValue(spot.holder, spot.spot.property, { value });
        if (typeof pending === 'string') {
            return cannotEdit(entry.name, (spot.holder === object ? object.matlabPath : spot.holder.matlabPath) + '.' + spot.spot.property + ' ' + pending);
        }
        // A NumericType's property its mode gates: as MATLAB's setter takes it from what the node holds
        // now, and the node is to show what that leaves (_setOffered), which the save must write.
        if (state.held.className === 'Simulink.NumericType' && matBagEditorOf(state.held.className, key)) {
            const after = matNumericTypeAfter(state, object, spot.spot.property, pending);
            if ('why' in after) {
                return cannotEdit(entry.name, after.why);
            }
            const shown = new Map();
            for (const [k, s] of state.spots) {
                const editor = matBagEditorOf(state.held.className, k.charAt(0).toLowerCase() + k.slice(1));
                const v = editor?.bag && Object.prototype.hasOwnProperty.call(after.values, editor.bag) ? spotValue(s.holder, k, { value: after.values[editor.bag] }) : null;
                if (v && typeof v !== 'string') {
                    shown.set(k, v);
                }
            }
            const refused = matEditsRefusal(state, object, undefined, shown);
            if (refused) {
                return cannotEdit(entry.name, refused);
            }
            this._followed = { node: object, key, values: after.values };
            return null;
        }
        const refused = matEditsRefusal(state, object, { key: at.key, value: pending });
        return refused ? cannotEdit(entry.name, refused) : null;
    }
    /**
     * The rows of `node`'s Property Inspector this file offers in its property groups
     * (BaseNode.sourceInspectorRows), where `node` is an object's or a row under one: its Name; where
     * it stands, its Kind and Class; of a string, its DataType, as of every MATLAB value; and the
     * properties a save writes into the object
     * (matObjectEdit.matPropertyAt finds a spot of them), each of which takes an edit in some state of
     * it (a storage class other than Auto opens an Identifier; a NumericType's mode opens its scaling).
     * A property it saves no edit of (a Parameter's Dimensions, which follow its Value; a CoderInfo's
     * custom attributes) is shown read-only in "Other". The saved keys a row shows already are not
     * shown again there, stale until a save: a NumericType's SignednessBool, FixedExponent and
     * SlopeAdjustmentFactor, which its Signedness, FractionLength and Slope show; a Bus's elements,
     * which its rows are; a ValueType's own element. Of a MATLAB value, every row, and none of a
     * Description, which no MATLAB value has.
     */
    _inspectorRows(entry, node) {
        const object = objectNodeAt(entry, node);
        if (!object) {
            return { shows: () => true, hides: (key) => key === 'Description', skips: [] };
        }
        const skips = ['SignednessBool', 'FixedExponent', 'SlopeAdjustmentFactor', 'Elements_internal', 'be'];
        const identity = (key) => key === 'Name' || key === 'Kind' || key === 'Class' || (key === 'DataType' && node instanceof MatlabVariableNode);
        const state = this._objectStateNow(object);
        if (typeof state === 'string') {
            return { shows: identity, hides: () => false, skips };
        }
        return { shows: (key) => identity(key) || 'key' in matPropertyAt(state, object, node, key, false), hides: () => false, skips };
    }
    /**
     * The editor this file offers of `key` at `node` (of `entry`), a property of an object's node
     * shown read-only in every other source (BaseNode.sourceOfferedEditor): one a save writes into
     * the object (matObjectEdit.matBagEditorOf), a text box, or a dropdown of the rules' choices or
     * true and false; null for any other. Whether it takes an edit now is _editRefusal's.
     */
    _offeredEditor(entry, node, key) {
        const cls = String(node.className ?? '');
        const object = objectNodeAt(entry, node);
        // A CoderInfo's storage class, of the rules' choices as saved, and its Alignment: the columns
        // and Property Inspector rows of a Parameter's and a Signal's, which the schema's setters write.
        if (object === node && (cls === 'Simulink.Parameter' || cls === 'Simulink.Signal')) {
            if (key === 'storageClass') {
                return { editor: 'select', options: [...(propertyChoices('Simulink.CoderInfo', 'StorageClass') ?? [])] };
            }
            if (key === 'alignment') {
                return { editor: 'text' };
            }
        }
        const editor = object ? matBagEditorOf(cls, key) : null;
        // A DataType or a Unit of a class whose save writes it, which the node's own setter sets: a text
        // box, of the class alone (whether this object takes it is _editRefusal's, asked next).
        if (!editor && object && (key === 'DataType' || key === 'Unit')) {
            return matOffersSpot(object === node ? cls : null, cls, key) ? { editor: 'text' } : null;
        }
        if (!editor) {
            return null;
        }
        if (editor.kind === 'flag') {
            return { editor: 'select', options: ['true', 'false'] };
        }
        const choices = editor.kind === 'choice' ? propertyChoices(cls, editor.property) : null;
        return choices ? { editor: 'select', options: [...choices] } : { editor: 'text' };
    }
    /**
     * The edit of `key` at `node` (of `entry`) to `text`, of a property this file offers an editor of
     * (_offeredEditor): the text taken as the editor takes it, held to what a save writes
     * (DataNode._refuseSourceValue, _editValueRefusal), and written into the node's property bag where
     * the node shows it, its field too where one shows it; for a NumericType, with what MATLAB's setter
     * changes beside it. Null for a key it offers no editor of, which the node's own setter takes.
     */
    _setOffered(entry, node, key, text) {
        const cls = String(node.className ?? '');
        const editor = objectNodeAt(entry, node) ? matBagEditorOf(cls, key) : null;
        const bag = node.serial?._properties;
        if (!editor || !bag) {
            return null;
        }
        const shown = offeredText(matBagEditorShown(node, editor));
        const parsed = offeredValue(text, editor.kind);
        if (typeof parsed === 'string') {
            return { error: true, reason: cannotEdit(entry.name, node.matlabPath + '.' + editor.property + ' ' + parsed), invalidValue: text, validValue: shown };
        }
        const data = node;
        this._followed = undefined;
        const refused = data._refuseSourceValue(key, parsed.value, text, shown);
        if (refused) {
            return refused;
        }
        const followed = this._followed;
        this._followed = undefined;
        for (const path of [editor.bag, editor.mirror]) {
            if (path) {
                writeSourcePath(bag, path, parsed.value);
            }
        }
        if (editor.field) {
            node[editor.field] = parsed.value;
        }
        if (followed && followed.node === node && followed.key === key) {
            Object.assign(bag, followed.values);
        }
        data._markModified();
        return true;
    }
    /**
     * What puts `key` of `node` (of `entry`) back as it stands now, a property this file offers an
     * editor of (_offeredEditor): every bag key and field its class's editors write, as they are, an
     * edit of a NumericType's changing more than its own. Null for any other key.
     */
    _offeredRestorer(entry, node, key) {
        const cls = String(node.className ?? '');
        const bag = node.serial?._properties;
        if (!bag || !objectNodeAt(entry, node) || !matBagEditorOf(cls, key)) {
            return null;
        }
        // Each key's leaf as it stands, absent included, and each field.
        const leaves = matBagEditorsOf(cls).flatMap((e) => [e.bag, e.mirror]).filter((p) => !!p).map((p) => sourceLeaf(bag, p)).filter((l) => l !== null);
        const held = leaves.map((l) => [l, l.key in l.bag, structuredClone(l.bag[l.key])]);
        const fields = matBagEditorsOf(cls).filter((e) => e.field).map((e) => [e.field, structuredClone(node[e.field])]);
        return () => {
            for (const [l, had, v] of held) {
                if (had) {
                    l.bag[l.key] = structuredClone(v);
                }
                else {
                    delete l.bag[l.key];
                }
            }
            for (const [f, v] of fields) {
                node[f] = structuredClone(v);
            }
            node._markModified();
        };
    }
    /**
     * What `key` of `node`, of `entry`, follows to once its edits are saved, for the node to show
     * (BaseNode.sourceFollowedProperty), or undefined: the DataType of a Simulink.Parameter's node, as
     * the save writes it with an edit of the Value (matObjectEdit.matShownDataType). Nothing else, and
     * nothing for a node that is no object's, or one whose object a save cannot find.
     */
    _followedProperty(entry, node, key) {
        if (key !== 'DataType' || objectNodeAt(entry, node) !== node) {
            return undefined;
        }
        const state = this._objectState(node);
        return typeof state === 'string' ? undefined : matShownDataType(state, node) ?? undefined;
    }
    /**
     * The subsystem of this file as a save writes edits into it: its record, and its element read
     * whole into records (McosSubsystemCodec.readSubsystem); or why no object's edit can be written,
     * read once.
     */
    _mcosSubsystem() {
        if (this._objects === undefined) {
            const record = this._subsystemRecord();
            const element = record ? subsystemElementOf(record) : null;
            const read = element ? readSubsystem(element) : null;
            this._objects = !record
                ? 'the file holds no objects for a save to write an edit into'
                : !read
                    ? "the file's objects are not held in one whole element a save can rewrite"
                    : read.ok
                        ? { record, records: read.subsystem }
                        : "the file's objects could not be read as a save rewrites them (" + read.message + ')';
        }
        return this._objects;
    }
    /**
     * What the file holds of the object at `object`, and what its node held the first time this was
     * asked (matObjectEdit.matObjectStateOf), or why no edit of it can be written; made once a node,
     * the first time the editor asks about the object, which every edit of it does before it is
     * made, and kept.
     */
    _objectState(object) {
        let state = this._objectStates.get(object);
        if (state === undefined) {
            // An object created since the file was read is in the subsystem it was merged into.
            const entry = this._entryOf(object) ?? object;
            const objects = this._creation?.created.has(entry) ? { records: this._creation.records } : this._mcosSubsystem();
            state = typeof objects === 'string' ? objects : matObjectStateOf(objects.records, object);
            this._objectStates.set(object, state);
        }
        return state;
    }
    /**
     * The state of the object at `object` as the gate judges an edit of it now: _objectState's, but
     * for a Bus with element rows added or removed since, whose state is projected onto a copy of
     * the records it was read from (matObjectEdit.projectedBusState), kept while its rows stay those.
     */
    _objectStateNow(object) {
        const base = this._objectState(object);
        if (typeof base === 'string' || !base.elementRows) {
            return base;
        }
        const rows = object.children.filter((c) => c.className === 'Simulink.BusElement');
        if (rows.length === base.elementRows.length && rows.every((r, i) => r === base.elementRows[i])) {
            return base;
        }
        const kept = this._busProjections.get(object);
        if (kept && kept.rows.length === rows.length && kept.rows.every((r, i) => r === rows[i])) {
            return kept.state;
        }
        const state = projectedBusState(cloneSubsystem(base.records), base, object, { classes: new Map(this._creation?.session.classes ?? []) });
        this._busProjections.set(object, { rows, state });
        return state;
    }
    /**
     * For the save (MatFileWriter): the subsystem's record (null for a file that held none) and its
     * element with every edit of an object under `entries` written into it, the records it was read
     * as (`original`, which the save holds it to append-only), and the cells written; or null where
     * none of them holds one and no object was created. `entries` are the variables whose edits
     * reached objects only, whose records are written as they were, and those created as objects
     * (_createObject), whose subsystem is written while any of them is in the tree. Throws
     * MatWriteError for an edit it cannot write (matObjectEdit.matObjectSubsystemEdit).
     */
    _objectSubsystemEdit(entries) {
        const entryOf = new Map();
        for (const entry of entries) {
            for (const object of objectNodesUnder(entry)) {
                if (object._objectEdited) {
                    entryOf.set(object, entry.name);
                }
            }
        }
        // Objects created since the read, in the tree: the subsystem they were merged into is written,
        // whether or not an edit reached one, and the file's otherwise.
        const created = this._liveCreations();
        if (entryOf.size === 0 && created.length === 0) {
            return null;
        }
        const record = this._subsystemRecord();
        let base;
        let original;
        const live = created.length > 0 ? this._liveCreation() : null;
        if (live) {
            base = live.records;
            original = this._creation.original;
        }
        else {
            const objects = this._mcosSubsystem();
            if (typeof objects === 'string') {
                const [name] = entryOf.values();
                throw new MatWriteError('Cannot write "' + name + '": ' + objects + '. Nothing was written.');
            }
            base = original = objects.records;
        }
        // The Buses with element rows added or removed: each written into one copy of the records, one
        // after another, its state projected onto that copy, as the gate projected it onto its own.
        let records = base;
        const projected = new Map();
        const session = { classes: new Map((live?.session ?? this._creation?.session)?.classes ?? []) };
        // An object created since the read, by its ids in the subsystem written (_liveCreation).
        const stateOf = (object) => {
            const state = this._objectState(object);
            return live && typeof state !== 'string' ? live.remap(object, state) : state;
        };
        for (const object of entryOf.keys()) {
            const state = stateOf(object);
            if (typeof state !== 'string' && state.elementRows && this._objectStateNow(object) !== this._objectState(object)) {
                if (records === base) {
                    records = cloneSubsystem(base);
                }
                projected.set(object, projectedBusState(records, state, object, session));
            }
        }
        const more = created.length > 0 || records !== base ? { has: true, edit: () => { } } : undefined;
        const written = matObjectSubsystemEdit(records, [...entryOf.keys()], (n) => projected.get(n) ?? stateOf(n), (n) => entryOf.get(n), more);
        if (!written) {
            return null;
        }
        // The objects of the file the edits write: a Bus whose elements were added or removed too; and
        // not those created, which the subsystem appends.
        const buses = [...projected.values()].flatMap((state) => (typeof state === 'string' ? [] : [{ objectId: state.objectId, properties: [ELEMENTS_SAVED] }]));
        const edited = editedObjects([], [...written.edited, ...buses]).filter((o) => o.objectId < original.blob.objects.length);
        return { record, original, ...written, edited };
    }
    /**
     * Why `value`, a node built of the text an edit typed in for `node`, of `entry`, cannot be
     * written into this file, or null where it can: a string, which MatWriter has no MAT class
     * for. Asked of the edit before it is made (MatlabVariableNode.setProperty), so that a value
     * that would leave the variable one a save refuses (freshRefusal) is never taken. A value typed
     * as a Simulink.Parameter's whole Value, on its Value row, is the object's, and judged as one
     * (_editValueRefusal); one typed into a field of its struct Value, as what such a field may hold
     * (mcosObjectEdit.memberRefusal).
     */
    _valueRefusal(entry, node, value) {
        const object = objectNodeAt(entry, node);
        // A `string` of the file, typed over whole: a string it takes, written into its payload; a value
        // of another class would be another variable, which the save writes only as it was read. An
        // element of one is held to a string's text by its own setter.
        if (object && object.className === 'string') {
            if (node !== object) {
                return null;
            }
            const v = value;
            if (!(v._kind === 'string' || (v._kind === 'scalar' && v._scalarType === 'string'))) {
                return cannotEdit(entry.name, object.matlabPath + ' is a string, which a save writes as the object it is, so it takes only a string: a value of another class would be another variable');
            }
            return this._editValueRefusal(entry, node, 'Value', value);
        }
        if (object && object._valueNode === node) {
            return this._editValueRefusal(entry, node, 'Value', value);
        }
        if (object) {
            const refused = memberRefusal(object, node, value);
            if (refused) {
                return cannotEdit(entry.name, refused);
            }
        }
        const unwritable = unwritableIn(value);
        if (!unwritable) {
            return null;
        }
        const is = unwritable.path === value.matlabPath ? ' would be ' : ' would hold ';
        return cannotEdit(entry.name, (node.matlabPath || entry.name) + is + unwritable.what + ', which this package cannot write into a MAT-file');
    }
    /**
     * Why `node`, a variable of this file, cannot be renamed, or null where it can: its record is not
     * one whole element whose name a save can replace (MatFileWriter.renameWhy), which only a damaged
     * file holds. Asked by the rename itself (DataNode.setProperty) and not by the editability
     * getters, as finding out inflates the record: a rename refused so is refused before it is made.
     */
    _renameRefusal(node) {
        const record = this.recordOf(node);
        const why = record ? renameWhy(record) : null;
        return why ? cannotEdit(node.name, why) : null;
    }
    /** Why no edit of this file is taken, or null (unsavableRefusal, structureRefusal). */
    _fileRefusal() {
        // A host that hands the bytes away empties every view of them at once, the header's
        // first, so a verdict of none is asked again only once that happened.
        const gone = this.headerBytes !== null && this.headerBytes.byteLength !== 128;
        if (this._fileVerdict === undefined || (gone && this._fileVerdict === null)) {
            const refused = unsavableRefusal(this) ?? structureRefusal(this, this.records, this._subsystemRecord());
            this._fileVerdict = refused ? editRefusalOf(refused) : null;
        }
        return this._fileVerdict;
    }
    /** The subsystem's record (MatFileWriter.subsystemOf), found once: the records never change. */
    _subsystemRecord() {
        if (this._subsystem === undefined) {
            this._subsystem = this.records ? subsystemOf(this, this.records) : null;
        }
        return this._subsystem;
    }
    /**
     * How many variables of the file a save writes under `name`: the variables in the tree, and
     * each record that became none (one the reader dropped) under its own name, as a save writes
     * it (MatFileWriter.refuseDuplicates). A rename into a name another holds is refused for it
     * (DataNode.setProperty), naming this file (_namespaceLabel).
     *
     * Counted when first asked, and moved with every variable added, removed or renamed after
     * (_entriesMoved), so that a rename costs a lookup and not a count of every name: as a
     * dictionary's are (SectionNode._namespaceHolds, F1-23).
     *
     * A record the reader dropped without a name, one that does not inflate or holds no matrix,
     * is counted under none: what it would be called is not known, so an added or renamed
     * variable is not held to it (MatFileWriter.refuseDuplicates, likewise). Every such record
     * already breaks a rule MATLAB loads a file by (MatFileCheck: `compressed-wrapper`,
     * `top-level-type`), and for all of them but one past the inflate ceiling that is a rule
     * MATLAB fails the whole load on: no variable of the file is loaded beside it, whatever its name.
     */
    _namespaceHolds(name) {
        if (!this._nameCounts || this._countedAt !== this._entriesVersion) {
            const counts = new Map();
            const add = (n) => counts.set(n, (counts.get(n) ?? 0) + 1);
            for (const child of this.children) {
                add(child.name);
            }
            for (const record of this.records ?? []) {
                if (record.name && !this.nodeOf(record)) {
                    add(record.name);
                }
            }
            this._nameCounts = counts;
            this._countedAt = this._entriesVersion;
        }
        return this._nameCounts.get(name) ?? 0;
    }
    /** Where a rename into a name already held is said to collide (DataNode.setProperty): this file. */
    get _namespaceLabel() {
        return basenameOf(this.name) || this.name;
    }
    // The format an out-of-process host is told this source is, since SourceDTO carries
    // this field and nothing else in the projection names the format. One value, unlike
    // ModelNode's three: a MAT-file has on-disk levels (4, 5, 7, 7.3) but only one of them
    // ever reaches this class — MatParser reads the Level-5 framing that `-v7` also uses,
    // and refuses `-v7.3` with a throw because it is HDF5, so no MatNode exists for one.
    // A level would therefore describe the reader's single supported case rather than
    // distinguish anything a consumer could act on. `header` keeps the file's own claim
    // for anyone who wants the detail. A getter, as ProjectNode's is: this cannot change
    // once the file is read.
    get sourceFormat() {
        return 'mat';
    }
    get icon() {
        return 'matlabWorkspaceFile';
    }
    get NumberOfEntries() {
        return this.children.length;
    }
    getProperties() {
        return [PropName];
    }
    getPILayout() {
        return [{ group: 'General', items: [PropName] }];
    }
    getSection() {
        return null;
    }
    /**
     * The classes a new variable of this file may be, which a host offers (its Add gallery) and
     * execAddEntry takes, exactly: a plain variable, the double 0; a 1x1 struct of no field; and each
     * of MAT_CREATABLE_CLASSES MATLAB's own default object of which merges into the file's subsystem
     * (_classRefusal: it reads whole, at a blob version an edit was measured on, and takes the merge),
     * or the file has none. None for a file no save of which can be written (_fileRefusal), whose view
     * takes no edit at all.
     */
    getAllowedTypes() {
        if (this._fileRefusal()) {
            return [];
        }
        return [...PLAIN_VARIABLE_CLASSES_OFFERED, ...MAT_CREATABLE_CLASSES.filter((c) => !this._classRefusal(c))];
    }
    // Why no object can be created in this file, or null: its subsystem does not read as one a save
    // writes, or is of a blob version no edit was measured on.
    _creationRefusal() {
        if (this._creation || !this._subsystemRecord()) {
            return null;
        }
        const objects = this._mcosSubsystem();
        if (typeof objects === 'string') {
            return objects;
        }
        return measuredVersion(objects.records) ? null : "the file's objects are of a blob version no edit was measured on";
    }
    // Why no object of `className` can be created in this file, or null: no class of
    // MAT_CREATABLE_CLASSES; a subsystem no object is created in (_creationRefusal); or one MATLAB's
    // default object of it does not merge into (a trailing element of class systems it does not
    // read, say), tried once a class, on a copy of the file's records.
    _classRefusal(className) {
        if (!MAT_CREATABLE_CLASSES.includes(className)) {
            return NOT_OFFERED.has(className)
                ? "its node shows nothing yet of the Table and Breakpoints its object holds, nor offers an editor of them, so none is created"
                : 'a MAT-file takes a new variable of a plain value, a struct, or one of ' + MAT_CREATABLE_CLASSES.join(', ');
        }
        const whole = this._creationRefusal();
        if (whole || !this._subsystemRecord()) {
            return whole;
        }
        this._classVerdicts ??= new Map();
        let verdict = this._classVerdicts.get(className);
        if (verdict === undefined) {
            verdict = null;
            const objects = this._mcosSubsystem();
            try {
                mergeTemplateObject(cloneSubsystem(objects.records), className, { session: createAppendSession() });
            }
            catch (e) {
                if (!(e instanceof MatWriteError)) {
                    throw e;
                }
                verdict = e.message;
            }
            this._classVerdicts.set(className, verdict);
        }
        return verdict;
    }
    // A new variable named `entryName`, or the class's default name with a counter appended if that
    // is taken (`var` for a plain variable): the double 0; a 1x1 struct of no field ('MatlabStruct');
    // or MATLAB's default object of a class getAllowedTypes lists, merged into the subsystem the save
    // writes (_createObject), its node the one a file holding that object shows. Null, adding
    // nothing, for a file no save of which can be written (_fileRefusal), for any other class, and for
    // a name that is no MATLAB name or one the file holds already, by the rule a rename is held to.
    execAddEntry(className, entryName) {
        const kind = !className || PLAIN_VARIABLE_CLASSES.has(className) ? 'plain' : className === 'MatlabStruct' ? 'struct' : 'object';
        this._addRefused = this._addRefusalOf(kind, className, entryName);
        if (this._addRefused) {
            return null;
        }
        const name = entryName || this._uniqueName(defaultNameOf(className));
        const node = kind === 'plain'
            ? MatlabVariableNode.createDefault(name, this)
            : kind === 'struct'
                ? MatlabVariableNode.parseMatVariable({ name, className: 'struct', dimensions: [1, 1], isComplex: false, isLogical: false, value: null, fields: {} }, name, this)
                : this._createObject(className, name);
        if (!node) {
            this._addRefused ??= cannotAdd(this, className, 'its object could not be made of MATLAB\'s default one');
            return null;
        }
        this.addChild(node);
        node.status = 'New';
        this.dirty = true;
        return {
            node,
            undo: () => {
                this.removeChild(node);
                this.dirty = true;
            },
            redo: () => {
                this.addChild(node);
                this.dirty = true;
            },
        };
    }
    /**
     * Why the last execAddEntry added nothing, in words naming this file, or null where it added a
     * variable: what a host shows of a refused Add, as it shows a refused edit's reason (DataModel's
     * addEntryRefusal).
     */
    addEntryRefusal() {
        return this._addRefused;
    }
    // Why a new variable of `className` (of `kind`) named `entryName` is refused before one is made:
    // no save of this file can be written; no class this file takes a new variable of; a subsystem no
    // object can be created in; a name that is no MATLAB name, or one the file holds already.
    _addRefusalOf(kind, className, entryName) {
        const file = this._fileRefusal();
        if (file) {
            return cannotAdd(this, className, file.replace(/^Cannot edit "[^"]*": /, '').replace(/\.$/, ''));
        }
        const objects = kind === 'object' ? this._classRefusal(className) : null;
        if (objects) {
            return cannotAdd(this, className, objects);
        }
        const name = entryName || this._uniqueName(defaultNameOf(className));
        const invalid = validateMatlabName(name);
        if (invalid) {
            return cannotAdd(this, className, "'" + name + "' is not a name MATLAB can load (" + invalid + ')');
        }
        if (entryName && this._namespaceHolds(entryName) > 0) {
            return "'" + entryName + "' already exists in " + this._namespaceLabel;
        }
        return null;
    }
    /**
     * MATLAB's default object of `className`, merged into the subsystem this file's saves write
     * (McosTemplateMerge.mergeTemplateObject: MATLAB R2023b's own records of one, copied in the order
     * its `save -append` writes them), and the node of the variable `name` holding it, as a file
     * holding it shows it: the typed node of a Simulink object, a `string`'s node. Null where the
     * merge refuses.
     */
    _createObject(className, name) {
        if (!this._creation) {
            const objects = this._subsystemRecord() ? this._mcosSubsystem() : null;
            if (typeof objects === 'string') {
                return null;
            }
            const original = objects ? objects.records : createTemplateSubsystem(className);
            this._creation = { records: cloneSubsystem(original), original, session: createAppendSession(), created: new Map(), rows: new Map() };
        }
        // Merged into a copy, which becomes the records only once the object's node is made: a merge
        // or a read refused leaves the records, and the session, as they were.
        const c = this._creation;
        const records = cloneSubsystem(c.records);
        const session = { classes: new Map(c.session.classes) };
        let obj;
        try {
            obj = mergeTemplateObject(records, className, { session });
        }
        catch (e) {
            if (e instanceof MatWriteError) {
                this._addRefused = cannotAdd(this, className, e.message);
                return null;
            }
            throw e;
        }
        // The node, decoded of the same object merged alone into its template's empty subsystem, whose
        // triples are the ones merged here and whose ids are not: writing and reading the file's whole
        // subsystem for each creation cost 225 ms in a 32 MB file. Its variable then names the object
        // merged here, as the save writes it (_createdElement).
        const small = createTemplateSubsystem(className);
        let alone;
        try {
            alone = mergeTemplateObject(small, className, { session: createAppendSession() });
        }
        catch (e) {
            if (e instanceof MatWriteError) {
                return null;
            }
            throw e;
        }
        const variable = elementValue(newObjectVariable(name, alone));
        const named = elementValue(newObjectVariable(name, obj));
        if (!variable || !named?.mcosHandle) {
            return null;
        }
        variable.name = name;
        attachMcosDecoded(writeSubsystem(small), [variable]);
        const node = modelOpaqueMcosVariable(variable, mcosDecodedFor(variable), this);
        if (!node) {
            return null;
        }
        variable.mcosHandle = named.mcosHandle;
        placeString(node);
        c.rows.set(node, rowsAdded(c.records.blob.objects.length, records));
        c.records = records;
        c.session = session;
        c.created.set(node, obj);
        return node;
    }
    /**
     * The properties a child row added at `node` (of `entry`) starts with (BaseNode.sourceNewChildProperties):
     * of a Bus of the file's objects, MATLAB's default Simulink.BusElement, as this package reads one
     * from a file, which is what a save writes for the row (matObjectEdit.projectedBusState) but its
     * name. Undefined for any other node.
     */
    _newChildProperties(entry, node) {
        if (node.className !== 'Simulink.Bus' || objectNodeAt(entry, node) !== node) {
            return undefined;
        }
        const props = defaultBusElementProperties();
        return props ? structuredClone(props) : undefined;
    }
    /** The class-17 element a save writes for `node`, a variable created in this file as an object (_createObject), or null for any other. */
    _createdElement(node) {
        const obj = this._creation?.created.has(node) ? this._liveCreation().objects.get(node) : undefined;
        return obj ? newObjectVariable(node.name, obj) : null;
    }
    /**
     * The subsystem a save writes the objects created since the read into, which are in the tree now
     * (_liveCreations), and each one's object there. Where every object created is, the one they were
     * merged into (_creation). Where one was deleted since, merged again of the file's subsystem
     * alone, those in the tree in the order made, with one append session, so that none of a deleted
     * one is written, as MATLAB's own save writes none: and what was judged of each by its old ids is
     * the object's under its new ones (remap). Made once for a set of those.
     */
    _liveCreation() {
        const c = this._creation;
        const live = this._liveCreations();
        const kept = this._rebuilt;
        if (kept && kept.from === c.records && kept.live.length === live.length && kept.live.every((n, i) => n === live[i])) {
            return kept.made;
        }
        let made;
        if (live.length === c.created.size) {
            made = { records: c.records, session: c.session, objects: c.created, remap: (_node, state) => state };
        }
        else {
            const records = cloneSubsystem(c.original);
            const session = createAppendSession();
            const objects = new Map();
            const ids = new Map();
            for (const node of live) {
                const was = c.created.get(node);
                const before = records.blob.objects.length;
                const obj = mergeTemplateObject(records, was.className, { session });
                objects.set(node, obj);
                // Each row the merge appended now, for each it appended then: the same object rows, in the
                // same order, of the same template.
                const old = c.rows.get(node);
                const now = rowsAdded(before, records);
                if (now.length !== old.length) {
                    throw new MatWriteError('Cannot write "' + node.name + '": its object could not be written again as it was made. Nothing was written.');
                }
                const map = new Map(old.map((id, i) => [id, now[i]]));
                const payload = new Map();
                const oldString = stringObjectOf(c.records, was.objectId);
                const newString = stringObjectOf(records, obj.objectId);
                if (oldString && newString) {
                    payload.set(oldString.valueIndex, newString.valueIndex);
                }
                ids.set(node, { objectId: obj.objectId, map, payload });
            }
            made = {
                records,
                session,
                objects,
                remap: (node, state) => {
                    const to = ids.get(this._entryOf(node) ?? node);
                    if (!to) {
                        return state;
                    }
                    const id = (k) => to.map.get(k) ?? k;
                    return {
                        ...state,
                        records,
                        objectId: to.objectId,
                        objects: new Map([...state.objects].map(([k, o]) => [k, { ...o, objectId: id(o.objectId) }])),
                        payload: state.payload === undefined ? undefined : to.payload.get(state.payload),
                    };
                },
            };
        }
        this._rebuilt = { from: c.records, live, made };
        return made;
    }
    /** The variables created as objects that are in the tree now. */
    _liveCreations() {
        return [...(this._creation?.created.keys() ?? [])].filter((n) => n.parent === this);
    }
    // Not a name any variable of the file holds, a record the reader dropped included (_namespaceHolds).
    _uniqueName(baseName) {
        if (this._namespaceHolds(baseName) === 0) {
            return baseName;
        }
        let i = 1;
        while (this._namespaceHolds(baseName + i) > 0) {
            i++;
        }
        return baseName + i;
    }
    // A delete is written by any save, of any variable, one stored after the subsystem and an object
    // included; refused only in a file no save of which can be written (_fileRefusal).
    execRemoveEntry(node) {
        const index = this.children.indexOf(node);
        if (index < 0 || this._fileRefusal()) {
            return null;
        }
        this.removeChild(node);
        this.dirty = true;
        return {
            undo: () => {
                this.addChild(node, index);
                this.dirty = true;
            },
            redo: () => {
                this.removeChild(node);
                this.dirty = true;
            },
        };
    }
    /**
     * The variable put in place of `node`, a variable of this file, for its whole Value typed over as
     * `text` (BaseNode.sourceRetype), and what undoes and redoes the swap; the refusal of the text by
     * that variable; or null, where `node`'s own setter makes the edit. A save writes a string only as
     * an object of the subsystem, which only its creation makes, and a plain value only fresh, so
     * neither becomes the other in place; and in MATLAB `x = "abc"` makes `x` a string whatever it
     * was, and `x = 5` a double. So a string typed over a variable that is not one makes it the
     * variable an Add of a string makes (_createObject), and anything else typed over a string the
     * plain variable an Add makes, each of its name and in its place, holding the text; and a save
     * writes it where the variable it replaced was (_replacementOf). A variable whose Value takes no
     * edit (valueEditable: a struct, a function handle, a summary) is not one, nor is one holding any
     * other object, whose Value row is the object's.
     */
    _retype(entry, node, key, text) {
        if (key !== 'Value' || node !== entry || node.parent !== this || !(node instanceof MatlabVariableNode) || !node.valueEditable) {
            return null;
        }
        const object = objectNodeAt(entry, node);
        const isString = object === node && node.className === 'string';
        if (object && !isString) {
            return null;
        }
        const typed = typedKind(text);
        if (typed === null || (typed === 'string') === isString || (typed === 'string' && this._classRefusal('string'))) {
            return null;
        }
        const made = typed === 'string' ? this._createObject('string', node.name) : MatlabVariableNode.createDefault(node.name, this);
        if (!made) {
            return null;
        }
        const swap = (from, to) => {
            const at = this.children.indexOf(from);
            this.removeChild(from);
            this.addChild(to, at);
            this.dirty = true;
        };
        // In its place first, as the edit of its Value judges it there; and put back, the file as it
        // was, where it refuses the text.
        const dirty = this.dirty;
        swap(node, made);
        const set = made.setProperty('Value', text);
        if (set !== true) {
            swap(made, node);
            this.dirty = dirty;
            return set;
        }
        this._replaced.set(node, made);
        return { node: made, undo: () => swap(made, node), redo: () => swap(node, made) };
    }
    /**
     * The variable of this file in place of `node` (_retype), however many times replaced, where
     * `node` is no longer in it and that variable holds no record of its own; or null: the variable
     * a save writes where `node`'s record was (MatFileWriter.planOf).
     */
    _replacementOf(node) {
        for (let n = this._replaced.get(node); n; n = this._replaced.get(n)) {
            if (n.parent === this) {
                return this.recordOf(n) === null ? n : null;
            }
        }
        return null;
    }
    getVariables() {
        const variables = [];
        for (const child of this.children) {
            // Typed Simulink nodes (ParameterNode, SignalNode) have no `_var` — they
            // come from the read-only MCOS path and are never serialized back.
            const v = child._var;
            if (v) {
                variables.push(v);
            }
        }
        for (const anon of this._anonymousElements) {
            variables.push(anon);
        }
        return variables;
    }
    // `warnings` is optional in the parameter type rather than required because a host
    // that hands over an older parse has none — the same reason addMatSourceParsed reads
    // `result.warnings` defensively. When it IS there it is the array addMatSource passes
    // to registerSource after this returns, so a degrade appended during construction
    // reaches the source node.
    //
    // The tree is built under the file's node ceiling (matNodeCeiling; DisplayConvention's
    // MAT_NODE_CEILING unless `options.nodeCeiling` says otherwise, which tests do): every
    // variable is listed and counted, each container under one is built with all its rows or
    // none, depth first, so the first values in the file are the whole ones, and an MCOS
    // object's typed node is built whole and counted (buildUncut). One warning says how many
    // containers have no rows and names the first ('part-not-expanded'). A parse handed over with
    // no warnings array (an older host's) is given one for it, which is the array addMatSource
    // and addMatSourceParsed pass on: both read it after this returns.
    //
    // Each node built of a record is bound to it (recordOf, nodeOf), whatever node it is: a
    // plain variable, an MCOS object's typed node, a function handle, one shown as not
    // decoded. A parse with no records, or whose records do not cover its variables one for
    // one, binds none and keeps none (`records` null).
    static fromParsed(parsed, filename, options = {}) {
        const node = new MatNode(filename);
        node.header = parsed.header;
        const records = heldRecords(parsed);
        // A .mat file keeps the MCOS blob in an anonymous trailing element. Every opaque in
        // the file, nested or not, comes back carrying its own decode, and what the decoder
        // could not read of one is a warning on the file.
        const anonElement = parsed.variables.find((v) => v._anonymous);
        attachMcosDecoded(anonElement?._rawBytes, parsed.variables, parsed.warnings);
        const ceiling = options.nodeCeiling ?? MAT_NODE_CEILING;
        const recordOf = records ? new Map(records.filter((r) => r.variable).map((r) => [r.variable, r])) : null;
        const { cut, firstCut } = buildUnderCeiling(ceiling, () => MatNode._addVariables(node, parsed, recordOf));
        if (cut > 0 && firstCut) {
            const warnings = parsed.warnings ?? (parsed.warnings = []);
            warnings.push(notExpandedWarning(firstCut.matlabPath, cut, ceiling));
        }
        placeStrings(node);
        if (records && bindsEveryRecord(node, records, parsed.variables)) {
            node.headerBytes = parsed.headerBytes;
            node.records = records;
            node.subsystemOffset = parsed.subsystemOffset ?? 0;
            node.framed = parsed.framed === true;
            node.unframed = parsed.unframed ?? null;
        }
        else {
            node._recordNodes.clear();
            node._nodeRecords.clear();
        }
        return node;
    }
    _bindRecord(child, record) {
        if (record) {
            this._recordNodes.set(record, child);
            this._nodeRecords.set(child, record);
        }
    }
    // Every variable as a row of `node`, in the file's order, under the ceiling fromParsed arms:
    // all of them counted first, and none refused (matNodeCeiling.chargeNodes), so that the rows
    // under them are what is left, and a tree is never more nodes than the ceiling or the
    // variables, whichever is more.
    //
    // `recordOf` is each variable's record, by identity (MatRecord.variable), and every node
    // made of a variable is bound to it here, the one place all four kinds are made.
    static _addVariables(node, parsed, recordOf = null) {
        chargeNodes(parsed.variables.filter((v) => !v._anonymous).length);
        for (const variable of parsed.variables) {
            if (variable._anonymous) {
                node._anonymousElements.push(variable);
                continue;
            }
            const record = recordOf?.get(variable);
            const add = (child) => {
                node.addChild(child);
                node._bindRecord(child, record);
            };
            if (variable.isOpaque) {
                const mcosNode = buildUncut(() => modelOpaqueMcosVariable(variable, mcosDecodedFor(variable), node, parsed.warnings));
                if (mcosNode) {
                    add(mcosNode);
                    continue;
                }
            }
            // A function handle, as MatParser read it (functionHandleOf), is the node a text
            // dictionary's is, `{_type: 'function_handle', _value: 'sin'}`: `@sin`, class
            // function_handle, no editor. It showed `null`, editable, class `unknown`, as the
            // numeric scalar its unmodelled class made it; an empty one `[ ]` of class `unknown`.
            const handle = functionHandleOf(variable);
            if (handle) {
                const value = handle.text === null ? 'Matrix(' + variable.dimensions.join(',') + ')' : handle.text;
                add(MatlabVariableNode.parse({ _type: 'function_handle', _value: value }, variable.name, node));
                continue;
            }
            add(variableNodeOf(variable, node, parsed.warnings));
        }
    }
}
// Each `string` of the file whose text decoded (MatlabVariableNode.createFromMcosDecoded), at the
// top of it, in a struct field or in a cell, is placed as the object of the subsystem it is
// (mcosPlace): an edit of its text is then an edit of that object, which a save writes into its
// payload cell (matObjectEdit) and leaves the variable that holds it as it was read. It is still shown
// as the object it is (opaque, in a container's summary `<1x3 string>`), and its text takes an edit,
// whole or an element at a time (MatlabVariableNode._mcosString). One whose handle names other than
// one object is left as it was.
function placeStrings(root) {
    const stack = [...root.children];
    while (stack.length > 0) {
        const n = stack.pop();
        if (!placeString(n)) {
            stack.push(...n.children);
        }
    }
}
// placeStrings of one node: whether it is such a string, placed.
function placeString(n) {
    if (n instanceof MatlabVariableNode && n._isOpaque && n._opaqueClassName === 'string' && n._kind === 'string' && n._matVar?.mcosHandle?.ids.length === 1) {
        setMcosPlace(n, n._matVar, 0);
        n._mcosString = true;
        return true;
    }
    return false;
}
// What `text`, typed in as a Value, makes: a string or another value, as an edit applies it
// (MatlabVariableNode _applyParsed) and as _valueRefusal tells a string; or null, for text that is
// no value at all, which the variable's own setter refuses.
function typedKind(text) {
    const parsed = MatlabValueParser.parse(text);
    if (!parsed) {
        return null;
    }
    const value = new MatlabVariableNode('', null, {});
    value._applyParsed(parsed);
    return value._kind === 'string' || (value._kind === 'scalar' && value._scalarType === 'string') ? 'string' : 'other';
}
// The ids of the object rows `after` holds past the `before` it held before a merge appended to it:
// past the null row 0 the first merge into an empty table adds.
function rowsAdded(before, after) {
    const from = Math.max(1, before);
    return Array.from({ length: Math.max(0, after.blob.objects.length - from) }, (_, i) => from + i);
}
// A typed text as an offered editor of `kind` takes it (MatNode._setOffered): text as typed, a
// choice (which the rules hold to theirs), true or false, a number, or a row of numbers (a number
// alone, or in brackets, by spaces or commas), Inf and -Inf among them; or why it is none.
function offeredValue(text, kind) {
    const number = (t) => {
        const u = t.trim();
        if (/^[+-]?inf$/i.test(u)) {
            return u.startsWith('-') ? -Infinity : Infinity;
        }
        return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(u) ? Number(u) : null;
    };
    switch (kind) {
        case 'text':
        case 'choice':
            return { value: text };
        case 'flag': {
            const t = text.trim();
            return t === 'true' || t === '1' ? { value: true } : t === 'false' || t === '0' ? { value: false } : 'must be true or false';
        }
        case 'number': {
            const x = number(text);
            return x === null ? 'must be a number' : { value: x };
        }
        case 'numbers': {
            const t = text.trim().replace(/^\[(.*)\]$/s, '$1').trim();
            const xs = t === '' ? [] : t.split(/[\s,]+/).map(number);
            return xs.length === 0 || xs.some((x) => x === null) ? 'must be a number or a row of numbers' : { value: xs.length === 1 ? xs[0] : xs };
        }
    }
}
// A bag's value as an offered editor shows it, for a refusal's valid value.
function offeredText(v) {
    if (Array.isArray(v)) {
        return '[' + v.join(' ') + ']';
    }
    return v === undefined || v === null ? '' : String(v);
}
// The properties of MATLAB's default Simulink.BusElement, as this package reads one from a file
// (the element of a Bus merged from the templates), but its Name; read once, or null where that
// read gives no element row.
let defaultElement;
function defaultBusElementProperties() {
    if (defaultElement === undefined) {
        const sub = createTemplateSubsystem('Simulink.Bus');
        const variable = elementValue(newObjectVariable('b', mergeTemplateObject(sub, 'Simulink.Bus', { elements: ['a'] })));
        let props = null;
        if (variable) {
            variable.name = 'b';
            attachMcosDecoded(writeSubsystem(sub), [variable]);
            const bus = modelOpaqueMcosVariable(variable, mcosDecodedFor(variable), null);
            const row = bus?.children[0];
            props = row?.serial?._properties ? { ...row.serial._properties } : null;
            delete props?.Name;
        }
        defaultElement = props;
    }
    return defaultElement;
}
// The classes a variable added to a file may be asked for as (execAddEntry): none, the one a
// dictionary's plain variable is added as, and a double's.
const PLAIN_VARIABLE_CLASSES = new Set(['MatlabVariable', 'double']);
// What getAllowedTypes offers of the plain classes: a variable, and a struct.
const PLAIN_VARIABLE_CLASSES_OFFERED = ['MatlabVariable', 'MatlabStruct'];
// The classes with a template no new object is created as: a LookupTable's and a Breakpoint's node
// shows nothing of their Table and Breakpoints, and offers no editor of them, nor of their flags,
// so one created would be MATLAB's default whatever the host showed.
const NOT_OFFERED = new Set(['Simulink.LookupTable', 'Simulink.Breakpoint']);
/**
 * The classes a new variable of a MAT-file may be created as an object of (MATLAB's own default one,
 * merged from its records: McosTemplateMerge): every class with a template whose node offers an
 * editor of each property MATLAB sets. A file offers each where its subsystem takes the merge
 * (MatNode.getAllowedTypes, which a host's Add gallery is to read, per file).
 */
export const MAT_CREATABLE_CLASSES = Object.freeze(CREATABLE_MCOS_CLASSES.filter((c) => !NOT_OFFERED.has(c)));
// The name a new variable of `className` is given before a counter: a plain variable's `var`, a
// string's `str`, and every other class's node's own default name (Param, Signal, Bus, Struct, …).
function defaultNameOf(className) {
    if (!className || PLAIN_VARIABLE_CLASSES.has(className)) {
        return 'var';
    }
    if (className === 'string') {
        return 'str';
    }
    const cls = NodeRegistry.getClass(className);
    return cls?.defaultName || className.slice(className.lastIndexOf('.') + 1);
}
// A refused Add, in words naming the file and the class: `Cannot add a Simulink.Parameter to "f.mat": ….`
function cannotAdd(file, className, why) {
    const what = !className || PLAIN_VARIABLE_CLASSES.has(className) ? 'a variable' : className === 'MatlabStruct' ? 'a struct' : 'a ' + className;
    return 'Cannot add ' + what + ' to "' + file._namespaceLabel + '": ' + why + '.';
}
// A refusal of the writer's, `Cannot save "f.mat": …. Nothing was written.`, as the editor says
// it of an edit it does not take: `Cannot edit "f.mat": ….`
function editRefusalOf(e) {
    return e.message.replace(/^Cannot (?:save|write) /, 'Cannot edit ').replace(/ Nothing was written\.$/, '');
}
function isStruct(node) {
    return node instanceof MatlabVariableNode && node._kind === 'scalar' && node._scalarType === 'struct';
}
// Whether `node` is `root` or under it.
function isAtOrUnder(node, root) {
    for (let n = node; n; n = n.parent) {
        if (n === root) {
            return true;
        }
    }
    return false;
}
function cannotEdit(name, why) {
    return 'Cannot edit "' + name + '": ' + why + '.';
}
// The records of `parsed` a save can splice, or null: none for a host's parse that carries
// none, and none for one whose header or records are not byte views as long as they say,
// which no reader of this package hands over. Views are told by ArrayBuffer.isView, which
// answers for one made in another realm (a worker's, structured-cloned here) as well.
function heldRecords(parsed) {
    const { headerBytes, records } = parsed;
    if (!Array.isArray(records) || !ArrayBuffer.isView(headerBytes) || headerBytes.byteLength !== 128) {
        return null;
    }
    const whole = records.every((r) => r && ArrayBuffer.isView(r.bytes) && r.bytes.byteLength === r.length);
    return whole ? records : null;
}
// Whether the tree `node` was built as is bound one for one: every variable the variable of
// exactly one record, and every node bound to the record of the variable it was made of (an
// unnamed element is made into no node, and is in `_anonymousElements`). A parse whose
// records were made apart from its variables, or whose variables a host changed since,
// binds short, and its records are not this tree's to splice.
function bindsEveryRecord(node, records, variables) {
    const withVariable = records.filter((r) => r.variable);
    const ofRecords = new Set(withVariable.map((r) => r.variable));
    return (ofRecords.size === withVariable.length &&
        ofRecords.size === variables.length &&
        variables.every((v) => ofRecords.has(v)) &&
        node._nodeRecords.size === node.children.length);
}
// The file's one word about its node ceiling, which is not a loss, as `duplicate-id` is not
// (ParseWarning): every value in it is read, and copied whole. `part` is the first container
// built without its rows, in the order the tree is built, and the count is of the others.
function notExpandedWarning(part, cut, ceiling) {
    const others = cut - 1;
    const what = others === 0
        ? `"${part}" is shown without its contents`
        : `"${part}" and ${withCommas(others)} other ${others === 1 ? 'value' : 'values'} are shown without their contents`;
    const copy = others === 0 ? 'Copying it copies it whole.' : 'Copying one copies it whole.';
    return {
        code: 'part-not-expanded',
        message: `${what}: this file holds more than ${withCommas(ceiling)} values to show. ${copy}`,
        part,
    };
}
function withCommas(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
// One variable the node builders cannot make a node of refused the whole file: a complex one
// whose flags word was overwritten with a class the reader does not model (255, say) has no
// value, and the complex arm read `.re` of its null, at the top of the file or inside a cell
// or a struct. The maintainer's ruling of 2026-10-16 (group E, theme 1: warn and show what
// was read, never refuse the file) catches it one variable at a time and shows it as what was
// read of it, its name, class and size, not decoded (MatlabVariableNode.createNotDecoded), as
// ModelSectionNode.addWorkspaceEntry does for a model workspace.
//
// The file says why once. MatParser already names a value of a class it does not model,
// wherever it stands (collectUndecoded: `z`, `c{1}`, `s.a`), and that warning is the one
// loss, so a variable it names, or names a piece of, gets no second one. A variable nothing
// names (a host's parse, say, from a reader that did not report it) gets one here.
function variableNodeOf(variable, parent, warnings) {
    try {
        return MatlabVariableNode.parseMatVariable(variable, variable.name, parent);
    }
    catch (e) {
        const name = variable.name;
        if (warnings && !warnings.some((w) => namesPieceOf(w.part, name))) {
            warnings.push({
                code: 'part-unreadable',
                message: `"${name}" could not be read (${reasonOf(e)}), so it is shown as not decoded.`,
                part: name,
            });
        }
        return MatlabVariableNode.createNotDecoded(variable, name, parent);
    }
}
// Whether a warning's part is the variable `name` or a piece of it, as MatParser names a piece:
// `name.field`, `name(2).field`, `name{3}`.
function namesPieceOf(part, name) {
    if (part === undefined || !part.startsWith(name)) {
        return false;
    }
    return part.length === name.length || '.({'.includes(part[name.length]);
}
//# sourceMappingURL=MatNode.js.map