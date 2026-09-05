<!-- Copyright 2026 The MathWorks, Inc. -->

# ModelBlockNode — data-object fidelity

**Node class:** `ModelBlockNode` (`src/datamodel/node/data/ModelBlockNode.ts`)
**MATLAB class:** host-only, no MATLAB data object (model-tree relationship node)
**Editable in our UI:** no (`valueEditable` and `nameEditable` explicitly return `false`)
**Verified against:** n/a — host node, not a Simulink data object

## Overview

ModelBlockNode represents a block in the model hierarchy tree (typically from an
`.slx` file's block diagram). It is a relationship/graph node, not a data object
— it shows a block's type and its parameter usages (e.g. which workspace variables
a block references). It extends BaseNode directly (not DataNode), and both
`nameEditable` and `valueEditable` are explicitly `false`.

The node carries:
- `blockType` — the Simulink block type string (e.g. `'Gain'`, `'SubSystem'`)
- `paramUsages` — array of `{property, value}` pairs showing workspace refs
- `modelSrcId` — navigation target for the model graph
- `paramSourceId` — optional link target for parameter navigation

Its `toRow()` emits a specialized row with a `_graphTarget` for model navigation
and optional `linkTarget` in the DataType column for parameter cross-referencing.

The target is `` `${firstParamValue}@${paramSourceId}` `` — e.g. `Kp@mdlparams.sldd`.
A host follows it with `session.resolveLink(target)`, which parses the shape, finds
the named source among the open ones and returns the entry node (or says whether the
file is simply not open). Note the name part is the parameter's raw VALUE and so may
be an expression: `[tau 1]@mdlparams.sldd` is a target this node really produces, and
`resolveLink` reads the identifiers out of it rather than treating the whole string as
a name. The reverse direction — which blocks reference a given definition — is
`session.findUsages(nodeId)`.

## Property table

| Property   | Editor | Notes                                           |
|------------|--------|-------------------------------------------------|
| Name       | —      | Block name (read-only, `nameEditable === false`) |

## Read-only / host status

- Both `valueEditable` and `nameEditable` explicitly return `false`.
- This is a graph/navigation node with no Simulink data-object backing.
- **Existing test coverage**: `test/archPresentation.test.ts` and
  `test/navTarget.test.ts` exercise ModelBlockNode in the context of model
  hierarchy presentation and navigation.
- **Contract-lock**: assert `valueEditable === false` and `nameEditable === false`
  in `test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- None. Pure presentation/navigation node.
