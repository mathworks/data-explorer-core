/**
 * One masked subsystem's mask workspace.
 *
 * `blockPath` is the masked block's OWN model-relative path (`Outer/Inner`), which is
 * also the `systemPath` every block directly inside it carries — that identity is what
 * makes the containment test below a path test and not a tree walk.
 *
 * `names` holds EVERY mask parameter name whatever its type, including the types whose
 * values are not expressions: a checkbox named `flag` still occupies the name `flag`
 * for the blocks inside, so leaving it out would let one of them resolve `flag` to a
 * model-workspace variable the mask hides.
 */
export interface MaskScope {
    /** The masked block's SID — '' when the file records none. See blockIdentity. */
    sid: string;
    blockName: string;
    blockPath: string;
    names: string[];
}
/**
 * The mask workspace that defines `name` for a block sitting at `systemPath`, or
 * undefined if none does.
 *
 * INNERMOST wins (R3). Every candidate encloses the same path, so the candidates are
 * nested and the deepest one is the longest — no tree needed to order them.
 */
export declare function maskDefining(masks: readonly MaskScope[], systemPath: string, name: string): MaskScope | undefined;
//# sourceMappingURL=maskScope.d.ts.map