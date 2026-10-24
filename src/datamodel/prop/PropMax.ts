// Copyright 2026 The MathWorks, Inc.

import { formatMatlabNum } from '../parser/XmlUtils.js';

export default class PropMax {
    static key = 'Max';
    static displayName = 'Maximum';
    static editor = 'text';
    static column: string | null = 'Max';

    static format(value: unknown): string {
        // A number as MATLAB spells it: a bound a file holds as an infinity shows Inf, not "Infinity".
        return value !== undefined && value !== null ? formatMatlabNum(value) : '';
    }
}
