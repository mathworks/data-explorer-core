// src/datamodel/expressions.ts
// Copyright 2026 The MathWorks, Inc.
//
// Reading a block-parameter expression. One function, and it sits in a leaf module so that
// BOTH resolvers can reach it: the session's findUsages, which answers over registered
// node trees, and the usage index, which answers over summarised files. A copy per
// resolver is exactly how the two answers drift.
// The MATLAB identifiers in a block-parameter expression, in the order they appear.
//
// A block parameter's value is an expression as often as it is a bare name — mdlcases.mdl
// has `[tau 1]`, `1/Uo`, `2*Tau_inf` — and the names in it are the definitions the block
// refers to. Both directions of link resolution need the same reading of that, so both
// call this: findUsages asks whether a parameter names a given definition, and
// resolveLink asks what the name part of a target can mean (ModelBlockNode builds its
// target from the raw parameter VALUE, so `[tau 1]@mdlparams.sldd` is a target this
// package really produces).
//
// EXPORTED, and the barrel publishes it, because a host can have a second resolver this
// package cannot be — and while the host had its own copy of THIS, the two answers
// differed: it credited `mode` in `cfg.mode` and `e5` in `1e5` as definitions, so a
// dictionary entry named `mode` acquired a usage that does not exist. A phantom usage is
// worse than a missing one, because a user acts on it.
//
// A token is skipped when the character before it is `.` or a digit. `.` is a field or
// property reference — `cfg.mode` refers to `cfg`, and the model resolves `cfg`, so the
// base name is the one credited and `mode` is not a definition of its own. A digit
// before an identifier cannot start one in MATLAB, so it is always the tail of a numeric
// literal (`1e5` would otherwise offer `e5`).
//
// What this does NOT do: it makes no attempt to exclude text inside quotes. In MATLAB
// `'` is both the char-literal delimiter and the transpose operator, so `A'*B'` is
// indistinguishable from a quoted span by any regular scan — and getting that wrong
// would DROP real usages, which is worse than the rare phantom one a char literal
// holding an entry's name would add. It also cannot tell a function call from an index,
// so a variable shadowed by a function of the same name is reported as a usage; MATLAB
// itself decides that at run time from the workspace, which is not something a file
// reader has.
export function identifiersIn(expression) {
    // Constructed per call rather than hoisted: a `/g` RegExp carries lastIndex, and a
    // shared one would resume mid-string on the next call — the same reentrancy hazard
    // compileTextTest rewrites `g` away for.
    const pattern = /[A-Za-z_]\w*/g;
    const names = [];
    let match;
    while ((match = pattern.exec(expression)) !== null) {
        const before = match.index > 0 ? expression.charAt(match.index - 1) : '';
        if (before === '.' || (before >= '0' && before <= '9')) {
            continue;
        }
        names.push(match[0]);
    }
    return names;
}
//# sourceMappingURL=expressions.js.map