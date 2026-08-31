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
export default { init, parseValue, getClass, getRegisteredClasses };
//# sourceMappingURL=NodeRegistry.js.map