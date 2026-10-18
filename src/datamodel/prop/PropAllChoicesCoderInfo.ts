// Copyright 2026 The MathWorks, Inc.

import { SAVEOBJ_KEY } from '../parser/XmlUtils.js';
import { formatText } from './formatText.js';

// A Simulink.VariantBank's AllChoicesCoderInfo: the name of the Simulink.VariantBankCoderInfo
// that applies to every choice of the bank (VariantBankNode).
export default class PropAllChoicesCoderInfo {
    static key = 'AllChoicesCoderInfo';
    static displayName = 'All Choices Coder Info';
    static editor = 'text';
    static column = 'allChoicesCoderInfo';
    // Read out of the saveobj envelope, so the "Other" group does not list the envelope again.
    static sourceKeys = [SAVEOBJ_KEY];

    static format = formatText;
}
