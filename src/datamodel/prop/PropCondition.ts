// Copyright 2026 The MathWorks, Inc.

export default class PropCondition {
    static key = 'Condition';
    static displayName = 'Condition';
    static editor = 'text';
    static column = 'Value';

    static format(value: unknown): string {
        return value ? "'" + value + "'" : '';
    }
}
