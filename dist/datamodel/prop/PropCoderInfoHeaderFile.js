// Copyright 2026 The MathWorks, Inc.
import { SAVEOBJ_KEY } from '../parser/XmlUtils.js';
import { formatText } from './formatText.js';
// A Simulink.VariantBankCoderInfo's HeaderFile: the header generated code declares the bank's
// choices in (VariantBankCoderInfoNode). It renders into the table's Header File column, the one
// a Parameter's or Signal's CustomAttributes.HeaderFile renders into. Its layout key is
// `coderInfoHeaderFile`, not `headerFile`, because that one is the schema property other classes'
// layouts name (schemaBridge resolves an atom key before a schema one).
export default class PropCoderInfoHeaderFile {
    static { this.key = 'HeaderFile'; }
    static { this.displayName = 'Header File'; }
    static { this.editor = 'text'; }
    static { this.column = 'headerFile'; }
    // Read out of the saveobj envelope, or the plain property a text dictionary R2026b wrote, so
    // the "Other" group lists neither again.
    static { this.sourceKeys = [SAVEOBJ_KEY, 'HeaderFile']; }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropCoderInfoHeaderFile.js.map