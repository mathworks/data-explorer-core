// Copyright 2026 The MathWorks, Inc.
import { propNamed, refusalClause, sourceEditRefusal, withArticle } from './BaseNode.js';
// A refusal that names its row already: `Cannot <verb ...> "<row>"`, as `Cannot edit "s": ...`,
// `Cannot add a field to "s": ...`, `Cannot edit the Value of "s": ...` (session.valueEditRefusal),
// `Cannot paste "a" into "f.mat": ...`. Not MATLAB's own words that start so and name no row:
// "Cannot set Alignment when StorageClass is 'Auto'."
const NAMES_A_ROW = /^Cannot (?:[A-Za-z]+ )+"[^"]+"/;
/**
 * A refusal of an edit of `key` at `node` as a host shows it, naming the row: `reason` itself where
 * it names one already (NAMES_A_ROW), and otherwise `Cannot edit "<row>": <reason>.`, or
 * `Cannot rename "<row>": <reason>.` for its Name, the row its MATLAB path (an entry's name), the
 * reason's own words with one full stop at its end. session.editProperty answers every refusal so;
 * this is for a host that calls a node's setProperty itself, as a dictionary's editor does.
 *
 * Most setters say why and not where: "Invalid MATLAB expression", "Minimum must be a finite real
 * double scalar value", "'x' already exists in values.mat". Shown so, they named no row, and the
 * sweep of the edits a user can make found 6,700 such refusals.
 */
export function editRefusalText(node, key, reason) {
    const said = reason.trim();
    if (NAMES_A_ROW.test(said)) {
        return said;
    }
    // Its closing full stops (and the space between them) dropped, one by one: a pattern anchored at
    // the end only is tried from every place in the text, which is slow on a long run of spaces.
    let end = said.length;
    while (end > 0 && (said[end - 1] === '.' || said[end - 1].trim() === '')) {
        end--;
    }
    const body = said.slice(0, end);
    const verb = isNameKey(node, key) ? 'rename' : 'edit';
    return `Cannot ${verb} "${node.matlabPath || node.name}": ${body}${/[!?]$/.test(body) ? '' : '.'}`;
}
/** Whether `key` names the node's Name, by its key or its column, as session.editProperty reads one. */
export function isNameKey(node, key) {
    if (key === 'Name') {
        return true;
    }
    try {
        return propNamed(node.getProperties?.() ?? [], key)?.key === 'Name';
    }
    catch {
        return false;
    }
}
/**
 * A value's size and class with its article, as it is read out: 'a 2x3 double', 'an 8x1 cell',
 * 'an 11x2 struct', where withArticle reads the first letter only.
 */
export function withSizeArticle(sized) {
    return (/^(?:8|1[18](?:\d{3})*x)/.test(sized) ? 'an ' : 'a ') + sized;
}
/**
 * Why a struct or an object of `dims` takes no editor of its text, as a clause, in every format
 * alike: 'it is a struct, whose fields are edited one at a time', 'it is a 1x3 struct array, whose
 * elements are edited one at a time', 'it is a Widget, which no text spells'.
 */
export function objectWhy(dims, cls) {
    const one = dims === '1x1';
    if (cls === 'struct') {
        return one ? 'it is a struct, whose fields are edited one at a time' : 'it is ' + withSizeArticle(dims + ' struct') + ' array, whose elements are edited one at a time';
    }
    return 'it is ' + (one ? withArticle(cls) : withSizeArticle(dims + ' ' + cls) + ' array') + ', which no text spells';
}
/**
 * Why the Value of `node` takes no editor (its Value cell is greyed), as a clause, in the words
 * session.valueEditRefusal says it in, `Cannot edit the Value of "<row>": <why>.`, and the node's
 * setter refuses an edit of it (DataNode._offerRefusal): first its source's (a MAT-file's object, one
 * with another node of it), then, of a value shown as a summary, why its text written out whole is
 * no editor's seed (BaseNode._editTextWhy, the D13 ruling), then a value still in the encoded stream
 * it was read from, or read from a MAT stream that is shown and not edited, and else what it shows:
 * no value (a bus, a signal), a summary of what no text spells (a struct, an object), or a value
 * shown by its text.
 */
export function valueTakesNoEditWhy(node) {
    const refused = sourceEditRefusal(node, propNamed(node.getProperties(), 'Value')?.key ?? 'Value');
    if (refused) {
        return refusalClause(refused);
    }
    const seedless = node._editTextWhy();
    if (seedless) {
        return seedless;
    }
    const own = node;
    const set = own._refuseEncodedEdit?.('Value', '') ?? own._refuseStreamEdit?.('') ?? own._refuseStreamValue?.('');
    if (set?.reason) {
        return refusalClause(set.reason);
    }
    const shown = node.displayValue;
    if (shown === '') {
        return 'it has no value of its own to edit here';
    }
    const summary = /^<([\dx]+) (.+)>$/.exec(shown);
    if (summary) {
        return objectWhy(summary[1], summary[2]);
    }
    const cls = node.className;
    return cls ? 'it is ' + withArticle(cls) + ', shown here and not edited' : 'it is shown here and not edited';
}
//# sourceMappingURL=editRefusal.js.map