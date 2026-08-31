// Copyright 2026 The MathWorks, Inc.

import { formatText } from './formatText.js';

export default class PropDescription {
    static key = 'Description';
    static displayName = 'Description';
    static editor = 'textArea';
    static column = 'Description';

    static format = formatText;
}
