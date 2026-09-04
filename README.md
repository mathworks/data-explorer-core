# data-explorer-core

Core data model for Data Explorer: the parser, data model, and node schema for
Simulink data-dictionary (`.sldd`), model (`.slx`, `.mdl`), MAT-file (`.mat`),
and project (`.prj`) files.

Presentation-independent and embeddable in-process. Used by the Simulink Data
Explorer VS Code extension, and shared across other Data Explorer front-ends.

## Install

```bash
npm install data-explorer-core
```

## Usage

```js
import { createSession } from 'data-explorer-core';

const session = createSession();
const src = session.addDataSource('params.sldd', slddJson);
session.getDataSourceIds();          // ['params.sldd']
session.editProperty(id, 'Value', 5);
session.undo();
```

Each `createSession()` returns an independent instance with its own data
sources, node index, undo stacks, and event bus, so multiple sessions never
share state. Stateless parsers (`parseSlx`, `parseMdl`, `parseModel`, `parseMat`,
`parseProject`, `parseBinarySldd`) are also exported for consumers that only need
to parse a buffer.

Both model containers open to the same tree. A `.slx` is a zip of parts; a `.mdl`
is either the modern OPC *text* package carrying that same part set, or the
pre-R2012 nested-brace text that a model which was never migrated still has.
`parseModel` takes either one and picks the reader from the bytes.

Neither container has one fixed part layout, and the reader covers both eras of
each. A `.slx` written by R2026b or later stores its block diagram, config set
index and graphical interface as JSON; every earlier release wrote XML, kept its
blocks inside the block diagram before R2020a, and its model workspace in a plain
MAT-file part before R2019b. All of those read back to the same tree, down to the
values in the model workspace. Two things a pre-R2020a file simply does not record
are reported as absent rather than guessed: the model UUID (new in R2020a) and, for
a pre-R2014a file, a linked data dictionary. See
`test/parity/matlab/README.md` for the full layout matrix and what the parity suite
holds each era to.

### Universal ingest

Instead of choosing an `addXSource` by type, hand core the content plus a
filename and it sniffs (extension + magic bytes) and dispatches:

```js
import { createSession, ingest, toDTO } from 'data-explorer-core';
const session = createSession();
const src = ingest(session, bytesOrTextOrObject, { filename: 'params.sldd' });
const snapshot = toDTO(src, { depth: 2 }); // JSON-safe; for RPC boundaries
```

`ingest` and `toDTO` are universal — no `fs` — so they run identically in the
browser (uploaded `ArrayBuffer`) and in Node. `toDTO` projects a live node into
a flat, serializable snapshot (child *ids*, not object references) for consumers
that cross a process or network boundary; in-process consumers hold live nodes
directly.

To load from a filesystem path, import the Node-only subpath (the only part of
the package that touches `fs`; fenced out of browser bundles by `exports`):

```js
import { createSession, loadFromPath, loadDirectory } from 'data-explorer-core/node';
const s = createSession();
loadFromPath(s, 'params.sldd');
loadDirectory(s, 'some_dir/');   // all .sldd/.slx/.mdl/.mat/.prj into one session
```

## License

BSD-3-Clause © The MathWorks, Inc.
