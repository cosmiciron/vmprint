import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.spec.ts', 'tests/**/*.test.ts'],
        exclude: ['tests/performance-benchmark.ts'],
        testTimeout: 30000,
    },
    resolve: {
        conditions: ['tsx'],
    },
});
