// Copyright 2026 The MathWorks, Inc.
//
// A coder setting no MAT-file or compressed-binary dictionary keeps: one of a CoderInfo MATLAB never
// set up (HasCoderInfo false), which a Parameter or a Signal copied out of a model workspace or a data
// dictionary holds, and MATLAB keeps so through every copy it makes. MATLAB ignores every coder setting
// such a file holds of it (R2027a: a Storage Class core wrote there read back Auto, isequal to the file
// without it; MATLAB's own save of a MAT-file drops one too). A text dictionary keeps it, and reads the
// flag true. Asked of the schema's coder rows (schemaBridge) and of a MAT-file's own (matObjectEdit),
// so that each says the same.
import { resolveSourcePath } from '../schema/index.js';
// The files MATLAB was measured to ignore an unset CoderInfo's coder settings in: a MAT-file, and a
// compressed-binary dictionary (SlddNode's 'xml'). Not a text dictionary, which keeps them, nor a
// model's workspace, where it was not measured.
const UNKEPT_IN = new Set(['mat', 'xml']);
/** Whether a coder setting of `node`'s CoderInfo would not be kept: an unset CoderInfo, in a file UNKEPT_IN. */
export function coderSettingUnkept(node) {
    const bag = node.serial?._properties;
    const flag = resolveSourcePath(bag, 'CoderInfo.HasCoderInfo');
    if (flag !== false) {
        return false;
    }
    const format = node._ownerFormat?.();
    return format !== undefined && UNKEPT_IN.has(format);
}
/**
 * Why an edit of `label` (a row's name, `Storage Class`) of `node` would not be kept, as the clause a
 * refusal of it says after `Cannot edit "<entry>": `, naming the node by its MATLAB path as every
 * other clause of a MAT-file's does, so that an object nested in a struct says what its top-level
 * twin says of itself.
 */
export function unkeptCoderWhy(node, label) {
    const cls = String(node.className ?? '');
    const noun = cls.replace(/^Simulink\./, '');
    return (node.matlabPath || node.name) + "'s " + label + ' would not be kept. This ' + noun + "'s coder settings were never set up (as when it was copied out of a model "
        + 'workspace or a data dictionary), and MATLAB ignores coder settings saved on such a ' + noun + '. To set them, create a new ' + cls + ' in MATLAB';
}
//# sourceMappingURL=unkeptCoder.js.map