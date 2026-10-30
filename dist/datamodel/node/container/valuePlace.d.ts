/**
 * The first place in `value`, an entry's value as a copy holds it, where `match` finds something, named
 * as MATLAB indexes it from `at` (the entry's name), or null where it finds nothing: `x{3}` of a cell,
 * `x(2).v` of a field of a struct array, `x.Value` of an object's property, each by its linear index in
 * MATLAB's column-major order, which is the order `_elements` holds. `match` is asked of each bag, the
 * outermost first, and answers null to look inside it, or what to add to the place to name the thing it
 * found there: '' for the bag itself, `(2)` for its second element. The paste's refusals of a value no
 * dictionary takes as MATLAB would say where it is by this (SectionNode.parseEntry).
 */
export declare function valuePlace(value: unknown, at: string, match: (bag: Record<string, unknown>) => string | null): {
    at: string;
    bag: Record<string, unknown>;
} | null;
//# sourceMappingURL=valuePlace.d.ts.map