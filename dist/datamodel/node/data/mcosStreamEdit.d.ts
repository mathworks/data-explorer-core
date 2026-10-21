import DataNode from '../DataNode.js';
import { type EncodedValue } from '../../parser/EncodedValue.js';
/** What a stream was read as, for its holder's gate and writer. */
export interface McosStreamRead {
    format: 'hex' | 'cdata';
    bytes: Uint8Array;
    className: string;
    encoded?: EncodedValue;
    raw?: Record<string, unknown>;
}
/**
 * Makes `holder`, the node a dictionary value's MAT stream decoded into, the gate of every edit
 * inside it (mcosStream) and the writer of its stream: as read while its value is the stream it
 * was read from (`_encoded` still set), and rewritten, with the edited properties' cells swapped,
 * after. For MatlabVariableNode.parseEncoded and _parseCdataObjects, through the registry.
 */
export declare function adoptMcosStream(holder: DataNode, read: McosStreamRead): void;
//# sourceMappingURL=mcosStreamEdit.d.ts.map