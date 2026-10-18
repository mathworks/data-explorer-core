// Copyright 2026 The MathWorks, Inc.

import { SAVEOBJ_KEY } from '../parser/XmlUtils.js';
import { formatText } from './formatText.js';

// A Simulink.VariantBank's own Name, which is not the entry's: MATLAB's bank carries a Name of
// its own inside its saveobj envelope, the C identifier generated code calls the bank by. Shown
// as "Bank Name" because the entry's Name has the column and the label already
// (VariantBankNode).
export default class PropBankName {
    static key = 'BankName';
    static displayName = 'Bank Name';
    static editor = 'text';
    static column = 'bankName';
    // Read out of the saveobj envelope, so the "Other" group does not list the envelope again.
    static sourceKeys = [SAVEOBJ_KEY];

    static format = formatText;
}
