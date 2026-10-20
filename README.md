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
`-v6` file stays one. Before the bytes are handed back they are read again, and
held to the rules MATLAB loads a file by: a save that breaks one the file as read
did not break is refused, with a `MatWriteError` naming the variable, and nothing
is written.

What such a save cannot write, the editor does not offer. A host that honours the
editability core hands it (`getPropInfo(...).editable`, a row's `Name.editable`,
`_valueEditable` and `_descriptionEditable`, `nameEditable`, `valueEditable`,
`canAddChild`, `canRemoveChild`) offers no edit a save then refuses, and every
setter and `editProperty` refuse the same edits, naming the variable and why.
These take a rename and a delete and nothing else:

- an object, of any class (a `Simulink.Parameter`, a bus, a signal, a class of
  your own): none of its properties and none of the rows under it;
- a string, a function handle, and a value the reader could not decode;
- a plain variable holding any of these, or a cell or struct array the reader
  read short (holding fewer elements than it declares, which a save would write
  as empty), at any depth: neither its value nor any row under it;
- either of two variables of one name, until one is renamed: MATLAB loads only
  one of them.

A value typed in that would make a string (`"abc"`, `{1, "a"}`) is refused, and
Add is not offered on a struct array or on an element of one. A variable stored
after the objects, which MATLAB does not load, takes no edit, not even a rename,
and can be deleted. A file no save of which can be written is `readOnly` and takes
no edit, addition or delete at all: one whose records do not tile it, one opened
from a parse without its records (an older host's, through
`addMatSourceParsed`), one whose bytes the host has since handed away.
`addEntry` adds a variable named `var` (then `var1`, and so on) holding the
double `0`. What only a value's bytes can say is still checked by the save, and
refused in the same words.

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
