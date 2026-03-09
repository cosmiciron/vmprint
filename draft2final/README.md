# draft2final (Transmuter-First CLI)

Thin transmuter-first CLI wrapper that compiles source files to VMPrint `DocumentInput` via a selected transmuter, then renders PDF through VMPrint engine + PDF context.

## Usage

```bash
draft2final
draft2final --guide
draft2final --init my-manuscript.md --using mkd-manuscript
draft2final --init my-screenplay.md --using mkd-screenplay
draft2final input.md --using mkd-mkd
draft2final screenplay.md --using mkd-screenplay --out screenplay.pdf
draft2final screenplay.md --using mkd-screenplay --out screenplay.ast.json
draft2final manuscript.md --using mkd-manuscript --config my.config.yaml --theme my.theme.yaml
draft2final manuscript.md --using mkd-manuscript --theme classic
```

With no arguments, `draft2final` shows a short welcome screen with example commands and a link to the guide.

`--init <file.md>` writes a starter Markdown file at the exact path you pass. For `mkd-manuscript` and `mkd-screenplay`, it uses built-in starter templates drawn from those transmuters.

`--out` determines output mode by extension:

- `.pdf` => render PDF
- `.json` => write transmuted AST (`DocumentInput`) JSON

`--using` is optional when frontmatter includes one of:

- `using: mkd-*`
- `transmuter: mkd-*`
- `format: markdown|academic|literature|manuscript|screenplay`

`--theme` accepts either:

- a file path to YAML, or
- a theme name resolved from `themes/<using>/<name>.yaml` (or `.yml`)

Frontmatter `theme:` uses the same resolution behavior.

`--guide` opens the user guide on GitHub.

## Default Config Files

`draft2final` auto-loads a user-editable config file from:

```text
config/<using>.config.yaml
```

For example:

- `config/mkd-mkd.config.yaml`
- `config/mkd-literature.config.yaml`
- `config/mkd-screenplay.config.yaml`

Use `--config` to override that path explicitly.

## CLI Surface Policy

This CLI intentionally does not expose legacy monolith-era flags like:

- `--cover-page` (manuscript behavior belongs in frontmatter/config)
- `--debug`
- `--overlay`
- `--ast` (replaced by `--out <file>.json`)


