<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.data.dictionary.EnumTypeDefinition — data-object fidelity

**Node class:** `EnumTypeNode` (`src/datamodel/node/data/EnumTypeNode.ts`)
**MATLAB class:** `Simulink.data.dictionary.EnumTypeDefinition`
**Editable in our UI:** yes
**Verified against:** MATLAB R2027a (probe_enumdef on params.sldd fixture)

## Overview

A Simulink.data.dictionary.EnumTypeDefinition defines a custom enumeration type
within a data dictionary. In our UI the enum surfaces as an editable entry whose
Value column shows the DefaultValue (or the first enumeral's name when no default is
set). Its Property Inspector groups (from `schema/classes/enumType.json`) are General
(Name, Kind, Class), Value Properties (Value — a select editor — Storage Type,
Description) and Code Generation (Data Scope, Header File, Add Class Name To Enum Names,
Is Tunable In Code). Everything but Name, Value and Description is a read-only label.
The child tree shows individual enumeral
rows, each with Name/Value/Description.

## Property table

| Property      | MATLAB type          | SetAccess | Editable here | Serialized key (JSON / binary) | Editor   | Allowed values / constraint |
|---------------|---------------------|-----------|---------------|--------------------------------|----------|-----------------------------|
| Name          | char                | (entry)   | yes           | name / name                    | text     | Valid MATLAB identifier, unique in namespace |
| DefaultValue  | char                | public    | yes           | DefaultValue / DefaultValue    | select   | Must be empty or match an existing enumeral Name |
| DataType      | char                | public    | no (label)    | (not serialized as top-level)  | label    | Any string (free-form) |
| Description   | char                | public    | yes           | Description / Description      | text     | Any string |
| DataScope     | char (enum)         | public    | no (label)    | DataScope / DataScope          | label    | 'Auto', 'Exported', 'Imported' |
| HeaderFile    | char                | public    | no (label)    | HeaderFile / HeaderFile        | label    | Any string |
| StorageType   | char                | public    | no (label)    | StorageType / StorageType      | label    | Any string |
| AddClassNameToEnumNames | logical  | public    | no (label)    | AddClassNameToEnumNames        | label    | true/false |
| IsTunableInCode | logical           | public    | no (label)    | IsTunableInCode / IsTunableInCode | label | true/false; blank when the file omits the key |

## Non-obvious behavior (the reason this doc exists)

### DefaultValue (the select editor)

- **Options come from the live child enumeral names.** `PropEnumValue.readOptions()`
  returns `node.children.map(c => c.name)` — the dropdown always reflects the
  current set of enumerals, including freshly-added ones and excluding removed ones.

- **Selecting a value writes to `node.DefaultValue`.** PropEnumValue has
  `nodeProperty = 'DefaultValue'`, so `setProperty('Value', 'Red')` resolves to
  writing `this.DefaultValue = 'Red'`.

- **displayValue falls back to the first enumeral.** When `DefaultValue === ''`,
  `displayValue` returns `this.children[0].name`. The same enumeral gets the
  "current" icon in the child tree. This mirrors MATLAB's behavior: an enum with
  an empty DefaultValue implicitly defaults to the first enumeral.

- **MATLAB rejects non-existent enumeral names:**
  `v.DefaultValue = 'Bogus'` → "Default value does not match any of the enumeration
  names." However, this rejection is **unreachable** from our string editor because
  the select dropdown only offers existing enumeral names — the user cannot type a
  free-form string. Type-guarded by the select editor.

- **Empty string clears the default:** `v.DefaultValue = ''` is valid in MATLAB,
  reverting to the implicit "first enumeral" behavior. Our code supports this (an
  empty string assignment to a string property succeeds).

### Enumeral child values

- Enumeral `Value` is stored as a **string** (e.g. `"0"`, `"1"`, `"42"`), not a
  number. This matches the JSON/binary source format where the struct array stores
  Value as a character field. MATLAB's `v.Enumerals(i).Value` is numeric (int32),
  but the serialized representation is the string form.

- When a new enumeral is added via `addChildNode()`, its Value is set to
  `String(children.length)` — the next sequential integer as a string.

### Non-string assignment

- Non-string assignment (`5`, `[1 2]`, `true`, etc.) to DefaultValue or Description
  → **"Value must be a character vector or a string scalar."**
  This rejection is **unreachable** from our UI (the select editor and text editor
  always deliver strings). Type-guarded by the string editor.

### IsTunableInCode — the row that cannot be gated

- **It goes last in Code Generation because MATLAB appends it last.**
  `SLEnum.getCodegenPropertyNames()` builds DataScope, HeaderFile and
  AddClassNameToEnumNames, then appends IsTunableInCode when the `OpaqueEnum` feature
  is on — which it is in R2027a, where the property reports `valid=1 readonly=0`.

