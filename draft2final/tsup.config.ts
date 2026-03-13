import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/cli.ts'],
    format: ['cjs'],
    target: 'node18',
    clean: true,
    noExternal: [/(.*)/], // Bundle all dependencies for a standalone CLI
    external: [
      '@vmprint/transmuter-mkd-mkd',
      '@vmprint/transmuter-mkd-academic',
      '@vmprint/transmuter-mkd-literature',
      '@vmprint/transmuter-mkd-manuscript',
      '@vmprint/transmuter-mkd-screenplay'
    ],
    outExtension() {
      return { js: '.js' };
    },
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    target: 'node18',
    dts: true,
  }
]);
