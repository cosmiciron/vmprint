import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import from the freshly-built ESM output — config.ts is the single source of truth
const { LOCAL_FONT_REGISTRY } = await import('../dist/config.js');

const outPath = resolve(__dirname, '../assets/registry.json');
writeFileSync(outPath, JSON.stringify(LOCAL_FONT_REGISTRY, null, 2) + '\n');
console.log(`[generate-registry] Wrote ${LOCAL_FONT_REGISTRY.length} entries → assets/registry.json`);
