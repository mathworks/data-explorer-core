// Copyright 2026 The MathWorks, Inc.
import { SAVEOBJ_KEY } from '../parser/XmlUtils.js';
import { formatText } from './formatText.js';
// A Simulink.VariantBankCoderInfo's PreStatement: code generated before the bank's choices, any
// text, a line break included (VariantBankCoderInfoNode).
export default class PropPreStatement {
    static { this.key = 'PreStatement'; }
    static { this.displayName = 'Pre Statement'; }
    static { this.editor = 'textArea'; }
    static { this.column = 'preStatement'; }
    // Read out of the saveobj envelope, or the plain property a text dictionary R2026b wrote, so
    // the "Other" group lists neither again.
    static { this.sourceKeys = [SAVEOBJ_KEY, 'PreStatement']; }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropPreStatement.js.map