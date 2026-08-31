// Copyright 2026 The MathWorks, Inc.
// A bus element's Dimensions. Read-only: MATLAB accepts a positive double
// vector but ALSO scalars, [1 3], Inf and the char inherit-token 'x' (verified),
// so the constraint is too underspecified to mirror safely — per the
// conservative rule we surface it read-only. Emits into the shared `dimensions`
// column. A scalar 1 (the default) renders blank to avoid noise.
export default class PropDimensions {
    static { this.key = 'dimensions'; }
    static { this.displayName = 'Dimensions'; }
    static { this.editor = 'label'; }
    static { this.column = 'dimensions'; }
    static { this.defaultValue = ''; }
    // Raw _properties key (differs from the lowercase display key) so the PI
    // "Other" catch-all treats it as already shown.
    static { this.sourceKeys = ['Dimensions']; }
    static readValue(node) {
        const d = node.Dimensions;
        return PropDimensions.format(d);
    }
    static format(value) {
        if (value === undefined || value === null) {
            return '';
        }
        if (Array.isArray(value)) {
            return '[' + value.join(' ') + ']';
        }
        return String(value);
    }
}
//# sourceMappingURL=PropDimensions.js.map