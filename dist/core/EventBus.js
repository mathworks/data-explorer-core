// Copyright 2026 The MathWorks, Inc.
export function createEventBus() {
    const listeners = {};
    function publish(topic, ...args) {
        const entries = listeners[topic];
        if (!entries) {
            return;
        }
        // Iterate a snapshot so a listener that subscribes or unsubscribes during
        // dispatch cannot perturb this round. One listener throwing must not silence
        // the remaining ones — the model fans a single mutation out to many
        // independent consumers — so report the failure without aborting the fan-out.
        for (const entry of entries.slice()) {
            try {
                entry.fn(...args);
            }
            catch (err) {
                console.error(`EventBus: listener for "${String(topic)}" threw`, err);
            }
        }
    }
    function subscribe(topic, fn) {
        if (!listeners[topic]) {
            listeners[topic] = [];
        }
        const entries = listeners[topic];
        const entry = { fn };
        entries.push(entry);
        return {
            remove() {
                // Remove this subscription only, by wrapper identity.
                const current = listeners[topic];
                if (!current) {
                    return;
                }
                const at = current.indexOf(entry);
                if (at !== -1) {
                    current.splice(at, 1);
                }
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