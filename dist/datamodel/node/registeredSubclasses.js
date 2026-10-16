// Copyright 2026 The MathWorks, Inc.
// The MATLAB subclasses this package registers as the class they extend, each by its
// superclass. mpt.Parameter and mpt.Signal are the Embedded Coder subclasses of
// Simulink.Parameter and Simulink.Signal, and they are everywhere in production
// dictionaries: MPT ("module packaging tool") is what a project switches to the moment it
// needs custom storage classes and memory sections for code generation.
//
// One row here is the whole of what this package does with such a class:
//  - NodeClassMap registers it under its superclass's node, so it is read with the
//    superclass's treatment in every format while the node reports the class the file
//    holds (see mpt.Parameter.md);
//  - SectionNode.allowsType admits it to a paste or a drop wherever its superclass may
//    live, since a paste copies an object MATLAB already wrote, and MATLAB holds mpt.*
//    in Design Data (the maintainer's ruling on C-180, 2026-10-16);
//  - SectionNode.addEntry still refuses to create it: creating one would claim we write
//    a well-formed mpt object from scratch, which the MATLAB round-trip gate has never
//    checked.
//
// The schema resolves the same rows through its own CLASS_ALIASES (schema/index.ts), which
// cannot import this module: dependencies point into the schema, never out of it.
// test/mptClasses.test.ts holds the two together.
//
// A leaf, importing nothing, so SectionNode and NodeClassMap can both read it without a
// cycle.
const SUPERCLASS_OF = {
    'mpt.Parameter': 'Simulink.Parameter',
    'mpt.Signal': 'Simulink.Signal',
};
// The registered superclass of `className`, or undefined when it is not a registered
// subclass. By OWN key: a class name is the file's word, and `toString` or `constructor`
// is a valid MATLAB class name that would otherwise answer an inherited function.
export function superclassOf(className) {
    return Object.prototype.hasOwnProperty.call(SUPERCLASS_OF, className) ? SUPERCLASS_OF[className] : undefined;
}
// Every registered subclass, in the order of the table above.
export function registeredSubclasses() {
    return Object.keys(SUPERCLASS_OF);
}
//# sourceMappingURL=registeredSubclasses.js.map