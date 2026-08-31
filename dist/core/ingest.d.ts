import type { Session } from './DataModel.js';
import type { ISourceNode, SourceMeta } from './NodeInterfaces.js';
export type IngestContent = ArrayBuffer | Uint8Array | string | Record<string, unknown>;
export interface IngestOptions {
    filename: string;
    meta?: Partial<SourceMeta>;
}
export declare function ingest(session: Session, content: IngestContent, opts: IngestOptions): ISourceNode;
//# sourceMappingURL=ingest.d.ts.map