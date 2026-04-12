export const runtimePerformance: Pick<Performance, 'now'> = (() => {
    if (typeof globalThis !== 'undefined' && globalThis.performance && typeof globalThis.performance.now === 'function') {
        return globalThis.performance;
    }
    return {
        now: () => Date.now()
    };
})();
