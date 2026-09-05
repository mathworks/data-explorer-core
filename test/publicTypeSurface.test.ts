// Copyright 2026 The MathWorks, Inc.
//
// The public surface has to be NAMEABLE, not just callable. `parseSlx` being
// exported while `ParsedSlx` is not leaves a TypeScript consumer unable to write
// down what it just got back: no annotated variable, no field on its own interface,
// no typed function that takes a parse result. That is a compile-time defect, and a
// compile-time defect needs a compile-time test — vitest erases type-only imports,
// so `import type { ParsedSlx }` from a module that does not export it runs green.
//
// So this suite compiles a synthetic consumer file against the package entry point
// with the TypeScript API and asserts it produces no diagnostics. The consumer is
// virtual (never written to disk) and everything else resolves through the real
// filesystem under the repo's own tsconfig, so what is checked is exactly what a
// consumer of this package sees. The negative control at the bottom is what proves
// the harness can fail at all.

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
// A path INSIDE test/ so that `../src/index.js` resolves the way a real file there
// would. Nothing is ever written here.
const CONSUMER = fileURLToPath(new URL('./__typeConsumer.ts', import.meta.url));

function compilerOptions(): ts.CompilerOptions {
  const { config } = ts.readConfigFile(
    fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
    ts.sys.readFile,
  );
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, REPO_ROOT);
  const options = { ...parsed.options, noEmit: true, declaration: false, declarationMap: false, sourceMap: false };
  // The consumer lives in test/, outside `rootDir`, and emits nothing anyway.
  delete options.rootDir;
  delete options.outDir;
  return options;
}

// Compile `source` as test/__typeConsumer.ts and return its diagnostic messages.
function diagnose(source: string): string[] {
  const options = compilerOptions();
  const host = ts.createCompilerHost(options, true);
  const synthetic = ts.createSourceFile(CONSUMER, source, ts.ScriptTarget.ES2022, true);
  const realGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, ...rest) =>
    fileName === CONSUMER ? synthetic : realGetSourceFile(fileName, ...rest);
  const realFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => fileName === CONSUMER || realFileExists(fileName);
  const realReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => (fileName === CONSUMER ? source : realReadFile(fileName));

  const program = ts.createProgram([CONSUMER], options, host);
  return [
    ...program.getSyntacticDiagnostics(synthetic),
    ...program.getSemanticDiagnostics(synthetic),
  ].map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

