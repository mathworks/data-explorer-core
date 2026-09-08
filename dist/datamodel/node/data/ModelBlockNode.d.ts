import BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef, RowData } from '../BaseNode.js';
export default class ModelBlockNode extends BaseNode {
    blockType: string;
    paramUsages: Array<{
        property: string;
        value: string;
    }>;
    modelSrcId: string;
    paramSourceId: string | null;
    /** Simulink's own identity for this block; '' for a file that records none. */
    sid: string;
    /** The systems this block is inside, model-relative; '' for one in the root system. */
    systemPath: string;
    constructor(name: string, parent: BaseNode | null, blockType: string, paramUsages: Array<{
        property: string;
        value: string;
    }>, modelSrcId: string, paramSourceId: string | null, sid?: string, systemPath?: string);
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
    get id(): string;
    get isEntry(): boolean;
    get icon(): string;
    get displayName(): string;
    get displayValue(): string;
    /**
     * WHERE this block is — `Controller/Gain`, and just `Gain` for one in the root system.
     *
     * Read by PropBlockPath (which ModelReferenceNode already uses, for the same fact about
     * a different node), so the Property Inspector answers the question a row of same-named
     * blocks raises. Model-relative and escaped by joinBlockPath — see blockIdentity.
     */
    get blockPath(): string;
    get className(): string;
    get nameEditable(): boolean;
    get valueEditable(): boolean;
    toRow(): RowData | null;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
}
//# sourceMappingURL=ModelBlockNode.d.ts.map