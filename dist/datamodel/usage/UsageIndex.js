// src/datamodel/usage/UsageIndex.ts
// Copyright 2026 The MathWorks, Inc.
//
// Which blocks use which definitions, across a SET OF FILES rather than across a session.
//
// The session answers the same question already — findUsages / BaseNode._usedByCell — but
// only about sources a host registered, because that answer is read off node trees and a
// node tree is an expensive thing to hold. So a host with a whole folder of models on disk
// cannot use it: registering every file to find out which ones use a dictionary entry
// costs a full parse and a full tree per file, permanently. data-explorer-vscode built its
// own resolver over file SUMMARIES for exactly that reason, and that resolver is what this
// module is. It belongs here: which names a model can see is MATLAB's rule about parsed
// data, not a rule about editors.
//
// A summary is small — names, links, and the block parameters — so a workspace-sized set
// is affordable and needs no session, no node trees and no singleton.
//
// There are two implementations of visibility in this package — this one over file
// summaries, and the session's over registered node trees (DataModel.resolutionOrder, which
// findUsages applies) — and they now answer alike. They did not: the session credited every
// definition a model could REACH, chased no dictionary reference, and matched a recorded
// reference case-sensitively, so for the same two files it reported a usage this module
// did not (a shadowed dictionary entry) and missed ones it did (a sub-dictionary's entry, a
// model linking `Params.SLDD`). A host showing both — data-explorer-vscode fills the column
// from this index and falls back to the session for a model it cannot find on disk — showed
// whichever engine happened to answer, which is how the shadowed usage was found.
//
// The rule below is the one both express: the enclosing mask workspaces innermost-out, then
// the model workspace, then the dictionary chain, then the MATs, first hit wins. Two
// implementations remain because the INPUTS genuinely differ
// (bytes on disk versus trees in a session, and neither can be had from the other), so the
// agreement is pinned by test rather than by construction — see test/usageEngines.test.ts,
// which asks both the same question about the same files.
//
// ==> OPEN, and not the same question: a model whose WORKSPACE is sourced from a `.mat`
// (`WSDataSource: 'MAT-File'`) resolves that file last here, with the other externals,
// because both parsers merge it into `externalDataSources` and the distinction is gone by
// the time a summary is built. MATLAB would resolve it FIRST — it is the model workspace.
// It only shows when such a model also links a dictionary defining the same name, and
// closing it needs the parsers to keep the workspace file apart from the rest.
import { blockKey, blockLabel, joinBlockPath } from '../blockIdentity.js';
import { identifiersIn } from '../expressions.js';
import { maskDefining } from '../maskScope.js';
import { basenameOf, isMatFile, isModelFile, isSlddFile, modelNameOf, refBasename } from '../fileKinds.js';
import { normalizeRefNames, readSlddContent, slddChunkContent } from '../parser/SlddContent.js';
import { parseModel } from '../parser/ModelParser.js';
import { parseMat } from '../parser/MatParser.js';
// --- Summarising -------------------------------------------------------------
// Every `??` below defaults a field ParsedSlx declares as REQUIRED, so TypeScript says none
// of them can be taken and a coverage report lists them as branches never hit. They are kept
// deliberately, and the next person measuring coverage should leave them alone: these fields
// are what a PARSER made of a user's file, and the type is only as true as SlxParser is on
// every malformed `.slx` anyone ever opens. Deleting them to move that number up trades a
// summary short of one field for a TypeError that costs the whole file — the opposite of the
// policy on summarizeFiles below, where one unreadable file must not empty the answers for
// the rest of the folder.
function modelSummary(parsed, srcId, filename) {
    const externals = parsed.externalDataSources ?? [];
    return {
        srcId,
        // The bare model name, off the BASENAME: a caller hands over whatever path it has, and
        // a model is named `engine` in a block path and in every reference recorded to it —
        // never `/work/models/engine`. Stripping the extension without stripping the directory
        // makes a host label a usage cell with a path it then cannot match anything against.
        name: modelNameOf(basenameOf(filename)) ?? basenameOf(filename),
        workspaceNames: new Set((parsed.workspace ?? []).map((v) => v.name).filter(Boolean)),
        // The linked dictionary first, because that is the order MATLAB resolves in and
        // resolveName takes the first hit. The kind tests are the shared, case-insensitive ones
        // (fileKinds) because these strings are whatever the MODEL recorded: `EXTRADICT.SLDD` is
        // a real dictionary link, and a stricter test classifies it as neither dictionary nor
        // MAT and drops the link entirely.
        slddRefs: [
            ...(parsed.dataDictionary ? [refBasename(parsed.dataDictionary)] : []),
            ...externals.filter(isSlddFile).map(refBasename),
        ],
        matRefs: externals.filter(isMatFile).map(refBasename),
        masks: parsed.masks ?? [],
        blockParams: (parsed.blockParamUsages ?? []).map((u) => ({
            blockName: u.blockName,
            blockType: u.blockType,
            sid: u.sid ?? '',
            systemPath: u.systemPath ?? '',
            property: u.paramProperty,
            expression: u.paramValue,
        })),
    };
}
function slddSummary(srcId, json) {
    const content = slddChunkContent(json);
    const names = new Set();
    const slddRefs = [];
    if (content) {
        for (const entry of content.entries ?? []) {
            const name = entry?.name;
            if (name) {
                names.add(name);
            }
        }
        slddRefs.push(...normalizeRefNames(content['Dictionary References']).map(refBasename));
    }
    return { srcId, names, slddRefs };
}
function matSummary(srcId, parsed) {
    return {
        srcId,
        names: new Set(parsed.variables.map((v) => v.name).filter(Boolean)),
        slddRefs: [],
    };
}
/**
 * Parse each file into the summary its kind calls for, dispatching on the FILENAME through
 * the shared kind tests.
 *
 * A file that cannot be parsed contributes nothing rather than aborting the run: one corrupt
 * dictionary in a folder must not empty the usage answers for every other file in it. That
 * is the same policy the session applies per source, and the reason readSlddContent leaves
 * refusal to its caller.
 */
