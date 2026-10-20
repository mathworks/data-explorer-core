// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import MatlabVariableNode from '../data/MatlabVariableNode.js';
import { attachMcosDecoded, modelOpaqueMcosVariable } from '../data/mcosTypedNode.js';
import { mcosDecodedFor } from '../data/mcosDecodedTable.js';
import { reasonOf } from '../../parser/ParseWarning.js';
import { functionHandleOf } from '../../parser/MatParser.js';
import PropName from '../../prop/PropName.js';
import { MAT_NODE_CEILING } from '../../display/DisplayConvention.js';
import { buildUnderCeiling, buildUncut, chargeNodes } from '../data/matNodeCeiling.js';
import { PAST_SUBSYSTEM, duplicateWhy, freshRefusal, renameWhy, structureRefusal, subsystemOf, unsavableRefusal, unwritableIn, } from '../../parser/MatFileWriter.js';
import { validateMatlabName } from '../../matlabName.js';
import { owningEntryOf } from '../DataNode.js';
import { basenameOf } from '../../fileKinds.js';
export default class MatNode extends ContainerNode {
    constructor(name) {
        super(name, null);
        this.header = '';
        this.dirty = false;
        this._valueVerdicts = new WeakMap();
        this._nameCounts = null;
        this._countedAt = -1;
        this._entriesVersion = 0;
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
    _nodeEdited(node) {
        const entry = owningEntryOf(node);
        if (entry && entry.parent === this) {
            this._valueVerdicts.delete(entry);
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
     *
     * Phase 2 of the MAT-file save widens the last of these, for the properties of an object it
     * writes into the subsystem.
     */
    _editRefusal(entry, node, key) {
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
     * Why `value`, a node built of the text an edit typed in for `node`, of `entry`, cannot be
     * written into this file, or null where it can: a string, which MatWriter has no MAT class
     * for. Asked of the edit before it is made (MatlabVariableNode.setProperty), so that a value
     * that would leave the variable one a save refuses (freshRefusal) is never taken.
     */
    _valueRefusal(entry, node, value) {
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
    // A new variable is the double 0, named `entryName`, or `var` with a counter appended if that
    // is taken. The only class it takes is a plain variable's: a save writes no object (freshRefusal).
    // Null, adding nothing, for a file no save of which can be written (_fileRefusal), for any other
    // class, and for a name that is no MATLAB name or one the file holds already, by the rule a rename
    // is held to: a save would refuse each.
    execAddEntry(className, entryName) {
        if (this._fileRefusal() || (className && !PLAIN_VARIABLE_CLASSES.has(className))) {
            return null;
        }
        if (entryName && (validateMatlabName(entryName) || this._namespaceHolds(entryName) > 0)) {
            return null;
        }
        const name = entryName || this._uniqueName('var');
        const node = MatlabVariableNode.createDefault(name, this);
        this.addChild(node);
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
// The classes a variable added to a file may be asked for as (execAddEntry): none, the one a
// dictionary's plain variable is added as, and a double's.
const PLAIN_VARIABLE_CLASSES = new Set(['MatlabVariable', 'double']);
// A refusal of the writer's, `Cannot save "f.mat": …. Nothing was written.`, as the editor says
// it of an edit it does not take: `Cannot edit "f.mat": ….`
function editRefusalOf(e) {
    return e.message.replace(/^Cannot (?:save|write) /, 'Cannot edit ').replace(/ Nothing was written\.$/, '');
}
function isStruct(node) {
    return node instanceof MatlabVariableNode && node._kind === 'scalar' && node._scalarType === 'struct';
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