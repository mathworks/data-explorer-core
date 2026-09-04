<!-- Copyright 2026 The MathWorks, Inc. -->

# How MATLAB stores a `string` in a `.mat` file

A MATLAB `string` is an MCOS object, so it arrives on the same path as a
`Simulink.Parameter` — and `McosParser.buildObjectValue` used to give up on one by
design, returning `NOT_AVAILABLE` (`'<not available>'`) with a comment calling the
encoding "internal, undocumented … we cannot reverse with confidence."

This note is the record of reversing it, written from a dump of real files rather than
from memory, so that the decoder was built against measured bytes and not against a
guess. **Everything below is verified in both directions**: predicted from MATLAB's own
answers and compared word for word against the bytes in the file. It is now all
implemented — see "Implemented" — and `NOT_AVAILABLE` survives only as the fallback for
a payload that does not match the measured layout.

Two separate things were wrong and only one of them needed the payload cracked:

- **shape and Data Type** (defect 31). `cases.mat`'s `strArray` is 1x3 and `strMat` is
  2x3, and the reader reported `[1,1]` for both with a blank Data Type. A 1x3 `string`
  is ONE MCOS object (unlike a 1x3 `Simulink.Parameter`, which is three), so the handle
  a named variable carries says `[1,1]` no matter how big the array is — the real shape
  is inside the payload. This was wrong whatever happened to the text.
- **the text itself** (defect 33), which needed the layout AND an exact 64-bit read.
  See "The blocker, since removed": it was not decodable through the `.mat` read path as
  it stood, and the reason was not the layout. Task 10.2 made that read exact (DESIGN.md
  defect 32), and the decoder built on it now yields MATLAB's own answer for all eleven
  probe cases — astral plane, `missing`, empties and a 2x2x2 included.

## Reproduce

```bash
env STRING_OUT=/tmp/strprobe mw -using Bmain matlab -nodesktop \
    -batch "run('$PWD/test/parity/matlab/probe_string.m')"
```

Prints one line per case and `STRINGPROBE OK`. Writes `strings.mat` (all 11 cases),
`strings_v7.mat`, `strings_v73.mat`, one `one_<name>.mat` per case, the four
`mix_*.mat` files that settle where a payload lives, and `strings_truth.json` —
MATLAB's own `class`, `size`, `ismissing`, `strlength`, text and code units per case,
all flat and column-major.

## Where the text lives: the segment the parser skipped

`McosParser.parseMetaTable` reads five regions out of `cells[0]`: the ten header words,
the string table, the class table, the object table `[w[4], w[5])` and the property
blocks `[w[5], w[6])`. It never reads **`[w[3], w[4])`**, and that is where a string's
link to its data is.

An object row is 24 bytes — six `uint32`. The parser reads word0 (`classId`) and word4.
Dumping all six for `mix_order.mat`, a file holding one `Simulink.Parameter` and one
string:

```
obj 0 [0,0,0,0,0,0]
obj 1 [3,0,0,0,1,3]  Simulink.Parameter
obj 2 [2,0,0,0,2,2]  Simulink.CoderInfo
obj 3 [1,0,0,0,3,1]  SimulinkCSC.AttribClass_Simulink_Default
obj 4 [4,0,0,1,0,0]  string
```

Every Simulink object has word3 = 0 and a nonzero word4; the string is the mirror
image — word4 = 0, **word3 = 1**. So there are two block segments, and word3 indexes the
one at `[w[3], w[4])`. `mix_nested.mat`, which holds two strings, numbers them 1 and 2.

That segment has exactly the encoding the parser already implements for the other one:
a `[0, 0]` placeholder for block 0, then per block a count followed by that many
`(nameStringIdx, flag, value)` triples, padded to 8 bytes. For `mix_order.mat`:

```
[0,0,  1,26,1,7]        block 1: one property, strings[26], flag 1, value 7
```

`strings[26]` is `"any"`, `flag 1` means "value is a heap index", and heap index 7 is
`cells[7 + 2]` = `cells[9]` — the `uint64` payload. Measured in every file: **a `string`
object always has exactly one type-1 property, always named `any`, always flag 1**.
That is the same word the text dictionary uses for a class that serializes its whole
state as one opaque blob (`<P Source="saveobj" PropertyType="any" …>`, defect 28), which
is what a `string` is.

**`objId + 1` is NOT the rule**, though it fits every file whose only objects are
strings. `mix_order.mat` refutes it directly: the string is object 4 and its payload is
`cells[9]`, because the Parameter's seven property values were allocated on the heap
first. The type-1 block is the only link.

## The payload cell

