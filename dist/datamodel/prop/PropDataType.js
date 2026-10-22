// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
export default class PropDataType {
    static { this.key = 'DataType'; }
    static { this.displayName = 'Data Type'; }
    static { this.editor = 'label'; }
    // Which a node's source may offer an editor of (BaseNode.sourceOfferedEditor): a MAT-file's
    // object's, whose save holds it to the rules for its class.
    static { this.sourceEditable = true; }
    static { this.column = 'DataType'; }
    static readValue(node) {
        return node.dataType;
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropDataType.js.map