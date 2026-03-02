# draft2final

_A Markdown compiler for industry-standard documents._

---

I'm an animation film director and producer. For years I've written my screenplays in plain text, because proper screenplay software is cumbersome and gets in the way of thinking. Plain-text screenplay formats exist, but they're English-centric — not designed for writers working in multiple languages.

So I wrote in hacked Markdown. Character names in blockquotes, scene headings as headings, transitions as capitalized paragraphs. It worked for writing. Then, every time I needed to hand something to a producer or submit to a festival, I had to format it manually — copy everything into proper screenplay software, fix every element by hand. That's not a workflow. That's penance.

Then I wrote a book. Also in Markdown. And when it came time to produce a proper manuscript, I found the same wall: there's no reliable tool that takes what you wrote and produces what the industry expects, without either fighting you about format or requiring you to rewrite everything in a DSL you didn't choose.

draft2final is what I built to get out of that situation.

## The Idea

Markdown is a writing format. It was never designed to represent a screenplay, a legal brief, or an academic paper. But it has something valuable: structure that's meaningful without being rigid.

When you write this in a plain Markdown editor:

```markdown
## INT. OFFICE - DAY

A long, uncomfortable silence.

> @MORGAN
>
> I've been thinking about what you said.

CUT TO:
```

you're looking at something that already makes sense. A heading that reads like a scene heading. A blockquote that groups the dialogue, visually separated from action. A transition you can see at a glance. The document is navigable and readable in any editor that understands Markdown — no screenplay software required, no proprietary format, no special tooling.

draft2final reads those structural hints and interprets them semantically. The blockquote isn't a citation — it's a dialogue turn. The `@` on the name isn't decoration — it's a character cue. The `h2` that starts with `INT.` isn't just a heading — it's a scene heading. A format module maps these conventions to the domain-specific elements they represent, then hands off to the vmprint layout engine to produce output that meets the industry standard.

This is what makes it a _compiler_, not a template renderer. It compiles from one representation — Markdown with structural conventions — to another: a precisely-laid-out professional document. The source file doesn't change. The conventions are stable and readable without the tool. What changes is the compilation target.

And because each format module is an independent compilation pass over the same source language, draft2final is a _platform_. A screenplay is one compilation target. A book manuscript is another. An academic paper, a legal brief, a technical report, a stage play — each is a format module that maps the same Markdown input to a different professional output. You write in Markdown. You choose what that Markdown becomes.

## Philosophy

- **No new syntax.** You're writing CommonMark + GFM. The structural conventions — headings, blockquotes, lists — are the same ones you're already using. They carry domain meaning when compiled; they carry structural meaning when read as plain text.
- **The output meets the standard, not an approximation.** Screenplay output is WGA-compliant. Page layout, margins, element positions, page numbering, and continuation markers are all correct — not roughly correct.
- **Language is not a constraint.** Multilingual documents — mixed scripts, non-Latin alphabets, CJK text — are first-class. This was a core requirement from the beginning.
- **Formats are composable, not monolithic.** A format defines structure. A theme defines style. Swapping a theme changes the look without touching the source. Adding a format adds a new compilation target without touching any existing one.

## What It Produces

### Screenplay

The screenplay format produces WGA-compliant output from plain Markdown, with full production-grade pagination behavior.

**Automatic MORE / CONT'D.** When a dialogue block is split across a page boundary, `(MORE)` appears at the bottom of the page and `CHARACTER NAME (CONT'D)` — with the original parenthetical, if one was present — appears at the top of the next. This is not approximated. It uses vmprint's `paginationContinuation` system, which knows exactly where the split occurs and inserts the correct markers in the correct positions.

The `@` prefix on a name inside a blockquote signals a dialogue turn. Everything that follows is dialogue. A parenthetical on the line immediately after the name is picked up automatically.

**Dual dialogue** is supported. Mark the first speaker's cue with `^` and the next blockquote becomes the right column.

**Title pages** are generated from the first `h1` and the surrounding front matter and list items. Metadata (written by, draft date, revision) and contact information are laid out in the correct positions.

**Scene numbers** can be enabled per configuration — decimal or alpha, with optional zero-padding.

**Locked pages** for production: revision labels can be appended or prepended to page numbers (`1A.`, `A1.`).

### Prose (Markdown)

The `markdown` format renders structured prose documents with typographic precision. It supports the full CommonMark + GFM surface: paragraphs, headings, blockquotes, lists (ordered, unordered, task lists), tables, fenced code blocks, and inline formatting.

Available themes/formats:

| Format/Theme | Description                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default`    | Clean, readable general-purpose document                                                                                                           |
| `academic`   | Citation markers, references section, definition lists, formal typography                                                                          |
| `literature` | Book manuscript conventions                                                                                                                        |
| `opensource` | Publication-grade open-source documentation style with title subheading (`:: ...`), print-like framed figures, and blockquote-under-image captions |

