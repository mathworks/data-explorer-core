// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
export default class PropUnit {
    static { this.key = 'Unit'; }
    static { this.displayName = 'Unit'; }
    // Read-only: Simulink routes Unit through a unit-expression parser (verified
    // against MATLAB — e.g. '[1 2]' raises "Encountered error while parsing unit
    // expression") that we cannot faithfully replicate, so per the conservative
    // rule we surface Unit as a label rather than risk writing an invalid value.
    static { this.editor = 'label'; }
    static { this.column = 'Unit'; }
    // Unit is displayed from either raw key (DocUnits is the modern SLDD key;
    // Unit the legacy one). Listing both lets the PI "Other" catch-all treat
    // whichever key the node carries as already shown, so it is never re-listed.
    static { this.sourceKeys = ['DocUnits', 'Unit']; }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropUnit.js.map