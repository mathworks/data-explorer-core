<!-- Copyright 2026 The MathWorks, Inc. -->

# mcosTypedNode — data-object fidelity

**Node class:** factory function `buildTypedNodeFromMcos` (`src/datamodel/node/data/mcosTypedNode.ts`)
**MATLAB class:** n/a — this is a routing factory, not a node class
**Editable in our UI:** n/a (routes to other nodes; no own UI)
**Verified against:** n/a — host factory, not a MATLAB data object

## Overview

`mcosTypedNode.ts` centres on one factory function, `buildTypedNodeFromMcos`,
that bridges the binary (MCOS) decode path to the same typed data-model nodes the
SLDD (JSON) path builds. It ensures that a Simulink object resolves to the SAME
node class with the SAME property values regardless of source format. Beside it
are the helpers the two MCOS containers (`MatNode` for a `.mat`, `ModelNode` for
an `.slx`/`.mdl` model workspace) share: `attachMcosDecoded`, which decodes their
objects, and `modelOpaqueMcosVariable`, which turns one decoded object into its
node. `decodeMcosObjects` is the older by-name form, for named top-level objects
only; neither container calls it now.

The function takes a `className`, `name`, `parent`, and optional `properties` bag.
It constructs a synthetic `rawVal` in the SLDD shape and routes it through
`NodeRegistry.parseValue`. If the class is unrecognized or in the GENERIC_KEYS
exclusion set (`MatlabVariable`, `MatlabStruct`, `CustomObject`), it returns `null`
to signal the caller to fall back to the opaque representation.

When no decoded properties are supplied, it builds an EMPTY SHELL (correct class
and icon, empty columns, no children) rather than guessing values.

`modelOpaqueMcosVariable` does not ask it for one when the decoder REFUSED the
object (`mcosDecodedTable.mcosRefused`): the bytes name an object the table does not
hold, or objects of another class than the variable declares. An empty shell of the
declared class would then be an object that is not the one in the file, and a copy
of it would write that empty object. It returns `null` instead, and the container
builds the plain opaque (`<1x1 Simulink.Parameter>`, with its class, its icon and the
bytes it was read from), as it does for a class with no typed node. Nothing to decode
against (no blob) and a handle that is only the null object (ids `[0]`, as MATLAB
writes a handle that saved no state) are not refusals: those still get the shell.

When the caller passes `warnings` (both containers do), the node built is walked for
what it holds that the reader could not read in full, and each such value is one
`part-unreadable` warning named by its MATLAB path (`p.Value`, `h.M{2}`,
`arr(3).Value`): a value recorded without decoding, a sparse array whose column
index holds fewer columns than it declares, and a struct array or a cell that holds
fewer elements than it declares, in the words `MatParser.collectUndecoded` uses for
the same value outside an object (`shortArrayMessage`). What is shown is a row for
each element held.

## Nested objects

An MCOS object held in a struct field (of a scalar struct or of any element of a
struct array) or in a cell element, at any depth, resolves to EXACTLY the node the
same object gets at top level, apart from its name. Three pieces carry it:

- **`attachMcosDecoded(blob, variables, warnings?, rootPath?)`** walks the whole
  parsed tree with an explicit stack, collects every opaque, decodes them in one
  `McosParser.decodeMcosVariables` call (keyed per variable, since a nested object
  has no name), and records each result. What the decoder could not read of one —
  the confidence gate refused it, or an object it reaches addresses a property block
  the block reader stopped before — is one `part-unreadable` warning, named by its
  MATLAB path (`s.f`, `s(2).f`, `c{3}`). So is what it did not lay out: one variable
  lays out an object again each time it reaches it by another path, and past 10,000
  of those repeats a repeat is shown without its properties. MATLAB saves a handle
  once however many places hold it, so a 1 KB file can reach its objects millions of
  times. A refusal is also recorded, for
  `modelOpaqueMcosVariable`, and cleared for every other variable, so a detach
  (`blob` null) clears it too. Both containers pass their file's warnings;
  a dictionary's encoded value passes its own, under the entry's name (`rootPath`),
  which `SlddNode.parse` collects per entry (`EncodedValue.recordPartialDecode`).
- **The side table, `mcosDecodedTable.ts`**: the results live in a module-level
  `WeakMap` keyed by the parsed variable, not on the variable, which may be a
  host's own object. `mcosDecodedFor(variable)` reads it. A re-attach that no
  longer decodes a variable removes its entry. Beside it, a `WeakSet` of the
  variables the decoder refused (`setMcosRefused`, `mcosRefused`), filled and cleared
  by the same attach. The module imports nothing at run
  time, so all three layers that read it can import it without a cycle.
- **The hook in `MatlabVariableNode.parseMatVariable`**, the one dispatch every
  struct field and cell element goes through. Its opaque arm looks the variable up
  in the side table and, when it was decoded, builds it through
  `NodeRegistry.modelMcosVariable` — implemented in `NodeClassMap` as
  `modelOpaqueMcosVariable` under the field name or cell index. The registry is
  the route because this module imports `MatlabVariableNode`, so a direct import
  back would be a cycle. Without a decode, the arm builds the opaque summary node
  it always did.

What a container shows for itself: a cell's one-line literal and its Variable Editor
grid (`displayElements`) both print every object element as its `<mxn Class>` summary,
at the element's own shape (`<1x3 string>`, `<1x2 Simulink.Parameter>`). Until P5 of the
2026-10-16 list it was `<1x1 Class>` whatever the shape, as before nested objects
resolved.

## Complex values

The bag this factory is handed carries a complex property value in the
compressed-binary dictionary's own form, `{_type: 'cdata', _value: '1+2i 3+4i',
_dimensions: [1, 2]}` (plus `_class: 'int16'` for a class other than double), built by
`McosParser.complexPropertyValue` wherever the decoder resolves a value — a Parameter's
Value, a struct field or cell element inside one, a custom class's property, an object
array's elements. So the node it routes to reads the value the way it reads the same
property out of a binary dictionary, and shows `3+4i`, `[1+2i 3+4i]` and `<1x60 int16>`
with one row per element; before, the decoder passed MatParser's `{re, im}` pairs through
and the node showed `[object Object]`. The digits are the plain `.mat` variable's, which
are not always the binary dictionary's text (`0.3333333333333333` against MATLAB's
`0.33333333333333331`). A value with an Inf or NaN part carries `_nonFinite`, the one
place the decoder's form is not the binary dictionary's. The node reads the elements of
either, the binary dictionary's own non-finite text included (see
`MatlabVariableNode._isComplexText`). Graded against MATLAB R2027a by
`test/complexMcosFixtures.test.ts` in four venues, and at the decoder by
`test/complexMcosValue.test.ts`.

## Host / factory status

- This is NOT a node class — it is a routing utility.
- It delegates all node construction to the NodeRegistry; it owns no state.
- **Existing test coverage**: `test/mcosTypedNode.test.ts` comprehensively tests
  routing for Parameter, Signal, Bus, LookupTable, NumericType, Breakpoint,
  VariantControl, empty shells, decoded properties, and GENERIC_KEYS exclusion.
  Nested objects are covered by `test/nestedMcos.test.ts` (each layer above) and
  `test/nestedMcosFixtures.test.ts` (every nested object against its top-level
  twin and MATLAB R2027a's own values).
- **Contract-lock**: no additional pinning needed — the existing test already
  covers the factory's contract exhaustively. Referenced from
  `test/parity/fidelity/hostnodes.fidelity.test.ts` as existing coverage (SKIP).

## Open questions / deferred

- None. The factory is stable and comprehensively tested.