`opensource` title deck convention:

```markdown
# Main Title

:: Optional subheading line directly under the H1
```

## Architecture — For Format Authors

draft2final is a pipeline with two extension points.

```
Markdown source
      │
      ▼
 SemanticDocument       ← remark parse + normalize
      │
      ▼
  FormatModule          ← your format code lives here
      │
      ▼
  DocumentInput         ← vmprint IR (plain JSON)
      │
      ▼
  vmprint engine        → PDF
```

### Formats

A format is a TypeScript module that exports a `FormatModule`. Its job is to walk the `SemanticDocument` and emit a `DocumentInput` — the plain JSON structure that vmprint's layout engine consumes.

```ts
export const myFormat: FormatModule = {
    name: 'my-format',
    listThemes(): string[] {
        return listThemes('my-format');
    },
    createHandler(config: Record<string, unknown>): FormatHandler {
        return new MyFormat(config);
        // Handler emits blocks via FormatContext; compiler assembles DocumentInput
    },
};
```

You control what each Markdown construct maps to, what styles the resulting elements carry, and how they paginate. You're not writing pagination code — vmprint handles that. You're writing the semantic mapping: this heading is a scene heading, this blockquote is a dialogue turn, this list item is a metadata field.

Formats are registered in `src/formats/index.ts`.

### Themes and Config

A theme is a YAML file placed in `src/formats/<format-name>/themes/<theme-name>.yaml`. It provides declarative style and layout values. Behavioral options live in `src/formats/<format-name>/config.defaults.yaml` and can be overridden from frontmatter or CLI flags.

A per-theme behavioral override file can also be placed at `themes/<theme-name>.config.yaml`. It is merged after the format defaults but before document frontmatter, so user frontmatter always wins. This is how the `opensource` theme enables `:: ...` title subheadings automatically — the feature is off by default, and the theme's config sidecar turns it on without requiring frontmatter in every document.

Themes contain no code. If you know what a correctly formatted legal brief, technical report, or stage play should look like, you can write a theme without touching any TypeScript.

```yaml
# src/formats/screenplay/config.defaults.yaml
production:
    sceneNumbers:
        enabled: true
        pad: 3
        style: decimal
    lockedPages:
        enabled: true
        revisionLabel: A
        placement: suffix
```

### The SemanticDocument

The `SemanticDocument` passed to the handler is the normalized form of the parsed Markdown. Every node carries `kind`, `children`, `value` (for leaf nodes), `sourceRange`, and `sourceSyntax`. Front matter is available at `document.frontMatter`. Inline formatting — `em`, `strong`, `link`, `inlineCode` — is preserved in the child tree of each block node.

You're not parsing Markdown yourself. You receive a clean, typed, annotated document and decide what it becomes.

## Supported Input

Standard CommonMark Markdown with GFM extensions: tables, strikethrough, task lists, autolinks. YAML front matter at the top of the file is parsed and available to format modules.

```markdown
---
title: The Manuscript
author: A. Writer
date: 2025
---

# Chapter One

Body text...
```

## Quickstart

See [QUICKSTART.md](QUICKSTART.md) for install and command reference.

## Status

Version `0.1.0`. Screenplay and markdown formats are working and covered by layout regression fixtures. Additional themes and format modules for legal, technical, and stage play documents are planned.

This is pre-1.0 software. The API may change.
