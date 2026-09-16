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
