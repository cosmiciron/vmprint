type VmcanvasRuntimeFlags = {
    disableSafeCheckpoints?: boolean;
    maxReactiveResettlementCycles?: number;
};

const readRuntimeFlags = (): VmcanvasRuntimeFlags => {
    const maybeFlags = (globalThis as typeof globalThis & { __VMCANVAS_RUNTIME_FLAGS__?: VmcanvasRuntimeFlags }).__VMCANVAS_RUNTIME_FLAGS__;
    return maybeFlags && typeof maybeFlags === 'object' ? maybeFlags : {};
};

export const areSafeCheckpointsEnabled = (): boolean =>
    readRuntimeFlags().disableSafeCheckpoints !== true;

export const getReactiveResettlementCycleCap = (): number => {
    const raw = Number(readRuntimeFlags().maxReactiveResettlementCycles);
    if (Number.isFinite(raw) && raw >= 1) {
        return Math.floor(raw);
    }
    return 8;
};
