<!-- Copyright 2026 The MathWorks, Inc. -->

# ObjectNode — data-object fidelity

**Node class:** `ObjectNode` (`src/datamodel/node/data/ObjectNode.ts`)
**MATLAB class:** host-only, generic `_array_class` fallback (className is dynamic)
**Editable in our UI:** no (displayValue renders as `<RxC ClassName>`, triggering BaseNode's valueEditable=false)
**Verified against:** n/a — host node, no specific MATLAB data object to probe

## Overview

ObjectNode is the final fallback in the NodeRegistry's matcher chain: any parsed
value object with an `_array_class` key that does NOT match a registered typed node
class routes here. It renders as a read-only `<RxC ClassName>` display (e.g.
`<1x1 Simulink.SomeUnknown>`). This keeps unrecognized Simulink objects visible
in the tree without crashing the extension.

The node stores its `arrayClass` from the raw value's `_array_class` and reports
it as `className`. It exposes [PropName, PropValue, PropDataType, PropDescription]
in the property table. Serialization passes through the raw value unchanged
(`serializeValue()` returns `this.serial._rawVal`), preserving fidelity for
classes we do not understand.

Special case: a derived `Simulink.ServiceBus` receives the `serviceInterfaces`
icon (architectural data support).

## Property table

| Property      | Editor | Notes                                         |
|---------------|--------|-----------------------------------------------|
| Name          | text   | Entry name                                    |
| Value         | label  | Shows `<RxC ClassName>` (read-only)           |
| DataType      | label  | Read-only label                               |
| Description   | label  | Read-only display                             |

## Element rows of an object array

A multi-element value object expands in two levels — N element rows `name(i)`, each
expanding into its own rows (see `test/objectArrayExpansion.test.ts`). Those element
rows do NOT inherit a data type from the container, which is the opposite of the
numeric rule one level over (an int32 array's elements are int32s — see
`MatlabVariable.md`). An object's class is Class, not a data type, so:

- a custom-class element shows its class in **Class** and leaves **Data Type** blank
  (`dataType` returns `''`, as it does for an opaque MCOS variable);
- a KNOWN-class element shows its OWN data type — a `Simulink.Parameter` array's
  elements each report their own `DataType` property, which may differ element to
  element, and default to `'auto'` where the dictionary stores no key.

Handing the container's `_array_class` to a Data Type column would put a class name
in a type column for every unrecognized object in the tree.

## Read-only / host status

- `displayValue` returns `<RxC ClassName>` which triggers BaseNode's
  `valueEditable` heuristic to return `false`.
- ObjectNode is a catch-all fallback registered via a matcher function (not a class
  key), so it handles any `_array_class` value object not claimed by a typed node.
- It performs a pure passthrough serialization (no mutation), so unknown objects
  are preserved byte-for-byte.
- **Existing test coverage**: `test/archPresentation.test.ts` exercises ObjectNode
  for architectural data entries. `test/icons.test.ts` tests the ServiceBus icon path.
- **Contract-lock**: assert displayValue shape and className for a constructed
  instance in `test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- None. ObjectNode is intentionally a passthrough with no editing behavior.
