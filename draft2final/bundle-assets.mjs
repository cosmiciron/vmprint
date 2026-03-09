import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(__dirname, 'dist');

// 1. Copy PDFKit AFM metrics
const pdfkitDataSrc = path.join(repoRoot, 'node_modules', 'pdfkit', 'js', 'data');
const pdfkitDataDest = path.join(distDir, 'data');

if (fs.existsSync(pdfkitDataSrc)) {
  fs.mkdirSync(pdfkitDataDest, { recursive: true });
  const files = fs.readdirSync(pdfkitDataSrc);
  for (const file of files) {
    if (file.endsWith('.afm') || file.endsWith('.icc')) {
      fs.copyFileSync(path.join(pdfkitDataSrc, file), path.join(pdfkitDataDest, file));
    }
  }
  console.log('[bundle-assets] Copied PDFKit metrics to dist/data');
}

// 2. Copy Selective Fonts (Latin Pack + Small Fallbacks)
const fontsSrc = path.join(repoRoot, 'font-managers', 'local', 'assets', 'fonts');
const fontsDest = path.join(distDir, 'assets', 'fonts');

const includeFonts = [
  'Arimo',
  'Caladea',
  'Carlito',
  'Cousine',
  'CourierPrime',
  'NotoSans',
  'Tinos',
  // Small fallbacks
  'NotoSansArabic',
  'NotoSansDevanagari',
  'NotoSansThai',
  'NotoSansSymbol'
];

fs.mkdirSync(fontsDest, { recursive: true });

for (const fontDir of includeFonts) {
  const src = path.join(fontsSrc, fontDir);
  const dest = path.join(fontsDest, fontDir);
  if (fs.existsSync(src)) {
    fs.mkdirSync(dest, { recursive: true });
    const files = fs.readdirSync(src);
    for (const file of files) {
      fs.copyFileSync(path.join(src, file), path.join(dest, file));
    }
    console.log(`[bundle-assets] Bundled font: ${fontDir}`);
  }
}

console.log('[bundle-assets] Asset bundling complete.');

// 3. Copy starter templates from transmuters
const starterTemplates = [
  {
    src: path.join(repoRoot, 'transmuters', 'mkd-manuscript', 'templates', 'starter.md'),
    dest: path.join(distDir, 'templates', 'mkd-manuscript', 'starter.md')
  },
  {
    src: path.join(repoRoot, 'transmuters', 'mkd-screenplay', 'templates', 'starter.md'),
    dest: path.join(distDir, 'templates', 'mkd-screenplay', 'starter.md')
  }
];

for (const template of starterTemplates) {
  if (!fs.existsSync(template.src)) continue;
  fs.mkdirSync(path.dirname(template.dest), { recursive: true });
  fs.copyFileSync(template.src, template.dest);
  console.log(`[bundle-assets] Bundled starter template: ${path.basename(path.dirname(template.dest))}`);
}