A `1xN uint64`. Every case measured:

| words | meaning |
|---|---|
| 0 | version — `1` in every case measured |
| 1 | `ndims` |
| 2 .. 2+ndims-1 | the extents, MATLAB's own `size()` |
| next `numel` | per-element **UTF-16 code unit count**, column-major; `0xFFFFFFFFFFFFFFFF` = `missing` |
| the rest | every element's code units CONCATENATED, 4 per `uint64`, unit *j* of a group in bits 16*j*..16*j*+15, zero-padded in the last word |

The code units are **one continuous stream**: an element does not start a fresh word, so
`"alpha" "beta" "gamma"` packs as `alph | abet | agam | ma__`. `sRow`'s payload, exactly:

```
1 2 1 3  5 4 5  29273878621323361 32651531096555617 30681189080039521 6357101
```

Rank is real, not flattened — `sNd`, a 2x2x2, writes `1 3 2 2 2` and then eight count
words. The extents are the shape channel this fixes.

### The edges

```
sEmptyA   1 2 0 0                                     strings(0,0): extents 0 0, no count words at all
sEmptyE   1 2 1 1 0                                   "": a count word of 0, and no data word
sMissing  1 2 1 2 18446744073709551615 1 120          [string(missing), "x"]
sAstral   1 2 1 1 4 27828642926887009                 "a😀b"
```

- **empty vs missing are distinguished by the count word**, not by absence: `""` gets a
  0 and `missing` gets all ones. A `missing` element contributes no code units, and the
  count words still number `numel` — the sentinel occupies the slot.
- **a non-BMP character is a surrogate pair, counted as two.** `"a😀b"` has count 4, and
  MATLAB's own `strlength` agrees (4, not 3). So the count word is code units, and a
  decoder that walked characters would desynchronize the whole stream after the first
  astral character.
- **no interning.** Two variables holding `"same"` get two objects and two payload cells
  with identical bytes (`mix_dup.mat`).

## Both `.mat` flavours, and the one that is a different file

`-v7` stores a string identically — same MCOS subsystem, same type-1 block, same
`uint64` payload — so one decoder covers both. Verified against `strings_v7.mat`.

**`-v7.3` is HDF5**, not a level-5 MAT file: the superblock signature
`89 48 44 46 0d 0a 1a 0a` sits at offset 512, after the 512-byte text header. `MatParser`
does not read that container at all, so how a string is laid out inside it was not
investigated and no fixture in this corpus is one.

It is now *refused* rather than read as empty. The first 128 bytes of a v7.3 file are a
level-5 header of exactly the ordinary shape — right length, endian indicator a genuine
`IM` — so every framing guard passed it and the first record tag was read out of the
zero padding between the header and the offset above, which is the format's
end-of-variables marker. The file parsed successfully with no variables in it.
`MatParser.ts:356-369` now throws on the `MATLAB 7.3 MAT-file` header prefix. The offset
recorded above is the standing fallback if that prefix ever turns out to be wrong: it is
fixed by HDF5's own spec, while the header text is MATLAB's to choose.

## Which paths reach a string, and which do not

A `Simulink` object's property cannot hold a string. Assigning one converts it:

```matlab
mixProp = Simulink.Parameter(1);
mixProp.Description = "described";     % class(mixProp.Description) is char
```

`mix_prop.mat` has no type-1 segment at all as a result — the string never existed by the
time the file was written.

**A user-written class is different, and this was originally recorded here as unreachable
in error.** `test/fixtures/mcos/object_props.mat` holds a plain `classdef` whose
properties are typed `string`, and those DO survive as string objects and DO reach
`buildObjectValue` as property values:

```matlab
v = Vehicle;  v.Name = "Model-X";      % class(v.Name) stays string
```

So the property path is live, and the decoder renders it: `Vehicle.Name` → `"Model-X"`,
`FleetName` → `"east"`, the nested `Engine.Label` → `"V8"`, `Garage.Location` →
`"Boston"`, while a sibling property assigned `'blue'` correctly stays a char. Pinned by
`a string held as an object PROPERTY` in `test/matStringOpaque.test.ts` and by
`decodes a MATLAB string-typed property value out of its own payload cell` in
`test/mcosParser.test.ts`.

What is genuinely not reached is a string nested in a **struct field or cell element**,
and not because of the payload: such an opaque has no variable name, so
`decodeMcosObjects`' `variables.filter(v => v.isOpaque && v.name)` never sees it. That
is a nested-MCOS gap shared with every other class — see DESIGN.md's "Known
limitations" — and it is pinned by `a string nested in a struct or a cell` against
`test/fixtures/strings_nested.mat`.

