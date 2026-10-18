<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.VariantBank — data-object fidelity

**Node class:** `VariantBankNode` (`src/datamodel/node/data/VariantBankNode.ts`)
**MATLAB class:** `Simulink.VariantBank`
**Editable in our UI:** the bank's own five properties, by MATLAB's rules; the Value column is
read-only, and a Value edit is refused: the MATLAB class has no Value.
**Verified against:** MATLAB R2027a (27.1.0.3409468), 2026-10-16 and 2026-10-18: the bank `vbD`
MATLAB wrote into `test/fixtures/classes_r2027a_{text,binary}.sldd` (`make_classes_r2027a.m`), and
the banks `vbN`, `vb1` and `vbD` in `test/fixtures/variantbank_r2027a_{text,binary}.sldd`
(`make_variantbank_r2027a.m`, which also prints every setter rule and load result below)

## Overview

A Simulink.VariantBank stores variant bank configuration data. MATLAB's class has five
properties: Name, Description, VariantConditions, AllChoicesCoderInfo and
ActiveChoiceCoderInfo. A dictionary holds a bank as a saveobj envelope of those five plus the
Hidden BankCoderInfo, in both formats, with nothing beside it.

The node reads the five out of the envelope (`readSaveobjField`, the inverse of DataNode's
`writeIntoSaveobj`), shows them, and takes an edit of each by MATLAB's own rules. An edit is
written into the envelope only (`_mergeProps`), in MATLAB's spelling, and a field no edit has set
is written as it was read, so a save with no edit writes the file as it was read. BankCoderInfo
is not shown, as MATLAB hides it, and is written as read. `createDefault` makes the envelope MATLAB
writes for a new bank, with its fields, order and defaults measured from a MATLAB-written
dictionary, and nothing beside it.

## Property table

