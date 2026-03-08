---
format: markdown
typography:
  smartQuotes: false
dropCap:
  openingParagraph:
    enabled: true
    lines: 4
    gap: 6
    characterStyle:
      fontFamily: Caladea
      fontWeight: 700
      color: "#1f3550"
---

# draft2final For Humans: A Friendly Tutorial

You write in plain Markdown. `draft2final` helps that writing become real, polished documents fast, and this guide is for writers, directors, researchers, students, and anyone who wants clean output without wrestling complex layout tools.

## Who This Is For

- Novelist: You want to stay in writing flow, then generate manuscript-ready output without format panic.
- Screenwriter or director: You want plain-text drafting speed and screenplay-style output when it is time to share.
- Student or academic: You want to focus on argument and structure first, then produce clean, professional documents on demand.

Before tools like this, many people did the same painful dance:

- Write in one place
- Reformat by hand in another
- Lose hours fixing layout details
- Stress about submission rules and avoidable rejections

Now the workflow can be:

- Focus on ideas first
- Keep writing in plain text
- Generate the right format on demand

In one sitting, you will:

1. Write a technical manual
2. Write a screenplay
3. Write a manuscript
4. Remix formats for fun (and insight)

You can copy and paste every command.

## First, One Minute Setup

From repo root:

```bash
npm install
npm run build
```

What you should see:

- Build output for workspaces, including `draft2final`

If you installed the CLI globally (or from npm), this should work:

```bash
draft2final --help
```

Create a folder for this tutorial:

```bash
mkdir -p samples/tutorial
```

PowerShell alternative:

```powershell
New-Item -ItemType Directory -Force -Path samples/tutorial
```

## Part 1: Make a Technical Manual

Create `samples/tutorial/tech-manual.md`:

```md
---
title: "VMPrint Field Manual"
author: "Alex Typesetter"
---

# VMPrint Field Manual

## Why this exists

People do serious work under pressure. Good docs reduce panic.

## Install Checklist

1. Install Node.js 18+
2. Run `npm install`
3. Run `npm run build`

## Fast Recovery Rules

- Commit before risky changes
- Keep snapshots current
- If layout shifts, inspect AST JSON first

## One command to render

`draft2final input.md --using mkd-mkd --out output.pdf`
```

Render it:

```bash
draft2final samples/tutorial/tech-manual.md --using mkd-mkd --out samples/tutorial/tech-manual.pdf
```

What you should see:

- A line like `[draft2final] Wrote ...tech-manual.pdf`
- A new PDF at `samples/tutorial/tech-manual.pdf`

Now try style variants:

```bash
draft2final samples/tutorial/tech-manual.md --using mkd-mkd --theme novel --out samples/tutorial/tech-manual.novel.pdf
```

```bash
draft2final samples/tutorial/tech-manual.md --using mkd-mkd --theme opensource --out samples/tutorial/tech-manual.opensource.pdf
```

Same words. Different personality.

This is one of the big unlocks: you can keep the content stable and change presentation per audience.

## Part 2: Make a Screenplay

Create `samples/tutorial/screenplay.md`:

```md
---
title: "THE LAYOUT HEIST"
author: "A. Typesetter"
---

INT. BUILD ROOM - NIGHT

Rows of monitors. One progress bar. No mercy.

NOVA
(low)
If pagination slips, we lose the morning.

RHEA
Then we don't slip.

The printer wakes up like a jet engine.

NOVA
Print it.
```

Render it:

```bash
draft2final samples/tutorial/screenplay.md --using mkd-screenplay --out samples/tutorial/screenplay.pdf
```

What you should see:

- A new screenplay PDF at `samples/tutorial/screenplay.pdf`

If you are a filmmaker, this is the fun moment: plain text in, screenplay energy out.

## Part 3: Make a Manuscript

Create `samples/tutorial/manuscript.md`:

```md
---
title: "The Last Typesetter"
author: "Alex Writer"
---

Chapter One

The cursor blinked in the dark room like it knew a secret.

Mira wrote one sentence, then another, then one she almost deleted.
She kept it. It was not perfect, but it was true.
```

Render default manuscript:

```bash
draft2final samples/tutorial/manuscript.md --using mkd-manuscript --out samples/tutorial/manuscript.default.pdf
```

What you should see:

- A manuscript-style PDF at `samples/tutorial/manuscript.default.pdf`

Render classic manuscript:

```bash
draft2final samples/tutorial/manuscript.md --using mkd-manuscript --theme classic --out samples/tutorial/manuscript.classic.pdf
```

Now you have a writer-friendly workflow without giving up plain Markdown.

For writers, this is the relief point: you can stay in creative mode and still deliver industry-shaped output when it counts.

## Part 4: Remix Mode (Because We Can)

This is where people realize the bigger idea.

Technical manual as screenplay:

```bash
draft2final samples/tutorial/tech-manual.md --using mkd-screenplay --out samples/tutorial/tech-manual.as-screenplay.pdf
```

Screenplay as manuscript:

```bash
draft2final samples/tutorial/screenplay.md --using mkd-manuscript --out samples/tutorial/screenplay.as-manuscript.pdf
```

Manuscript as opensource-style markdown:

```bash
draft2final samples/tutorial/manuscript.md --using mkd-mkd --theme opensource --out samples/tutorial/manuscript.as-opensource.pdf
```

It is a little ridiculous. It is also genuinely useful when exploring tone and presentation quickly.

It also proves the core concept: source and output style do not have to be trapped together.

## Part 5: Peek Under the Hood (Optional)

Want the transmuted document structure instead of a PDF?

```bash
draft2final samples/tutorial/tech-manual.md --using mkd-mkd --out samples/tutorial/tech-manual.ast.json
```

If output ends with `.json`, `draft2final` writes VMPrint `DocumentInput` AST JSON.

## Part 6: Let Frontmatter Do the Work

Add this to the top of any `.md` file:

```md
---
using: mkd-manuscript
theme: classic
---
```

Then run:

```bash
draft2final samples/tutorial/manuscript.md --out samples/tutorial/manuscript.auto.pdf
```

No `--using` needed.

What you should see:

- `draft2final` infers the transmuter from frontmatter and writes the PDF

## Quick Mental Model

- You write Markdown
- A transmuter interprets intent (`mkd-mkd`, `mkd-screenplay`, `mkd-manuscript`, etc.)
- `draft2final` renders polished output

Same source. Different destination.

This is the promise: write once, publish many ways.

## Where Theme and Config Files Live

- Default config: `draft2final/config/<using>.config.yaml`
- Named themes: `draft2final/themes/<using>/<name>.yaml`
- You can pass file paths directly with `--config` and `--theme`

## Try This Next

1. Pick one real piece of your writing and generate 3 output styles.
2. Share all 3 PDFs with a collaborator and ask which feels right for the audience.
3. Keep writing in plain Markdown and stop worrying about format lock-in.

If this tutorial saved you from one "wrong format" submission scare, it already paid for itself.
