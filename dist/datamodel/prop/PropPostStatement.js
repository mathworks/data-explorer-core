// Copyright 2026 The MathWorks, Inc.
import { SAVEOBJ_KEY } from '../parser/XmlUtils.js';
import { formatText } from './formatText.js';
// A Simulink.VariantBankCoderInfo's PostStatement: code generated after the bank's choices, any
// text, a line break included (VariantBankCoderInfoNode).
export default class PropPostStatement {
    static { this.key = 'PostStatement'; }
    static { this.displayName = 'Post Statement'; }
    static { this.editor = 'textArea'; }
    static { this.column = 'postStatement'; }
    // Read out of the saveobj envelope, or the plain property a text dictionary R2026b wrote, so
    // the "Other" group lists neither again.
    static { this.sourceKeys = [SAVEOBJ_KEY, 'PostStatement']; }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropPostStatement.js.map