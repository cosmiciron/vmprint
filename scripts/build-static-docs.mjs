import fs from 'node:fs/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';

const root = process.cwd();
const docsRoot = path.join(root, 'docs');
const assetsDir = path.join(docsRoot, 'assets');

const pages = [
  { input: 'README.md', output: 'index.html', section: 'home' },
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
  await fs.mkdir(assetsDir, { recursive: true });
  const css = `:root {
  --bg: #f6f4ef;
  --panel: #fffdf8;
  --ink: #1d1b18;
  --muted: #6a6258;
  --line: #ddd5c8;
  --accent: #8f3b1b;
  --accent-soft: #f7e6db;
  --code-bg: #f2eee6;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  color: var(--ink);
  background:
    radial-gradient(circle at top, #fff9ef, #f6f4ef 38%),
    linear-gradient(180deg, #f7f2e8 0%, #f6f4ef 100%);
}
a { color: var(--accent); }
a:hover { color: #6f2d14; }
.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(10px);
  background: color-mix(in srgb, var(--panel) 84%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 12%, var(--line));
}
.site-header__inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 14px 20px;
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
}
.brand {
  text-decoration: none;
  color: var(--ink);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 0.9rem;
}
.site-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.nav-link {
  text-decoration: none;
  color: var(--muted);
  padding: 6px 10px;
  border-radius: 999px;
}
.nav-link.is-active {
  color: var(--accent);
  background: var(--accent-soft);
}
.page-shell {
  max-width: 1120px;
  margin: 0 auto;
  padding: 32px 20px 56px;
}
.markdown-body {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 18px 48px rgba(44, 30, 13, 0.08);
  padding: 32px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.markdown-body > :first-child { margin-top: 0; }
.markdown-body > :last-child { margin-bottom: 0; }
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  line-height: 1.2;
  margin-top: 1.6em;
  margin-bottom: 0.55em;
}
.markdown-body h1 {
  font-size: clamp(2rem, 4vw, 3rem);
  letter-spacing: -0.03em;
}
.markdown-body h2 {
  font-size: clamp(1.45rem, 2vw, 2rem);
  padding-bottom: 0.2em;
  border-bottom: 1px solid var(--line);
}
.markdown-body p,
.markdown-body ul,
.markdown-body ol,
.markdown-body table,
.markdown-body pre,
.markdown-body blockquote {
  margin-top: 0;
  margin-bottom: 1em;
}
.markdown-body code {
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 0.92em;
  background: var(--code-bg);
  padding: 0.14em 0.38em;
  border-radius: 6px;
}
.markdown-body pre {
  background: #1d1a17;
  color: #f6efe6;
  padding: 16px;
  border-radius: 14px;
  overflow: auto;
}
.markdown-body pre code {
  background: transparent;
  color: inherit;
  padding: 0;
}
.markdown-body blockquote {
  margin-left: 0;
  padding: 0.2em 1em;
  border-left: 4px solid color-mix(in srgb, var(--accent) 40%, var(--line));
  color: var(--muted);
}
.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}
.markdown-body th,
.markdown-body td {
  border: 1px solid var(--line);
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
}
.markdown-body th {
  background: #f3ece2;
}
.markdown-body hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 2em 0;
}
@media (max-width: 720px) {
  .site-header__inner,
  .page-shell { padding-left: 14px; padding-right: 14px; }
  .markdown-body { padding: 22px 18px; border-radius: 16px; }
}
`;
  await fs.writeFile(path.join(assetsDir, 'docs.css'), css, 'utf8');
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
