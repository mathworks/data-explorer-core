# data-explorer-core

Parser, data model, and node schema for Simulink data dictionaries (`.sldd`),
models (`.slx`, `.mdl`), MAT-files (`.mat`), and projects (`.prj`).
Presentation-independent and embeddable in-process.

This is the host layer of the [Simulink Data Explorer VS Code
extension](https://github.com/mathworks/data-explorer-vscode), its main
consumer: host and data-model changes land here first, then the extension moves
its pin to a tag.

## Consuming it

```json
"dependencies": {
  "data-explorer-core": "github:mathworks/data-explorer-core#v1.21.0"
}
```

Releases are tags, and `dist/` is committed, so installing needs no build step.
The package barrel is the whole supported surface — import from
`data-explorer-core`, never a deep path into `src/`.

## Opening a file

`DataModel` is a session: parse the bytes, hand the result over, read the tree.

```js
import { DataModel, parseModel, readSlddContent } from 'data-explorer-core';

DataModel.addDataSource('params.sldd', readSlddContent(dictBytes), { path: 'params.sldd' });
DataModel.addModelSourceParsed('a.slx', parseModel(slxBytes, 'a.slx'));
DataModel.getDataSourceIds();   // ['params.sldd', 'a.slx']
DataModel.editProperty(id, 'Value', 5);
DataModel.undo();
```

`srcId` is the caller's own key for a file and is never parsed; the filename is
what decides the kind. `createSession()` returns an independent session with the
same surface — its own sources, node index, undo stacks and event bus — for a
host that needs more than one.

`parseModel` takes either model container and picks the reader from the bytes.
The stateless parsers are exported for callers that only want a buffer read:
`parseSlx`, `parseMdl`, `parseMat`, `parseProject`, `parseBinarySldd`, plus
`scanSldd` / `scanMat` / `scanModelStructure` for the cheap pass that reads a
file's names and references without building a tree.

Filesystem loading lives in the Node-only subpath, the only part that touches
`fs` (`exports` fences it out of browser bundles):

```js
import { createSession, loadFromPath, loadDirectory } from 'data-explorer-core/node';
```

## Saving a file

`session.serializeSource(srcId)` answers a file in the form it arrived in: a
`.sldd` as `{ kind: 'binary', bytes }` for a compressed-binary package and
`{ kind: 'text', text }` for a text dictionary, a `.mat` as
`{ kind: 'binary', sourceFormat: 'mat', bytes }`. Models and projects are
read-only and answer `null`. A save does not reset the source's `dirty` flag:
the host writes the bytes and registers the file again.

A binary dictionary's save writes each entry nobody edited as the bytes it was
read from, in its own place, and writes from the model only what was edited or
added. An edited entry is written the same way, part by part: its bytes, with
only the parts the edit changed written from the model. A rename changes the
entry's Name and LastMod lines and nothing else, a value MATLAB spelled its own
way is kept as MATLAB spelled it until it is edited, and removing a bus element
leaves every other element as it was read. (Where the reader cannot pair every
entry with the bytes it was read from, the save writes the whole chunk from the
model; where an edited entry's parts cannot be paired with certainty, that
entry is written whole from the model.) Two rules follow, and both are part of
the contract:

- **Malformed in, malformed out.** The readers accept some input that is not
  well-formed XML: a bad XML declaration, text outside the root element, a
  duplicate attribute, a bare `&` inside an entry. In the parts nobody edited, a
  save keeps it as it was read. The save does not repair it.
- **The API is the contract.** Only an edit made through core's API is saved:
  `editProperty` (a rename is one), `addEntry`, `addChild`, `deleteNode` and the
  session's other edit methods, with their `undo` and `redo`. Each marks the entry
  it changes, `Modified` (or `New` for an added one), and the save writes what was
  edited in a marked entry from the model. A change made around the API marks nothing, so it is not
  guaranteed to be saved: a value changed in place, such as `p.Value = 42`, is
  not, and the entry is written as the bytes it was read from. Before it writes an
  unedited entry's bytes, the save does check the entry's name, section and the
  metadata it writes, and writes what changed from the model where any of those
  has changed; that guards against some edits made around the API but does not widen
  the contract.

A host that keeps a binary dictionary's `data/chunk0.xml` as text and splices
each edit into it has three functions for it. `spliceEntryObject(chunkXml,
entry, selectorBefore?)` replaces one entry's `<Object>` with what a save writes
for it now, laid out as the chunk is, every byte around it untouched; the entry
is found by `selectorBefore`, the name it has in the chunk before a rename (or
an `EntrySelector`, its name and UUID, where two entries share the name), and by
its own selector by default.
`keptPartsViolations(entry, objectText)` lists, by path, where the text a host
is about to save for an entry changes a part nobody edited; it reads the text
with a structure-aware scan, not with the reader, and an empty list means the
untouched parts are the bytes they were read as, or that there is nothing to
hold them to: an entry with no bytes it was read from, or one whose bytes that
scan cannot read (a processing instruction inside it, for example), which a
save gate has to check for itself. `readEntryFragment(fragment,
{ section, inheritPlaceFrom })` reads one `<Object>` into a section with the
bytes it came from, so an entry rebuilt from text by an undo is still written as
those bytes, and merged with them when it is edited again.

The properties of an object a MAT-file's object takes an edit of (below) take
one in a text and a binary dictionary too, held to the same rules and refused in
the same words: a `Simulink.Parameter`'s DataType and Unit; a `Simulink.Signal`'s
DataType, Unit, Dimensions, InitialValue, SampleTime and SamplingMode; a
`Simulink.BusElement`'s and a `Simulink.ValueType`'s DataType, Unit and
Dimensions; a `Simulink.Bus`'s DataScope, HeaderFile, Alignment and
PreserveElementDimensions; a `Simulink.AliasType`'s DataScope and HeaderFile;
and a `Simulink.NumericType`'s DataTypeMode, Signedness, WordLength,
FractionLength, Slope, Bias, DataTypeOverride, IsAlias, DataScope and
HeaderFile, with what MATLAB's setter changes beside it (a NumericType set to
`Single` is 32 bits, unscaled). The save writes each as MATLAB writes it.

