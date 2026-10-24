import type BaseNode from '../BaseNode.js';
import type { MatVariable } from '../../parser/MatParser.js';
import { type MatWriteError } from '../../parser/MatWriter.js';
import type MatNode from './MatNode.js';
/**
 * One entry handed to a paste: what DataNode.serialize answers for an entry of a dictionary or a
 * variable of a MAT-file, `{ name, metadata, value }`. A MAT-file has no metadata, and reads none.
 */
export interface PastePayload {
    name: string;
    metadata?: unknown;
    value: unknown;
}
/** A paste refused: why, in words naming the entry and the file, and the entry's name. */
export interface PasteRefused {
    error: true;
    reason: string;
    name?: string;
}
/** A paste made: the variables added, in the order handed over, and what takes them out and back. */
export interface PasteMade {
    nodes: BaseNode[];
    undo: () => void;
    redo: () => void;
}
export declare const PASTED_OBJECT_CLASSES: readonly string[];
/**
 * The refusal of a paste of `payload` into `mat` known without making anything, in words naming the
 * entry and the file, or null where only making it can tell: the file takes no edit at all
 * (MatNode._fileRefusal); what was handed over is no entry; its name is no MATLAB name; its value is
 * of a kind or a class a MAT-file takes no new variable of (classOf, MatNode._classRefusal). Asked
 * first by the making (makeOne), so that one refused here is refused there.
 */
export declare function cheapRefusal(mat: MatNode, payload: unknown): string | null;
/**
 * The paste of `payloads` into `mat`, made: each entry a variable of the file, in order, named as it
 * was or, where the file holds that name already (an entry made before it included), with a counter
 * appended. Or, where any of them is refused, nothing: every one made is taken out again, the file is
 * as it was, and the refusal says which entry and why.
 */
export declare function pasteInto(mat: MatNode, payloads: readonly unknown[]): PasteMade | PasteRefused;
/**
 * Why a paste of `payload` into `mat` is refused, or null where it would be made: cheapRefusal's
 * answer, or, `deep`, the making itself (pasteInto, of this entry alone), taken back whatever it
 * answers, so that the two cannot disagree.
 */
export declare function pasteRefusalOf(mat: MatNode, payload: unknown, deep: boolean): string | null;
/**
 * The tokens of what a paste or a drop into `mat` takes (MatNode.getAdmittedTypes): a host's
 * prediction of one judges a copied entry by its value's `_array_class`, or 'MatlabVariable' where it
 * has none, which is every plain value and a string. So 'MatlabVariable', and each class of
 * PASTED_OBJECT_CLASSES the file creates an object of (MatNode._classRefusal). None for a file that
 * takes no edit (MatNode._fileRefusal).
 */
export declare function admittedTypesOf(mat: MatNode): string[];
/**
 * The variable the MAT reader would hand over for `node`, a node of a plain MATLAB value as any
 * reader of this package makes one (a dictionary's StructNode, a MatlabVariableNode, a ConstantNode),
 * named `name`; or why there is none, as a clause naming what stands in the way by its MATLAB path.
 * A cell or a struct is built of its members, each so; anything else is its own variable
 * (MatlabVariableNode._var), which is what a save of it as a MAT stream encodes.
 *
 * Refused: an object at any depth (a typed node, an opaque MCOS object, an enumeration value), a
 * string at any depth (a MAT-file holds one only as an object), a function handle, a value the reader
 * did not decode.
 */
export declare function matVariableOfNode(node: BaseNode, name: string): MatVariable | {
    why: string;
};
/**
 * Where `made`, the object made of `source`, is not what `source` is, as a clause naming the property
 * by its MATLAB path, or null where it is: every row the two show, by its text (rowsDifference), the
 * value a text does not say whole (a Parameter's Value of an integer class, complex, of a size its
 * text does not hold: valueDifference), and what of the copy's property bag no row shows
 * (bagDifference).
 */
export declare function objectDifference(source: BaseNode, made: BaseNode): string | null;
/**
 * Where `payload`, what `node`, a plain value of a MAT-file or of a dictionary, copies as (its
 * serialize()), reads back as another value than the one `node` holds, as a clause, or null where it
 * reads back as it (or `node` is no plain value, which its own paste holds to what it is): read as a
 * dictionary's reader reads a copy (NodeRegistry.parseValue), and held to `node` as landedDifference
 * holds it. An empty of a class or a size a copy does not spell (a MAT-file's int8 0x3, a logical
 * 1x0) reads back as a double 0x0.
 */
export declare function copyDifference(node: BaseNode, payload: {
    value: unknown;
}, ofMatFile: boolean): string | null;
/**
 * Where `landed`, a node of what a copy of `node` became somewhere (a copy read back, an entry a
 * dictionary wrote and read again), is another value than `node`, a plain value, holds, as a clause, or
 * null: both as the variable a MAT reader would hand over (matVariableOfNode); of a MAT-file's
 * variable, the one its save writes (MatlabVariableNode._var), which a container the node ceiling
 * built without its rows still has whole. Null too where either is no plain value.
 */
export declare function landedDifference(node: BaseNode, landed: BaseNode, ofMatFile: boolean): string | null;
export declare function cannotPaste(mat: MatNode, name: string, why: string): string;
export declare function writerWhy(e: MatWriteError): string;
//# sourceMappingURL=matPaste.d.ts.map