import type { MatVariable } from '../parser/MatParser.js';
/** Where a typed node's object is: its variable, and the element of the variable's handle. */
export interface McosPlace {
    variable: MatVariable;
    index: number;
}
export declare function setMcosPlace(node: object, variable: MatVariable, index: number): void;
/** Where the object `node` was built of is, or undefined for a node built of none. */
export declare function mcosPlaceOf(node: object): McosPlace | undefined;
//# sourceMappingURL=mcosPlace.d.ts.map