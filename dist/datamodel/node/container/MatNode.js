// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import MatlabVariableNode from '../data/MatlabVariableNode.js';
import { decodeMcosObjects, modelOpaqueMcosVariable } from '../data/mcosTypedNode.js';
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
        // A .mat file keeps the MCOS blob in an anonymous trailing element.
        const anonElement = parsed.variables.find((v) => v._anonymous);
        const mcosData = decodeMcosObjects(anonElement?._rawBytes, parsed.variables);
        for (const variable of parsed.variables) {
            if (variable._anonymous) {
                node._anonymousElements.push(variable);
                continue;
            }
            if (variable.isOpaque) {
                const mcosNode = modelOpaqueMcosVariable(variable, mcosData?.get(variable.name), node);
                if (mcosNode) {
                    node.addChild(mcosNode);
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