import MatlabVariableNode from './MatlabVariableNode.js';
import { type SetPropertyResult } from '../DataNode.js';
import type BaseNode from '../BaseNode.js';
export default class ConstantNode extends MatlabVariableNode {
    get kind(): string;
    get icon(): string;
    canAddChild(): boolean;
    get valueEditable(): boolean;
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): ConstantNode;
    static parse(rawVal: unknown, name: string, parent: BaseNode | null): ConstantNode;
    static fromVariable(node: MatlabVariableNode): ConstantNode;
}
//# sourceMappingURL=ConstantNode.d.ts.map