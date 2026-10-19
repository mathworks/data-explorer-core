<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.VariantBankCoderInfo — data-object fidelity

**Node class:** `VariantBankCoderInfoNode` (`src/datamodel/node/data/VariantBankCoderInfoNode.ts`)
**MATLAB class:** `Simulink.VariantBankCoderInfo`
**Editable in our UI:** the class's own five properties, by MATLAB's rules; the Value column is
read-only, and a Value edit is refused: the MATLAB class has no Value. Nor has it a Description,
so none is offered and an edit of one is refused.
**Verified against:** MATLAB R2027a (27.1.0.3409468), 2026-10-16 and 2026-10-18: the entry `vbciD`
MATLAB wrote into `test/fixtures/classes_r2027a_{text,binary}.sldd` (`make_classes_r2027a.m`), and
the entries `ciA` and `ciB` in `test/fixtures/variantbank_r2027a_{text,binary}.sldd`
(`make_variantbank_r2027a.m`, whose coder info SET and LOAD lines are every rule and load result
below)

## Overview

A Simulink.VariantBankCoderInfo stores code-generation settings for variant banks. MATLAB's
class has five properties: HeaderFile, DefinitionFile, PreStatement, PostStatement and
Qualifier. All five are char, and all default to `''` except Qualifier, which defaults to
`'None'`. A dictionary holds the object as a saveobj envelope of those five, in both formats,
with nothing beside it.

The node reads the five out of the envelope (`readSaveobjField`), shows them, and takes an edit
of each by MATLAB's own rules, as `VariantBankNode` does a bank's. An edit is written into the
envelope only (`_mergeProps`), a Qualifier in MATLAB's spelling, and a field no edit has set is
written as it was read, so a save with no edit writes the file as it was read. `createDefault`
makes the envelope MATLAB writes for a new entry, with its fields, order and defaults measured
from a MATLAB-written dictionary, and nothing beside it.

## Property table

| Property        | Editor   | Column           | Serialized key            | Notes |
|-----------------|----------|------------------|---------------------------|-------|
| Name            | text     | Name             | entry name                | MATLAB identifier |
| Value           | none     | Value            | written back as read      | Not a property of the class; shown only where the file carries one |
| DataType        | label    | Data Type        | (className display)       | Read-only label |
| Header File     | text     | `headerFile`     | envelope `HeaderFile`     | '' or a file name ending .h or .hpp |
| Definition File | text     | `definitionFile` | envelope `DefinitionFile` | '' or a file name |
| Pre Statement   | textArea | `preStatement`   | envelope `PreStatement`   | Any text |
| Post Statement  | textArea | `postStatement`  | envelope `PostStatement`  | Any text |
| Qualifier       | select   | `qualifier`      | envelope `Qualifier`      | None, Const, Volatile or ConstVolatile |

