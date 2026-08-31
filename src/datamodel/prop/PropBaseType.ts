// Copyright 2026 The MathWorks, Inc.

import { formatText } from './formatText.js';

export default class PropBaseType {
    static key = 'BaseType';
    static displayName = 'Base Type';
    // The alias's base type is shown in the Data Type column of the table (the
    // Value column is not applicable for an alias). It remains an editable text
    // field in the property inspector; the table's Data Type column has no
    // in-place editor, so it renders read-only there.
    static editor = 'text';
    static column = 'DataType';

    static format = formatText;
}
