import { type FileSummaries } from '../datamodel/usage/UsageIndex.js';
import { type SourceCache, type SourceFile, type SourceReader } from './sourceCache.js';
/**
 * The summaries needed to answer Usage for the file at `forUri`, over `files`.
 *
 * `forUri` of `null` scopes nothing and summarises every candidate — the graph as it was
 * built before scoping. That is not a fallback path a host takes; it is the reference the
 * scoped answer is compared against in test/usageScopeEquality.test.ts.
 */
export declare function planSummaries(cache: SourceCache, reader: SourceReader, files: readonly SourceFile[], forUri: string | null): Promise<FileSummaries>;
//# sourceMappingURL=usagePlan.d.ts.map