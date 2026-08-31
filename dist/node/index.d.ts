import '../datamodel/node/NodeClassMap.js';
import { createSession as _createSession } from '../core/DataModel.js';
import type { Session } from '../core/DataModel.js';
import type { ISourceNode } from '../core/NodeInterfaces.js';
export declare const createSession: typeof _createSession;
export declare function loadFromPath(session: Session, path: string): ISourceNode;
export declare function loadDirectory(session: Session, dir: string): ISourceNode[];
//# sourceMappingURL=index.d.ts.map