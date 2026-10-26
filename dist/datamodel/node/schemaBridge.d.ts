import type { PropClass, PIGroupDef } from './BaseNode.js';
import type BaseNode from './BaseNode.js';
import type { SetPropertyResult } from './DataNode.js';
export declare function formatSchemaValue(value: unknown): string;
export declare function buildPILayout(className: string): PIGroupDef[] | null;
export declare function schemaColumns(className: string): PropClass[];
export declare function trySetSchemaProperty(node: BaseNode, key: string, stringValue: string): true | SetPropertyResult | null;
/**
 * Why an edit of `key`, a property the schema of the node's class shows, is refused whatever the
 * file, in the words trySetSchemaProperty refuses it with, before it writes anything: a row shown
 * of another property MATLAB saves (shownOnlyRefusal), a property of a CoderInfo held as MATLAB's
 * handle data (heldOpaqueRefusal), one of a CoderInfo the node holds none of (leafHeld), and an
 * Alignment MATLAB refuses, by its value and then under StorageClass 'Auto'. Null where none of
 * them refuses it, and for a key no schema of the class shows. Changes nothing:
 * DataNode._offerRefusal asks it of a row that offers no editor of `key`, to say why as the setter
 * would.
 */
export declare function schemaEditRefusal(node: BaseNode, key: string, stringValue: string): SetPropertyResult | null;
export declare function schemaColumnLabels(): Record<string, string>;
//# sourceMappingURL=schemaBridge.d.ts.map