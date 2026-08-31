export default class PropDescription {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static defaultValue: string;
    static format(value: unknown): string;
    static parse(raw: unknown): string;
    static validate(): string | null;
}
//# sourceMappingURL=PropDescription.d.ts.map