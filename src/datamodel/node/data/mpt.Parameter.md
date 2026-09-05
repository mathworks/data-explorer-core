<!-- Copyright 2026 The MathWorks, Inc. -->

# mpt.Parameter — data-object fidelity

**Node class:** `ParameterNode` (`src/datamodel/node/data/ParameterNode.ts`) — shared with `Simulink.Parameter`, not subclassed
**MATLAB class:** `mpt.Parameter` (Embedded Coder; subclass of `Simulink.Parameter`)
**Editable in our UI:** yes, on exactly the terms `Simulink.Parameter` is — see [Simulink.Parameter.md](Simulink.Parameter.md). Not offered for creation.
**Verified against:** n/a — no MATLAB probe of `mpt.Parameter` itself. The
inherited properties are covered by `probe_class('Simulink.Parameter')` and the
`params.sldd` round-trip; the mpt-only properties are **unverified**.

## Overview

`mpt.Parameter` is the Embedded Coder ("module packaging tool") subclass of
`Simulink.Parameter`. A project adopts it when it needs custom storage classes and
memory sections for generated code, which makes it common in production Design Data
dictionaries — and until TODO item 12 it was an unknown class here, so every such
parameter fell through to the generic `ObjectNode`: correct Class column, and
nothing else. No Kind, an empty Data Type, no Min/Max/Unit, no schema columns, and
a property bag expanded as anonymous child rows.

Being a subclass, it presents every property its superclass does. So it is
registered as the superclass's treatment rather than given a node of its own:

| Registry | Entry | Effect |
|----------|-------|--------|
| `NodeClassMap.CLASS_MAP` | `'mpt.Parameter': ParameterNode` | dispatch — the typed node, in every format |
| `kindMap.KIND_BY_CLASS` | `'mpt.Parameter': 'Simulink Parameter'` | Kind column and `kindForClass` (webview tooltip) |
| `schema/index.ts` `CLASS_ALIASES` | `'mpt.Parameter' → 'Simulink.Parameter'` | typed columns (`schemaColumns`) and PI layout (`buildPILayout`) |

Nothing else. Section placement is keyed on an entry's metadata namespace, not its
class, so `SectionConstants` needs no entry; the MCOS decoder for `.mat`/`.slx`
resolves through the same registry, so it inherits the dispatch for free.

## Class identity is the subclass's, only the treatment is inherited

`ParameterNode.className` reports `_array_class` from the parsed value rather than
the node's own declared class, so the Class column shows `mpt.Parameter` — what the
file actually holds. That distinction is the point of the item: a user who cannot
see which of the two classes an entry is has lost information the old untyped
fall-through at least preserved.

The fallback to `'Simulink.Parameter'` covers a node with no parsed value behind it
(`createDefault`, or one constructed directly in a test), so the column is never
blank.

## Round-trip coverage

`.sldd` is the only writable format, and both of its flavours take the class name
from `serial._rawVal._array_class`: the binary writer via
`DataNode._serializeSimulinkObjectXml` (`<Element Class="...">`) and the text writer
via `ParameterNode.serializeValue`, which copies `_rawVal` wholesale. Neither
consults the node's declared class, so class fidelity holds by construction — but
it is fidelity that would be silently lost by a plausible refactor of either
writer, so it is pinned by test rather than left to inspection:

- `test/mptClasses.test.ts` — read a binary dictionary containing an
  `mpt.Parameter` entry, write it, assert the written XML carries
  `<Element Class="mpt.Parameter">` and that the count of
  `<Element Class="Simulink.Parameter">` has not grown, re-parse, and assert the
  class and value survive. Repeated after an edit to `Value`, which is the save a
  user actually performs, and again through the text (`serializeJson`) path.

The inputs there are MATLAB-authored `Simulink.Parameter` entries from
`test/parity/artifacts/binary/params.sldd` with the class name on the `<Element>`
changed and nothing else — legitimate because the only thing under test is
class-name dispatch, and the property shape an `mpt.Parameter` presents is its
superclass's. See the header comment of that file.

## Not offered for creation

Deliberately absent from every section's `ALLOWED_TYPES`, so `getAllowedTypes()`
does not list it and `addEntry('mpt.Parameter', …)` returns `null`. Item 12 is about
READING production dictionaries, and nothing in the read path consults that list.
Offering "Add mpt.Parameter" would instead claim we can write a well-formed mpt
object from scratch — a class whose creation the MATLAB round-trip gate has never
seen. Locked by test so the exclusion is a decision rather than an oversight.

Note the consequence: a host-side paste or drag/drop pre-check that calls
`allowsType` will refuse an `mpt.*` entry even though the model can hold one.

## Open questions / deferred

- **The mpt-only properties are unverified.** `mpt.Parameter` adds
  code-generation properties beyond its superclass (memory section, owner, and
  persistence/definition-file attributes, spelled differently across releases).
  None are in the schema, so they surface as generic property rows rather than
  typed columns, and they are not editable. Closing that needs a MATLAB-authored
  `mpt.Parameter` fixture, which cannot be synthesised — the whole point of the
  synthesis above is that it claims nothing about properties the superclass lacks.
- **`mpt.CustomStorageClass` / custom attribute classes** are not registered; an
  mpt CoderInfo referencing one shows its attributes as a generic sub-object. The
  `storageClass` column still reads correctly, since it comes from `CoderInfo`.
- **Other `mpt.*` classes** are out of scope: only the two item 12 names are
  registered, and any other one still falls to `ObjectNode`. The same three-registry
  recipe applies to each, but only where a `Simulink.*` superclass is already known
  here and the subclass genuinely adds no properties the columns depend on.
