import DataNode from '../DataNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
export default class ConfigSetNode extends DataNode {
    ConfigName: string;
    active?: boolean;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get displayValue(): string;
    get valueEditable(): boolean;
    getProperties(): PropClass[];
    _getSerializedProperties(): Record<string, unknown>;
    serializeValue(): unknown;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): ConfigSetNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ConfigSetNode;
}
//# sourceMappingURL=ConfigSetNode.d.ts.map