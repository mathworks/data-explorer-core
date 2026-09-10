// src/datamodel/maskScope.ts
// Copyright 2026 The MathWorks, Inc.
//
// The MASK WORKSPACE: the resolution scope a masked subsystem puts around the blocks
// inside it.
//
// A mask parameter is two things at once, and reading it as one thing is what left a
// masked model's Usage cells wrong in both directions:
//
//   * its VALUE is an expression, evaluated where the MASKED BLOCK sits — so
//     `MulAdd`'s `g1 = g1_param` is a use of the model workspace's `g1_param` BY THE
//     MULADD BLOCK, exactly as if `g1_param` had been typed into an ordinary block
//     parameter. That is the reverse direction, and it is why `g1_param` has a usage
//     at all.
//   * its NAME is a definition, visible only to the blocks INSIDE that subsystem, and
//     SHADOWING the model workspace and any enclosing mask. That is the forward
//     direction, and it is why the inner `Gain`'s `Gain = g1` refers to the mask and
//     not to some model-workspace `g1`.
//
// Measured against `Simulink.findVars` in R2027a on test/fixtures/maskUsage.slx (built
// by test/parity/matlab/gen_mask.m, truth recorded in test/fixtures/mask_truth.json):
//
//   g1        mask workspace   maskUsage/MulAdd    USER maskUsage/MulAdd/Gain
//   g1_param  model workspace  maskUsage           USER maskUsage/MulAdd
//
// Note which block is credited on each line. MATLAB does NOT link the inner `Gain` to
// `g1_param`; it is a two-hop chain through the mask, and both hops have to be modelled
// for either cell to read like MATLAB's.
//
// Four rules came out of that model, each with an arm in the fixture:
//
//   R1 a mask parameter's value is credited even when NO inner block reads the
//      parameter (`g3 = g3_param`, unused inside, still gives `g3_param` the user
//      `MulAdd`) — the mask dialog evaluates it regardless.
//   R2 only EXPRESSION-valued parameter types count; a popup's value is the option the
//      user picked, not a variable (see SlxParser's EXPRESSION_MASK_TYPES).
//   R3 the name shadows outwards: the model workspace's `shadowed` gets no usage from
//      `MulAdd/Const` because the mask defines `shadowed` too, and `Inner`'s `o1` beats
//      `Outer`'s for the blocks inside `Inner`.
//   R4 a value resolves in the mask block's OWN enclosing scope, never its own mask:
//      `Inner`'s `i1 = o1` credits OUTER's `o1`, though `Inner` also defines `o1`.
//
// R4 needs no code here — a mask parameter value is recorded as a block parameter of
// the masked block, whose systemPath is the system the block sits IN, so the lookup
// below starts outside its own mask by construction.
//
// One module because there are two visibility engines (UsageIndex over file summaries,
// DataModel.findUsages over registered trees) and a scope rule they spell differently
// is a rule they will eventually disagree about — the recurring defect class in this
// package. Both import this.
import { isInsideBlockPath } from './blockIdentity.js';
/**
 * The mask workspace that defines `name` for a block sitting at `systemPath`, or
 * undefined if none does.
 *
 * INNERMOST wins (R3). Every candidate encloses the same path, so the candidates are
 * nested and the deepest one is the longest — no tree needed to order them.
 */
export function maskDefining(masks, systemPath, name) {
    let best;
    for (const mask of masks) {
        if (!mask.names.includes(name)) {
            continue;
        }
        if (!isInsideBlockPath(mask.blockPath, systemPath)) {
            continue;
        }
        if (!best || mask.blockPath.length > best.blockPath.length) {
            best = mask;
        }
    }
    return best;
}
//# sourceMappingURL=maskScope.js.map