## The blocker, since removed: the layout was right and the text still came out wrong

`MatParser.readNumericArray` read a 64-bit integer through
`Number(view.getBigUint64(...))`, and a `uint64` holding four packed code units is
routinely outside a double's exact range. Of the 154 payload words across the eleven
cases, **11 are not exactly representable** — and because unit 3 of a group sits in the
HIGH bits, the rounding lands on the LOW bits, which is unit 0: the FIRST character of
every group.

Decoding the eleven cases straight out of the words that reader gave us:

```
s2x3     WRONG  ["`","d","b","e","c","f"]     want ["a","d","b","e","c","f"]
sAstral  WRONG  "`😀b"                        want "a😀b"
sCol     WRONG  ["pne","two"]                 want ["one","two"]
sNd      WRONG  [...,"d","d",...]             want [...,"d","e",...]
sRow     WRONG  ["`lph`","bet`","gamma"]      want ["alpha","beta","gamma"]
sUnicode WRONG  ["`afé","païve","日本"]        want ["café","naïve","日本"]
sEmptyA / sEmptyE / sLong / sMissing / sScalar  OK
```

Six of eleven, and every failure was the "plausible mojibake" a guessed layout would
produce — except the layout was right and the READ was lossy. `"café"` read back as
`"`afé"`: one character off by one bit, silently.

So **exact 64-bit `.mat` reads (PLAN.md Task 10.2) were a hard prerequisite for decoding
the text (Task 9.3)**, and 9.2 — shape and Data Type — did not depend on either, because
the extents are small integers.

**That prerequisite is now met** (DESIGN.md defect 32). `readNumericArray` returns
`(number | string)[]`: a word a double cannot hold arrives as its own decimal TEXT via
`XmlUtils.exactInt`, so all 154 payload words are exact. The decoder is written against
that: every count and data word goes through `payloadWord`, which accepts a `number`
**or** a decimal token and returns a `bigint`. `typeof word === 'number'` alone would
have silently skipped exactly the words that carry four characters — the six-of-eleven
failure above, restored.

`missing` detection was safe even under the rounded read: `0xFFFFFFFFFFFFFFFF` came back as
`18446744073709552000`, still far above any real length, so `sMissing` decoded correctly
throughout. It is now the exact token `'18446744073709551615'`, and the decoder compares
against it as the `bigint` `STRING_MISSING_COUNT`.

## Implemented

The shape-and-type half, per PLAN.md Task 9.2 (DESIGN.md defect 31):

- `McosParser.parseMetaTable` now reads BOTH block segments through one reader — type 1
  at `[w[3], w[4])` and type 2 at `[w[5], w[6])`, same encoding — and keeps object-row
  word3 as `ObjectRow.type1Idx`.
- `stringPayloadWords` / `stringPayload` walk word3 → the type-1 block → its single
  `"any"` triple → `cells[value + 2]`, and read words 1..1+ndims as MATLAB's `size()`.
  Either the whole route is there in exactly the measured form or the answer is null:
  a version word other than 1, a block with more than the one triple, a payload cell
  that is not `uint64` — each falls back to the handle's `[1,1]` rather than reading
  extents from a position that may have moved.
- `decodeMcosBlob` uses those extents for a `string` and the handle's own dims for
  everything else.
- `MatlabVariableNode.dataType` returns `'string'` for the one opaque className that is a
  data type; `dims` and both summary spellings in `displayValue` use `_mcosDimensions`
  instead of a hardcoded `[1, 1]`.

Pinned by `test/matStringOpaque.test.ts` — all eleven probe cases plus `strScalar`,
`strArray` and `strMat` from the corpus, asserted against `strings_truth.json` and
`truth.json` — and by two unit tests in `matlabVariableNode.test.ts`.

And the prerequisite for the text, per PLAN.md Task 10.2 (DESIGN.md defect 32):

- `MatParser.readNumericArray` returns `(number | string)[]`. A 64-bit word a double cannot
  hold arrives as its own decimal TEXT through `XmlUtils.exactInt`, so every payload word
  is now exact — including the ones that pack four code units, which are the words the
  rounding used to land in.
- `stringPayload` was widened for that: the extents are still small numbers, but the
  count and data words in the same array may be tokens now, so the rank and extent checks
  require `typeof === 'number'` explicitly rather than letting a string coerce.

And the text itself, per PLAN.md Task 9.3 (DESIGN.md defect 33):

- `decodeStringElements` reads the `numel` count words — `STRING_MISSING_COUNT` →
  `null`, anything above `MAX_STRING_UNITS` → bail — sums them, then unpacks
  `ceil(total / 4)` data words into one flat code-unit stream and slices per element in
  count order. One stream, not one word per element: that is what the bytes say, and
  slicing per element would desynchronize after any element whose length is not a
  multiple of four.
- `textFromUnits` is `String.fromCharCode` over that slice, chunked at
  `FROM_CHAR_CODE_CHUNK = 4096` so a long scalar cannot blow the argument limit. Because
  the units are UTF-16 and are handed over untouched, a surrogate pair reassembles
  itself — `sAstral` comes back `"a😀b"` with no astral special case anywhere.
- `stringObjectValue` returns the `{_array_type: 'String', _dimensions, _elements,
  _mw_element_type: 'MATLABArray'}` envelope the rest of the node layer already speaks,
  so a string property renders through the same code as a string from a dictionary.
- `decodeMcosBlob` carries `stringElements` alongside the dims, and
  `modelOpaqueMcosVariable` routes a `string` variable to
  `MatlabVariableNode.createFromMcosDecoded`, which calls `_adoptStringPayload`: set
  `_kind = 'string'`, adopt the column-major `_elements` and `_dims`, build the element
  children. Subscript labels then come for free — `BaseNode.displayName` already asks for
  `'column-major'` with `()` when the parent's `_kind` is `'string'`, so `sNd`'s eight
  children label `sNd(1,1,1)` … `sNd(2,2,2)` without a line of new label code.
- `MISSING_STRING = '<missing>'` in `DisplayConvention`, MATLAB's own spelling. Unquoted
  and in angle brackets, which is also what withholds the editor.
- **A decoded string stays read-only.** `canAddChild`, `canRemoveChild` and
  `valueEditable` all refuse for an opaque node and for a child of one, and
  `_setConstrainedValue` refuses with `'This value is read-only'`. `.mat`/`.slx` have no
  write-back path, so an editable cell would promise a save that cannot happen; the same
  string in a text `.sldd` stays editable, because that writer exists.

Pinned by 31 tests in `test/matStringOpaque.test.ts`: all eleven probe cases against
`strings_truth.json` (text, code units, order, labels, display), the six formerly
mojibake'd cases by name, four-way parity across `.mat` / `.slx` / text `.sldd` / binary
`.sldd`, the `-v7` flavour, the property path, the read-only contract, and the nested gap.

**The type-1 segment is parsed but its properties are NOT lifted into any property bag.**
Only the string payload is read out of it. `aVariant`'s saveobj state lives there too, and
DESIGN.md's decision under defect 28 is to preserve such a payload verbatim rather than
translate its fields — see the closing section below.

## What could not be determined

- **Header words `w[0]` and `w[1]`.** `w[0]` is 4 in every file; `w[1]` is 27, 25, 2 and
  2 in the four `mix_*`/`strings` files and matches neither the string count nor the
  class count. Neither is needed to navigate.
- **Object-row words 1, 2 and 5.** Words 1 and 2 are 0 in every row seen. Word 5 is
  nonzero for a Simulink object and 0 for a string, but it is not the row index — in
  `mix_order.mat` rows 1, 2, 3 carry 3, 2, 1. Its purpose is unknown, and nothing here
  needs it.
- **`cells[1]`.** A placeholder that `parseMatrix` reports as a `double` with a null
  value and a nonsense `dimensions` array. Nothing indexes it — heap index 0 is
  `cells[2]` — so it is inert, not a defect.
- **Whether the version word is ever anything but 1**, and what a different value would
  change.
- **`-v7.3`/HDF5 storage**, as above.
- **Whether MATLAB reads a payload we WRITE.** Nothing in this package writes a `.mat`
  MCOS subsystem, so the write direction is untested and out of scope for Phase 9.

## A related observation, deliberately not fixed here

The type-1 segment is not only a string mechanism. In `cases.mat`, `aVariant` is
`[13,0,0,4,0,0]` — a `Simulink.VariantVariable` whose ENTIRE state is type-1 block 4,
pointing at `cells[60]`, a struct. Skipping that segment therefore drops a
VariantVariable's saveobj state out of `.mat` and `.slx` the same way the binary
dictionary writer used to destroy it (defect 28).

It is not a user-visible regression today: `aVariant` presents no property rows in ANY
format — `mat`, `text` and `binary` all show zero children — because DESIGN.md's
decision under defect 28 is to preserve a saveobj payload verbatim and NOT lift its
fields, there being no corpus artifact that answers the translation. Nothing writes a
`.mat`, so nothing is lost on the way out either. Recording it so the next person
reading this segment knows it carries more than strings.
