// Copyright 2026 The MathWorks, Inc.
import BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
export default class ModelBlockNode extends BaseNode {
    constructor(name, parent, blockType, paramUsages, modelSrcId, paramSourceId) {
        super(name, parent);
        this.blockType = blockType;
        this.paramUsages = paramUsages;
        this.modelSrcId = modelSrcId;
        this.paramSourceId = paramSourceId;
    }
    get isEntry() {
        return true;
    }
    get icon() {
        return 'block';
    }
    get displayName() {
        return this.name;
    }
    get displayValue() {
        return this.blockType;
    }
    get className() {
        return this.paramUsages.map((u) => `${u.property}=${u.value}`).join(', ');
    }
    get nameEditable() {
        return false;
    }
    get valueEditable() {
        return false;
    }
    toRow() {
        const paramText = this.paramUsages.map((u) => `${u.property}=${u.value}`).join(', ');
        const firstParam = this.paramUsages.length > 0 ? this.paramUsages[0].value : null;
        const paramLink = firstParam && this.paramSourceId ? `${firstParam}@${this.paramSourceId}` : undefined;
        return {
            ID: this.id,
            parent: null,
            Status: '',
            Name: { label: this.name, iconId: this.icon, disabled: false, editable: false, element: false },
            Value: this.blockType,
            DataType: paramLink ? { text: paramText, linkTarget: paramLink } : paramText,
            _valueEditable: false,
            _graphTarget: this.modelSrcId,
        };
    }
    getProperties() {
        return [PropName];
    }
    getPILayout() {
        return [{ group: 'General', items: [PropName] }];
    }
}
//# sourceMappingURL=ModelBlockNode.js.map