// Copyright 2026 The MathWorks, Inc.
import BaseNode from './BaseNode.js';
export default class ContainerNode extends BaseNode {
    get isContainer() {
        return true;
    }
    get tableColumnConfig() {
        return { columns: ['Name', 'Value', 'DataType', 'Status', 'UsedBy'] };
    }
    toRow() {
        return null;
    }
    // A dictionary, a section, a model, a .mat file or a project holds entries and has no
    // Value of its own, so it takes no editor there. Its displayValue is the blank BaseNode
    // gives, which BaseNode.valueEditable leaves editable for a node that can hold a value.
    // It takes no edit either: a container has no setProperty, which DataModel.editProperty
    // answers with a refusal.
    get valueEditable() {
        return false;
    }
    flatten() {
        const result = [];
        const stack = [];
        for (let i = this.children.length - 1; i >= 0; i--) {
            stack.push(this.children[i]);
        }
        while (stack.length > 0) {
            const node = stack.pop();
            result.push(node);
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push(node.children[i]);
            }
        }
        return result;
    }
}
//# sourceMappingURL=ContainerNode.js.map