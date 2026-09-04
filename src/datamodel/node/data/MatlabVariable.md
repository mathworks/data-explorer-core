<!-- Copyright 2026 The MathWorks, Inc. -->

# MATLAB Variable — data-object fidelity

**Node class:** `MatlabVariableNode` (`src/datamodel/node/data/MatlabVariableNode.ts`)
**MATLAB class:** (none — a plain MATLAB value: double, array, cell, struct, string, complex, logical, typed-int)
**Editable in our UI:** yes (Value column editable for all shapes except struct and opaque)
**Verified against:** MATLAB R2027a (params.sldd fixture round-trip)

## Overview

A MATLAB Variable is a raw MATLAB value stored in Design Data. Unlike
`Simulink.Parameter` or `Simulink.Signal`, there is no wrapper MATLAB class — the
dictionary entry value IS the variable (a scalar, vector, matrix, cell, struct,
string, logical, complex, or typed integer).

In Architectural Data (metadata.isderived = '1'), a plain variable that is scalar
and numeric is classified as a **Constant** and rendered via `ConstantNode` (see
`Simulink.Constant.md`). The fork is purely metadata-driven; on disk they are
byte-identical.

### Columns surfaced
| Column    | Source                       | Editable |
|-----------|------------------------------|----------|
| Name      | entry name                   | yes      |
| Value     | the variable itself          | yes (except struct, opaque) |
| DataType  | className (double, int16...) | no       |
| Description | metadata.description       | yes      |

## Value shapes and their internal representation

| Shape         | `_kind`   | `_scalarType`      | Example displayValue    |
|---------------|-----------|--------------------|-------------------------|
| scalar double | `scalar`  | `double`           | `3.14`                  |
| scalar logical| `scalar`  | `logical`          | `true`                  |
| scalar char   | `scalar`  | `char`             | `'hello'`               |
| scalar string | `string`  | `string`           | `"world"`               |
| scalar complex| `scalar`  | `complex`          | `3+4i`                  |
| typed int     | `scalar`  | `int8`/`int16`/... | `-1234`                 |
| vector/matrix | `array`   | `double`/`logical`/...| `[1 2; 3 4]`        |
| cell array    | `cell`    | `double`           | `{1, 'two', [3 4]}`    |
| string array  | `string`  | `string`           | `["a" "bb" "ccc"]`     |
| struct        | `scalar`  | `struct`           | `<1x1 struct>`          |
| struct array  | `scalar`  | `struct`           | `<2x3 struct>`          |
| empty         | `array`   | `double`           | `[]`                    |

## Non-obvious behavior

### A typed integer/single class survives an edit
`MatlabValueParser.parse('500')` produces `{ type: 'double', value: 500 }` — there
is no `int16(500)` syntax in the parser — so the node's existing class, not the
parser's default, decides the result (`classAfterEdit`). Editing an int16 entry to
`500` keeps int16, matching MATLAB's own `v(:) = 500`. Only the integer and single
classes (`TYPED_NUMERIC_CLASS`) qualify: they can hold any number the editor
accepts. A `logical` retypes to double instead, because MATLAB rejects `7` in a
logical and keeping the class would render the value as `true`. Typing something
that is explicitly another class (`'text'`, `true`, `3+4i`) always retypes — only
the parser's *default* is overridden. (An ELEMENT of a logical array cannot retype
its container, so that path refuses the edit instead — see below.)

### An array element's data type is the array's
One MATLAB array is one class, so every element row of an int32 vector shows
`int32` in the Data Type column, not `double`. `elementClass(arrayClass)` is the
single definition, applied by every element builder — the parse paths
(`parseTypedVector`, `parseTypedArray`, `parseFlatArray`, `_createFromMatNumeric`),
the mutation paths (`_buildArrayChildren`, `_addArrayChild`, `restoreChildNode`'s
collapse survivor), and the element editor (`_setConstrainedValue`). They used to
hardcode `'double'`, which described one value two ways: `int32` on the array row
and `double` on every row beneath it.

The eligible set is `TYPED_NUMERIC_CLASS` plus `logical`. For the integer/single
classes the change moves the Data Type column and nothing else — they format through
`formatMatlabNum` exactly as a double does. Cell and struct children never inherit —
they are independent values, and their container has no one class to hand down
(arrays and matrices only). Pinned in `test/matlabVariableNode.test.ts`.

