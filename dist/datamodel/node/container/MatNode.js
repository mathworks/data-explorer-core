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
export default class MatNode extends ContainerNode {
    constructor(name) {
        super(name, null);
        this.header = '';
        this.dirty = false;
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
    get readOnly() {
        return true;
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
    execAddEntry(_className, entryName) {
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
    _uniqueName(baseName) {
        const names = new Set(this.children.map((c) => c.name));
        if (!names.has(baseName)) {
            return baseName;
        }
        let i = 1;
        while (names.has(baseName + i)) {
            i++;
        }
        return baseName + i;
    }
    execRemoveEntry(node) {
        const index = this.children.indexOf(node);
        if (index < 0) {
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