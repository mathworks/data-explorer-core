import type BaseNode from './BaseNode.js';
/** Whether a coder setting of `node`'s CoderInfo would not be kept: a Parameter's unset CoderInfo, in a file UNKEPT_IN. */
export declare function coderSettingUnkept(node: BaseNode): boolean;
/**
 * Why an edit of `label` (a row's name, `Storage Class`) of `node` would not be kept, as the clause a
 * refusal of it says after `Cannot edit "<entry>": `, naming the node by its MATLAB path as every
 * other clause of a MAT-file's does, so that an object nested in a struct says what its top-level
 * twin says of itself.
 */
export declare function unkeptCoderWhy(node: BaseNode, label: string): string;
//# sourceMappingURL=unkeptCoder.d.ts.map