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