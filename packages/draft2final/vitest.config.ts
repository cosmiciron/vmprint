import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
        exclude: ['tests/boundary-guards.ts'],
        testTimeout: 60000,
    },
    resolve: {
        conditions: ['tsx'],
    },
});
