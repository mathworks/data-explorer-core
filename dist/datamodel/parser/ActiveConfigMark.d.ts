export declare const JSON_INFO = "simulink/configSetInfo.json";
export declare const XML_INFO = "simulink/configSetInfo.xml";
export declare const BLOCK_DIAGRAM = "simulink/blockdiagram.xml";
/** Why a member cannot be given another active set, as a clause. */
export declare class ActiveMarkError extends Error {
}
/** The member of `entries` that marks the active set, or null where there is none. */
export declare function activeMarkMember(entries: Record<string, Uint8Array>): string | null;
/**
 * The member of `entries` that marks the active set, with set `to` made active, or an
 * ActiveMarkError saying why it cannot be. Each splice is checked by reading its result again: the
 * sets as they were, `to` the one active.
 */
export declare function withActiveSet(entries: Record<string, Uint8Array>, to: string): {
    member: string;
    bytes: Uint8Array;
};
//# sourceMappingURL=ActiveConfigMark.d.ts.map