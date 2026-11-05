/** A set's class: a set, or a reference to one. */
export type SetClass = 'Simulink.ConfigSet' | 'Simulink.ConfigSetRef';
/** A configuration set as the package holds it, or as it is to hold it. */
export interface SetState {
    name: string;
    className: SetClass;
    description: string;
    /** What a reference points to; '' for a set. */
    sourceName: string;
}
/** A set the package is to hold: one it held (`read`, its place in the sets as read) or a new one. */
export interface SetToWrite extends SetState {
    read: number | null;
    /**
     * A new set's settings, its `_properties` as a dictionary or an R2026b+ part holds them (a set
     * pasted in): its part is written with them, in R2026b+'s layout alone. Absent: a set as MATLAB
     * makes a fresh one, its Name and Version.
     */
    content?: Record<string, unknown>;
}
/** Why the sets cannot be written as asked, as a clause. */
export declare class ConfigSetsError extends Error {
}
/**
 * The members of `entries` the sets as asked change: each with its new bytes, or null for one taken
 * out. `asRead` is the package's sets as read, in order; `sets` the sets it is to hold, in order, as
 * read where `read` names one and added where it is null, every set as read that none names
 * deleted. Throws ConfigSetsError, saying why, where the package is not laid out as MATLAB writes it.
 */
export declare function withConfigSets(entries: Record<string, Uint8Array>, asRead: readonly SetState[], sets: readonly SetToWrite[], model: {
    hasDictionary: boolean;
}): Record<string, Uint8Array | null>;
//# sourceMappingURL=ConfigSetsWriter.d.ts.map