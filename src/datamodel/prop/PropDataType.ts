// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode.js';
import { formatText } from './formatText.js';

export default class PropDataType {
    static key = 'DataType';
    static displayName = 'Data Type';
    static editor = 'label';
    // Which a node's source may offer an editor of (BaseNode.sourceOfferedEditor): a MAT-file's
    // object's, whose save holds it to the rules for its class.
    static sourceEditable = true;
    static column = 'DataType';

    static readValue(node: BaseNode): string {
        return node.dataType;
    }

    static format = formatText;
}
