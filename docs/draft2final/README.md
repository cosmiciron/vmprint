# draft2final User Guide

`draft2final` is for people who want their writing to look finished.

You do not need to set up a complicated publishing workflow first. You do not need frontmatter to get started. You can take any Markdown file you already have and render it through any supported transmuter directly from the command line.

For example:

```bash
draft2final my-draft.md --using mkd-manuscript --out my-draft.pdf
draft2final notes.md --using mkd-mkd --out notes.pdf
draft2final scene.md --using mkd-screenplay --out scene.pdf
draft2final article.md --using mkd-academic --out article.pdf
```

That is the simplest mental model:

1. Bring a Markdown file
2. Choose the kind of finished document you want
3. Get a polished PDF

## Start Here

If you want `draft2final` available as a normal command:

```bash
npm install -g @draft2final/cli
```

Then check that it works:

```bash
draft2final --help
```

If you just run:

```bash
draft2final
```

you will get a short welcome screen with a few useful commands and a link to the guide.

If you prefer not to install globally:

```bash
npx @draft2final/cli --help
```

If you want examples to build from, see the starter sample folder: [samples/README.md](./samples/README.md)

If you want a ready-made starting file instead of a blank page, you can ask the CLI to create one directly:

```bash
draft2final --init my-manuscript.md --using mkd-manuscript
draft2final --init my-screenplay.md --using mkd-screenplay
```

The path you pass is the file it writes. It does not create a project subdirectory first.

## If You Already Have Writing

This is a good fit if you already have drafts in Word, Google Docs, Notion, Obsidian, or old Markdown files and you are tired of reformatting them by hand.

The easiest way in is not a full migration. It is this:

1. Take one real piece of writing
2. Move it into Markdown
3. Run it through the output style you need
4. See whether the result feels closer to what you want to send out into the world

You can always add frontmatter later if you want a file to remember its preferred output style. It is optional, not required.

## If You Are Starting Fresh

Starting from scratch can be even easier, because you do not have to unlearn old formatting habits.

Here is a tiny example:

```md
## Chapter One

By the time Mara reached the market, the lanterns were already lit and the fishmongers were shouting over the rain.

She had come for ink.
She left with a brass key, a warning, and the feeling that somebody had recognized her.
```

Render it as a manuscript:

```bash
draft2final moonlit-market.md --using mkd-manuscript --out moonlit-market.pdf
```

No frontmatter needed.

## Choose the Shape of the Finished Work

Think of the transmuter as the answer to one question:

"What kind of document am I trying to make?"

- `mkd-manuscript` for novels, memoir, short fiction, and long prose
- `mkd-screenplay` for scripts and scene-driven writing
- `mkd-mkd` for clean general documents, handbooks, notes, and technical writing
- `mkd-academic` for papers and formal academic drafts
- `mkd-literature` for more literary reading-oriented layouts

If you are not sure, start here:

- fiction or narrative prose: `mkd-manuscript`
- script: `mkd-screenplay`
- almost anything else: `mkd-mkd`

## What You Actually Type

Two common questions are:

- "What does manuscript Markdown look like?"
- "What does screenplay Markdown look like?"

Here are a few simple examples.

### Manuscript Example

For a manuscript, chapter headings are level-2 headings:

```md
## Chapter One

The train came in under rain and smoke.

Mira stood on the platform with one suitcase and a letter she had not yet opened.

## Chapter Two

By morning, the station had become a town of rumors.
```

If you want a visible scene-break label, smaller headings become scene breaks:

```md
### Three Days Later

The harbor was empty by sunrise.
```

If you want the default manuscript scene-break marker, use a horizontal rule:

```md
The lamps went dark one by one.

---

When she woke, the sea was gone.
```

That is enough for many novelists and memoir writers: chapter names, paragraphs, and occasional scene breaks.

### Screenplay Example

For screenplays, scene headings are recognized either as level-2 headings or as plain lines beginning with `INT.`, `EXT.`, `INT/EXT.`, or `EST.`. Dialogue turns are written as blockquotes with an `@CHARACTER` cue.

```md
## INT. BUILD ROOM - NIGHT

Rows of monitors. One progress bar. No mercy.

> @NOVA
> (low)
> If pagination slips, we lose the morning.

> @RHEA
> Then we do not slip.

The printer wakes up like a jet engine.
```

That gives you the basic rhythm of a screenplay page:

- scene heading
- action line
- dialogue block
- optional parenthetical
- more action

If you can type those clearly in Markdown, you can start writing.

## Cheat Sheet

These are the syntax forms verified against the current `mkd-manuscript` and `mkd-screenplay` transmuters.

### Manuscript Cheat Sheet