- **The row is always shown.** The feature gate lives in the running MATLAB
  installation, not in the `.sldd`, and a file carries no trace of whether the release
  that wrote it had `OpaqueEnum` enabled. So an enum whose bag omits the key gets a
  BLANK row rather than no row. Hiding it on a heuristic would hide a value other files
  really carry, and it would hide it twice over: `BaseNode.toPIObject` adds every
  resolved layout key to `shownKeys`, so the "Other" catch-all suppresses the raw
  property as well — the same defect the ValueType doc records.

- **`false` is not the same as absent.** `hydrate` substitutes the descriptor's default
  only when the resolved value is `undefined`, and that default is `''`. An enum that
  turns tunability off renders `false`; one that never mentioned it renders nothing. A
  truthiness test anywhere on this path collapses the two.

- **Serialized flat, as a real boolean.** R2027a writes `"IsTunableInCode": true` at the
  top level — not a nested sub-object and not MATLAB's `'on'`/`'off'` string. The
  display path stringifies it to `"true"`; both save paths must not, because a `"true"`
  reaches the binary XML writer as `Class="char"` where a logical belongs.

- Property-Inspector-only: the descriptor is not `projected`, so it contributes no table
  column. Test: `test/enumIsTunableInCode.test.ts`.

## Structural editing (add/remove enumerals)

### canAddChild / canRemoveChild

- `canAddChild()` → `true` (unconditionally; any enum can grow its enumeral set)
- `canRemoveChild()` → `true` when `children.length > 0`

### addChildNode — enumeral creation

Creates a new enumeral named `'enumN'` (N starts at 1, incremented until unique
among siblings). The new enumeral's Value is `String(children.length)` — the next
ordinal. Description defaults to empty string.

### Dimension re-derivation on serialize

`_getSerializedProperties()` rebuilds the `Enumerals` wrapper on every serialize
call, keeping `_dimensions` in sync:

```
Enumerals = {
  ...preservedKeys,
  _elements: [child.serializeValue() for each child],
  _dimensions: [1, enumerals.length]   // row-vector struct array
}
```

This ensures add/remove stays consistent in the serialized format.

### removeChildNode / restoreChildNode

- `removeChildNode(child)` splices the child from children and marks modified.
- `restoreChildNode(child, index)` reinserts at the original position for undo.
- `execRemoveChild(child)` returns `{ undo, redo }` closures.

### Undo/Redo contract

| Operation | undo() | redo() |
|-----------|--------|--------|
| Add child | `removeChildNode(child)` | `restoreChildNode(child, index)` |
| Remove child | `restoreChildNode(child, index)` | `removeChildNode(child)` |

### Removing the enumeral that IS the DefaultValue

**Measured in MATLAB R2027a Prerelease 27.1.0.3393633 on 2026-09-17**
(`test/parity/matlab/probe_enum_removal.m`, `probe_enum_stale_open.m`). The two
dictionary flavours behave DIFFERENTLY from each other, and both differ from us.

| | Design Data (`Simulink.data.dictionary.EnumTypeDefinition`) | Architectural Data (`Simulink.dictionary.archdata.EnumType`) |
|---|---|---|
| remove API | `removeEnumeral(obj, INDEX)` | `removeEnumeral(obj, NAME)` |
| add API | `appendEnumeral(obj, name, value, desc)` | `addEnumeral(obj, name, value, desc)` |
| removing the default enumeral | allowed; live `DefaultValue` keeps the **dangling** name | allowed; `DefaultValue` immediately reads the **first surviving** enumeral |
| is it cleared or re-pointed? | neither — genuinely still stored (it survives removing other enumerals too) | **cleared**: remove the first one too and the default follows to the next survivor |
| removing a NON-default enumeral | default unchanged | default unchanged |
| removing the LAST enumeral | allowed, down to zero enumerals | **refused** — `interface_dictionary:api:CannotDeleteLastEnumeral` |
| assigning a name that does not exist | rejected — `Simulink:DataType:DynamicEnum_InvalidDefaultValue` | rejected — same identifier |
| on save | the invalid `DefaultValue` key is **dropped from the file** | same: **dropped from the file** |
| on reload | `DefaultValue` is `''` → effective default is the first enumeral | reads the first enumeral |

So the two converge on the same end state — **the effective default becomes the
first surviving enumeral** — and neither ever writes a `DefaultValue` naming an
enumeral the file does not contain. Design data merely defers the tidy-up until
save; arch data does it at once. Note the asymmetry both share: the name is
validated on ASSIGNMENT but not re-validated on REMOVAL.

#### What we do instead — an open defect

`removeChildNode` splices the child and never looks at `DefaultValue`, so after
deleting the enumeral the default named:

- the Value column and PI row still show the **removed** name, because
  `displayValue` returns `this.DefaultValue` whenever it is non-empty;
- **no enumeral carries the "current" icon** — `EnumValueNode.icon` compares
  `parent.DefaultValue === this.name`, and nothing matches any more;
