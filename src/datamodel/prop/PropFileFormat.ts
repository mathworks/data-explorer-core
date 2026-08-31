// Copyright 2026 The MathWorks, Inc.

import { formatText } from './formatText.js';

export default class PropFileFormat {
    static key = 'FileFormat';
    static displayName = 'File Format';
    static editor = 'label';

    static format = formatText;
}