describe('a consumer can name what a parser returned', () => {
  it('names every parser return type, and every named type reachable from one', () => {
    // Each line is one thing a consumer cannot do while the type is unexported. The
    // last three are the closure: an exported function whose return type mentions an
    // unexported interface is the same defect one level down, so naming the FIELDS of
    // a parse result is part of the contract, not extra credit.
    expect(
      diagnose(`
        import { parseSlx, parseMdl, parseModel, parseMat } from '../src/index.js';
        import type {
          ParsedSlx,
          ParsedMdl,
          ParsedMat,
          BlockParamUsage,
          MatVariable,
        } from '../src/index.js';

        declare const buf: ArrayBuffer;

        const slx: ParsedSlx = parseSlx(buf, 'm.slx');
        const mdl: ParsedMdl = parseMdl(buf, 'm.mdl');
        const model: ParsedSlx = parseModel(buf, 'm.slx');
        const mat: ParsedMat = parseMat(buf);

        // The fields, which is where the closure lives.
        const usage: BlockParamUsage = slx.blockParamUsages[0];
        const workspaceVar: MatVariable = mdl.workspace[0];
        const matVar: MatVariable = mat.variables[0];

        // Two members of ParsedSlx are anonymous inline object types rather than named
        // interfaces, so there is no name for the closure to be missing. Asserted
        // rather than assumed, because "there is nothing to export here" is a claim:
        // indexed access is what a consumer writes for those, and it only works while
        // the type carrying them is itself exported.
        const ref: ParsedSlx['modelReferences'][number] = slx.modelReferences[0];
        const cfg: ParsedSlx['configSets'][number] = slx.configSets[0];

        // A consumer's own signature over a parse result — the case the item is about.
        function summarize(parsed: ParsedSlx, vars: MatVariable[]): string {
          return parsed.name + vars.length + ref.modelName + cfg.name;
        }

        export const out = summarize(model, [workspaceVar, matVar]) + usage.blockName;
      `),
    ).toEqual([]);
  });

  it('names the warnings a parse result carries, and the code it switches on', () => {
    // A short parse is only useful if the host can render it, and rendering it means
    // holding the warnings in a field, passing them to a formatter of its own, and
    // switching on `code` to decide what to say. All three need the type to have a
    // name. `ParseWarningCode` is checked as a literal union rather than as a string:
    // a host builds its own icon-per-code map from it, and a widened `string` would
    // silently let that map go stale. The negative control at the bottom of this file
    // is what proves an empty diagnostic list here means something.
    expect(
      diagnose(`
        import { parseSlx, parseMdl, parseMat, parseProject } from '../src/index.js';
        import type { ParseWarning, ParseWarningCode, ParsedSlx, ParsedMat } from '../src/index.js';

        declare const buf: ArrayBuffer;

        // Every reader's warnings, named as the one type.
        const fromSlx: ParseWarning[] = parseSlx(buf, 'm.slx').warnings;
        const fromMdl: ParseWarning[] = parseMdl(buf, 'm.mdl').warnings;
        const fromMat: ParseWarning[] = parseMat(buf).warnings;
        const fromPrj: ParseWarning[] = parseProject({}, 'p.prj').warnings;

        // A host's own field over them, and its own formatter taking one.
        interface OpenedSource { path: string; problems: ParseWarning[] }
        function describe(w: ParseWarning): string {
          // \`part\` is optional — a loss the format cannot name a piece for has none —
          // so a consumer must be able to see that in the type.
          return w.code + ': ' + w.message + (w.part ? ' [' + w.part + ']' : '');
        }

        // The codes as a closed union: every arm is reachable and the switch is
        // exhaustive, which is what makes a per-code UI safe to write.
        function icon(code: ParseWarningCode): string {
          switch (code) {
            case 'part-unreadable': return 'part';
            case 'source-empty': return 'empty';
            case 'source-unreadable': return 'broken';
          }
        }

        // And the field reached through the result types by name, not just off a call.
        function countOf(parsed: ParsedSlx | ParsedMat): number {
          return parsed.warnings.length;
        }

        const state: OpenedSource = { path: 'm.slx', problems: [...fromSlx, ...fromMdl, ...fromPrj] };
        export const out =
          state.problems.map(describe).join() +
          fromMat.map((w) => icon(w.code)).join() +
          countOf(parseSlx(buf, 'm.slx')) +
          state.path;
      `),
    ).toEqual([]);
  });

  it('takes a warnings sink on the dictionary reader, and still compiles without one', () => {
    // The dictionary reader is the only one whose diagnostics do not arrive on the return
    // value: `parseBinarySldd` hands back the dictionary CONTENT, so there is no
    // `ParsedSldd` to put a `warnings` field on, and the warnings come out through an
    // optional array the caller owns (the header of BinarySlddParser.ts records the
    // decision). That makes two things compile-level promises rather than runtime ones,
    // and vitest cannot check either — it erases types and ignores extra arguments.
    //
    // First: the sink has to be TYPED as the same `ParseWarning[]` every other reader
    // reports through, all the way down the chain a host actually calls — parser, node
    // layer, session. A sink typed as `unknown[]` would compile at the call site and be
    // unreadable at the point of use.
    //
    // Second, and the reason it is a trailing optional parameter: every existing
    // one-argument call still compiles. This package is consumed as a git dependency, so
    // that is not a courtesy — a `{ content, warnings }` wrapper would have moved the
    // content one level down for every consumer, and `Record<string, unknown>` is loose
    // enough that some of those call sites would have kept compiling while handing a
    // wrapper to something expecting content.
    expect(
      diagnose(`
        import { parseBinarySldd, parseBinarySlddParts, createSession, ingest, SlddNode } from '../src/index.js';
        import type { ParseWarning, Session } from '../src/index.js';

        declare const buf: ArrayBuffer;
        declare const chunkXml: string;
        declare const zipParts: Record<string, Uint8Array>;

        // The whole chain, sharing one list — which is the point of the shape.
        const warnings: ParseWarning[] = [];
        const content: Record<string, unknown> = parseBinarySldd(buf, warnings);
        const rebuilt: Record<string, unknown> = parseBinarySlddParts(chunkXml, zipParts, warnings);
        const session: Session = createSession();
        const node = SlddNode.parse(content, 'd.sldd', warnings);
        session.addDataSource('d.sldd', rebuilt, { size: 1 }, warnings);
        session.addParsedSource('d.sldd', node as never, { size: 1 }, warnings);

        // A host's own formatter over the collected list, as one type with every other
        // reader's warnings.
        function report(list: ParseWarning[]): string {
          return list.map((w) => w.code + ': ' + w.message).join();
        }

        // Every call the sink was added to, still written the way it was before it existed.
        const unchanged: Record<string, unknown> = parseBinarySldd(buf);
        const unchangedParts: Record<string, unknown> = parseBinarySlddParts(chunkXml, zipParts);
        const plain = SlddNode.parse(unchanged, 'd.sldd');
        session.addDataSource('e.sldd', unchangedParts);
        session.addParsedSource('f.sldd', plain as never);
        ingest(session, buf, { filename: 'd.sldd' });

        export const out = report(warnings) + node.name + plain.NumberOfEntries;
      `),
    ).toEqual([]);
  });

  it('names the query type session.findNodes() takes', () => {
    // The same defect one call away from a parser: findNodes() takes a structured
    // query, so a host builds one from its own search UI, keeps it in a field and
    // passes it to its own helpers — none of which it can write down while the type
    // has no name. vitest erases `import type`, so only a compile catches it.
    expect(
      diagnose(`
        import { createSession } from '../src/index.js';
        import type { FindNodesQuery, Session } from '../src/index.js';

        const session: Session = createSession();

        // A host's own field over a query, and its own signature taking one.
        interface SearchState { pending: FindNodesQuery | null }
        function run(s: Session, query: FindNodesQuery): string[] {
          return s.findNodes(query).map((n) => n.id);
        }

        const state: SearchState = {
          pending: {
            name: /^Elem/,
            className: 'Simulink.Bus',
            kind: 'Bus',
            value: 'x',
            sourceId: 'a.sldd',
            caseSensitive: true,
            limit: 10,
          },
        };
        const first = session.findNode({ name: 'x' });

        export const out = run(session, state.pending!).length + (first ? first.id : '');
      `),
    ).toEqual([]);
  });

  it('names what session.resolveLink()/findUsages() hand back', () => {
    // A resolution is a discriminated union whose whole point is the failure arms, so a
    // host writes a `switch (r.status)` — and it writes it in a helper of its own, over a
    // parameter it has to be able to declare. A usage is worse: it goes into an array the
    // host holds and into the `UsedBy` cell it builds, so an unnameable NodeUsage means
    // the host cannot type the function that does the building.
    expect(
      diagnose(`
        import { createSession } from '../src/index.js';
        import type {
          Session,
          LinkResolution,
          NodeUsage,
          DictionaryReference,
          RowData,
        } from '../src/index.js';

        const session: Session = createSession();

        // Every arm reachable and narrowed by \`status\` — which is what makes the union
        // worth being a union rather than a node-or-null.
        function describeLink(r: LinkResolution): string {
          switch (r.status) {
            case 'resolved': return r.node.id + r.nodes.length + r.sourceId;
            case 'not-found': return r.sourceId + r.name;
            case 'source-not-open': return r.sourceId + (r.name ?? '');
            case 'empty': return '';
          }
        }

        // The item-4 shape, written the way item 4 will write it: usages in, a multi-link
        // UsedBy cell out. It only compiles while NodeUsage and RowData are both nameable.
        function usedByCell(usages: NodeUsage[]): RowData['UsedBy'] {
          return {
            links: usages.map((u) => ({
              text: u.blockName + ' (' + u.blockType + ')',
              linkTarget: u.linkTarget,
            })),
          };
        }

        function subdictionaries(s: Session, srcId: string): DictionaryReference[] {
          return s.resolveDictionaryReferences(srcId);
        }

        const resolution: LinkResolution = session.resolveLink('Kp@mdlparams.sldd');
        const usages: NodeUsage[] = session.findUsages('mdlparams.sldd/design/Kp');
        const cell = usedByCell(usages);

        export const out =
          describeLink(resolution) +
          JSON.stringify(cell) +
          subdictionaries(session, 'mdlparams.sldd').length +
          usages.map((u) => u.paramProperty + u.paramValue + u.modelSrcId).join();
      `),
    ).toEqual([]);
  });

  it('names what session.rowsOf() hands back, and narrows a UsedBy cell', () => {
    // The other half of item 4. `RowData` was already exported for the cell a host
    // builds itself (the test above); what is new is that a row now ARRIVES with the
    // cell filled, from `rowsOf()` or from `node.toRow()`, so the host is on the
    // reading side of that union rather than the writing side. Reading it means
    // narrowing all three arms plus the absent one, in a function of the host's own
    // over a `RowData` it has to be able to declare.
    //
    // The container parameter is named through `Parameters<Session['rowsOf']>[0]`
    // rather than as `INode`, because `INode` is not exported from the entry point
    // today. That is not something rowsOf introduced — `findNodes`, `findNode` and
    // the `resolved` arm of `LinkResolution` all hand back a node the same
    // unnameable way — and exporting it is a surface change of its own, so this
    // asserts the route that does exist and would fail if `rowsOf` fell off the
    // session literal or changed arity.
    expect(
      diagnose(`
        import { createSession } from '../src/index.js';
        import type { Session, RowData } from '../src/index.js';

        const session: Session = createSession();

        // A host's renderer, over the cell as it now arrives.
        function usedByLabels(row: RowData): string[] {
          const cell = row.UsedBy;
          // The no-usages case is the ABSENT key, not an empty \`links\` array and not an
          // empty string, so \`undefined\` is a host's first branch and the type has to
          // say so. See BaseNode._usedByCell for why absence is the answer.
          if (cell === undefined) {
            return [];
          }
          if (typeof cell === 'string') {
            return [cell];
          }
          if ('links' in cell) {
            // The arm the data model actually produces: one entry per referencing
            // block, each independently clickable through resolveLink.
            return cell.links.map((l) => l.text + ' -> ' + session.resolveLink(l.linkTarget).status);
          }
          return [cell.text + (cell.linkTarget ?? '')];
        }

        // A whole table in one call, typed as rows: the batched projection.
        function table(s: Session, container: Parameters<Session['rowsOf']>[0]): string[][] {
          return s.rowsOf(container).map((row) => [row.ID, ...usedByLabels(row)]);
        }

        const rows: RowData[] = session.rowsOf(session.findNode({ name: 'design' })!);

        export const out = rows.map(usedByLabels).join() + table(session, session.findNode({})!).length;
      `),
    ).toEqual([]);
  });

  it('reports an unexported name, so an empty diagnostic list means something', () => {
    // The negative control. Without it, a harness that silently resolved nothing
    // would pass the test above no matter what the entry point exports.
    const messages = diagnose(`
      import type { NoSuchParseResult } from '../src/index.js';
      export const x: NoSuchParseResult | null = null;
    `);
    expect(messages.join('\n')).toContain('has no exported member');
    expect(messages.join('\n')).toContain('NoSuchParseResult');
  });
});
