// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
export default class PropDataType {
    static { this.key = 'DataType'; }
    static { this.displayName = 'Data Type'; }
    static { this.editor = 'label'; }
    static { this.column = 'DataType'; }
    static readValue(node) {
        return node.dataType;
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropDataType.js.map