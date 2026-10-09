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

## Nested objects

An MCOS object held in a struct field (of a scalar struct or of any element of a
struct array) or in a cell element, at any depth, resolves to EXACTLY the node the
same object gets at top level, apart from its name. Three pieces carry it:

- **`attachMcosDecoded(blob, variables)`** walks the whole parsed tree with an
  explicit stack, collects every opaque, decodes them in one
  `McosParser.decodeMcosVariables` call (keyed per variable, since a nested object
  has no name), and records each result.
- **The side table, `mcosDecodedTable.ts`**: the results live in a module-level
  `WeakMap` keyed by the parsed variable, not on the variable, which may be a
  host's own object. `mcosDecodedFor(variable)` reads it. A re-attach that no
  longer decodes a variable removes its entry. The module imports nothing at run
  time, so all three layers that read it can import it without a cycle.
- **The hook in `MatlabVariableNode.parseMatVariable`**, the one dispatch every
  struct field and cell element goes through. Its opaque arm looks the variable up
  in the side table and, when it was decoded, builds it through
  `NodeRegistry.modelMcosVariable` — implemented in `NodeClassMap` as
  `modelOpaqueMcosVariable` under the field name or cell index. The registry is
  the route because this module imports `MatlabVariableNode`, so a direct import
  back would be a cycle. Without a decode, the arm builds the opaque summary node
  it always did.

What a container shows for itself does not change: a cell's one-line literal and
its Variable Editor grid (`displayElements`) both print every object element as
`<1x1 Class>`, as before nested objects resolved, whatever the element's shape.

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
