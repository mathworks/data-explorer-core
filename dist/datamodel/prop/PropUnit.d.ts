export default class PropUnit {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string | null;
    static defaultValue: string;
    static sourceKeys: string[];
    static format(value: unknown): string;
    static parse(raw: unknown): string;
    static validate(): string | null;
}
//# sourceMappingURL=PropUnit.d.ts.map