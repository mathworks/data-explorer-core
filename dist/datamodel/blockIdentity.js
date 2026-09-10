// Copyright 2026 The MathWorks, Inc.
//
// How a block is IDENTIFIED and how it is LABELLED — two facts that Simulink keeps
// apart and that this package used to conflate, taking the name for both.
//
// A block NAME is unique within its own system and nowhere else. `f14.slx` (the
// shipped demo) holds four blocks named `Gain`, three named `Gain3`, two named
// `Gain1` — one per subsystem, each with its own gain expression. Keying a block by
// its name therefore MERGED them: the model's `Gain` row read
// `Gain=Mq, Gain=Zw, Gain=Kf, Gain=Zw` — four blocks' parameters on one row, with
// `Zw` listed twice because two different blocks use it, and no way to tell which
// row a Usage link should reach.
//
// A block SID is unique within the MODEL and stable across renames — it is
// Simulink's own identity for a block (`get_param(blk,'SID')`,
// `Simulink.ID.getHandle`), recorded as an attribute on every `<Block>` in a `.slx`
// and as an ordinary property in a `.mdl` from R2010b on. So the SID is what this
// package keys a block by, and the name is only ever displayed.
//
// The name is also allowed to be BLANK, which is the case that led here: a user who
// clears a block's label leaves `Name="&#xA;"` in the file — one line break — and
// normalizeBlockName (SlxParser) flattens that to ''. That is a real block with a
// real parameter (in f14 a Constant reading `Uo`), so it must be shown; showing
// nothing at all made it look like a defect in the reader, and left a Usage link
// with no text to click.
//
// Every function here takes the FIELDS of a BlockParamUsage rather than the usage
// itself, so the node layer (which keeps them apart) and the summary layer (which
// keeps the usage whole) can call the same one — the point being that there is
// exactly one spelling of each rule.
/**
 * The block's identity within its model: its SID, or its NAME when the file records
 * no SID.
 *
 * The fallback is for the classic `.mdl` before R2010b, which has no SID for
 * anything — those files keep the identity they have always had here, name-merging
 * and all, because there is nothing better in the bytes.
 */
export function blockKey(name, sid) {
    return sid !== '' ? sid : name;
}
/**
 * What a block reads as in a cell: its name, or `<SID: 65>` when the model gives it
 * none.
 *
 * Angle brackets and the space are deliberate: this is a stand-in for a name, and
 * must not be mistakable for one a user typed. A block with neither a name nor a SID
 * gets '' — there is nothing to say about it, and inventing a label for a case the
 * bytes cannot support would be worse than an empty cell.
 */
export function blockLabel(name, sid) {
    if (name !== '') {
        return name;
    }
    return sid !== '' ? `<SID: ${sid}>` : '';
}
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
export function joinBlockPath(parentPath, label) {
    const segment = label.replace(/\//g, '//');
    return parentPath === '' ? segment : parentPath + '/' + segment;
}
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
export function isInsideBlockPath(ancestor, path) {
    if (ancestor === '') {
        return true; // the root system holds every block in the model
    }
    if (path === ancestor) {
        return true;
    }
    if (!path.startsWith(ancestor)) {
        return false;
    }
    let slashes = 0;
    while (path[ancestor.length + slashes] === '/') {
        slashes++;
    }
    return slashes % 2 === 1;
}
//# sourceMappingURL=blockIdentity.js.map