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
fields as its direct children; a struct array gets one child per ELEMENT, carrying
an `_subscript` spec (`{index: ei, dims, 'column-major', '()'}`) that
`BaseNode.displayName` spells as `s(1,1) s(2,1) s(1,2) …` on demand — derived, so
renaming the variable relabels its elements — with that element's fields beneath
it. Keeping only
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
  uudecodes (`CdataCodec.uudecode`) and hands the bytes to
  `MatParser.decodeMatStream`, then `parseMatVariable` — the one stream reader
  every venue uses: the Property Inspector's Other group, a binary dictionary's
  hex values, a classic `.mdl`'s MatData record and a `.slx` workspace part go
  through it too, each removing only its own wrapper first (pinned in
  `test/matStreamSites.test.ts`). Real MATLAB puts far more than complex
  doubles here: the R2027a corpus stores `cellNd` (2x3x2 cell), `nd2x3x2`
  (rank-3 real double) and `structNd` (2x3x2 struct array) this way, alongside
  `cplxScalar` and `cplxVec`.

An undecodable payload degrades to a `char` scalar rather than being dropped, and
an untouched cdata entry writes back byte-identically by replaying `_rawInput`.

Pinned in `test/cdataParse.test.ts` (against `truth.json` and the real
`artifacts/text/cases.sldd`).

### A binary dictionary's hex values are the same stream, read-only
A compressed-binary dictionary writes a value XML cannot spell — a sparse array or a
function handle anywhere inside it — as
`<P Name="Value" Class="<class(value)>" Encoding="hex" EncodedLength="<bytes>">`, whose
text is the same MAT stream a text dictionary carries as cdata. `BinarySlddParser`
hands it over verbatim as `{ _type: 'encoded', _attrs, _value }`
(`parser/EncodedValue.ts`), and `parseEncoded` decodes it through the cdata path's
reader, with the stream's own MCOS subsystem for an object. The node it builds can be
of any class (a `ParameterNode` for a `Simulink.Parameter`), and it:

- writes the element back byte for byte (`DataNode._adoptEncoded`) until a value edit,
  which a rename is not;
- is read-only at and under it (`_refuseEncodedEdit`, `_encodedReadOnly`), since
  nothing here writes a new stream for everything one can hold (an MCOS object's
  subsystem, a function handle);
- goes into a text dictionary as the equivalent cdata (`MatWriter.textDictionaryForm`);
- shows `<CLASS, not decoded>` when the stream does not read, and a part-unreadable
  warning says why, never a number;
- is written back unchanged when the stream reads but does not decode, and the rest of
  the dictionary opens.

An untouched text-dictionary stream that holds a sparse array, an MCOS object or a
function handle goes into a binary dictionary as the hex MATLAB writes for it
(`_binaryEncoded`), and so does a renamed one. Pinned in
`test/encodedValueWriteBack.test.ts` and `test/encodedValueDecode.test.ts`.

### A sparse array is held as its non-zeros
A sparse array is never held as a dense list: what it costs is what it holds, at any
declared size. `MatParser` reads one into `MatVariable.sparse` (`parser/SparseData`:
0-based row, column, real and imaginary parts, in MATLAB's column-major `find()` order),
and its `value` is its summary. The node keeps its own copy in `_sparse`, with
`_elements` empty, and `isSparse` (public) says it is one. So spTall, 10000000x2 with two
non-zeros, opens with its two rows — it was refused past a million elements, as
`<10000000x2 sparse double, not decoded>`, until 1.36.3 — and spBig, 1000x1000 with five,
holds five entries rather than a million zeros. A damaged one costs what its bytes hold:
the column walk covers the columns `jc` holds, its index arrays are read only as
integers, and out-of-order or repeated rows are sorted, the last kept.

### A sparse array's class is its element class
`class()` of a sparse double is `double` (`logical`, `single`; complex is still
`double`), so that is the Class and the Data Type.
The storage is `isSparse`, and `MatWriter.encodeSparse` writes it as MATLAB does, byte
for byte, from its non-zeros. So an edited sparse array is that stream — cdata in a text
dictionary, hex in a binary one, at an entry and in a struct field, a cell element or a
Parameter's Value, never `Class="sparse"`, which MATLAB's reader crashes on. An unedited
one is written back as the bytes it was read from. A value typed in whole is the full
array MATLAB makes of the literal. A cell holding a sparse array goes into a binary
dictionary as one hex stream, as MATLAB writes it; a struct as XML with each sparse field
its own hex element, which MATLAB reads back sparse. Pinned in
`test/sparseFixtures.test.ts`, against MATLAB's own answers in all four venues,
`test/sparseNonzeros.test.ts` and `test/matWriter.test.ts`.

A rename leaves a value as it was read (`DataNode.setProperty` keeps `_rawInput`), in
every venue: a renamed value is not rebuilt from its node.

A sparse property of an MCOS object — a Simulink.Parameter's Value in a `.mat`, a model
workspace or a binary dictionary's hex — is handed over by `McosParser.resolveValue` as
the cdata stream a text dictionary holds for the same value, so it is sparse there too
and is copied into a dictionary as MATLAB's own stream (cdata, or hex in a binary one).

### A sparse array shows its summary, and its non-zeros as its rows
- **Summary, always:** `<10x10 sparse double>`, `<3x3 sparse logical>` — the storage,
  then the class, and no "complex", as no summary says it
  (`DisplayConvention.sparseSummaryForm`). At every size, a 1x1 and an empty one
  included, and inside a cell's literal (`{<1x3 sparse double>, [9 10]}`), and at any
  declared size, `<10000000x2 sparse double>`. It is never a dense literal, which is a deliberate departure from MATLAB's struct and cell displays, which
  print a small one inline. Like every summary it offers no cell editor.
- **Element rows:** one per non-zero (MATLAB's `nnz` rule: NaN counts, -0 does not), in
  MATLAB's column-major order, labelled with both subscripts, `x(1,3)` for a vector too,
  as MATLAB's own display lists them (`BaseNode.ElementSubscript`'s `at`, the entry's own
  subscripts). An all-zero one has none. The row budget counts non-zeros. A 1x1 sparse
  array is an array with one row, not a scalar, so that its value is visible somewhere.
- **The value is the non-zeros:** row k is entry k of `_sparse`, and its edit sets that
  entry (`_syncElementFromChild`). An edit to 0 keeps the entry, so the row stays and
  shows 0; the writers keep only the non-zeros, so it is gone once the file is read again.
  A complex array stays complex when every non-zero is set to a real number: its entries
  carry imaginary parts. `Value` is the summary and `elements` is empty.
- **No Variable Editor grid:** `displayElements` answers null for a sparse array, and a
  host asks `isSparse` to offer none. A Parameter whose sparse Value has no rows (an
  all-zero one) has no Value row either.
- **Editing:** a row edits as an element row did; no Add or Remove, so nothing in the
  tree adds a non-zero or shortens a sparse vector. A cell whose literal shows an
  element as a summary — a sparse one, or a large array, a struct, an object — offers no
  in-cell editor and refuses a whole-value edit (`_literalRoundTrips`): read back as text
  the summary is char cells, and undo restores the text. Its elements edit as before.

Pinned in `test/sparseFixtures.test.ts` and `test/sparsePresentation.test.ts`.

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
