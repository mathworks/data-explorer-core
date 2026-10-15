// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode.js';
import { formatText } from './formatText.js';

// The class identity (e.g. 'Simulink.Parameter', 'Simulink.Bus', 'int16 (complex)') — the
// object's Class, distinct from PropKind (the human-readable Kind label, e.g.
// 'Simulink Parameter'). Read-only, computed from the live node, so it must resolve via this
// atom rather than schema hydration. PI-only (column: null) — the table already emits its own
// Class column in toRow, and both are BaseNode._classColumn, MATLAB's Workspace browser text.
export default class PropClass {
    static key = 'Class';
    static displayName = 'Class';
    static editor = 'label';
    static column: string | null = null;

    static readValue(node: BaseNode): string {
        // A node-shaped object that carries a className and nothing more is its class.
        return typeof node._classColumn === 'function' ? node._classColumn() : node.className;
    }

    static format = formatText;
}