export function summarizeFiles(files) {
    const models = [];
    const slddByName = new Map();
    const matByName = new Map();
    for (const file of files) {
        try {
            if (isModelFile(file.filename)) {
                models.push(modelSummary(parseModel(file.bytes, file.filename), file.srcId, file.filename));
            }
            else if (isMatFile(file.filename)) {
                matByName.set(refBasename(file.filename), matSummary(file.srcId, parseMat(file.bytes)));
            }
            else if (isSlddFile(file.filename)) {
                slddByName.set(refBasename(file.filename), slddSummary(file.srcId, readSlddContent(file.bytes)));
            }
        }
        catch {
            /* unreadable file contributes nothing */
        }
    }
    return { models, slddByName, matByName };
}
// --- Resolving ---------------------------------------------------------------
/**
 * Where the name `name` resolves for a block of `model` sitting at `systemPath`, or null
 * if it does not.
 *
 * MATLAB's order, and the FIRST hit wins: the mask workspaces of the masked subsystems
 * this block is inside (innermost out), then the model's own workspace, then the linked
 * dictionary and any dictionary it references transitively, then linked MAT-files. Each
 * scope SHADOWS the ones after it — the block reads one value, so only one definition is
 * used, and crediting both would put a usage on a definition whose value never reaches
 * the block.
 *
 * `systemPath` is where the resolution is being done FROM, and it defaults to the root
 * for a caller that has no block in mind. It is only the mask scope that needs it — the
 * other three are properties of the model as a whole — but that is exactly the fact this
 * signature had to learn: which names a block can see depends on where the block is, not
 * only on which model it is in.
 *
 * Dictionary references are chased breadth-first with a seen-set, because a dictionary
 * hierarchy is a graph a user can make cyclic and a cycle here would not terminate.
 */
export function resolveName(model, name, slddByName, matByName, systemPath = '') {
    const mask = maskDefining(model.masks, systemPath, name);
    if (mask) {
        // The model's own srcId: a mask workspace is not a file, and the block it belongs to
        // is in this model. What identifies it is `maskBlock`, not the srcId.
        return { kind: 'mask', srcId: model.srcId, maskBlock: mask };
    }
    if (model.workspaceNames.has(name)) {
        return { kind: 'workspace', srcId: model.srcId };
    }
    const seen = new Set();
    const queue = [...model.slddRefs];
    while (queue.length > 0) {
        const ref = queue.shift();
        if (seen.has(ref)) {
            continue;
        }
        seen.add(ref);
        const sldd = slddByName.get(ref);
        if (!sldd) {
            continue;
        }
        if (sldd.names.has(name)) {
            return { kind: 'sldd', srcId: sldd.srcId };
        }
        queue.push(...sldd.slddRefs);
    }
    for (const ref of model.matRefs) {
        const mat = matByName.get(ref);
        if (mat?.names.has(name)) {
            return { kind: 'mat', srcId: mat.srcId };
        }
    }
    return null;
}
const reverseKey = (srcId, name) => `${srcId}\n${name}`;
// Keyed by the block's KEY (its SID), which is what paramsOf is asked with. Keying this by
// name merged every same-named block in a model: in f14.slx one lookup of `Gain` answered
// with four different blocks' gains.
const forwardKey = (modelSrcId, blockKey) => `${modelSrcId}\n${blockKey}`;
/**
 * Build the index over a set of files.
 *
 * Both directions come out of one pass over the block parameters, because they are one
 * traversal read two ways — a second pass could disagree with the first about what
 * resolved.
 */