A host that writes one entry of a text dictionary itself writes the entry's
`serialize()` record with `textDictionaryJson(value, indent?)`, not
`JSON.stringify`: its numbers are spelled as MATLAB writes them (`1000000.0`,
`1e300`), as a save spells them. `JSON.stringify` writes a double of 2^64 as an
integer literal, and MATLAB does not open the dictionary. `jsonNumberText(x)`
spells one number so.

A value a dictionary holds as a MAT stream is shown, and written back as the
stream: a binary dictionary's `Encoding="hex"` value, which MATLAB writes for an
entry whose value holds a sparse array, and the cdata of the same stream a text
dictionary holds for it, and for a complex or N-D value. One of plain values (numbers,
logicals, chars, sparse arrays, and cells and structs of them) takes edits as the same
value in a MAT-file does, at its rows and members, where the stream the edit makes reads
back as it; the save writes the stream anew, and an edit undone writes it as it was read.
In one holding an object or a function handle, nothing takes an edit but its entry's
rename and, where the stream is the entry's whole value, the parts of it that are no
object (written anew around its objects, each the element it was read as) and the
properties of its `Simulink.Parameter` and `Simulink.Signal` objects that a MAT-file's
take (below), by the same rules, and shown as a MAT-file shows them:
the DataType each edit of the Value co-writes, one edit at a time, as MATLAB's
`p.Value = v` re-derives it, at once, and two fields holding
one handle as one object, every edit of it made through the first of them
edited. The save writes the stream again with only the cells of those
properties replaced, every other byte as it was read: the hex's `EncodedLength`
is the new byte count, and the cdata's text is the new stream's own. An edit
undone writes the stream as it was read.

### A MAT-file

