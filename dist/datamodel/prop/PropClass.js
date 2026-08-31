// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
// The raw class identity (e.g. 'Simulink.Parameter', 'Simulink.Bus') — the
// object's Class, distinct from PropKind (the human-readable Kind label, e.g.
// 'Simulink Parameter'). Read-only, computed from the live node getter, so it
// must resolve via this atom rather than schema hydration. PI-only (column:
// null) — the table already emits its own Class column in toRow.
export default class PropClass {
    static { this.key = 'Class'; }
    static { this.displayName = 'Class'; }
    static { this.editor = 'label'; }
    static { this.column = null; }
    static readValue(node) {
        return node.className;
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropClass.js.map