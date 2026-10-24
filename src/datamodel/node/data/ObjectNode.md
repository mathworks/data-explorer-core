<!-- Copyright 2026 The MathWorks, Inc. -->

# ObjectNode — data-object fidelity

**Node class:** `ObjectNode` (`src/datamodel/node/data/ObjectNode.ts`)
**MATLAB class:** host-only, generic `_array_class` fallback (className is dynamic)
**Editable in our UI:** its property rows, yes, each by its own node's rules; its own Value, no (refused, see
[A Value edit is refused](#a-value-edit-is-refused))
**Verified against:** n/a — host node, no specific MATLAB data object to probe

## Overview

ObjectNode is the final fallback in the NodeRegistry's matcher chain: any parsed
value object with an `_array_class` key that does NOT match a registered typed node
class routes here. It renders as a read-only `<RxC ClassName>` display (e.g.
`<1x1 Simulink.SomeUnknown>`); an enumeration value shows its enumeral instead where
one is known, `GearMode.Reverse` (`displayValue`). This keeps unrecognized Simulink
objects visible in the tree without crashing the extension.

The node stores its `arrayClass` from the raw value's `_array_class` and reports
it as `className`. It exposes [PropName, PropValue, PropDataType, PropDescription]
in the property table.

Serialization rebuilds the value from the LIVE child nodes (`serializeValue`, issue #3),
so an edit made on a property row is written back. A scalar object's `_properties` is
rebuilt from its property rows, in the stored bag's own key order, with the bag's
reserved `_`-named keys carried across in their place (in a binary dictionary only the
saveobj envelope, the one XML can spell: `_rebuiltProperties`), and every other key of
its wrapper and its element is kept as read. An object array's `_elements` is rebuilt
one per element row, each as its row writes it (see below), in the wrapper it was read
in. Two cases are written exactly as read
(`this.serial._rawVal`): an enumeration value, which nothing here edits, and an object
with no expanded children (an empty object array, or an object whose property bag is
empty or absent), which has nothing to rebuild from.

Special case: a derived `Simulink.ServiceBus` receives the `serviceInterfaces`
icon (architectural data support).

## Property table

| Property      | Editor   | Notes                                         |
|---------------|----------|-----------------------------------------------|
| Name          | text     | Entry name                                    |
| Value         | none     | Shows `<RxC ClassName>`, or an enumeration value's enumeral; an edit is refused, in three arms (below) |
| DataType      | label    | Read-only label                               |
| Description   | textArea | Only where the object has one (`descriptionApplies`: MATLAB's isprop for its class, `descriptionClasses.ts`; for a class MATLAB was not asked about, a `Description` key in its bag or the CoderInfo of a Parameter or Signal subclass); not an object array or an enumeration value, nor a table (its Description is in its Properties) or a value still in its encoded stream. The column shows the object's `Description` property row and an edit sets that row, or adds it where the file held the default, which the save writes (see "A Description" below) |

## A Value edit is refused

An object's own Value cell offers no editor: `valueEditable` is false, for an
enumeration value by `ObjectNode.valueEditable`, for any other object because its
`<RxC ClassName>` summary is what BaseNode's heuristic reads as no editor. A caller
that asks anyway, `setProperty('Value', …)` or `session.editProperty(id, 'Value', …)`,
is refused: `ObjectNode.setProperty` never answers `true` for a Value. It answers
`{ error: true, reason, invalidValue, validValue }`, with the value as shown in
`validValue`, from the first of these three arms that applies:

1. **An enumeration value**, in the `_is_enum` form the binary dictionary reader and
   the MCOS decoder give one (`isEnumBag`), or as a text dictionary spells one
   (`_textEnum()`): "'\<name\>' is an enumeration value, which this editor shows but
   cannot change." Nothing here writes an enumeration value, and its enumeral is not
   text that reads back as one: `GearMode.Reverse` typed into a MATLAB value is a char.
2. **A value still in the encoded stream it was read from**
   (`DataNode._refuseEncodedEdit`, its holder found by `encodedHolderOf`): "'\<holder\>'
   is stored as an encoded MATLAB value that this editor can show but not write, so it
   is read-only." The holder is the node at or above this one whose value is that
   stream, which is written as the stream and nothing else.
3. **Any other object**: "'\<name\>' is an object of class \<arrayClass\>, whose value
   this editor shows but cannot change." Its value is edited through its property rows,
   which `serializeValue` writes back.

The third arm is core #100's (F2-25, and the ObjectNode half of F1-45). Before it, a
Value set on an object reached DataNode's generic tail, which kept the text on a `Value`
field nothing writes, marked the entry Modified, pushed an undo step and answered
`true`; the save then dropped it.

Locked by `test/objectValueRefused.test.ts`, over an entry, a property, an object array,
an element of one and an object in a cell, in binary and text dictionaries:
`setProperty` refuses with nothing kept on the node, no Modified mark and an untouched
save, and `session.editProperty` refuses with no undo step; the encoded and enumeration
arms keep their own reasons; and a property row under the object still takes an edit
that the save keeps.

## Element rows of an object array

A multi-element value object expands in two levels — N element rows `name(i)`, each
expanding into its own rows (see `test/objectArrayExpansion.test.ts`). Each element is
named by its 1-based slot, `1` to `N`, as a struct array's elements are
(`test/elementNameBase.test.ts`). Those element rows do NOT inherit a data type from the container, which is the opposite of the
numeric rule one level over (an int32 array's elements are int32s — see
`MatlabVariable.md`). An object's class is Class, not a data type, so:

- a custom-class element shows its class in **Class** and leaves **Data Type** blank
  (`dataType` returns `''`, as it does for an opaque MCOS variable);
- a KNOWN-class element shows its OWN data type — a `Simulink.Parameter` array's
  elements each report their own `DataType` property, which may differ element to
  element, and default to `'auto'` where the dictionary stores no key.

Handing the container's `_array_class` to a Data Type column would put a class name
in a type column for every unrecognized object in the tree.

Each element row is a node of its ELEMENT's class, which need not be the array's. MATLAB
writes a mixed-class array, such as a config set's `Components` or a `Simulink.Signal`
array holding a subclass element, with the class the elements share in `_array_class`
and each element of another class carrying its own in `_object_class`, in a text
dictionary; a binary dictionary names each element's class on its `<Element>`, and its
reader holds the array in the text spelling (`BinarySlddParser.objectArrayValue`). So
`serializeValue` puts an `_object_class` back on each element whose row is of another
class, and `serializeXml` writes each `<Element>` under its row's class. The container
reads as an element of the array's own class where it has one (its icon).

A value of ONE element spelled the same way, `_array_class` naming one class and its
element's `_object_class` another, is an object of the element's class
(`DataNode.objectValueClassOf`): it is dispatched, shown and written to XML as that class,
and its JSON keeps the file's spelling.

Each element row is handed its element whole: every key MATLAB wrote on it, `_id` and
`_custom_save` among them, less the `_object_class` its row's class already says. The
array writes each element back as its row writes it, with `_object_class` restored in the
place the file had it. A row built from `{_properties}` alone wrote that back, so a text
dictionary's untouched save dropped every element's `_id`, and an element of a class that
saves through saveobj, whose `_custom_save` is its whole state, was saved as
`{"_properties":{}}`.

## Read-only / host status

- Its own Value is read-only: `valueEditable` is false, and a Value edit is refused
  (see [A Value edit is refused](#a-value-edit-is-refused)). Its property rows are not:
  each takes an edit by its own node's rules, and the object is written back from them.
- ObjectNode is a catch-all fallback registered via a matcher function (not a class
  key), so it handles any `_array_class` value object not claimed by a typed node.
- Only an enumeration value, and an object with no expanded children, are written
  exactly as read; any other object is rebuilt from its rows (see Overview).
- **Existing test coverage**: `test/archPresentation.test.ts` exercises ObjectNode
  for architectural data entries. `test/objectNode.test.ts` and
  `test/objectIcon.test.ts` test the ServiceBus icon path, and `test/objectNode.test.ts`
  the rebuild from live children. `test/objectValueRefused.test.ts` tests the refused
  Value edit.
- **Contract-lock**: assert displayValue shape and className for a constructed
  instance in `test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- **A Description** (the user's ruling, 2026-10-24: "Description is just a property: if the
  object has it, show it and allow editing; if there is no such property, show it as invalid").
  Decided per class, from MATLAB's isprop (`descriptionClasses.ts`,
  `test/parity/matlab/probe_description_isprop.m`), and for a class MATLAB was not asked about,
  per entry from its bag: a `Description` key, or a CoderInfo naming a Parameter or Signal
  subclass, which a text dictionary saves with only the properties set on it. Measured of a
  default object of a user's subclass of each class one is made of (`fixtures/subclasses`): a
  subclass of AliasType, NumericType or Bus saves its Description at its default, in a text and a
  binary dictionary; a binary dictionary saves every property of all of them; a text dictionary
  saves a ValueType subclass's at its defaults as no property at all, which nothing tells from a
  class with none, so it is shown with none. Where the object has one, the column is its
  `Description` property row: an edit sets it, or adds it, and the save writes it (MATLAB R2027a
  reads it back, `test/descriptionApplies.test.ts`). Where it has none (`embedded.fi`, the
  fixtures' `widget`, an enumeration value, an object array), the row shows none and the edit is
  refused, naming the class.
