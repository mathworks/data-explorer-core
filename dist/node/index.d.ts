import '../datamodel/node/NodeClassMap.js';
import { createSession as _createSession } from '../core/DataModel.js';
import type { Session } from '../core/DataModel.js';
import type { ISourceNode } from '../core/NodeInterfaces.js';
import { type ParseWarning } from '../datamodel/parser/ParseWarning.js';
export declare const createSession: typeof _createSession;
export declare function loadFromPath(session: Session, path: string): ISourceNode;
/**
 * Every supported file in `dir` that opened, and — in `skipped`, when the caller brings
 * somewhere to put them — the ones that did not.
 *
 * One corrupt file in a folder must cost that file and nothing else, which is what the
 * try/catch is for. But a skip is not nothing: silence makes a folder look as though it
 * simply held fewer files. This used to say so with `console.error`, which is the one
 * channel a host cannot work around — it cannot be captured, routed to a UI, localized or
 * turned off, and a library has no business writing to a consumer's stderr. The two CLIs
 * in this repo now print it themselves, which is where the decision to write to a
 * terminal belongs.
 *
 * `ParseWarning` rather than a type of its own, though nothing here parsed: a skipped file
 * is exactly `source-unreadable` — "reading the source failed outright and was recovered
 * from" — and a host already knows how to render one. What it does NOT have is a node to
 * hang itself on, because the source never opened, and that is the whole reason this comes
 * back beside the sources instead of attached to one.
 *
 * Optional and trailing, so every existing caller keeps compiling and keeps its behaviour
 * minus the stderr write. Same shape as SlddNode.parse's sink.
 */
export declare function loadDirectory(session: Session, dir: string, skipped?: ParseWarning[]): ISourceNode[];
//# sourceMappingURL=index.d.ts.map