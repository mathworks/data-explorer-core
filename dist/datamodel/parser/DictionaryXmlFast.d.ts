/**
 * Read a dictionary XML part, or decline.
 *
 * `null` means "I did not read this" — never "this is broken". The caller must fall back to the
 * general engine, which owns every judgement about damaged input.
 *
 * HOW THE STATE IS HELD, and why it is seven arrays instead of a stack of objects.
 *
 * The obvious shape is a `Frame` object per open element, pushed and popped. It works and it
 * was the first version, and it cost one object plus one attribute array for every element in
 * the file — 13.8 M allocations on the corpus's largest dictionary, all of them dying
 * immediately. Dictionaries nest shallowly (single digits), so the arrays below are indexed by
 * DEPTH and reused: a `<P>` at depth 3 writes over the state of the previous `<P>` at depth 3.
 * The element's own object (`kids[d]`) is of course fresh each time, because it is the output.
 */
export declare function readDictionaryXmlFast(text: string): Record<string, unknown> | null;
//# sourceMappingURL=DictionaryXmlFast.d.ts.map