// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode.js';
import { formatText } from './formatText.js';

export default class PropName {
    static key = 'Name';
    static displayName = 'Name';
    static editor = 'text';
    static column = 'Name';
    static nodeProperty = 'name';
    // The raw _properties key is 'Name' (capital) — distinct from nodeProperty
    // ('name', the JS field). Declare it so the PI "Other" catch-all treats a
    // node's raw 'Name' key as already shown (e.g. bus elements store it).
    static sourceKeys = ['Name'];

    static readValue(node: BaseNode): string {
        return node.displayName;
    }

    static format = formatText;
}