A MAT-file is saved as the file it was read from, with what was edited written
fresh. That is a Level-5 file, as `-v6` and `-v7` write it; a `-v7.3` file (HDF5)
and a big-endian one are not opened. Every variable nobody edited is written as
the bytes it was read from, compressed or not as it was, in its own place, and so
are the file's objects (the unnamed record MATLAB keeps them in, last) and every
record the reader could not read; the header keeps its text. A variable only
renamed is its own bytes with the new name in them. One whose value was edited,
and one added, is written from the model, after the last variable and before the
objects, and compressed only if the file already holds a compressed record, so a
`-v6` file stays one. A struct's field takes a rename as a dictionary's does, at
any depth and in every element of a struct array, with the same refusals; its
variable is then written from the model, an object it holds as the element it was
read as. Written from the model, a variable is still the one it was
read as in every part it holds: a struct array of no element keeps its field
names, an empty its complexity, a zero its sign, and a variable saved as global
stays global. Text is written as MATLAB writes it, byte for byte: as UTF-8 where
every character is ASCII, and as UTF-16 otherwise, at the top, in a struct or a
cell and in an object's property, which MATLAB R2023b loads as R2027a does (it
fails a file holding CJK as UTF-8); a UTF-16 surrogate on its own is read and
written as the unit it is, as MATLAB keeps it. Before the bytes are handed back, every record written anew is
read again, and the file is held to the rules MATLAB loads a file by: a save that
breaks one the file as read did not break is refused, with a `MatWriteError`
naming the variable, and nothing is written. Both are asked where the save changed
the file, so a save costs what it changed, however large the rest of the file is;
a record written anew too large for the check to finish is refused as not
verified.

What such a save cannot write, the editor does not offer. A host that honours the
editability core hands it (`getPropInfo(...).editable`, a row's `Name.editable`,
`_valueEditable` and `_descriptionEditable`, `nameEditable`, `valueEditable`,
`canAddChild`, `canRemoveChild`) offers no edit a save then refuses, and every
setter and `editProperty` refuse the same edits, naming the variable and why.
These take a rename and a delete and nothing else:

- an object of any class but `Simulink.Parameter` and `Simulink.Signal` (a bus,
  an `mpt.Parameter`, a class of your own): none of its properties and none of
  the rows under it;
- an enumeration value (`matlab.lang.OnOffSwitchState.on`, an enumeration of
  your own), scalar or array. A struct or a cell holding one writes it as it was
  read, so the other members of the struct or the cell take every edit;
- a function handle, and a value the reader could not decode;
- a plain variable holding any of these, or a cell or struct array the reader
  read short (holding fewer elements than it declares, which a save would write
  as empty), at any depth: neither its value nor any row under it;
- a plain variable stored in a form MATLAB does not load as it is (char data in
  `miUINT8` or `miUTF32`, a numeric class in another class's type, a matrix its
  parts do not fill), whose value as read is this package's guess at it;
- either of two variables of one name, until one is renamed: MATLAB loads only
  one of them.

A `Simulink.Parameter` or a `Simulink.Signal`, at the top of the file, in a
struct field or a cell, or an element of an object array, takes an edit of each
property the file holds a value for: a Parameter's Value (and a row of it, and a
field of a struct Value, a char of any shape included, which MATLAB keeps a char
there; a string there is refused, as a MAT-file holds one as an object of the
file), Min, Max, Description and Unit, a Signal's Min, Max,
Description, Unit and DataType. The save writes it into the value cell of the
file's objects that holds it, and every other byte of them and of the variable
that holds the object as it was read. The cells MATLAB's own edit of the property
changes go with it: a resized Value's Dimensions, and the DataType MATLAB derives
from a Value of another class (a double typed over a `single` Parameter makes its
DataType `auto`, as `p.Value = 7` does, and the Data Type column shows it at once).
It refuses what MATLAB would load as something else, or warn of on every load: a
Min above its Max, a bound or a double Value outside the range of a builtin
DataType, a property at its class default (the file holds no value for it), a
sparse Value, a Parameter's DataType on its own, a Complexity, a storage class.
Two variables holding one handle (`r = h`), or a struct field and a cell element
holding it, hold one object, as MATLAB loads them: an edit of it is shown by every
node of it, its undo and redo too, and the save writes it once. The first of them
an edit is made through is the one every later edit of the object is made through
until the file is read again; the others show it and take none of their own.

