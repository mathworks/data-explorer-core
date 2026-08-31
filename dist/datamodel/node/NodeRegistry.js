// Copyright 2026 The MathWorks, Inc.
let classMap = null;
export function init(map) {
    classMap = map;
}
export function parseValue(rawVal, name, parent) {
    return classMap.parseValue(rawVal, name, parent);
}
export function getClass(className) {
    return classMap.getClass(className);
}
export function getRegisteredClasses() {
    return classMap.getRegisteredClasses();
}
export function wrapDerivedVariable(node) {
    return classMap.wrapDerivedVariable(node);
}
export default { init, parseValue, getClass, getRegisteredClasses, wrapDerivedVariable };
//# sourceMappingURL=NodeRegistry.js.map