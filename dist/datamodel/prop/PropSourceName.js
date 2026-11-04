// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
/**
 * A Simulink.ConfigSetRef's SourceName: the set it points to, which MATLAB looks for in the data
 * dictionary of the model (or of the dictionary) that holds the reference, or with none, the base
 * workspace. Edited as text: MATLAB resolves the name only as it uses the reference, so any name is
 * kept (the editor cannot look where MATLAB looks: ModelNode.activeSetCaution).
 */
export default class PropSourceName {
    static { this.key = 'SourceName'; }
    static { this.displayName = 'Source Name'; }
    static { this.editor = 'text'; }
    static { this.column = null; }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropSourceName.js.map