| What you want | Write this |
|---|---|
| First title / cover title | `# The Last Orchard` |
| Chapter heading | `## Chapter One` |
| Labeled scene break | `### Three Days Later` |
| Default scene break symbol | `---` |
| Normal body paragraph | plain paragraph text |
| Indented quotation / extract | `> Quoted text` |
| Poem block | blockquote starting with `[poem]` |
| Lyrics block | blockquote starting with `[lyrics]` |
| Epigraph block | blockquote starting with `[epigraph]` |
| Literary extract block | fenced code block with language `extract` |

Examples:

```md
# The Last Orchard

## Chapter One

The train came in under rain and smoke.

### Three Days Later

The harbor was empty by sunrise.

---

> [epigraph]
> We were all looking for a door.
> -- Ada Vale
```

If a `# Title` is followed immediately by a bullet list, manuscript mode also reads that list as cover-page fields such as `author:`, `address:`, `phone:`, `email:`, `word-count:`, `byline:`, `agent:`, and `rights:`.

### Screenplay Cheat Sheet

| What you want | Write this |
|---|---|
| Title page title | `# LAST TRAIN TO ORBIT` |
| Title page metadata/contact | bullet list immediately after `# Title` |
| Scene heading | `## INT. PLATFORM - NIGHT` or a plain paragraph starting with `INT.`, `EXT.`, `INT/EXT.`, or `EST.` |
| Action | plain paragraph text |
| Dialogue turn | blockquote with first line `@CHARACTER` |
| Parenthetical | second line inside that same blockquote, starting with `(` |
| Transition | `### CUT TO:` or a plain all-caps paragraph ending with `:` |
| Beat | `---` |
| Dual dialogue | two consecutive dialogue blockquotes whose cue line ends in `^` |

Examples:

```md
# LAST TRAIN TO ORBIT

- Written by J. Mercer
- Contact: jmercer@example.com

## INT. PLATFORM 9 - NIGHT

Wind tears through the station.

> @ELIAS
> If we miss this one, we wait six months.

> @RIN
> Then we do not miss it.

### CUT TO:

---
```

Dual dialogue example:

```md
> @ELIAS ^
> Go now.

> @RIN ^
> I know.
```

## A Few Real-Life Uses

Novel draft:

```bash
draft2final orchard.md --using mkd-manuscript --out orchard.pdf
```

Screenplay scene:

```bash
draft2final last-train.md --using mkd-screenplay --out last-train.pdf
```

Technical guide:

```bash
draft2final greenhouse-notes.md --using mkd-mkd --out greenhouse-notes.pdf
```

Academic paper:

```bash
draft2final ritual-paper.md --using mkd-academic --out ritual-paper.pdf
```

The same source-writing habit can serve very different finished forms.

## About Frontmatter

Frontmatter is there for convenience, not as a gatekeeper.

If you want a file to remember things like title, theme, or preferred transmuter, frontmatter is useful. But if you just want to take a Markdown file and turn it into a polished document, you can do that entirely from the command line.

That is especially helpful when:

- you are testing old writing quickly
- you are comparing different output styles
- you are migrating a large folder of existing documents

## Themes

Themes let you change the look of a document without rewriting the document itself.

This is especially useful with `mkd-mkd`, where the same guide, handbook, or essay might need a different feel depending on where it is going.

For example:

```bash
draft2final notes.md --using mkd-mkd --theme opensource --out notes.pdf
draft2final notes.md --using mkd-mkd --theme novel --out notes.novel.pdf
```

That means you can keep one Markdown source file and try different presentation styles without making a second copy of the writing.

`draft2final` also accepts a custom theme file path if you want to supply your own YAML theme later:

```bash
draft2final notes.md --using mkd-mkd --theme ./my-theme.yaml --out notes.pdf
```

For most people, the easiest place to start is a named theme on `mkd-mkd`, then only move to custom theme files if you have a specific house style or brand look to match.

## Multilingual Writing

If your work includes more than one language, `draft2final` is built for that.

You can mix English with Arabic, Hindi, Chinese, Japanese, Korean, Hebrew, Thai, and many other scripts without manually assembling a font setup first. When broader script coverage is needed, `draft2final` can fetch the right fallback fonts just in time and keep them cached locally for later renders.

For writers and academics, the practical meaning is simple: multilingual writing should not turn into a font emergency.

## A Good First Week

1. Install `draft2final`
2. Choose one real piece of writing
3. Render it with the transmuter that matches your goal
4. Make small edits to the writing
5. Render again
6. Try one other transmuter if you want to compare presentation

That is enough to tell whether this workflow fits you.

## Samples

If you want starting points instead of blank pages, see the starter sample folder: [samples/README.md](./samples/README.md)

It currently includes copyable manuscript and screenplay source files.

## Related Files

- Starter sample folder: [samples/README.md](./samples/README.md)
- Developer-oriented package docs: [`draft2final/README.md`](../../draft2final/README.md)
