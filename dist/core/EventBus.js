// Copyright 2026 The MathWorks, Inc.
export function createEventBus() {
    const listeners = {};
    function publish(topic, ...args) {
        const fns = listeners[topic];
        if (fns) {
            fns.forEach((fn) => fn(...args));
        }
    }
    function subscribe(topic, fn) {
        if (!listeners[topic]) {
            listeners[topic] = [];
        }
        listeners[topic].push(fn);
        return {
            remove() {
                const arr = listeners[topic];
                listeners[topic] = arr.filter((f) => f !== fn);
            },
        };
    }
    function clear() {
        Object.keys(listeners).forEach((k) => delete listeners[k]);
    }
    return { publish, subscribe, clear };
}
const defaultBus = createEventBus();
export function publish(topic, ...args) {
    return defaultBus.publish(topic, ...args);
}
export function subscribe(topic, fn) {
    return defaultBus.subscribe(topic, fn);
}
export function clear() {
    return defaultBus.clear();
}
export { defaultBus };
//# sourceMappingURL=EventBus.js.map