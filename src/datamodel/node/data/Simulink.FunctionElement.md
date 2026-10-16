<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.FunctionElement — data-object fidelity

**Node class:** `FunctionElementNode` (`src/datamodel/node/data/ServiceBusNode.ts`)
**MATLAB class:** `Simulink.FunctionElement`
**Editable in our UI:** yes (Name only)
**Verified against:** MATLAB R2027a (probe_class('Simulink.FunctionElement'))

## Overview

A `Simulink.FunctionElement` defines one service function within a
`Simulink.ServiceBus`. It carries a function prototype (e.g. `y = f1(u,v)`),
an Asynchronous flag, and an Arguments array of `Simulink.BusElement` objects
that define the function's input/output ports. In our UI each function element
appears as a child row under its parent ServiceBus entry. The Value column shows
the Prototype via `displayValue`. The Property Inspector exposes only Name.

## Property table

| Property | MATLAB type | SetAccess | Editable here | Serialized key | Editor | Constraint |
|----------|-------------|-----------|---------------|----------------|--------|------------|
| Name | char | public | yes | Name | text | Valid MATLAB identifier AND must match the function name in Prototype |
| Prototype | char | public | no (displayValue) | Prototype | — | Function signature string; MATLAB auto-appends `()` if missing |
| Asynchronous | logical | public | no | Asynchronous | — | true/false |
| Arguments | Simulink.BusElement[] | public | no | Arguments | — | Array of BusElement defining function ports |

## Non-obvious behavior

### Name — coupled to Prototype

In MATLAB the Name and the Prototype's function name are one value. Setting
either one sets the other (measured on R2027a, 2026-10-15, on a fresh
`Simulink.FunctionElement`):

- After `elem.Prototype = 'y = other(u)'`, `elem.Name` is `'other'`.
- `elem.Name = 'step'` renames the function in the Prototype, and only that
  token: `y = f(u)` → `y = step(u)`, `[a,b] = f(u,v)` → `[a,b] = step(u,v)`,
  `f = f(f)` → `f = step(f)`, `f()` → `step()`.
- With an empty Prototype (the default, Name `f1`), `elem.Name = 'step'` is
  refused: **"The character vector "" specified for prototype specification
  is invalid."** (`Simulink:FcnCall:FcnCallPrototypeInvalid`).

- `elem.Name = ''` → **"Name '' must start with an alphabetic or '' character,
  followed by alphanumeric or '' characters. Name must not start with
  'sl_padding'."**

The Prototype is not directly editable in our UI (it is shown via
displayValue only), so a rename that moved only the Name saved a Name the
Prototype contradicts.

**Current behavior in our code:** a rename renames both.
`FunctionElementNode.setProperty` rewrites the function-name token of the
Prototype in the same call: `y = f1(u,v)` renamed to `myFunc` becomes
`y = myFunc(u,v)`. Only that token changes, so an output or input spelled like
the function keeps its spelling (`f = f(f)` renamed to `g` becomes `f = g(f)`),
and so does the whitespace. The usual name checks still apply (the new Name
must be a MATLAB identifier and unique among its siblings), and the Prototype
moves only when the Name did. This is the rewrite MATLAB's own Name setter makes,
on every Prototype form measured above.

Because it is one `setProperty`, it is one edit. The session's undo replays
`setProperty('Name', old)`, which renames the Prototype back, and a host that
rewrites the owning entry (`serializeEntryToXml`, or the JSON entry writer)
writes both fields. `_applyElementOverrides` writes the Prototype back only once
it differs from the one read, so an element that was not renamed saves its
Prototype as it came in.

The rename is refused, with a message naming the Prototype and with neither
field changed, when the Prototype does not have the form
`[outputs =] Name(inputs)` with the current Name as its function. That covers an
empty Prototype, a qualified name (`y = a.f(u)`), a Prototype that already names
another function, a second call, and trailing text. MATLAB refuses the empty
case too. The Prototype is checked before the name checks, so a rename it blocks
gets this message whatever the new name is. Every FunctionElement
Prototype in the fixtures and the corpus has the form `y = NAME(args)`, with the
Name as its function.
Test: `test/functionElementRename.test.ts`.

The System Composer interface dictionary
(`simulink/systemcomposer/interfaceDictionary`) keeps its own copy of each
function of a service interface, a `p_FunctionElements` child of the interface's
definition with its own `p_Name` and `p_FunctionPrototype`. A rename of the
function of an entry is recorded for that catalog
(`ScCatalog.renameFunctionInCatalog`, keyed by the interface's name in the file,
so a rename of the interface too lands in either order), and the save writes the
copy's `p_Name` and the function-name token of its `p_FunctionPrototype`, by the
same rule, at those two sites only: a text dictionary through
`scJsonTextWithRenames`, a binary one through `scXmlWithRenames`, in the same
one pass as the entry renames. A function the catalog does not list (`f2` in
`arch.sldd`) leaves the catalog as read; undo replays the setter, so it records
the way back.
Test: `test/functionElementRename.test.ts` ("a FunctionElement rename carries
into the System Composer catalog").

### Prototype — auto-appends parentheses

MATLAB auto-normalizes the Prototype:
- `elem.Prototype = 'foo'` → stores `'foo()'`
- `elem.Prototype = ''` → stores `''` (OK, unlike Name)

Prototype is NOT editable in our UI — it appears only via `displayValue`.
No validation needed.

### Asynchronous — boolean

Accepts true/false/0/1/any numeric scalar (coerced to logical). Rejects arrays,
NaN, complex. Not editable in our UI — not surfaced as a property.

### Arguments — BusElement array

The function's argument list is a structured array of `Simulink.BusElement`
objects. Not directly editable through property editors. Managed internally by
`ServiceBusNode.addChildNode()`.

## Validation mirrored in code

- `DataNode.setProperty` (resolved='name') validates via `validateMatlabName`:
  rejects empty, non-identifier chars, keywords, >63 chars. Also checks sibling
  uniqueness.
  Test: `test/parity/fidelity/element.fidelity.test.ts`.

- Prototype-coupling: a rename rewrites the Prototype's function name with it,
  or is refused when that name cannot be found unambiguously. See
  "Name — coupled to Prototype" above.
  Test: `test/functionElementRename.test.ts`.

## Round-trip coverage

- No `Simulink.ServiceBus` entry exists in the `params.sldd` fixture.
  FunctionElement coverage uses in-process construction via
  `ServiceBusNode.createDefault` + `addChildNode`.
  Test: `test/parity/fidelity/element.fidelity.test.ts`.

- MATLAB re-open gate: skipped for FunctionElement (no fixture entry, and the
  Prototype-coupling makes live MATLAB validation of an isolated rename
  non-trivial). Documented as deferred. Checked once by hand instead
  (2026-10-15, R2027a): a binary dictionary with one ServiceInterface (`f`,
  `y = f(u)`), renamed to `step` by this code and saved, opens through
  `Simulink.dictionary.archdata.open` with Name `step` and FunctionPrototype
  `y = step(u)`.

## Open questions / deferred

- **System Composer catalog copy of other elements**: a function element's
  rename reaches the catalog (see "Name — coupled to Prototype"). A bus
  element's does not, and adding or removing a function leaves the catalog as
  read, as adding or deleting an entry does.

- **Prototype editing**: not surfaced in the UI. If added, it must enforce the
  format `[outputs =] name(inputs)` and keep the Name in sync.

- **Arguments editing**: not surfaced. The argument BusElements are managed
  internally by `addChildNode`. If per-argument editing is needed, it would
  follow the BusElement fidelity rules.