| Property              | Editor | Column                  | Serialized key                       | Notes |
|-----------------------|--------|-------------------------|--------------------------------------|-------|
| Name                  | text   | Name                    | entry name                           | MATLAB identifier (the entry's) |
| Value                 | none   | Value                   | written back as read                 | Not a property of the class; shown only where the file carries one |
| DataType              | label  | Data Type               | (className display)                  | Read-only label |
| Description           | textArea | Description           | envelope `Description`               | Any text |
| Bank Name             | text   | `bankName`              | envelope `Name`                      | '' or a C identifier not starting with "rt" |
| Variant Conditions    | text   | `variantConditions`     | envelope `VariantConditions` (cell)  | A cell of conditions, `{'V == 1','V == 2'}` |
| All Choices Coder Info | text  | `allChoicesCoderInfo`   | envelope `AllChoicesCoderInfo`       | '' or a variable name |
| Active Choice Coder Info | text | `activeChoiceCoderInfo` | envelope `ActiveChoiceCoderInfo`     | '' or a variable name |

The Property Inspector shows Description last under General (as ConfigSet's) and the other four
under "Variant Bank" (`classes/variantBank.json`). The four declare the envelope as their source
key, so the PI no longer lists it as a stray `Other._saveobj` row.

## The rules, measured

MATLAB's setters, each refusal quoted verbatim by `setProperty`:

- **Name**: '' or a C identifier (`[A-Za-z_][A-Za-z0-9_]*`) that does not start with `rt` (case
  sensitive: `RtX` is taken). Keywords, a leading underscore and any length are taken. Refused:
  "'Name' property for Simulink.VariantBank must be a valid C identifier that does not start with
  "rt"."
- **Description**: any text.
- **AllChoicesCoderInfo, ActiveChoiceCoderInfo** (and the Hidden BankCoderInfo): '' or a name
  `[A-Za-z][A-Za-z0-9_]*`, of any length, `end` included; the object it names need not exist.
  Refused: "'AllChoicesCoderInfo' value '1bad' must be a valid variable name corresponding to
  Simulink.VariantBankCoderInfo object."
- **BankCoderInfo** (Hidden): setting it in MATLAB sets both coder infos to the same name, but a
  file's three fields are read independently: an AllChoicesCoderInfo edited beside a BankCoderInfo
  'ciA' loads as edited. So an edit of either coder info writes that field alone.
- **VariantConditions**: a cell (or a string array); a char is refused ("... must be a cell
  array."), an element that is not text too ("Conditions defined in 'VariantConditions' property
  must be a scalar string."), an empty one ("Invalid variant condition '' ..."), one that does not
  parse, and an integer past int32 ("Unsupported numeric value ..."). A cell of any shape is stored
  1xN in column order, `{}` as 1x0. Each condition is stored in MATLAB's own spelling: `V==1` as
  `V == 1`, `(W>0)&&~X` as `W > 0 && ~X`.

The edit path takes a smaller language than MATLAB's (`src/datamodel/variantCondition.ts`), so that
every condition written is one MATLAB was measured to take, spelled as MATLAB was measured to spell
it: names (dotted for an enumeration), whole numbers in int32, one comparison at a time, and `&&`,
`||` and `~` with parentheses. MATLAB takes more (`&`, `|`, arithmetic, decimals, function calls),
and refusing one costs an edit, where writing one MATLAB refuses costs the bank (below). MATLAB
rewrites `0x1F` as `31`, `1e3` as `1000`, `3.14159265358979` as `3.14159` and `V==(W<1)` as
`V == W < 1`, a different condition, which is why decimals and chained comparisons are not taken.
`V==1i` crashed MATLAB outright (a segmentation violation in `SlVariantBank::setVariantConditions`).

## A hand-edited file

What MATLAB loads, measured with the text fixture edited one field at a time:

- A value a setter refuses (a bad Name, coder info name or BankCoderInfo, an empty or unparsable
  condition, a condition that is not text) makes MATLAB load the **whole bank as defaults**, with
  no warning.
- A Name or Description that is not text loads as '', the rest as written; a VariantConditions
  that is neither a cell nor text loads as no conditions.
- A char VariantConditions loads as a cell of that one condition, a 2x1 cell as 1x2, and an
  unspaced condition in MATLAB's spelling: read as written.

Following theme 1 (warn and show what was read; never refuse the file, never crash), such a bank
is shown as read and saved as read, and the dictionary's warnings carry one `part-unreadable` for
it, naming each field MATLAB would not read as written and what MATLAB does with it. A field the
envelope does not have takes no edit, because the edit would have nowhere to be written.

MATLAB was also given this package's own saves (2026-10-18, both formats: every field of the default
bank edited, a 2x2 cell of four conditions, and vbN's fields cleared) and read each field back as
written.

Locked by `test/variantBankFields.test.ts` (both formats).

## Value: the class has none

Measured in R2027a: `isprop(Simulink.VariantBank, 'Value')` is 0, and `vb.Value = 'x'` fails
with "Unrecognized property 'Value' for class 'Simulink.VariantBank'."

This node used to offer one anyway. The cell took a text editor, `setProperty('Value', …)`
returned true, and both save paths wrote the text beside the envelope: `_properties: {Value: …}`
in a text dictionary, `<P Name="Value" Class="char">…</P>` after the saveobj `P` in a binary
one. MATLAB opens both files with no error and no warning, reads every entry, and builds a bank
with no Value; a MATLAB re-save of the entry drops the key. So the edit was accepted, saved, and
had no effect. Every MATLAB-written bank also showed `''`, which implies a char value the class
does not have.

Following MATLAB (the 2026-10-16 ruling, group E, C-168), as a bus element does
(`BaseBusElementNode`):

- `valueEditable` is false, so neither the table nor the Property Inspector offers an editor.
- `setProperty('Value', …)` is refused: "'<name>' is a Simulink.VariantBank, which has no Value,
  so none can be set on it." An entry still in an encoded stream keeps that refusal's reason.
- `_serializedOverrides` is empty, so no save writes a Value. A Value key a file already carries
  (only ever this package's) passes through `_mergeProps` unchanged, and is shown quoted.
- A bank whose file carries no Value key, which is every bank MATLAB writes, shows an empty cell.

Locked by `test/variantBankNoValue.test.ts` (both formats, and `createDefault`) and the
`READ_ONLY` row of `test/variantLeafNodes.test.ts`.

## Open questions / deferred

- None for the bank's own properties (C-168 option (b) is done). The vscode table needs four
  columns for them (`bankName`, `variantConditions`, `allChoicesCoderInfo`,
  `activeChoiceCoderInfo`) before they can be edited there.
