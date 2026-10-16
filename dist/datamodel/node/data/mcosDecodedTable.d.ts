import type { MatVariable } from '../../parser/MatParser.js';
import type { McosObjectData } from '../../parser/McosParser.js';
export declare function setMcosDecoded(variable: MatVariable, decoded: McosObjectData | undefined): void;
export declare function mcosDecodedFor(variable: MatVariable): McosObjectData | undefined;
export declare function setMcosRefused(variable: MatVariable, refused: boolean): void;
export declare function mcosRefused(variable: MatVariable): boolean;
//# sourceMappingURL=mcosDecodedTable.d.ts.map