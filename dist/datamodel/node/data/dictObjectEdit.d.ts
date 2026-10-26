import type BaseNode from '../BaseNode.js';
import { type SourceOfferedEditor, type SourceSetResult } from '../BaseNode.js';
/** The editor a dictionary offers of `key` at `node`, of `entry` (BaseNode.sourceOfferedEditor), or null. */
export declare function dictOfferedEditor(entry: BaseNode, node: BaseNode, key: string): SourceOfferedEditor | null;
/**
 * Why a dictionary offers no editor of `key` at `node` (of `entry`) now, a property it offers one of
 * in another state (dictOfferedEditor), as a MAT-file says it: `Cannot edit "<entry>": <why>.`; null
 * for any other (BaseNode.sourceUnofferedRefusal).
 */
export declare function dictUnofferedRefusal(entry: BaseNode, node: BaseNode, key: string): string | null;
/**
 * The edit of `key` at `node` (of `entry`) to `text`, of a property a dictionary offers an editor of
 * (dictOfferedEditor): judged by the rules a MAT-file's save holds it to, and written into the
 * node's bag, and its field where it has one, with what MATLAB's setter changes beside it. Null for
 * a key it offers no editor of, which the node's own setter takes.
 */
export declare function dictSetOffered(entry: BaseNode, node: BaseNode, key: string, text: string): SourceSetResult | null;
/**
 * What puts `key` of `node` (of `entry`) back as it stands now, a property a dictionary offers an
 * editor of: every key of its bag a plan of the rules can write (each one holding a value, and not
 * an object the bag nests, its CoderInfo or its Elements_internal, which no plan writes and other
 * nodes hold), a key absent then removed again, and every field the writers write over the bag.
 * Null for any other key.
 */
export declare function dictOfferedRestorer(entry: BaseNode, node: BaseNode, key: string): (() => void) | null;
/**
 * The editor a dictionary offers of `key` on a node of `cls`, of a property it writes into an
 * object's bag (dictOfferedEditor), whatever the node holds now: what a MAT stream holding objects
 * offers of one of them, where its own gate takes the edit (mcosStreamEdit).
 */
export declare function dictEditorOf(cls: string, key: string): SourceOfferedEditor | null;
//# sourceMappingURL=dictObjectEdit.d.ts.map