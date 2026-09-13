/** The variable names of a `.mat`, in file order. */
export interface MatScanResult {
    /**
     * One name per variable, in file order, INCLUDING `''` for a variable that has none.
     *
     * The empty string is kept because `parseMat` keeps it: a matrix truncated before its
     * own array-flags subelement is pushed as an anonymous variable with `name: ''`, and
     * every MCOS file carries one such unnamed element. Dropping it here would shift every
     * later name by one against a consumer that indexes positionally — a wrong-name bug,
     * which is worse than a missing-name one.
     */
    names: string[];
}
/**
 * The variable names of a `.mat`, in file order.
 *
 * Equivalent to `parseMat(bytes).variables.map(v => v.name)`, and that equivalence is
 * checked over the corpus by `perf/oracle-run.mjs` and over the fixtures by
 * `test/matScan.test.ts` rather than argued for here.
 *
 * Throws whatever `parseMat` throws for a file that is not a readable v5 MAT-file,
 * because on every path it cannot scan it calls `parseMat` and lets it speak. What it
 * does NOT forward is `parseMat`'s `warnings`: a name list has nowhere to put them, and
 * the caller this replaced (`UsageIndex.matSummary`) discarded them too. A caller that
 * wants the diagnostics wants the full parse.
 */
export declare function scanMat(bytes: ArrayBuffer): MatScanResult;
//# sourceMappingURL=MatScan.d.ts.map