// src/core/sessionTypes.ts
// Copyright 2026 The MathWorks, Inc.
//
// The vocabulary a session speaks: what a caller hands `createSession` and its methods,
// and what those methods hand back.
//
// Every declaration here was written inside `core/DataModel.ts`, above the 1900-line
// `createSession` that implements them. Nothing about them is session code — they are
// the CONTRACT, the part a consumer names in its own signatures, and the part it reads
// to find out what an answer means. Keeping them in the implementing file made the one
// question a host actually asks ("what does resolveLink give me back, and what are the
// failure arms for?") a question you had to open the session to answer. This file is
// that answer on its own, and it is the file to read first.
//
// Two things a maintainer would otherwise rediscover:
//
//   * `core/DataModel.ts` still re-exports every name here, from the same path it
//     always did, so NO importer changed — not `src/index.ts`, which publishes them onto
//     the package barrel, not `src/node/index.ts`, and above all not
//     `datamodel/usage/UsageIndex.ts`, which reaches UP for `NodeUsage` and is the one
//     upward edge `test/moduleBoundaries.test.ts` allows by name. Import from here in NEW
//     core code if you like; do not go rewriting the existing importers, because that
//     test asserts the shape of that one edge and the barrel is a published surface.
//
//   * This file holds types and nothing else, deliberately. Every import of it is
//     therefore erased by tsc, which is what keeps it free of the layering questions
//     `test/moduleBoundaries.test.ts` asks: an erased edge pulls no bytes into a
//     consumer's bundle and creates no load order to get wrong. Putting a `const`, a
//     default or a helper function in here would quietly end that.
//
// `Session` did not come with them: it is `ReturnType<typeof createSession>`, so it is
// derived from the implementation and cannot live apart from it.
export {};
//# sourceMappingURL=sessionTypes.js.map