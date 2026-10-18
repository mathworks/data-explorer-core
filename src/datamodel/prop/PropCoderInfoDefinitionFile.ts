// Copyright 2026 The MathWorks, Inc.

import { SAVEOBJ_KEY } from '../parser/XmlUtils.js';
import { formatText } from './formatText.js';

// A Simulink.VariantBankCoderInfo's DefinitionFile: the source file generated code defines the
// bank's choices in (VariantBankCoderInfoNode). Its layout key is `coderInfoDefinitionFile`, not
// `definitionFile`, because that one is the schema property a Parameter's and a Signal's layouts
// name for their CustomAttributes.DefinitionFile (schemaBridge resolves an atom key first).
export default class PropCoderInfoDefinitionFile {
    static key = 'DefinitionFile';
    static displayName = 'Definition File';
    static editor = 'text';
    static column = 'definitionFile';
    // Read out of the saveobj envelope, or the plain property a text dictionary R2026b wrote, so
    // the "Other" group lists neither again.
    static sourceKeys = [SAVEOBJ_KEY, 'DefinitionFile'];

    static format = formatText;
}
