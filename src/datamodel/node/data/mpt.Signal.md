<!-- Copyright 2026 The MathWorks, Inc. -->

# mpt.Signal — data-object fidelity

**Node class:** `SignalNode` (`src/datamodel/node/data/SignalNode.ts`) — shared with `Simulink.Signal`, not subclassed
**MATLAB class:** `mpt.Signal` (Embedded Coder; subclass of `Simulink.Signal`)
**Editable in our UI:** yes, on exactly the terms `Simulink.Signal` is (Min, Max, Description) — see [Simulink.Signal.md](Simulink.Signal.md). Not offered for creation.
**Verified against:** n/a — no MATLAB probe of `mpt.Signal` itself. The inherited
properties are covered by `probe_class('Simulink.Signal')` and the `params.sldd`
round-trip; the mpt-only properties are **unverified**.

## Overview

`mpt.Signal` is the Embedded Coder subclass of `Simulink.Signal`, the counterpart of
[mpt.Parameter](mpt.Parameter.md), and it is registered the same way and for the
same reasons — the argument is not repeated here. Before TODO item 12 it fell
through to the generic `ObjectNode`, which for a Signal is a particularly poor
showing: no Kind, an empty Data Type, no Min/Max/Unit, no Dimensions/Complexity/
Dimensions Mode columns, and a `<1x1 mpt.Signal>` summary in a Value column that a
Signal has no value to put there at all.

| Registry | Entry | Effect |
|----------|-------|--------|
| `NodeClassMap.CLASS_MAP` | `'mpt.Signal': SignalNode` | dispatch — the typed node, in every format |
| `kindMap.KIND_BY_CLASS` | `'mpt.Signal': 'Simulink Signal'` | Kind column and `kindForClass` (webview tooltip) |
| `schema/index.ts` `CLASS_ALIASES` | `'mpt.Signal' → 'Simulink.Signal'` | typed columns (`schemaColumns`) and PI layout (`buildPILayout`) |

`SignalNode.className` reports `_array_class` from the parsed value, so the Class
column shows `mpt.Signal` — the class the file holds — while the Kind, columns and
PI layout are the superclass's. `'Simulink.Signal'` remains the fallback for a node
with no parsed value behind it.

## Round-trip coverage

Both `.sldd` writers take the class name from `serial._rawVal._array_class`
(`SignalNode.serializeValue` goes through `DataNode._serializeSimulinkObject`, which
preserves it), so fidelity holds by construction and is pinned by test:

- `test/mptClasses.test.ts` — read `params.sldd`'s MATLAB-authored `sig1` re-classed
  to `mpt.Signal`, assert it arrives as a typed `SignalNode` with Kind
  `Simulink Signal` and Data Type `single`, write it, and assert the XML carries
  `<Element Class="mpt.Signal">` while the genuine `Simulink.Signal` count is
  unchanged.

The synthesis — a MATLAB-authored `Simulink.Signal` with only the class name on its
`<Element>` changed — is justified in that file's header comment: the only thing
under test is class-name dispatch.

## Not offered for creation

Absent from every section's `ALLOWED_TYPES` by the same deliberate decision as
`mpt.Parameter`: `addEntry('mpt.Signal', …)` returns `null`, and the read path never
consults that list. Locked by test.

## Open questions / deferred

- **The mpt-only properties are unverified** — same position as `mpt.Parameter`, and
  the same blocker: it needs a MATLAB-authored fixture, not a synthesised one.
- **`LoggingInfo`** is not exposed for either class, so nothing changes there.
