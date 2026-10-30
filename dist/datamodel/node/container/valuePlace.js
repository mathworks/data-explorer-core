// Copyright 2026 The MathWorks, Inc.
/**
 * The first place in `value`, an entry's value as a copy holds it, where `match` finds something, named
 * as MATLAB indexes it from `at` (the entry's name), or null where it finds nothing: `x{3}` of a cell,
 * `x(2).v` of a field of a struct array, `x.Value` of an object's property, each by its linear index in
 * MATLAB's column-major order, which is the order `_elements` holds. `match` is asked of each bag, the
 * outermost first, and answers null to look inside it, or what to add to the place to name the thing it
 * found there: '' for the bag itself, `(2)` for its second element. The paste's refusals of a value no
 * dictionary takes as MATLAB would say where it is by this (SectionNode.parseEntry).
 */
export function valuePlace(value, at, match) {
    if (value === null || typeof value !== 'object') {
        return null;
    }
    if (Array.isArray(value)) {
        for (const v of value) {
            const found = valuePlace(v, at, match);
            if (found !== null) {
                return found;
            }
        }
        return null;
    }
    const o = value;
    const said = match(o);
    if (said !== null) {
        return { at: at + said, bag: o };
    }
    const elements = Array.isArray(o._elements) ? o._elements : null;
    const indexed = (i) => (elements && elements.length > 1 ? '(' + (i + 1) + ')' : '');
    const inMembers = (members, where) => {
        for (const [k, v] of Object.entries(members)) {
            const found = k.startsWith('_') ? null : valuePlace(v, where + '.' + k, match);
            if (found !== null) {
                return found;
            }
        }
        return null;
    };
    if (o._array_type === 'Cell' && elements) {
        for (let i = 0; i < elements.length; i++) {
            const found = valuePlace(elements[i], at + '{' + (i + 1) + '}', match);
            if (found !== null) {
                return found;
            }
        }
        return null;
    }
    if (elements) {
        // A struct's elements are its fields; an object's, its `_properties`.
        for (let i = 0; i < elements.length; i++) {
            const e = elements[i];
            if (e === null || typeof e !== 'object' || Array.isArray(e)) {
                continue;
            }
            const members = o._array_type === 'Struct' ? e : e._properties;
            const found = members !== null && typeof members === 'object' && !Array.isArray(members) ? inMembers(members, at + indexed(i)) : null;
            if (found !== null) {
                return found;
            }
        }
        return null;
    }
    // An object at a property, as the element alone (`{_object_class, _properties}`).
    const props = o._properties;
    return props !== null && typeof props === 'object' && !Array.isArray(props) ? inMembers(props, at) : null;
}
//# sourceMappingURL=valuePlace.js.map