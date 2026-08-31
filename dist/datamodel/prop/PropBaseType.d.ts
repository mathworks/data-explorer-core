export default class PropBaseType {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static defaultValue: string;
    static format(value: unknown): string;
    static parse(raw: unknown): string;
    static validate(): string | null;
}
//# sourceMappingURL=PropBaseType.d.ts.map