// Copyright 2026 The MathWorks, Inc.

import { formatText } from './formatText.js';

export default class PropRelease {
    static key = 'Release';
    static displayName = 'Release';
    static editor = 'label';

    static format = formatText;
}
