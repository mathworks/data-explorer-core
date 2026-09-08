// Copyright 2026 The MathWorks, Inc.
import BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import { blockKey, blockLabel } from '../../blockIdentity.js';
export default class ModelBlockNode extends BaseNode {
    constructor(name, parent, blockType, paramUsages, modelSrcId, paramSourceId, sid = '') {
        super(name, parent);
        this.blockType = blockType;
        this.paramUsages = paramUsages;
        this.modelSrcId = modelSrcId;
        this.paramSourceId = paramSourceId;
        this.sid = sid;
    }
    /**
     * `…/blocks/65` — the SID, not the name.
     *
     * The one place a block's id is formed, and the reason blockIdentity exists: a name
     * is unique per SYSTEM, so `f14.slx` alone has four blocks named `Gain` and the
     * inherited id gave all four `f14.slx/blocks/Gain`. A node id is what findNodeById
     * resolves, what a row is keyed by and what a selection is remembered as, so four
     * blocks sharing one was four blocks the host could not tell apart — and a name that
     * is BLANK (see blockLabel) made the id `f14.slx/blocks/` with nothing after the
     * slash at all.
     *
     * Falls back to the name for a file with no SIDs, which is the id those files always
     * had. A rename cannot change this id, which is the other half of what a SID is for.
     */
    get id() {
        const key = blockKey(this.name, this.sid);
        return this.parent ? this.parent.id + '/' + key : key;
    }
    get isEntry() {
        return true;
    }
    get icon() {
        return 'block';
    }
    // `<SID: 65>` for a block whose label the user cleared — see blockLabel. Every
    // surface that shows a block goes through this or through toRow below, so there is
    // one answer to "what does this block read as".
    get displayName() {
        return blockLabel(this.name, this.sid);
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
            Name: { label: this.displayName, iconId: this.icon, disabled: false, editable: false, element: false },
            Value: this.blockType,
            DataType: paramLink ? { text: paramText, linkTarget: paramLink } : paramText,
            _valueEditable: false,
            _graphTarget: this.modelSrcId,
            // How a caller asks the usage index about THIS block (UsageIndex.paramsOf) and
            // what a link back to it carries (NodeUsage.linkTarget) — the SID, because the
            // label above is not unique and may be a stand-in. A host joining on the label
            // would put one block's parameters on another block's row, which is the merge
            // blockIdentity exists to undo.
            _blockKey: blockKey(this.name, this.sid),
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