export function buildUsageIndex(files) {
    const { models, slddByName, matByName } = summarizeFiles(files);
    const reverse = new Map();
    const forward = new Map();
    for (const model of models) {
        for (const param of model.blockParams) {
            // Which block this is, and what it reads as — see blockIdentity. The target carries
            // the key, the cell shows the label, and for most blocks they are the same string.
            const key = blockKey(param.blockName, param.sid);
            const label = blockLabel(param.blockName, param.sid);
            const target = `${key}@${model.srcId}`;
            // Where the block is, for a cell that must otherwise print the same word twice for
            // two different blocks. Joined here rather than carried whole from the parser so
            // that the label a user reads and the path it sits at cannot disagree.
            const path = joinBlockPath(param.systemPath, label);
            // A Set: an expression can name the same definition twice (`Kp + Kp`), and that is ONE
            // place it is referenced, not two.
            const names = [...new Set(identifiersIn(param.expression))];
            let origin = null;
            for (const name of names) {
                const resolved = resolveName(model, name, slddByName, matByName, param.systemPath);
                if (!resolved) {
                    continue;
                }
                // The first name that resolves is the parameter's origin for the FORWARD answer,
                // which is about the parameter as a whole and can only point at one place. The
                // reverse answer credits every name that resolved, because `Kp*Ki` really is a usage
                // of both.
                if (!origin) {
                    origin = { ...resolved, name };
                }
                // A mask-resolved name has NO reverse entry. `reverse` is keyed by (file, name of
                // a definition IN that file), and a mask parameter is not one — so the only key
                // available would be the model's own, which belongs to the model workspace's
                // variable of that name. That is a variable the mask HIDES from this block, and
                // crediting it there is the exact usage MATLAB withholds: maskUsage.slx defines
                // `shadowed` in the model workspace and again as a mask parameter of `MulAdd`, and
                // findVars gives the workspace one no user at all though `MulAdd/Const` reads
                // `shadowed`. The usage is not lost — it appears on the mask parameter's own row,
                // which is the masked block's, through the forward direction below.
                if (resolved.kind === 'mask') {
                    continue;
                }
                const index = reverseKey(resolved.srcId, name);
                const usages = reverse.get(index) ?? [];
                // One entry per BLOCK, and `target` identifies the block and its model together —
                // which is the old two-field test made exact. Two blocks named `Gain` using the
                // same variable are two usages of it, and used to collapse into one link that
                // could only reach whichever came first.
                if (!usages.some((u) => u.linkTarget === target)) {
                    usages.push({
                        blockName: label,
                        blockPath: path,
                        blockType: param.blockType,
                        paramProperty: param.property,
                        paramValue: param.expression,
                        modelSrcId: model.srcId,
                        // The forward grammar reversed, the same target findUsages produces, so a host
                        // resolves a usage the same way whichever resolver answered it.
                        linkTarget: target,
                    });
                }
                reverse.set(index, usages);
            }
            const params = forward.get(forwardKey(model.srcId, key)) ?? [];
            params.push({
                property: param.property,
                expression: param.expression,
                name: origin?.name ?? null,
                originSrcId: origin?.srcId ?? null,
                kind: origin?.kind ?? null,
                // `name@srcId`, this package's one link grammar — never a display string, and never
                // a channel prefix. A host that routes `workspace:` or `blocks:` targets prefixes
                // this itself, which is what it already does with the targets nodes produce.
                //
                // A mask origin points at the masked BLOCK instead, by its key: there is no row
                // anywhere named `g1` to reach, and the place a reader wants from `Gain = g1` is
                // the mask that gives `g1` its value. Two hops, which is how MATLAB models it too.
                linkTarget: origin
                    ? `${origin.maskBlock ? blockKey(origin.maskBlock.blockName, origin.maskBlock.sid) : origin.name}@${origin.srcId}`
                    : '',
                maskBlock: origin?.maskBlock ?? null,
            });
            forward.set(forwardKey(model.srcId, key), params);
        }
    }
    return {
        models,
        usagesOf: (srcId, name) => reverse.get(reverseKey(srcId, name)) ?? [],
        paramsOf: (modelSrcId, key) => forward.get(forwardKey(modelSrcId, key)) ?? [],
    };
}
//# sourceMappingURL=UsageIndex.js.map