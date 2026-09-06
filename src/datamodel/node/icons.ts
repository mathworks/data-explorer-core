// Copyright 2026 The MathWorks, Inc.

// Icon ids shared by more than one node class, so the rule lives in one place
// rather than being restated per path.

// An OBJECT whose class this data model has no icon of its own for: a
// customer-defined class out of a dictionary, an MCOS object out of a .mat whose
// class is not in the branded map, a pre-MCOS class-3 object the reader recorded
// without decoding, and the generic `CustomObject` entry. Four paths reach that
// same conclusion, and they used to spell it four ways — three said `wsDefault`,
// the plain-variable icon, so an object was indistinguishable from a double, and
// the fourth named an `object` icon that ships no SVG at all and rendered as a
// broken image. `ws3d` is the workspace-browser glyph for a class instance, which
// is what all four of them are.
export const OBJECT_ICON = 'ws3d';
