/**
 * The block's identity within its model: its SID, or its NAME when the file records
 * no SID.
 *
 * The fallback is for the classic `.mdl` before R2010b, which has no SID for
 * anything — those files keep the identity they have always had here, name-merging
 * and all, because there is nothing better in the bytes.
 */
export declare function blockKey(name: string, sid: string): string;
/**
 * What a block reads as in a cell: its name, or `<SID: 65>` when the model gives it
 * none.
 *
 * Angle brackets and the space are deliberate: this is a stand-in for a name, and
 * must not be mistakable for one a user typed. A block with neither a name nor a SID
 * gets '' — there is nothing to say about it, and inventing a label for a case the
 * bytes cannot support would be worse than an empty cell.
 */
export declare function blockLabel(name: string, sid: string): string;
/**
 * WHERE a block is, appended one enclosing system at a time: `Controller/Gain`.
 *
 * The other half of the same problem the two functions above split. A SID tells two
 * same-named blocks apart for a machine, but it is not what a person reads: f14's four
 * `Gain` rows are each correct, each its own block, and identical on screen. What
 * distinguishes them is the subsystem each lives in, which is the one fact neither the
 * name nor the SID carries.
 *
 * Paths are model-RELATIVE — '' for a block in the root system, so a root block's path
 * is just its label. MATLAB's `getfullname` prefixes the model name; here the model is
 * already the file being looked at, and repeating it on every one of a thousand rows
 * says nothing.
 *
 * A `/` inside a block's own name is DOUBLED, which is Simulink's own escape
 * (`getfullname` writes `a//b` for a block named `a/b`). Two reasons it matters: a path
 * built this way can be split back into its segments, and it can be pasted into MATLAB
 * as-is. `parentPath` is expected to be the result of an earlier join and so already
 * escaped — the escape is applied to the segment being added, once.
 */
export declare function joinBlockPath(parentPath: string, label: string): string;
/**
 * Is `path` AT or BENEATH `ancestor` — both paths as joinBlockPath spells them?
 *
 * The containment question the mask workspace asks (maskScope): a masked subsystem's
 * scope covers the blocks inside it, and "inside" is a fact about paths.
 *
 * A plain `path.startsWith(ancestor + '/')` gets this wrong, and gets it wrong in the
 * direction that credits a usage to a scope that does not hold it. `A//B/C` is a block
 * `C` inside a block NAMED `a/b` — one segment, doubled — and it starts with `A/`, so
 * a mask on a sibling block `A` would swallow it. So the boundary is checked rather
 * than assumed: what follows the ancestor must be a run of slashes of ODD length, the
 * even half being the escape and the odd one left over being the separator.
 *
 * The one path pair this cannot tell apart is a label that ENDS in a slash from a
 * separator followed by a label that begins with one (`A///B` is both `[A/, B]` and
 * `[A, /B]`), which is inherent to the escape and not worth a second encoding to fix:
 * Simulink trims a block name's outer whitespace and no MathWorks tool writes such a
 * name.
 */
export declare function isInsideBlockPath(ancestor: string, path: string): boolean;
//# sourceMappingURL=blockIdentity.d.ts.map