// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
// The user-facing Kind (e.g. 'Simulink Parameter', 'Bus', 'Value Type') — the
// human-readable label for the object's class, distinct from PropClass (the raw
// class identity, e.g. 'Simulink.Parameter'). Read-only, computed from the live
// node getter (which applies classification/derived/MATLAB-variable overrides),
// so it must resolve via this atom rather than schema hydration. PI-only
// (column: null) — the table already emits its own Kind column in toRow.
export default class PropKind {
    static { this.key = 'Kind'; }
    static { this.displayName = 'Kind'; }
    static { this.editor = 'label'; }
    static { this.column = null; }
    static readValue(node) {
        return node.kind;
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropKind.js.map