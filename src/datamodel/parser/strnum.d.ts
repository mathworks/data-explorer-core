// src/datamodel/parser/strnum.d.ts
// Copyright 2026 The MathWorks, Inc.
//
// `strnum` ships no types — the package is three files and none of them is a `.d.ts`, and
// `@types/strnum` does not exist. So the declaration lives here, next to its only consumer.
//
// This is deliberately a PRECISE signature rather than `declare module 'strnum';`, which
// would make the import `any` and silently delete type checking at the one call site that
// decides what every dictionary text value becomes. The shape below is read off
// `node_modules/strnum/strnum.js` and off how `fast-xml-parser` calls it in
// `xmlparser/OrderedObjParser.js`:
//
//   * The return is `string | number | boolean` — NOT just `number`. A value it declines
//     comes back as the string it was given, and that decline is load-bearing: an integer
//     too large for a double keeps its spelling instead of losing precision. (Booleans are
//     in the union because the option `numericStrings`/`skipLike` paths can return the input
//     unchanged; `fast-xml-parser` handles `true`/`false` before calling, and so do we.)
//   * Every option is optional, and the defaults are NOT the ones we want — which is the
//     whole reason `DictionaryXmlFast` passes an explicit object instead of relying on them.
//
// WHY THIS PACKAGE AT ALL, rather than ten lines of our own coercion.
//
// `readDictionaryXml`'s contract says `007` reads as 7, `1.0` as 1, `0x1F` as 31, and an
// integer too large for a double stays a string. That is not a rule anyone would
// re-derive correctly from a sentence; it is the behaviour of this function, which
// `fast-xml-parser` already calls with the options in `DictionaryXmlFast.NUMBER_OPTIONS`.
// Calling the same function with the same options makes the two readers agree BY
// CONSTRUCTION. Reimplementing it would make them agree only as long as a test happened
// to cover the case that diverged — and `strnum` is already in the tree either way, as
// `fast-xml-parser`'s own dependency, so this costs no install surface. It is declared
// directly in `package.json` because importing a transitive dependency without declaring
// it is how a working build breaks on somebody else's minor release;
// `test/moduleBoundaries.test.ts` enforces that, and caught exactly this.

declare module 'strnum' {
  interface StrnumOptions {
    /** Read `0x1F` as 31. `fast-xml-parser` defaults it ON. */
    hex?: boolean;
    /** Read `007` as 7 rather than keeping the spelling. Defaults ON. */
    leadingZeros?: boolean;
    /** Read `1e3` as 1000. Defaults ON. */
    eNotation?: boolean;
    /** Accept non-ASCII digits. Defaults OFF, and we keep it off. */
    unicode?: boolean;
    /** Patterns to leave alone entirely. Unused here. */
    skipLike?: RegExp;
  }
  export default function toNumber(
    value: string,
    options?: StrnumOptions,
  ): string | number | boolean;
}
