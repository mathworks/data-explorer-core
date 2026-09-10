import BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef, RowData } from '../BaseNode.js';
export default class DataSourceNode extends BaseNode {
    fullPath: string;
    resolved: boolean;
    constructor(name: string, parent: BaseNode | null, fullPath: string);
    get isEntry(): boolean;
    /**
     * The one classification behind BOTH the icon and the class name.
     *
     * These were two independent chains of `endsWith`, which is two answers to one
     * question: a kind added to one and not the other shows a dictionary icon on a row
     * labelled 'MAT File'. They were also both case-SENSITIVE, while `refBasename` —
     * which is what actually RESOLVES this source against the workspace — is not. So a
     * model naming `Params.SLDD`, exactly as its author typed it, got a working link and a
     * MAT-file presentation, and no part of that looks like a bug from either side.
     * Deriving from `fileKinds` puts the case rule where the rest of this package keeps it.
     */
    private get presentation();
    get icon(): string;
    get displayName(): string;
    get displayValue(): string;
    get className(): string;
    get nameEditable(): boolean;
    get valueEditable(): boolean;
    toRow(): RowData | null;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
}
//# sourceMappingURL=DataSourceNode.d.ts.map