### A logical array and its element rows are logicals
`logical` is the one inherited class that changes how the row looks: `logical` in the
Data Type column, `true`/`false` as the text, and the `wsCheck` checkbox icon — the
same three the logical SCALAR path has always produced (`icon`, `_formatScalar`), now
reached because the element's `_scalarType` is `logical`. Before this, an array cell
read `[true false true]` over rows reading `1` and `0`: the storage form leaking into
the UI.

The CONTAINER row carries the checkbox too (`icon`, `_kind === 'array'`). Array rows
returned the generic `wsDefault` whatever they held, so a logical array looked like a
plain double vector while every element row under it was a checkbox. The numeric
classes still share `wsDefault` — int32 and double have no icons of their own — and a
logical array that collapses to a scalar keeps the icon, since the scalar path was
already `wsCheck`.

Stored elements stay 1/0. `_elements` is the single representation the container's
display, its `_var` snapshot, and the typed literal all read, and every parser writes
a logical array that way, so `_setConstrainedValue` normalizes an edited element back
to 1/0 rather than leaving one boolean among the numbers.

The element editor gets a logical arm to match: it accepts `true`/`false` (a row that
displays `true` must accept `true`) and also `1`/`0`, and **refuses any other
number** — "Logical array elements must be true or false". That closes a hole rather
than adding a restriction: the numeric-only accept set took `7` and wrote
`{_type:'logical', _value:'[7, 0, 1]'}`, a logical array holding 7. MATLAB answers
`L(1) = 7` by retyping the whole ARRAY to double, which an element editor cannot
express — see the deferred note below.

### Constrained children (array elements and string elements)
When editing a child of an array or string-array:
- **Array element:** `setProperty('Value', ...)` rejects anything that is not a
  scalar number. Error: **"Array elements must be scalar numbers"**
- **String element:** rejects anything that is not a char or string value. Error:
  **"String elements must be character or string values"**

### A string element is a string-KIND child, not a string-typed scalar
Every element of a string array is built by `_makeStringElement` as a node with
`_kind = 'string'` (and `_scalarValue` holding the text), never as
`_createScalar(..., 'string')`. The reason is serialization: a string-kind node
emits a bare `""` element, where a string-typed scalar would emit a nested `[""]`
array via `_serializeScalar`.

The consequence for the mutation paths is that a string array's children do NOT
match the shape a numeric array's do (those *are* scalar-kind), so code that reads
a child's value must not gate on `_kind === 'scalar'`. `restoreChildNode` used to,
which made every undone string element come back as `''` while its child row still
showed the old text.

