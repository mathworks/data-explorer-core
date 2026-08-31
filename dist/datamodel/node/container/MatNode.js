// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import MatlabVariableNode from '../data/MatlabVariableNode.js';
import { buildTypedNodeFromMcos } from '../data/mcosTypedNode.js';
import { decodeMcosBlob } from '../../parser/McosParser.js';
import PropName from '../../prop/PropName.js';
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
    static fromParsed(parsed, filename) {
        const node = new MatNode(filename);
        node.header = parsed.header;
        // Decode MCOS objects if present
        const opaqueVars = parsed.variables.filter((v) => v.isOpaque && v.name);
        const anonElement = parsed.variables.find((v) => v._anonymous);
        let mcosData = null;
        if (opaqueVars.length > 0 && anonElement?._rawBytes) {
            mcosData = decodeMcosBlob(anonElement._rawBytes, opaqueVars.map((v) => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })));
        }
        for (const variable of parsed.variables) {
            if (variable._anonymous) {
                node._anonymousElements.push(variable);
                continue;
            }
            if (variable.isOpaque) {
                // Unify on CLASS: any opaque Simulink object whose class the data model
                // knows becomes the SAME typed node the SLDD path builds. When the MCOS
                // decoder resolved the object's properties, they populate the node with
                // real values (SLDD-shaped); otherwise it is an empty shell. The class
                // comes from the variable's own metadata, so this works even for objects
                // the decoder could not resolve.
                const decoded = mcosData?.get(variable.name);
                const typed = buildTypedNodeFromMcos(variable.className, variable.name, node, decoded?.properties, decoded?.elements, decoded?.dimensions);
                if (typed) {
                    node.addChild(typed);
                    continue;
                }
                // No typed node for this class: opaque node, enriched when decoded.
                if (decoded) {
                    node.addChild(MatlabVariableNode.createFromMcosDecoded(variable, decoded, node));
                    continue;
                }
            }
            const child = MatlabVariableNode.parseMatVariable(variable, variable.name, node);
            node.addChild(child);
        }
        return node;
    }
}
//# sourceMappingURL=MatNode.js.map