The Header File column is the one a Parameter's or Signal's `CustomAttributes.HeaderFile` renders
into. The Property Inspector shows the five under "Code Generation"
(`classes/variantBankCoderInfo.json`), whose layout keys are `coderInfoHeaderFile`,
`coderInfoDefinitionFile`, `preStatement`, `postStatement` and `qualifier`: not `headerFile` and
`definitionFile`, which are the schema properties other classes' layouts name, and which an atom
key of the same name would take over (`schemaBridge` resolves an atom key first). The five declare
the envelope, and their plain property (R2026b's spelling, below), as their source keys, so the PI
no longer lists either as a stray `Other` row.

## The rules, measured

MATLAB's setters, each refusal quoted verbatim by `setProperty`:

- **HeaderFile**: '' or a name whose first `.`-separated part, after any leading spaces or tabs,
  is a C identifier that does not start with `rt` (case sensitive: `RTa.h` is taken). That is
  checked first; refused: "'HeaderFile' property for Simulink.VariantBankCoderInfo must be a valid
  C identifier that does not start with "rt"." (`a b.h`, `1a.h`, `rta.h`, `.h`, `inc/a.h`, `a-b.h`).
  Then the length: each `/`-separated part of the name may be at most 255 characters, a leading
  space counted. 255 is taken and 256 refused, for `.h`, `.hpp`, a leading space and a dotted
  middle part alike; `a.b/` and 253 more characters is taken, 257 in all, and a first part of 262
  before a `/` is refused. A character that decomposes counts as its parts, as the macOS file
  system counts a name (measured on macOS: `é` counts 2, `ǖ` 3, and `€` and `中` 1 each, each at
  its limit; another platform's count of a character outside ASCII was not measured, and an edit
  writes only ASCII). Refused: "Check specified header file name '…' for invalid characters,
  invalid file name length, and trailing spaces.", even where the extension is wrong too
  (`a`×300`.c`), but not where the first part is (`rt`, or `1`, then `a`×300`.h` get the first
  part's message). Then the extension, what follows the last `.` of the last part of the path
  (one trailing `/` dropped), must be exactly `h` or `hpp`; refused: "Change file extension 'c' to
  header file extension '.h' or '.hpp'." (`a.c`, `a.H`, `a`, `a.h `, `a.h/x`).
- **DefinitionFile**: the same first-part rule, with its own name in the message, and no
  extension or length rule: `a`, `a.`, `a.txt`, `a.h` and `a.cpp` are all taken, and so is a name
  of 302 characters.
- **PreStatement, PostStatement**: any text, a line break included.
- **Qualifier**: the enumeration None, Const, Volatile and ConstVolatile, typed in any case
  (`const`, `CONSTVOLATILE`) and stored in that one. Refused: "Error setting property 'Qualifier'
  of class 'VariantBankCoderInfo': There is no enumerated value named 'foo'." (`''`,
  `const volatile`, `Const Volatile`, ` const`, `Con`, `Restrict`).
- A value that is not text is refused by each: "Value must be a character vector or a string
  scalar." An edit always arrives as text, so this one is not reached here.

MATLAB takes some file names beyond these that an edit does not write: a space, `/` or `-` after
the first part (`a.b/c.h`, `a.h/`, `a. .h`, `a.-.h`, `a.c d.h`), and a definition file name with a
trailing space or a `$` (`d.c `, `a.$`). They are refused with "'…' is not a header file name
this editor can check, so it is not written" (or a definition file name), stating the shape it
takes: a C identifier, then any `.`-separated parts of letters, digits and underscores, ending .h
or .hpp for a header file. Every name of that shape, within the header file's length, was
measured to be taken. `$` starts a token MATLAB checks by a rule not measured here (`a.c$.h` is refused with
"'$.' is not a supported token for property 'HeaderFile'."), and refusing a name costs an edit,
where writing one MATLAB refuses costs the whole coder info (below).

## A hand-edited file

What MATLAB loads, measured with the text fixture's `ciA` edited one field at a time:

- A HeaderFile or DefinitionFile the setter refuses (`a.c`, `a b.h`, `inc/a.h`, `rta.h`, `a b.c`,
  `1a.c`, and a HeaderFile of 256 or 302 characters, or of 131 that decompose to 256) makes MATLAB
  load the **whole coder info as defaults**, its Qualifier `'Const'` lost too, with no warning. A
  HeaderFile of 255 characters, or of 130 that decompose to 255, loads as written.
- A Qualifier that is not one of the four **as MATLAB spells them** loads as `'None'`, the rest as
  written: `const`, `CONST` and `volatile` too, though the setter takes them, and `foo`, `''` and a
  number.
- A field that is not text loads as `''` (a Qualifier as `'None'`), the rest as written.
- Read as written: `ConstVolatile`, a HeaderFile `''`, `a.hpp`, ` h.h`, `a.c.h`, `a.h/` or
  `a.b/` and 253 more characters, a DefinitionFile `a.txt` or `d.c `, and a two-line
  PostStatement.

Following theme 1 (warn and show what was read; never refuse the file, never crash), such a coder
info is shown as read and saved as read, and the dictionary's warnings carry one
`part-unreadable` for it, naming each field MATLAB would not read as written and what MATLAB does
with it. A header file name refused for its length is quoted cut short, so the warning says
that it is longer than the 255 characters MATLAB takes. A file name MATLAB takes that an edit
would not write is not reported. A field the
envelope does not have takes no edit, because the edit would have nowhere to be written. An edit
of a hand-edited field is undone to the value as read (`_restorerFor`), which its shown text
could not always do: a number shows as `5`, and a Qualifier `const` set back would be `Const`.

MATLAB was also given this package's own saves (2026-10-18, both formats: every field of `ciB`
edited, among them a header file ` x_1.v2.hpp` with its leading space, a two-line PreStatement and
the Qualifier typed `constvolatile`, and `ciA`'s HeaderFile and PreStatement cleared) and read
each field back as written.

## R2026b's spelling: plain properties

A text dictionary R2026b wrote holds a coder info as the five plain properties, with no
envelope: `"_elements": [{"_id": "1", "_properties": {"DefinitionFile": "", "HeaderFile": "",
"PostStatement": "", "PreStatement": "", "Qualifier": "None"}}]` (seen in two text dictionaries
R2026b wrote; the binary dictionaries it wrote already hold the envelope). R2027a reads that
spelling property by property, through the setters (the `r2026b` LOAD lines, which respell `ciA`
so, and a copy of one of those two dictionaries edited by hand): a Qualifier `const` is read as `Const` and
`foo` as `None`, and a HeaderFile `a.c`, a DefinitionFile `a b.c`, a HeaderFile `5` or a
HeaderFile of 256 characters as `''`, with every other property as written. So where a bag has no envelope the node reads the five
from, and writes an edit into, the plain properties, in MATLAB's spelling, and invents no
envelope; and the warnings say what MATLAB does there, which is one property's default, not the
whole coder info's. MATLAB read this package's edit of `ciA` so spelled back as written (2026-10-18:
a Qualifier typed `constvolatile`, a header file `p.hpp`, a two-line PreStatement and a cleared
DefinitionFile). (A `Simulink.VariantBank` in the same files has the same spelling, which
`VariantBankNode` reads the same way: `Simulink.VariantBank.md`.)

Locked by `test/variantBankFields.test.ts` (both formats).

## An envelope spelled `<P Name="undefined">`

An earlier version of this package wrote a saveobj envelope back as `<P Name="undefined"
Class="struct">` in place of MATLAB's `<P Source="saveobj" PropertyType="any" Class="struct">`
(`DataNode.pxAttrs`), so a binary dictionary it saved can hold a coder info whose five properties
are inside a property named `undefined`, with no envelope and none of the five beside it. Neither
spelling above finds them there, so the row shows the five blank and the Property Inspector lists
the struct as `Other.undefined`.

What R2027a makes of it (2026-10-18, `test/parity/matlab/probe_coderinfo_undefined.m`, on files
made from the R2027a fixtures by `coderinfo_undefined.mjs`), with no warning in any case:

- A binary dictionary so spelled opens, and its other entries read as written, but that entry's
  value fails: "Data dictionary unable to create an object of class
  'Simulink.VariantBankCoderInfo'."
- A text dictionary's plain bag holding only that struct is read as a coder info with every
  property at its default.
- A plain bag holding the five properties too is read from them, and the `undefined` is ignored.

Following theme 1, such a coder info is shown as read and saved as read, and the dictionary's
warnings carry one `part-unreadable` for it that names `undefined` and says what MATLAB does with
it in that format. An edit of one of the five has nowhere to be written, as for any field the
file does not have, and is refused so. A bag with any of the five beside its `undefined` is not
reported.

Measured as controls in the same run (2026-10-19), each also with no warning from MATLAB, and none
reported here:

- The envelope MATLAB wrote with an `undefined` struct of other values beside it, in either
  format, is read from the envelope, and the `undefined` is ignored.
- A text dictionary's plain bag with neither the five nor an `undefined` (no property at all, or
  only a `Foo`) is read as every default.
