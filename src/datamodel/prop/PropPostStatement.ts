// Copyright 2026 The MathWorks, Inc.

import { SAVEOBJ_KEY } from '../parser/XmlUtils.js';
import { formatText } from './formatText.js';

// A Simulink.VariantBankCoderInfo's PostStatement: code generated after the bank's choices, any
// text, a line break included (VariantBankCoderInfoNode).
export default class PropPostStatement {
    static key = 'PostStatement';
    static displayName = 'Post Statement';
    static editor = 'textArea';
    static column = 'postStatement';
    // Read out of the saveobj envelope, or the plain property a text dictionary R2026b wrote, so
    // the "Other" group lists neither again.
    static sourceKeys = [SAVEOBJ_KEY, 'PostStatement'];

    static format = formatText;
}
