// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode.js';
import { formatText } from './formatText.js';

export default class PropDataType {
    static key = 'DataType';
    static displayName = 'Data Type';
    static editor = 'label';
    static column = 'DataType';

    static readValue(node: BaseNode): string {
        return node.dataType;
    }

    static format = formatText;
}
