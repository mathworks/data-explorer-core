// test/resolveLink.test.ts
// Copyright 2026 The MathWorks, Inc.
//
// Following a link, in both directions. Every node that could point at something in
// another file already emitted a `linkTarget` string, and nothing in this package
// turned one back into a node — so a host holding two open files still could not
// answer "what is `Kp` here?" without knowing which node class had written the
// target and re-deriving the lookup itself. Worse, the targets were not even one
// shape: ModelBlockNode writes `Kp@mdlparams.sldd`, while DataSourceNode and
// ModelReferenceNode write a bare file name. Needing to know the producer to read
// the string is the tell that resolution belongs to the session.
//
// session.resolveLink() is the forward direction, session.findUsages() the reverse,
// and session.resolveDictionaryReferences() the one case where the target was never
// projected into a row at all (a `.sldd`'s referenced sub-dictionaries).
//
// What is under test is the CONTRACT, because a resolver's decisions all live in what
// it says when it cannot answer:
//
//   - each of the three target shapes a node actually produces resolves, with the
//     target read OUT of the producer's own row rather than hand-written here, so a
//     producer that changes its mind breaks this suite;
//   - "that file is not open" and "that file is open and has no such entry" are
//     different answers, because a host can act on the first (offer to open it) and
//     only report the second;
//   - the target grammar is closed: `name@source` names an entry, a bare target names
//     a FILE, and nothing resolves relative to a caller-supplied context node;
//   - a name two sections both hold resolves to one node and reports both;
//   - findUsages credits a usage only to a model that can actually SEE the definition,
//     and returns plain data, so item 4 can put it in a row cell;
//   - a referenced sub-dictionary resolves to its own root and its entries are NOT
//     grafted into the referencing dictionary;
//   - both directions read the live session, so closing and re-opening a file changes
//     the answer.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function artifact(rel: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./parity/artifacts/${rel}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function fixtureBytes(name: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// params.sldd as JSON, for the cases that need to alter a dictionary before loading it.
function paramsJson(): any {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL('./parity/artifacts/text/params.sldd', import.meta.url)), 'utf8'),
  );
}

// The entry list inside a textual `.sldd`, which is where a dictionary's content lives.
function entriesOf(json: any): any[] {
  return json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
}

