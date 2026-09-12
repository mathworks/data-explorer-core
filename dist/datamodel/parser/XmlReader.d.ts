/**
 * A `.sldd`'s XML part. `Object`, `P` and `Element` are always arrays; whitespace is
 * preserved exactly as written.
 *
 * Returns `unknown` on purpose: the empty object is a valid, common answer that means
 * "nothing readable here", so a caller has to narrow before it can trust a key. Every
 * caller already does.
 */
export declare function readDictionaryXml(text: string): unknown;
/**
 * One part of a `.slx` or `.mdl` package. Engine defaults: text is trimmed, and a lone
 * child stays an object, so a walker over one of these has to coerce to an array itself.
 */
export declare function readModelXml(text: string): unknown;
/** One `<Info>` sidecar of a `.prj` store. Same options as a model part. */
export declare function readProjectXml(text: string): unknown;
//# sourceMappingURL=XmlReader.d.ts.map