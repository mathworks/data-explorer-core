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
    static fromParsed(parsed, filename, options = {}) {
        const node = new MatNode(filename);
        node.header = parsed.header;
        // A .mat file keeps the MCOS blob in an anonymous trailing element. Every opaque in
        // the file, nested or not, comes back carrying its own decode, and what the decoder
        // could not read of one is a warning on the file.
        const anonElement = parsed.variables.find((v) => v._anonymous);
        attachMcosDecoded(anonElement?._rawBytes, parsed.variables, parsed.warnings);
        const ceiling = options.nodeCeiling ?? MAT_NODE_CEILING;
        const { cut, firstCut } = buildUnderCeiling(ceiling, () => MatNode._addVariables(node, parsed));
        if (cut > 0 && firstCut) {
            const warnings = parsed.warnings ?? (parsed.warnings = []);
            warnings.push(notExpandedWarning(firstCut.matlabPath, cut, ceiling));
        }
        return node;
    }
    // Every variable as a row of `node`, in the file's order, under the ceiling fromParsed arms:
    // all of them counted first, and none refused (matNodeCeiling.chargeNodes), so that the rows
    // under them are what is left, and a tree is never more nodes than the ceiling or the
    // variables, whichever is more.
    static _addVariables(node, parsed) {
        chargeNodes(parsed.variables.filter((v) => !v._anonymous).length);
        for (const variable of parsed.variables) {
            if (variable._anonymous) {
                node._anonymousElements.push(variable);
                continue;
            }
            if (variable.isOpaque) {
                const mcosNode = buildUncut(() => modelOpaqueMcosVariable(variable, mcosDecodedFor(variable), node, parsed.warnings));
                if (mcosNode) {
                    node.addChild(mcosNode);
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
                node.addChild(MatlabVariableNode.parse({ _type: 'function_handle', _value: value }, variable.name, node));
                continue;
            }
            node.addChild(variableNodeOf(variable, node, parsed.warnings));
        }
    }
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