// An in-memory `.slx` holding just the facts a link needs: the dictionary the model is
// linked to, the `.mat` its workspace is sourced from, and some blocks whose parameters
// reference things. Built the way blockParamUsages.test.ts builds one, so it goes
// through the real parser and the real ingest path rather than through a hand-assembled
// ModelNode.
function slxModel(dictionary: string | null, blocksXml: string, workspaceMat?: string): ArrayBuffer {
  const diagram: Record<string, unknown> = { ModelUUID: 'u1' };
  if (dictionary) {
    diagram.DataDictionary = dictionary;
  }
  if (workspaceMat) {
    diagram.ModelWorkspace = { WSDataSource: 'MAT-File', WSSourceFileName: workspaceMat };
  }
  const parts: Record<string, Uint8Array> = {
    'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: diagram })),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?><System>${blocksXml}</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  };
  const zipped = zipSync(parts);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

const block = (name: string, type: string, prop: string, value: string) =>
  `<Block BlockType="${type}" Name="${name}" SID="${name}"><P Name="${prop}">${value}</P></Block>`;

// mdlcases.mdl is the fixture the item names: a real model, harvested from MATLAB,
// whose block parameters reference its own model workspace (`tau`, `span`, `inner`),
// whose linked dictionary is recorded as `mdlparams.sldd`, and which references a
// child model as `mdl_child.mdl`.
function modelSession() {
  const s = createSession();
  const model = ingest(s, artifact('mdl/mdlcases.mdl'), { filename: 'mdlcases.mdl' }) as any;
  return { s, model };
}

// The dictionary half of that pair. `mdlparams.sldd` itself was never harvested — the
// generator script says so in as many words: only its NAME is recorded in a model
// file, so it existed purely for set_param to accept. So params.sldd's bytes are
// opened UNDER that name, which is exactly what a host does anyway: a srcId is the
// host's key for a file, ingest derives it from the basename, and the resolver's
// business is with names and open sources, not with which bytes are behind them.
function openDictionaryAs(s: any, srcId = 'mdlparams.sldd') {
  return ingest(s, artifact('text/params.sldd'), { filename: srcId }) as any;
}

// The linkTarget a node put in its own row — never a hand-written string. If
// ModelBlockNode or DataSourceNode ever changes shape, these read the new shape and
// the resolver is tested against what is actually produced.
function linkTargetOf(node: any, column: string): string {
  const cell = node.toRow()[column];
  expect(typeof cell).toBe('object');
  expect(typeof cell.linkTarget).toBe('string');
  return cell.linkTarget;
}

describe('resolveLink() — the three target shapes a node actually produces', () => {
  it('follows a block-parameter target (`name@source`) to the entry it names', () => {
    const s = createSession();
    const model = ingest(s, slxModel('mdlparams.sldd', block('K', 'Constant', 'Value', 'gravity')), {
      filename: 'uses.slx',
    }) as any;
    openDictionaryAs(s);

    // The producer's own string, read back out of the row it wrote.
    const target = linkTargetOf(s.findNodeById('uses.slx/blocks/K'), 'DataType');
    expect(target).toBe('gravity@mdlparams.sldd');

    const r = s.resolveLink(target);
    expect(r.status).toBe('resolved');
    expect(r.sourceId).toBe('mdlparams.sldd');
    expect(r.node.id).toBe('mdlparams.sldd/design/gravity');
    // The live node, as findNodeById hands back live nodes — not a copy.
    expect(r.node).toBe(s.findNodeById('mdlparams.sldd/design/gravity'));
    // One candidate, and `node` is the first of them.
    expect(r.nodes.map((n: any) => n.id)).toEqual(['mdlparams.sldd/design/gravity']);
    expect(r.node).toBe(r.nodes[0]);
    expect(model.dataDictionary).toBe('mdlparams.sldd');
  });

  it('follows a data-source target (a bare file name) to that source’s ROOT', () => {
    const { s } = modelSession();
    openDictionaryAs(s);

    const target = linkTargetOf(s.findNodeById('mdlcases.mdl/dataSources/mdlparams.sldd'), 'Value');
    expect(target).toBe('mdlparams.sldd');

    const r = s.resolveLink(target);
    expect(r.status).toBe('resolved');
    expect(r.sourceId).toBe('mdlparams.sldd');
    expect(r.node).toBe(s.getDataSource('mdlparams.sldd'));
    expect(r.node.parent).toBe(null);
    // And it reached something the id lookup cannot: a source ROOT is not in the node
    // index (ContainerNode.flatten excludes its receiver), so following a file link
    // through findNodeById was never possible, not merely inconvenient.
    expect(s.findNodeById('mdlparams.sldd')).toBe(null);
  });

  it('follows a model-reference target across the .slx/.mdl extension guess', () => {
    const { s } = modelSession();
    const target = linkTargetOf(s.findNodeById('mdlcases.mdl/references/mdl_child.mdl'), 'Value');
    // The reference is recorded with the PARENT's extension — addReferenceEntry guesses,
    // because a `.mdl` names its child without one — so the same child is `mdl_child.mdl`
    // here and `mdl_child.slx` from a `.slx` parent.
    expect(target).toBe('mdl_child.mdl');

    // Nothing open under either name yet.
    expect(s.resolveLink(target).status).toBe('source-not-open');

    // The child, open as a `.slx`, which is the mixed hierarchy the guess exists for.
    // (mdlcases.slx is the same model exported as a `.slx`; what is under test is the
    // name matching, not the content.)
    ingest(s, artifact('mdl/mdlcases.slx'), { filename: 'mdl_child.slx' });
    const viaStem = s.resolveLink(target);
    expect(viaStem.status).toBe('resolved');
    expect(viaStem.sourceId).toBe('mdl_child.slx');

    // And an exact name still wins over the stem match, so the guess never shadows a
    // file the host actually opened under the name the target used.
    ingest(s, artifact('mdl/mdlcases.mdl'), { filename: 'mdl_child.mdl' });
    expect(s.resolveLink(target).sourceId).toBe('mdl_child.mdl');
  });
});

describe('resolveLink() — what it says when it cannot answer', () => {
  it('names the file to open when the target names a source the session does not hold', () => {
    const { s } = modelSession();
    // The block links a dictionary that is not open. This is the answer a host can ACT
    // on — "open mdlparams.sldd to follow this" — which is why it is not folded into
    // null with every other failure.
    expect(s.resolveLink('Kp@mdlparams.sldd')).toEqual({
      status: 'source-not-open',
      sourceId: 'mdlparams.sldd',
      name: 'Kp',
    });
    // The bare form carries no entry name, so there is none to report.
    expect(s.resolveLink('mdl_child.mdl')).toEqual({
      status: 'source-not-open',
      sourceId: 'mdl_child.mdl',
      name: null,
    });
  });

  it('separates "no such entry" from "that file is not open"', () => {
    const { s } = modelSession();
    openDictionaryAs(s);
    // params.sldd, opened as mdlparams.sldd, genuinely has no `Kp`. The file is open,
    // so there is nothing for a host to offer to do about it.
    expect(s.resolveLink('Kp@mdlparams.sldd')).toEqual({
      status: 'not-found',
      sourceId: 'mdlparams.sldd',
      name: 'Kp',
    });
  });

  it('treats an empty target as a question with no content', () => {
    const { s } = modelSession();
    expect(s.resolveLink('')).toEqual({ status: 'empty' });
    expect(s.resolveLink('   ')).toEqual({ status: 'empty' });
    expect(s.resolveLink(undefined as any)).toEqual({ status: 'empty' });
  });

  it('does not let an empty name part match every entry in the file', () => {
    const { s } = modelSession();
    openDictionaryAs(s);
    // `@source` is well-formed and names nothing. A match-all here would be the same
    // defect findNodes' isAsked() exists to prevent, one call further out.
    expect(s.resolveLink('@mdlparams.sldd')).toEqual({
      status: 'not-found',
      sourceId: 'mdlparams.sldd',
      name: '',
    });
  });

  it('splits at the FIRST @, so a srcId may contain one', () => {
    const s = createSession();
    // A host keys sources by whatever it uses to open them, and a URI with credentials
    // or a revision in it has an `@`. The producer builds `param@srcId`, so the split
    // has to be from the left or every such source becomes unreachable.
    s.addDataSource('vfs://u@h/params.sldd', paramsJson());
    const r = s.resolveLink('gravity@vfs://u@h/params.sldd');
    expect(r.status).toBe('resolved');
    expect(r.sourceId).toBe('vfs://u@h/params.sldd');
    expect(r.node.id).toBe('vfs://u@h/params.sldd/design/gravity');
  });

  it('reads a bare target as a FILE, never as an entry', () => {
    const s = createSession();
    openDictionaryAs(s);
    // `gravity` IS an entry in the open dictionary, and a bare target still does not
    // find it: both producers of a bare target mean a file, so the grammar stays closed
    // and no caller has to pass a context node to disambiguate one.
    expect(s.resolveLink('gravity')).toEqual({
      status: 'source-not-open',
      sourceId: 'gravity',
      name: null,
    });
  });

  it('matches a source by basename when the host keyed it by path', () => {
    const s = createSession();
    // A target only ever holds a file NAME (MATLAB records the dictionary that way),
    // while a host's srcId is often a full path or a URI. Matching only exact srcIds
    // would make every link dead for those hosts.
    s.addDataSource('/home/w/proj/mdlparams.sldd', paramsJson());
    const byBasename = s.resolveLink('gravity@mdlparams.sldd');
    expect(byBasename.status).toBe('resolved');
    expect(byBasename.sourceId).toBe('/home/w/proj/mdlparams.sldd');

    // And by the recorded meta.path, for a host whose srcId is opaque.
    const s2 = createSession();
    s2.addDataSource('doc-7', paramsJson(), { path: '/tmp/mdlparams.sldd' });
    expect(s2.resolveLink('gravity@mdlparams.sldd').sourceId).toBe('doc-7');
  });

  it('resolves the whole-expression target a block writes for an expression parameter', () => {
    const s = createSession();
    // ModelBlockNode builds its target from the parameter's raw VALUE, and a parameter
    // value is an expression: mdlcases.mdl's TransferFcn writes `[tau 1]@mdlparams.sldd`.
    // A strict whole-string lookup would leave every such link dead, so the name part is
    // read as an expression and the identifiers in it are the names it can mean — the
    // same rule findUsages applies in the other direction.
    ingest(s, slxModel('mdlparams.sldd', block('TF', 'TransferFcn', 'Denominator', '[gravity 1]')), {
      filename: 'expr.slx',
    });
    openDictionaryAs(s);
    const target = linkTargetOf(s.findNodeById('expr.slx/blocks/TF'), 'DataType');
    expect(target).toBe('[gravity 1]@mdlparams.sldd');
    const r = s.resolveLink(target);
    expect(r.status).toBe('resolved');
    expect(r.node.id).toBe('mdlparams.sldd/design/gravity');

    // Two identifiers, two candidates, in the order the expression names them.
    ingest(s, slxModel('mdlparams.sldd', block('TF2', 'TransferFcn', 'Numerator', '[sig1, gravity]')), {
      filename: 'expr2.slx',
    });
    const two = s.resolveLink(linkTargetOf(s.findNodeById('expr2.slx/blocks/TF2'), 'DataType'));
    expect(two.status).toBe('resolved');
    expect(two.nodes.map((n: any) => n.id)).toEqual([
      'mdlparams.sldd/design/sig1',
      'mdlparams.sldd/design/gravity',
    ]);

    // An expression naming nothing that exists is still not-found, reported with the
    // target's own name part rather than with whatever was extracted from it.
    const none = s.resolveLink('[nosuch 1]@mdlparams.sldd');
    expect(none).toEqual({ status: 'not-found', sourceId: 'mdlparams.sldd', name: '[nosuch 1]' });
  });
});

describe('resolveLink() — a name two sections both hold', () => {
  // A `.sldd` target names an ENTRY, not a node id, and a dictionary can hold the same
  // name in two sections: a design entry and its derived counterpart share a namespace,
  // so `isderived` alone decides which section an entry lands in. That is built here by
  // cloning the fixture's own `gravity` and flipping that one field — the same entry
  // shape MATLAB wrote, in a second section.
  function twoSectionSession() {
    const json = paramsJson();
    const entries = entriesOf(json);
    const original = entries.find((e: any) => e.name === 'gravity');
    const derived = JSON.parse(JSON.stringify(original));
    derived.metadata.isderived = '1';
    entries.push(derived);
    const s = createSession();
    s.addDataSource('d.sldd', json);
    return s;
  }

  it('resolves to one node and reports every candidate', () => {
    const s = twoSectionSession();
    const r = s.resolveLink('gravity@d.sldd');
    expect(r.status).toBe('resolved');
    // Both candidates, in document order — the order a tree draws them, which is the
    // section order SlddNode builds (design before arch). A host with a picker offers
    // the list; a host without one follows `node` and is correct for the common case.
    expect(r.nodes.map((n: any) => n.id)).toEqual(['d.sldd/design/gravity', 'd.sldd/arch/gravity']);
    expect(r.node).toBe(r.nodes[0]);
    expect(r.node.id).toBe('d.sldd/design/gravity');
  });

  it('answers with entries only, not with anything else that shares the name', () => {
    const s = createSession();
    s.addDataSource('p.sldd', paramsJson());
    // `x` is a bus element of MyBus, not an entry of the dictionary, so no target
    // resolves to it: a link target names something a model can refer to by name.
    expect(s.findNodeById('p.sldd/design/MyBus/x')).not.toBe(null);
    expect(s.resolveLink('x@p.sldd')).toEqual({ status: 'not-found', sourceId: 'p.sldd', name: 'x' });
    // And the containing entry does resolve, so the filter is about depth and not about
    // the name failing to match at all.
    expect(s.resolveLink('MyBus@p.sldd').node.id).toBe('p.sldd/design/MyBus');
  });

  it('is case-sensitive about the entry name, as MATLAB identifiers are', () => {
    const s = createSession();
    s.addDataSource('p.sldd', paramsJson());
    expect(s.resolveLink('gravity@p.sldd').status).toBe('resolved');
    expect(s.resolveLink('Gravity@p.sldd').status).toBe('not-found');
  });
});

describe('findUsages() — which blocks reference a definition', () => {
  it('reports the one block that references a model-workspace variable, expression and all', () => {
    const { s } = modelSession();
    // mdlcases.mdl's TransferFcn holds `[tau 1]`, so this is the reverse of the case
    // that made the forward direction read expressions: the usage is real even though
    // the parameter value is not the bare name.
    expect(s.findUsages('mdlcases.mdl/workspace/tau')).toEqual([
      {
        blockName: 'TF',
        blockType: 'TransferFcn',
        paramProperty: 'Denominator',
        paramValue: '[tau 1]',
        modelSrcId: 'mdlcases.mdl',
        linkTarget: 'TF@mdlcases.mdl',
      },
    ]);
    // A variable a nested subsystem's block references is found too — usages are the
    // model's, not one system's.
    expect(s.findUsages('mdlcases.mdl/workspace/inner').map((u: any) => u.blockName)).toEqual(['InnerGain']);
  });

  it('round-trips: resolveLink(usage.linkTarget) is the block that holds the usage', () => {
    const { s } = modelSession();
    const usage = s.findUsages('mdlcases.mdl/workspace/tau')[0];
    // The contract item 4 needs: the usage carries a target this same session resolves
    // back to the block node, so a `UsedBy` cell is clickable without the host
    // assembling any string of its own.
    const back = s.resolveLink(usage.linkTarget);
    expect(back.status).toBe('resolved');
    expect(back.node).toBe(s.findNodeById('mdlcases.mdl/blocks/TF'));
  });

  it('reports every block that references one dictionary entry', () => {
    const s = createSession();
    ingest(
      s,
      slxModel(
        'mdlparams.sldd',
        block('K1', 'Constant', 'Value', 'gravity') +
          block('K2', 'Gain', 'Gain', '2*gravity') +
          block('K3', 'Constant', 'Value', 'sig1'),
      ),
      { filename: 'many.slx' },
    );
    openDictionaryAs(s);
    const usages = s.findUsages('mdlparams.sldd/design/gravity');
    expect(usages.map((u: any) => `${u.blockName}:${u.paramProperty}=${u.paramValue}`)).toEqual([
      'K1:Value=gravity',
      'K2:Gain=2*gravity',
    ]);
    // The third block is a usage of a different entry, and reported as one.
    expect(s.findUsages('mdlparams.sldd/design/sig1').map((u: any) => u.blockName)).toEqual(['K3']);
  });

  it('reports usages from every open model that links the dictionary', () => {
    const s = createSession();
    ingest(s, slxModel('mdlparams.sldd', block('Ka', 'Constant', 'Value', 'gravity')), { filename: 'a.slx' });
    ingest(s, slxModel('mdlparams.sldd', block('Kb', 'Gain', 'Gain', 'gravity')), { filename: 'b.slx' });
    openDictionaryAs(s);
    const usages = s.findUsages('mdlparams.sldd/design/gravity');
    // Grouped per model, in the order the session opened them, and each usage says
    // which model it came from — the fact a host needs to render "used by Ka in a.slx".
    expect(usages.map((u: any) => `${u.modelSrcId}/${u.blockName}`)).toEqual(['a.slx/Ka', 'b.slx/Kb']);
  });

  it('reports nothing for a definition no block references', () => {
    const { s } = modelSession();
    // `label` is in mdlcases.mdl's model workspace and no block parameter mentions it.
    expect(s.findNodeById('mdlcases.mdl/workspace/label')).not.toBe(null);
    expect(s.findUsages('mdlcases.mdl/workspace/label')).toEqual([]);
  });

  it('does not credit a usage to a model that cannot see the definition', () => {
    const s = createSession();
    // Same entry name, referenced by three models: one linked to the dictionary, one
    // linked to nothing, one linked to a DIFFERENT dictionary. Only the first can
    // resolve the name to this entry, so only the first is a usage of it — otherwise
    // opening two unrelated projects in one session cross-contaminates both.
    ingest(s, slxModel('mdlparams.sldd', block('Ok', 'Constant', 'Value', 'gravity')), { filename: 'linked.slx' });
    ingest(s, slxModel(null, block('Loose', 'Constant', 'Value', 'gravity')), { filename: 'none.slx' });
    ingest(s, slxModel('elsewhere.sldd', block('Other', 'Constant', 'Value', 'gravity')), { filename: 'other.slx' });
    openDictionaryAs(s);
    expect(s.findUsages('mdlparams.sldd/design/gravity').map((u: any) => u.blockName)).toEqual(['Ok']);
  });

  it('sees a variable in a .mat the model declares as its workspace source', () => {
    const s = createSession();
    // A dictionary is not the only file a model gets definitions from: a model workspace
    // can be sourced from a `.mat`, and those variables are definitions the same way.
    // The visibility rule reads the model's dataSources SECTION rather than its
    // dataDictionary field, so this case costs no extra rule — which is why the section
    // is what it reads.
    ingest(s, slxModel(null, block('K', 'Constant', 'Value', 'kp'), 'signals.mat'), { filename: 'ws.slx' });
    ingest(s, artifact('mat/cases.mat'), { filename: 'signals.mat' });
    expect(s.findNodeById('signals.mat/kp')).not.toBe(null);
    expect(s.findUsages('signals.mat/kp')).toEqual([
      {
        blockName: 'K',
        blockType: 'Constant',
        paramProperty: 'Value',
        paramValue: 'kp',
        modelSrcId: 'ws.slx',
        linkTarget: 'K@ws.slx',
      },
    ]);
    // The same bytes open under a name the model does not declare define the same `kp`,
    // and it is not this model's kp.
    ingest(s, artifact('mat/cases.mat'), { filename: 'unrelated.mat' });
    expect(s.findUsages('unrelated.mat/kp')).toEqual([]);
  });

  it('keeps a model workspace private to its own model', () => {
    const { s } = modelSession();
    // `tau` is mdlcases.mdl's own workspace variable. Another model's block referencing
    // the name `tau` means that model's OWN tau, so it must not be reported here.
    ingest(s, slxModel(null, block('Mine', 'Gain', 'Gain', 'tau')), { filename: 'stranger.slx' });
    expect(s.findUsages('mdlcases.mdl/workspace/tau').map((u: any) => u.modelSrcId)).toEqual(['mdlcases.mdl']);
  });

  it('credits a dotted reference to the base variable, not to the field', () => {
    const s = createSession();
    ingest(s, slxModel('mdlparams.sldd', block('Sel', 'Constant', 'Value', 'MyBus.x')), { filename: 'dot.slx' });
    openDictionaryAs(s);
    // `MyBus.x` is a reference to MyBus — that is the name the model resolves, and the
    // field is reached from it. So the usage belongs to the entry.
    expect(s.findUsages('mdlparams.sldd/design/MyBus').map((u: any) => u.paramValue)).toEqual(['MyBus.x']);
    // And not to the bus element, which is not a name a block parameter can name.
    expect(s.findNodeById('mdlparams.sldd/design/MyBus/x')).not.toBe(null);
    expect(s.findUsages('mdlparams.sldd/design/MyBus/x')).toEqual([]);
  });

  it('reports nothing for a node that is not a definition, and nothing for an unknown id', () => {
    const { s } = modelSession();
    // A block is an entry of its model, so it passes the same isEntry gate a variable
    // does — but "which blocks use this block" is a different question with a different
    // answer shape, and this is not it. The reverse direction for a model or a
    // sub-dictionary is deliberately out of scope; see resolveDictionaryReferences.
    expect(s.findNodeById('mdlcases.mdl/blocks/TF')).not.toBe(null);
    expect(s.findUsages('mdlcases.mdl/blocks/TF')).toEqual([]);
    // A struct field is not a definition either.
    expect(s.findNodeById('mdlcases.mdl/workspace/cfg/mode')).not.toBe(null);
    expect(s.findUsages('mdlcases.mdl/workspace/cfg/mode')).toEqual([]);
    // The same empty answer findNodeById gives for an id it does not hold.
    expect(s.findUsages('no/such/node')).toEqual([]);
    expect(s.findUsages('')).toEqual([]);
  });

  it('survives a host-supplied source that only looks like a model', () => {
    const { s } = modelSession();
    // addParsedSource takes a tree this package did not build, so `blockParamUsages`
    // may be anything at all. One such source must not take the scan down.
    const junk: any = {
      name: 'hostile.slx',
      isContainer: true,
      parent: null,
      children: [] as any[],
      blockParamUsages: 'not a list',
      get id() {
        return this.name;
      },
      flatten() {
        return this.children;
      },
    };
    const halfJunk: any = {
      name: 'half.slx',
      isContainer: true,
      parent: null,
      children: [] as any[],
      blockParamUsages: [null, 42, { blockName: 'X' }, { paramValue: 'tau' }],
      get id() {
        return this.name;
      },
      flatten() {
        return this.children;
      },
    };
    s.addParsedSource('hostile.slx', junk);
    s.addParsedSource('half.slx', halfJunk);
    expect(() => s.findUsages('mdlcases.mdl/workspace/tau')).not.toThrow();
    expect(s.findUsages('mdlcases.mdl/workspace/tau').map((u: any) => u.modelSrcId)).toEqual(['mdlcases.mdl']);
  });
});

describe('resolveDictionaryReferences() — the sub-dictionaries a dictionary names', () => {
  it('reports a referenced sub-dictionary that is not open, by name', () => {
    const s = createSession();
    const dict = openDictionaryAs(s);
    // Parsed all along and kept as a bare name on the node, which no consumer could do
    // anything with: `unknown[]`, no resolution, no way to ask whether the file is even
    // open. params.sldd records exactly one reference.
    expect(dict.dictionaryReferences).toEqual(['common.sldd']);
    expect(s.resolveDictionaryReferences('mdlparams.sldd')).toEqual([
      { name: 'common.sldd', resolution: { status: 'source-not-open', sourceId: 'common.sldd', name: null } },
    ]);
  });

  it('resolves the reference to that dictionary’s own root once it is open', () => {
    const s = createSession();
    openDictionaryAs(s);
    ingest(s, fixtureBytes('compressed.sldd'), { filename: 'common.sldd' });
    const refs = s.resolveDictionaryReferences('mdlparams.sldd');
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe('common.sldd');
    expect(refs[0].resolution.status).toBe('resolved');
    expect((refs[0].resolution as any).node).toBe(s.getDataSource('common.sldd'));
  });

  it('does NOT graft an inherited entry into the dictionary that inherits it', () => {
    const s = createSession();
    openDictionaryAs(s);
    ingest(s, fixtureBytes('compressed.sldd'), { filename: 'common.sldd' });
    // common.sldd defines `Kp`; mdlparams.sldd inherits it by reference. Resolving the
    // reference makes the sub-dictionary reachable — and that is the whole of it. The
    // entry stays in the file that defines it: it is not copied, aliased or listed
    // under the referencing dictionary, because the tree is what a host renders and
    // what a save writes back, and an entry that appears in a file it is not stored in
    // would be edited there and lost.
    expect(s.resolveLink('Kp@common.sldd').node.id).toBe('common.sldd/design/Kp');
    expect(s.resolveLink('Kp@mdlparams.sldd')).toEqual({
      status: 'not-found',
      sourceId: 'mdlparams.sldd',
      name: 'Kp',
    });
    expect(s.findNodeById('mdlparams.sldd/design/Kp')).toBe(null);
    // caseSensitive, because findNodes' name criterion is a case-folded SUBSTRING test
    // and `MyBkpt` contains 'kp' — a search box hit, not an entry named Kp.
    expect(s.findNodes({ name: 'Kp', sourceId: 'mdlparams.sldd', caseSensitive: true })).toEqual([]);
    // The chain is one link deep on purpose: a reference is resolved, a reference's
    // references are the caller's next question, asked the same way.
    expect(s.resolveDictionaryReferences('common.sldd')).toEqual([]);
  });

  it('reports nothing for a source with no references, and for a srcId it does not hold', () => {
    const { s } = modelSession();
    // A model has no dictionary references of its own — the dictionary it is LINKED to
    // is a different relationship, and it is already a row with a resolvable target.
    expect(s.resolveDictionaryReferences('mdlcases.mdl')).toEqual([]);
    expect(s.resolveDictionaryReferences('nope.sldd')).toEqual([]);
    // A dictionary that references nothing, rather than one that could not be asked.
    ingest(s, artifact('text/cases.sldd'), { filename: 'cases.sldd' });
    expect(s.resolveDictionaryReferences('cases.sldd')).toEqual([]);
  });
});

describe('both directions read the live session, not a snapshot of it', () => {
  it('stops resolving a target once its source is closed', () => {
    const s = createSession();
    ingest(s, slxModel('mdlparams.sldd', block('Ka', 'Constant', 'Value', 'gravity')), { filename: 'a.slx' });
    openDictionaryAs(s);
    expect(s.resolveLink('gravity@mdlparams.sldd').status).toBe('resolved');

    s.removeDataSource('mdlparams.sldd');
    expect(s.resolveLink('gravity@mdlparams.sldd')).toEqual({
      status: 'source-not-open',
      sourceId: 'mdlparams.sldd',
      name: 'gravity',
    });
    // The reference from the model's own row goes the same way.
    expect(s.resolveLink('mdlparams.sldd').status).toBe('source-not-open');
  });

  it('drops usages when the model holding them is closed', () => {
    const s = createSession();
    ingest(s, slxModel('mdlparams.sldd', block('Ka', 'Constant', 'Value', 'gravity')), { filename: 'a.slx' });
    openDictionaryAs(s);
    expect(s.findUsages('mdlparams.sldd/design/gravity')).toHaveLength(1);
    s.removeDataSource('a.slx');
    // Not a stale usage pointing into a tree the session no longer owns — the scan is
    // over what is open, so closing the model is the whole of the invalidation.
    expect(s.findUsages('mdlparams.sldd/design/gravity')).toEqual([]);
  });

  it('resolves into the NEW tree after a source is re-registered', () => {
    const s = createSession();
    ingest(s, slxModel('mdlparams.sldd', block('Ka', 'Constant', 'Value', 'gravity')), { filename: 'a.slx' });
    openDictionaryAs(s);
    const before = s.resolveLink('gravity@mdlparams.sldd').node;
    expect(s.findUsages(before.id)).toHaveLength(1);

    // Re-opening the same file (parse → add again on the same srcId) is the ordinary way
    // to hit this, and registerSource replaces the tree. A resolver reading a stale
    // index would hand back a detached node whose edits vanish on save.
    s.addDataSource('mdlparams.sldd', paramsJson());
    const after = s.resolveLink('gravity@mdlparams.sldd');
    expect(after.status).toBe('resolved');
    expect(after.node.id).toBe(before.id);
    expect(after.node).not.toBe(before);
    expect(after.node).toBe(s.findNodeById('mdlparams.sldd/design/gravity'));
    // And the reverse direction is keyed on the node id, so it follows the new tree too.
    expect(s.findUsages(after.node.id).map((u: any) => u.blockName)).toEqual(['Ka']);
  });

  it('follows a model re-registered under the name a reference already used', () => {
    const { s } = modelSession();
    expect(s.resolveLink('mdl_child.mdl').status).toBe('source-not-open');
    ingest(s, artifact('mdl/mdlcases.slx'), { filename: 'mdl_child.slx' });
    expect(s.resolveLink('mdl_child.mdl').status).toBe('resolved');
    s.removeDataSource('mdl_child.slx');
    expect(s.resolveLink('mdl_child.mdl').status).toBe('source-not-open');
  });
});