A string takes its text, whole or an element at a time. A variable's whole Value, a
struct field or a cell element, at any depth (a field of an element of a struct array
too), typed as a string (`"abc"`, `["a" "b"]`) becomes one, as `x = "abc"` and
`s.a = "abc"` make one in MATLAB; and a string typed as any other value becomes that
value. The save writes the new string into the file's objects (a file with none gains
them) and the variable or the container that holds it fresh; a string no longer held
stays among the objects, which MATLAB loads with no warning. One undo puts the value
back, and the file is then saved as it was read. A cell typed in that holds strings
(`{1, "a"}`, `{{"a"}}`, `{["a" "b"]}`) is taken the same way, each string made one of the
file's objects, and each then takes an edit of its own. A cell that holds no object but
strings shows them by their text, as a dictionary does (`{1, "a", ["x" "yz"]}`), and takes an
edit of that text; one holding another object, or a string no text spells (`<missing>`, an
N-D string array), shows its summaries and is edited an element at a time. In a
cell's text, in a MAT-file and a dictionary alike, a member of a numeric class other than
double is spelled with its class (`{1, int8(3), single(2.5), uint16([1 2])}`), so the text
typed back keeps every class; a cell holding one no text spells exactly (a single -0) is
edited an element at a time. An integer class's conversion reads its digits exactly:
`uint64(9007199254740993)` keeps that value, where MATLAB, which reads the digits as a
double first, keeps 9007199254740992. A bare word typed in a cell (`{missing}`) is refused: a char
is typed in quotes. A string is still refused in an element of a numeric array, and as a
`Simulink.Parameter`'s Value where MATLAB refuses it. A string array (a row or a column)
takes `""` added and an element deleted, as in a dictionary, written into its object;
one string, a matrix and an empty array do not.
Add is not offered on a struct array or on an element of one. A field of a 1x1 struct
is deleted, at any depth, as MATLAB's `rmfield` deletes it, as in a dictionary; a field
of a struct array or of an element of one is not. In every format, Add grows a cell as
MATLAB's `c{end+1}` does: a 1x1 or an empty cell as a row (`{3}` to `{3, 0}`), a
column as a column; and a delete of a 1x1 cell's element leaves it 1x0, as `c(1) = []`
does. A vector of any rank grows and shrinks along its one dimension past 1 (a 1x1x3 to a
1x1x4), and an array that is no vector, a 1x2x2 as a 2x3, takes neither. In every format, an
empty of a shape no bracket spells is shown in a cell's text as MATLAB makes it, and is taken
typed: `cell(1,0)`, `zeros(0,3)`, `zeros(1,0,'int8')`, `false(1,0)`, `char(zeros(1,0))`,
`strings(0,3)`; a cell of such a shape and an empty string array show it as their own Value
too, where a numeric, logical or char empty shows `[ ]` or `''` as MATLAB's Workspace browser
does. An undone Add or delete saves the file as it was read. A variable stored
after the objects, which MATLAB does not load, takes no edit, not even a rename,
and can be deleted. A file no save of which can be written is `readOnly` and takes
no edit, addition or delete at all: one whose records do not tile it, one opened
from a parse without its records (an older host's, through
`addMatSourceParsed`), one whose bytes the host has since handed away.
`addEntry` adds a variable named `var` (then `var1`, and so on) holding the
double `0`. What only a value's bytes can say is still checked by the save, and
refused in the same words.

