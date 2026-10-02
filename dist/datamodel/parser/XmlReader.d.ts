/**
 * The two keys that are not an element name, exported because one walker has to tell
 * them apart from one.
 *
 * Every other reader here knows the key it wants (`@_Name`, `#text`) and spells it,
 * which needs no constant. `ProjectParser`'s monolithic layout is the exception: an
 * element's CHILDREN are named by their entity type, so it enumerates the keys it
 * does not know and has to recognize these two by shape. That is the engine's shape
 * and so it belongs here, next to the options that produce it, rather than as a
 * second `'@_'` in a file that would not otherwise care.
 */
export declare const ATTRIBUTE_PREFIX = "@_";
export declare const TEXT_KEY = "#text";
/**
 * A `.sldd`'s XML part. `Object`, `P` and `Element` are always arrays; whitespace inside a
 * value is preserved exactly as written, and whitespace between two tags is not stored at
 * all (`dropLayoutWhitespace`).
 *
 * Returns `unknown` on purpose: the empty object is a valid, common answer that means
 * "nothing readable here", so a caller has to narrow before it can trust a key. Every
 * caller already does.
 */
export declare function readDictionaryXml(text: string): unknown;
/**
 * The same document through the general engine, with no fast path consulted.
 *
 * NOT for callers — `readDictionaryXml` is the reader, and reaching past it would give up the
 * speed for nothing. This exists because the fast reader's entire contract is "identical to the
 * general engine or `null`", and a test of that cannot go through `readDictionaryXml`: that
 * would compare the fast reader against itself. The alternative was for the test to build its
 * own `XMLParser` with a copy of the options above, which passes just as happily when the copy
 * has gone stale — the one failure that would let the two readers diverge in production while
 * the test stays green.
 */
export declare function readDictionaryXmlGeneric(text: string): unknown;
/**
 * One part of a `.slx` or `.mdl` package. Engine defaults: text is trimmed, and a lone
 * child stays an object, so a walker over one of these has to coerce to an array itself.
 */
export declare function readModelXml(text: string): unknown;
/** One `<Info>` sidecar of a `.prj` store. Same options as a model part. */
export declare function readProjectXml(text: string): unknown;
//# sourceMappingURL=XmlReader.d.ts.map