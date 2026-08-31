// Copyright 2026 The MathWorks, Inc.

export default class PropSpecification {
    static key = 'Specification';
    static displayName = 'Specification';
    static editor = 'text';
    static column = 'Value';

    static format(value: unknown): string {
        return value ? "'" + value + "'" : '';
    }
}