`session.pasteEntries(srcId, payloads)` pastes what a host copied, each entry's
`serialize()` (`{ name, metadata, value }`) of a dictionary or of a MAT-file, as new
variables of the MAT-file `srcId`: all of them or none, as one undo step, each named
as it was or with a counter appended. A plain value (numbers, text, a logical, a
sparse array, a struct, a cell, and structs and cells of these) is written fresh. A
`Simulink.Parameter`, `Signal`, `Bus` (with its elements), `NumericType`,
`AliasType` or `ValueType`, and a string, is made as `addEntry` makes one, and each
property the copy holds is set on it as an edit sets it; the object made is then held
to the copy, row by row and in the properties no row shows, and a difference refuses
the paste, naming the property. So does anything else no save could write as it was
copied: a function handle, an object array, an object inside a struct or a cell (a
string there is made one of the file's objects, as a cell typed in makes it, an empty one
too; an N-D one, which no text spells, is refused), an enumeration, the classes `addEntry` does not offer, a value past the
writer's budget, and a Parameter Value whose text does not hold it (an integer,
`single` or complex Value, a struct). `session.pasteRefusal(srcId, payload, { deep })`
answers what the paste would refuse, cheaply or, with `deep`, by making the paste and
taking it back; `getAdmittedTypes()` of the file lists what a paste takes by the
value's `_array_class` (`'MatlabVariable'` for one with none). `session.copyRefusal(nodeId,
target?)` says whether an entry can be copied at all, and into a text (`'json'`) or a
binary (`'xml'`) dictionary.

`addChildTo(nodeId)`, `deleteNodeById(nodeId)` and `deleteNodesById(ids)` answer a
refusal with `null` or `false`. `session.addChildRefusal(nodeId)`,
`session.deleteRefusal(nodeId | ids)` and `session.renameRefusal(nodeId)` say why, in
words that name the row, in every format: `Cannot add to "c": it is a 2x3 cell array,
which an element added at its end would not leave rectangular: type the whole value
over it instead. Nothing was added.` Each returns `null` exactly where its operation is
made, and changes nothing, so a host can ask before (to word a greyed menu item) or
after a refusal. `renameRefusal` is about a name that takes no edit at all (an
element's, a class property's); a name typed in that is refused for itself comes back
from `editProperty(id, 'Name', text)` with its reason. `session.addEntryRefusal(containerId,
className?, name?)` says the same of `addEntry` into a dictionary's section (by its id,
`x.sldd/design`) or a MAT-file (by its srcId): a class the section does not hold names
the one that does. Called with no argument it says why the last `addEntry` into the
active MAT-file added nothing, as before. `session.isUnchangedEdit(nodeId, key, text)` says
whether an edit would change nothing, the text a property shows committed unchanged, as
`editProperty` takes it, for a host that calls a node's setter itself.

## Usage across a folder

`session.findUsages(nodeId)` answers "what refers to this?" off the trees a
session holds. For a whole folder that is the wrong shape — asking about a
hundred models would mean holding a hundred trees — so the same question over
*read but unopened* files is answered from per-file summaries:

```js
import { buildUsageIndex } from 'data-explorer-core';

const index = buildUsageIndex([
  { srcId: 'a.slx', filename: 'a.slx', bytes: modelBytes },
  { srcId: 'params.sldd', filename: 'params.sldd', bytes: dictBytes },
]);
index.usagesOf('params.sldd', 'Kp');  // the blocks that read Kp, with link targets
index.paramsOf('a.slx', '15');        // each parameter of that block, and where it resolved
```

Its halves are exported for a host that caches: summarize each file
(`summarizeFiles`, or `summarizeParsedModel` / `summarizeSlddScan` /
`summarizeMatScan` off a parse or scan you already have),
`mergeFileSummaries` in workspace order, then `buildUsageIndexFromSummaries`.

Four things a consumer cannot guess:

- A block is addressed by its **SID** — `'15'` above — because a block name is
  unique only within its own system, and one model may hold four blocks named
  `Gain`. Rows publish it as `_blockKey`; a `linkTarget` is
  `` `${sid}@${srcId}` ``. Each row also carries where it is, as `_systemPath` /
  `_blockPath`.
- Resolution follows MATLAB's shadowing: mask workspaces, then the model
  workspace, then a linked dictionary, then a linked MAT-file, with dictionary
  references followed transitively and names matched case-insensitively.
- `linkTarget: ''` is an answer, not an absence — the name may be defined in a
  file the caller never handed over, or in the base workspace, which is a live
  session and not a file. Render the value, without a link.
- An unreadable file in the set contributes nothing and does not fail the rest.

## Detail that lives elsewhere, deliberately

Neither model container has one fixed part layout, and the readers cover both
eras of each — JSON parts and XML, blocks inside the block diagram, a MAT-file
model workspace part, and the two things a pre-R2020a file simply does not
record and so reports as absent rather than guessing.
`test/parity/matlab/README.md` holds the layout matrix and what the parity suite
pins each era to; it is the reference for this, not the file you are reading.

Same for which block parameters can name data: that table is keyed on the
`(BlockType, parameter)` pair and measured from MATLAB rather than
hand-written, and it is documented beside itself.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build     # writes dist/, which is committed
```

## License

BSD-3-Clause © The MathWorks, Inc.
