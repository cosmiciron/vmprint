import fs from 'node:fs/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';

const root = process.cwd();
const docsRoot = path.join(root, 'docs');
const assetsDir = path.join(docsRoot, 'assets');

const pages = [
  { input: path.join('guides', 'README.md'), output: path.join('guides', 'index.html'), section: 'guides' },
  { input: path.join('guides', '01-your-first-document.md'), output: path.join('guides', '01-your-first-document.html'), section: 'guides' },
  { input: path.join('guides', '02-styles-and-text.md'), output: path.join('guides', '02-styles-and-text.html'), section: 'guides' },
  { input: path.join('guides', '03-stories-strips-and-zones.md'), output: path.join('guides', '03-stories-strips-and-zones.html'), section: 'guides' },
  { input: path.join('guides', '04-headers-footers-and-page-control.md'), output: path.join('guides', '04-headers-footers-and-page-control.html'), section: 'guides' },
  { input: path.join('guides', '05-images-tables-and-overlays.md'), output: path.join('guides', '05-images-tables-and-overlays.html'), section: 'guides' },
  { input: path.join('guides', '06-scripting.md'), output: path.join('guides', '06-scripting.html'), section: 'guides' },
  { input: path.join('reference', 'ast.md'), output: path.join('reference', 'ast.html'), section: 'reference' },
  { input: path.join('reference', 'cli.md'), output: path.join('reference', 'cli.html'), section: 'reference' },
  { input: path.join('reference', 'overlay.md'), output: path.join('reference', 'overlay.html'), section: 'reference' },
  { input: path.join('reference', 'scripting.md'), output: path.join('reference', 'scripting.html'), section: 'reference' },
  { input: path.join('reference', 'standard-fonts.md'), output: path.join('reference', 'standard-fonts.html'), section: 'reference' },
];

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href');
  if (href) {
    token.attrSet('href', rewriteHref(href, env.inputDir));
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

function stripFrontMatter(source) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '');
}

function rewriteHref(href, inputDir) {
  if (
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('mailto:') ||
    href.startsWith('#')
  ) {
    return href;
  }

  const [rawPath, hash = ''] = href.split('#');
  if (!rawPath) {
    return href;
  }

  let nextPath = rawPath;
  if (nextPath.endsWith('/README.md')) {
    nextPath = `${nextPath.slice(0, -'README.md'.length)}index.html`;
  } else if (nextPath === 'README.md') {
    nextPath = 'index.html';
  } else if (nextPath.endsWith('.md')) {
    nextPath = `${nextPath.slice(0, -3)}.html`;
  }

  if (path.isAbsolute(nextPath)) {
    nextPath = path.relative(inputDir, nextPath);
  }

  return hash ? `${nextPath}#${hash}` : nextPath;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function pageTitle(markdownSource, fallback) {
  const match = markdownSource.match(/^#\s+(.+)$/m);
  return (match?.[1] || fallback).replace(/`/g, '');
}

function navLink(currentSection, targetSection, href, label) {
  const cls = currentSection === targetSection ? 'nav-link is-active' : 'nav-link';
  return `<a class="${cls}" href="${href}">${label}</a>`;
}

function htmlTemplate({ title, section, body, depth }) {
  const prefix = '../'.repeat(depth);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | VMPrint Docs</title>
  <meta name="description" content="VMPrint documentation">
  <link rel="stylesheet" href="${prefix}assets/docs.css">
</head>
<body>
  <header class="site-header">
    <div class="site-header__inner">
      <a class="brand" href="${prefix}index.html">VMPrint Docs</a>
      <nav class="site-nav" aria-label="Primary">
        ${navLink(section, 'home', `${prefix}index.html`, 'Home')}
        ${navLink(section, 'guides', `${prefix}guides/`, 'Guides')}
        ${navLink(section, 'reference', `${prefix}reference/ast.html`, 'Reference')}
        ${navLink(section, 'api', `${prefix}api/`, 'API')}
        ${navLink(section, 'examples', `${prefix}examples/`, 'Examples')}
        <a class="nav-link" href="https://github.com/cosmiciron/vmprint">GitHub</a>
      </nav>
    </div>
  </header>
  <main class="page-shell">
    <article class="markdown-body">
${body}
    </article>
  </main>
</body>
</html>
`;
}

async function ensureCss() {
  const cssPath = path.join(assetsDir, 'docs.css');
  await fs.access(cssPath);
}

async function buildPage(page) {
  const inputPath = path.join(docsRoot, page.input);
  const outputPath = path.join(docsRoot, page.output);
  const inputDir = path.dirname(page.input);
  const depth = page.output.split(path.sep).length - 1;
  const raw = await fs.readFile(inputPath, 'utf8');
  const source = stripFrontMatter(raw);
  const title = pageTitle(source, 'VMPrint Docs');
  const body = md.render(source, { inputDir });
  const html = htmlTemplate({ title, section: page.section, body, depth });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, 'utf8');
}

await ensureCss();
for (const page of pages) {
  await buildPage(page);
}

console.log(`Built ${pages.length} static docs page(s).`);
