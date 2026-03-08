# draft2final (Transmuter-First CLI)

Thin transmuter-first CLI wrapper that compiles source files to VMPrint `DocumentInput` via a selected transmuter, then renders PDF through VMPrint engine + PDF context.

## Tutorial

Want a follow-along guide that walks through tech manual, screenplay, manuscript, and remix examples?

- See [TUTORIAL.md](./TUTORIAL.md)

## Usage

```bash
draft2final input.md --using mkd-mkd
draft2final screenplay.md --using mkd-screenplay --out screenplay.pdf
draft2final screenplay.md --using mkd-screenplay --out screenplay.ast.json
draft2final manuscript.md --using mkd-manuscript --config my.config.yaml --theme my.theme.yaml
draft2final manuscript.md --using mkd-manuscript --theme classic
```

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


