# draft2final

**Focus on your writing. Get a book that's ready to publish.**

`draft2final` is a professional typesetting tool built for writers who want to stay focused on their content, yet demand output that is polished and perfect. It turns plain Markdown files into publication-grade PDFs for novels, memoirs, film scripts, and academic papers—without the complexity of LaTeX or the inconsistencies of word processors.

---

## Why draft2final?

- **Industrial-Strength Engine**: Built on a state-of-the-art native typesetting engine—not a browser-based hack. It offers clinical precision in layout, margins, and vertical rhythms that rivals high-end publishing software like InDesign.
- **Micro-Typographic Excellence**: Professional-grade handling of font opticals, kerning, and advanced pagination logic that respects the traditions of fine bookmaking.
- **Zero-Friction Infrastructure**: A purely native solution. No Chromium, no Puppeteer, and no "font emergencies." It just works, beautifully, every time.
- **Global-Ready from Day One**: Native, high-fidelity support for mixed scripts including Arabic, Chinese, Devanagari, and Thai with correct contextual shaping and bidirectional layout.

---

## Quick Start

### 1. Install
```bash
npm install -g draft2final
```

### 2. Scaffold a New Project
```bash
# For a novel or memoir
draft2final --new story.md --as manuscript

# For a film script
draft2final --new script.md --as screenplay
```

### 3. Render your PDF
```bash
# Render with default settings
draft2final story.md

# Render as a specific type
draft2final story.md --as manuscript
```
*(Render completes in ~0.3s for a typical chapter)*

---

## Preparing Existing Files

If you have an existing Markdown file and want to add the required front matter and recommended configuration:

```bash
draft2final --prepare story.md --as manuscript
```

This will:
1.  Add/update the `as: manuscript` key in the front matter.
2.  Inject a commented-out block of **recommended settings** for that specific format (boilerplate), making it easy to discover and tune options without leaving your editor.

---

## Choosing your "Form"

Use the `--as` flag to define the structural "Form" of your work. This is the structural DNA of your document:

- **`manuscript`**: The gold standard for prose submissions.
- **`screenplay`**: Effortless script formatting with dual-dialogue support.
- **`academic`**: Precise layout for research drafts and formal papers.
- **`literature`**: Clean, elegant book designs for poetry and prose.

---

## The Screenplay Workflow

`draft2final` handles screenplay syntax with effortless sophistication. It supports full industry formatting conventions—action, characters, parentheticals, and dual-dialogue—all derived from clean, semantic Markdown.

```md
## INT. COFFEE SHOP - DAY

Rain drums against the glass.

> @ELIAS
> If this script doesn't render perfectly, I'm taking up carpentry.

> @RIN
> Relax. It's draft2final.
```

---

## Aesthetics

The `--style` flag (or `style:` in your frontmatter) is where the "Aesthetic" lives—the visual skin of your document:

```bash
draft2final script.md --as screenplay --style classic
```

---

## Full Documentation

For the complete guide on syntax, advanced styles, and theme customization, visit the [User Guide](https://www.draft2final.app/guide).

---

## License

Licensed under the [Apache License 2.0](LICENSE).
