import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs'],
    target: 'node18',
    clean: true,
    dts: true,
    noExternal: [/(.*)/],
    outExtension() {
        return { js: '.js' };
    },
    banner: { js: '#!/usr/bin/env node' }
});