- the Value dropdown offers the surviving names while displaying one that is not
  among its own options (`PropEnumValue.readOptions` reads the live children);
- and `_getSerializedProperties` writes `"DefaultValue": "<removed name>"` into
  the file, which is the combination MATLAB never produces.

That last one was taken to MATLAB rather than assumed. Verified for BOTH .sldd
formats, each in its own MATLAB session (opening two dictionaries that define the
same enum in one session makes MATLAB reuse the first definition and contaminates
the second result): **MATLAB opens our file without error and silently repairs
it** — `DefaultValue` reads back `''`, so the effective default becomes the first
surviving enumeral, and a resave drops the key from the file. In a clean session
it does not even warn.

So this is a **display and round-trip fidelity defect, not file corruption**:
nothing is lost or unloadable, but our UI shows a default MATLAB will not honour,
and the value the user chose changes underneath them when the dictionary is
reopened in MATLAB. The fix that matches both flavours is one line of intent — on
removing the enumeral that `DefaultValue` names, clear `DefaultValue` (and restore
it on undo), which makes our own `displayValue` fall back to `children[0]`, exactly
what MATLAB reports. **Not yet implemented.**

## Validation mirrored in code

- `setProperty('Value', <name>)` writes `DefaultValue = name` unconditionally
  (string-to-string). No validation is needed in code because the select editor
  only offers valid options (existing enumeral names). The MATLAB-side rejection
  ("Default value does not match any of the enumeration names") is unreachable.
  Test: `test/parity/fidelity/enumtype.fidelity.test.ts`.

- IsTunableInCode: nothing to mirror. The descriptor declares `editor: 'label'` and
  `buildPILayout` forces every schema-resolved PI item to a label regardless, so there
  is no write path to validate — the property is a read-only projection of the source
  bag, not a node field. What is pinned instead is that reading it for display writes
  nothing. Test: `test/enumIsTunableInCode.test.ts`.

## Round-trip coverage

- JSON sldd: parse → edit DefaultValue → serialize → re-parse → value preserved.
  Test: `test/parity/fidelity/enumtype.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/enumtype.fidelity.test.ts` (binary format loop).
- MATLAB re-open value-equality gate:
  - `DefaultValue='Red'` → MATLAB reads `'Red'`. PASS.
  - Structural add → MATLAB opens file, `__class__` matches. PASS.
  - Structural remove → MATLAB opens file, `__class__` matches. PASS.
  Test: `test/parity/fidelity/enumtype.fidelity.test.ts` (gated on DEX_MATLAB_CMD).
- IsTunableInCode, in-process only: an enum that carries the key saves it unchanged as a
  logical on both save paths, an enum that omits it gains no key on either, and the saved
  bag re-parses to the same displayed value and the same group membership. **No MATLAB
  re-open gate was run for this property.**
  Test: `test/enumIsTunableInCode.test.ts`.

## MATLAB round-trip gate limitations

- **Enumeral count**: `verify_roundtrip.m`'s `__count__` special key reads
  `numel(v.Elements)`, which is bus-specific. For enums the count is
  `numel(v.Enumerals)`, but we must NOT modify verify_roundtrip.m. Structural
  add/remove tests use `__class__` only (proving MATLAB opens the mutated file)
  and assert exact child counts in-process. This is a known gate limitation.

## Open questions / deferred

- **Removing the enumeral that IS the DefaultValue**: measured in MATLAB and
  written up above — we keep the dangling name, MATLAB moves the default to the
  first survivor. Open defect, fix identified, not implemented.

- **Removing the LAST enumeral**: `canRemoveChild()` returns true whenever there is
  at least one child, so our UI will empty an enum out completely. Design data
  allows that; **Architectural Data refuses it**
  (`interface_dictionary:api:CannotDeleteLastEnumeral` — "Enumerations must have at
  least one enumeration member"). We do not distinguish the two flavours here, so
  for a derived enum we offer a deletion MATLAB would reject. Not yet handled;
  what MATLAB does when it LOADS an arch-data enum with zero enumerals has not
  been measured.

- **Enumeral Name editing**: Individual enumeral names can be renamed via the
  tree. If an enumeral is renamed to match the current DefaultValue, no update is
  needed. If the DefaultValue's enumeral is renamed, the DefaultValue becomes
  stale (MATLAB would reject it). Our UI does not yet cascade a rename into the
  parent's DefaultValue — deferred until enumeral name editing is surfaced.

- **DataScope / HeaderFile / StorageType / AddClassNameToEnumNames /
  IsTunableInCode**: all five are displayed — read-only labels in the Code Generation
  group, except StorageType, which sits under Value Properties. None is EDITABLE: the
  Property Inspector has no edit channel, and none of the five is `projected`, so none
  reaches the table's editable-cell path either. Editability deferred.
