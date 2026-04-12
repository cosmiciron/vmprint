import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs'],
    target: 'node18',
    clean: true,
    dts: true,
    external: ['@vmprint/local-fonts', '@vmprint/context-pdf'],
    noExternal: ['@vmprint/engine', '@vmprint/contracts'],
    outExtension() {
        return { js: '.js' };
    }
});