### A collapsed string array stays kind 'string'
Down to one element, a string array renders as a scalar string (`"a"`) and drops
the survivor's child row, but — unlike a numeric array, which becomes `_kind
'scalar'` — it keeps `_kind = 'string'`. So the undo-side survivor rebuild needs
its own condition (`_kind === 'string' && children.length === 0 && _elements.length
=== 1`) rather than sharing the numeric one. Both paths record the pre-collapse
`[1,n]`/`[n,1]` orientation in `_preCollapseDims` so undo does not transpose the
data. Pinned in `test/matlabVariableNode.test.ts`.

### Structs are not directly editable
A struct (`_kind='scalar', _scalarType='struct'`) has `valueEditable = false`. Its
fields are editable as individual children.

### A struct ARRAY expands to one row per element, not one row per field
`MatParser` reads a struct array as one `MatVariable` per element per field
(`fields[f][ei]`), in MATLAB's own column-major order. A 1x1 struct keeps its
fields as its direct children; a struct array gets one child per ELEMENT,
subscript-labelled through `subscriptLabel(name, ei, dims, 'column-major', '()')`
— `s(1,1) s(2,1) s(1,2) …` — with that element's fields beneath it. Keeping only
`fields[f][0]` used to make every element after the first invisible, and forced
`_buildVarObject` to replay elements 2..N from the parse snapshot, so an edit to
any element but the first was discarded on save. The rebuild now reads the live
tree: a field goes back out as one `MatVariable` per element, in the same order.
Pinned in `test/matStructArray.test.ts` (against `truth.json` and the real
`cases.mat`).

### Opaque objects are read-only
An opaque MCOS object (e.g. a `Simulink.Parameter` stored as a raw variable rather
than as a recognized catalog entry) has `valueEditable = false` and
`canAddChild() = false`.

### cdata is the format's escape hatch, not "the complex encoding"
A value the `.sldd` schema cannot spell is stored as `{ _type: "cdata", _value:
<encoded> }`, in one of two encodings:

- **Text**, for a complex value the writer could spell out: `"1+2i"` /
  `"1+2i 3+4i"`, column-major, with `_dimensions` alongside. This is what the
  binary (zipped-XML) dictionary emits, and `_parseCdataText` reads it.
- **Uuencoded bytes** (six bits per printable character, offset by `0x20`), which
  is what an *uncompressed-text* dictionary emits. The bytes are an 8-byte
  preamble followed by ONE MAT-file `miMATRIX` element, so `parseCdata`
  uudecodes, reads the tag at offset 8, and hands the payload at offset 16 to
  `MatParser.parseMatrix` / `parseMatVariable` — the same reader the `.mat` path
  uses. Real MATLAB puts far more than complex doubles here: the R2027a corpus
  stores `cellNd` (2x3x2 cell), `nd2x3x2` (rank-3 real double) and `structNd`
  (2x3x2 struct array) this way, alongside `cplxScalar` and `cplxVec`.

An undecodable payload degrades to a `char` scalar rather than being dropped, and
an untouched cdata entry writes back byte-identically by replaying `_rawInput`.

Pinned in `test/cdataParse.test.ts` (against `truth.json` and the real
`artifacts/text/cases.sldd`).

## Validation mirrored in code

| Rule | Code path | Error message |
|------|-----------|---------------|
| Array child must be scalar number | `MatlabVariableNode._setConstrainedValue` | "Array elements must be scalar numbers" |
| Logical array child must be true/false (or 1/0) | `MatlabVariableNode._setConstrainedValue` | "Logical array elements must be true or false" |
| String child must be char/string | `MatlabVariableNode._setConstrainedValue` | "String elements must be character or string values" |
| Unparseable expression | `MatlabVariableNode.setProperty` | "Invalid MATLAB expression" |

Test: `test/parity/fidelity/variable.fidelity.test.ts`

## Round-trip coverage

- **JSON sldd:** parse -> edit -> serialize -> re-parse -> value preserved. Shapes
  tested: scalarD, negD, colVec, rowVec, mat2x2, boolFlag, i16Scalar, strScalar,
  charStr, cplxScalar, emptyD, myCell, strArray, boolVec.
- **Binary sldd:** same set of shapes.
- **MATLAB re-open value-equality gate** (gated on `DEX_MATLAB_CMD`): scalarD,
  negD, colVec, rowVec, mat2x2, boolFlag, i16Scalar confirmed via `__value__` and
  `__class__` assertions.

### Shapes tested only in-process (not through the MATLAB gate)
| Shape | Reason |
|-------|--------|
| complex (cplxScalar) | cdata binary encoding; verify_roundtrip scalar path cannot compare |
| string (strScalar) | string saveobj/loadobj path requires special MATLAB comparison |
| char (charStr) | char class match works but value quoting needs special handling |
| cell (myCell) | heterogeneous cell; no scalar path |
| string-array (strArray) | same as cell |
| struct (myStruct) | top-level struct parses as StructNode, not MatlabVariableNode |

## Open questions / deferred

- **Casting to a typed integer from the editor**: the parser has no `int16(...)`
  cast syntax, so a `double` entry cannot be *changed* into an int16 by typing —
  only an already-typed entry keeps its class across an edit (`classAfterEdit`).
  Widening this would mean teaching `MatlabValueParser` the cast expressions.
- **Retyping an array from one of its elements**: MATLAB's `L(1) = 7` on a logical
  array converts the whole array to double. We refuse the edit instead, because the
  conversion would have to rewrite the container's class, its serial tag, and every
  sibling row's class and icon from inside a single cell's editor.
- **Complex array editing**: editing individual elements of a complex array is not
  supported through the constrained-child path (they are read-only). This is safe
  because the complex array's cdata serial is preserved unmodified until the parent
  value is re-edited as a whole expression.
