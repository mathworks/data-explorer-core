/** What a source resolves names through — a model, or a data file that can be resolved to. */
export type ChainKind = 'model' | 'sldd' | 'mat';
/**
 * One file's Tier-1 relationships: what it resolves names through, refBasename'd.
 *
 * `chain` is in RESOLUTION order for a model — its linked dictionary first, then its
 * external data sources — matching `ModelSummary.slddRefs`. For a `.sldd` it is that
 * dictionary's own references. For a `.mat` it is empty and must stay empty:
 * `DataSummary.slddRefs` is empty for a MAT-file, which inherits nothing, so a chase out of
 * one here would reach files the resolver never would.
 *
 * The entries are reference names as the FILE recorded them, and are matched
 * case-insensitively here (`refBasename`) — `EXTRADICT.SLDD` is a real link to
 * `extradict.sldd`, and the resolver matches it the same way, as the file systems these live on do.
 * A caller that has already normalised them loses nothing: refBasename is idempotent.
 */
export interface ChainSource {
    uriString: string;
    path: string;
    kind: ChainKind;
    chain: string[];
}
/**
 * The uris to summarise before answering Usage for the file at `openedUriString`, in the
 * order `sources` were given — which is folder order, and load-bearing twice: it decides
 * which file wins a basename collision, and the blocks in a Usage cell are listed in the
 * order their models were summarised.
 *
 * A uri not among `sources` returns all of them. That is the untitled or unreadable
 * document, where there is no chain to scope by and narrowing would be a guess.
 */
export declare function usageScope(openedUriString: string, sources: readonly ChainSource[]): string[];
//# sourceMappingURL=usageScope.d.ts.map