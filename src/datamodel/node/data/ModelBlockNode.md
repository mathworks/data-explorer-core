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
- `sid` — Simulink's own identity for the block, `''` for a file that records none

## Identity: the SID, not the name

`id` is `` `${parent.id}/${blockKey(name, sid)}` `` — the **SID**, e.g.
`f14.slx/blocks/65` — and `displayName` is `blockLabel(name, sid)`, which is the name
or `<SID: 65>` when the file records none. Both rules live in
`src/datamodel/blockIdentity.ts`; see item 21 in `docs/TODO.md` for the evidence.

Why they are separate: a block name is unique **within its own system** only. `f14.slx`
holds four blocks named `Gain`, so a name-keyed id gave all four
`f14.slx/blocks/Gain` and the section merged them into one row reading
`Gain=Mq, Gain=Zw, Gain=Kf, Gain=Zw`. A name may also be **blank** — clearing a label
leaves `Name="&#xA;"` in the file, which normalizes to `''` — which made the id
`f14.slx/blocks/` and left the Name cell and every link to that block with no text.

Its `toRow()` emits a specialized row with a `_graphTarget` for model navigation
and optional `linkTarget` in the DataType column for parameter cross-referencing.
It also publishes `_blockKey` — the same key the id is built from — because that is
what `UsageIndex.paramsOf(modelSrcId, blockKey)` is asked with and what a
`NodeUsage.linkTarget` back to this block carries. A host must join on `_blockKey`
and never on `Name.label`: the label is not unique and may be a stand-in.

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