- A text dictionary's plain bag with an `undefined` struct of other values beside only some of the
  five (each of the five alone, or `DefinitionFile` and `Qualifier`) is read from those it holds,
  each other property at its default, and the `undefined` is ignored.

## Description: the class has none

`properties(Simulink.VariantBankCoderInfo)` lists the five above and no Description. The row used
to offer one anyway (`descriptionEditable` was inherited, and true), `setProperty('Description', …)`
returned true and marked the entry Modified, and both save paths dropped the text, so the edit was
silently lost. Now, as for a Variant Control (decision D11), `descriptionEditable` is false and the
edit is refused: "A Variant Bank Coder Info has no Description in a dictionary, so one cannot be
saved for '<name>'." The General group keeps the identity five, with no Description.

## Value: the class has none

Measured in R2027a: `isprop(Simulink.VariantBankCoderInfo, 'Value')` is 0, and setting one fails
with "Unrecognized property 'Value' for class 'Simulink.VariantBankCoderInfo'."

This node used to offer one anyway. The cell took a text editor (`valueEditable` was inherited,
and true), `setProperty('Value', …)` returned true, and both save paths wrote the text beside
the envelope: `_properties: {Value: …}` in a text dictionary, `<P Name="Value" Class="char">…</P>`
after the saveobj `P` in a binary one. MATLAB opens both files with no error and no warning,
reads every entry, and builds an object with no Value, its Qualifier still `'None'`; the value
is silently dropped. So the edit was accepted, saved, and had no effect. Every MATLAB-written
entry also showed `''`, which implies a char value the class does not have.

Following MATLAB (the 2026-10-16 ruling, group E, C-169), as `Simulink.VariantBank` does (C-168)
and a bus element does (`BaseBusElementNode`):

- `valueEditable` is false, so neither the table nor the Property Inspector offers an editor.
- `setProperty('Value', …)` is refused: "'<name>' is a Simulink.VariantBankCoderInfo, which has
  no Value, so none can be set on it." An entry still in an encoded stream keeps that refusal's
  reason.
- `_serializedOverrides` is empty, so no save writes a Value. A Value key a file already carries
  (only ever this package's) passes through `_mergeProps` unchanged, and is shown quoted.
- An entry whose file carries no Value key, which is every one MATLAB writes, shows an empty
  cell.

Locked by `test/variantBankNoValue.test.ts` (both formats, and `createDefault`) and the
`READ_ONLY` row of `test/variantLeafNodes.test.ts`. The envelope's fields are pinned by
`test/newEntryEnvelopeBothFormats.test.ts`, and the property list by
`test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- None for the class's own properties (C-169 option (b) is done). The vscode table needs four
  columns for them (`definitionFile`, `preStatement`, `postStatement`, `qualifier`) before they
  can be edited there; Header File already has one.
