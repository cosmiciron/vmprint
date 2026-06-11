# @vmprint/transmuter-dev

Small developer CLI for rapid testing of local transmuters and theme/config YAML files inside the `vmprint-transmuters` workspace.

## Usage

```bash
npm run dev:transmute -- sample.md --as mkd-mkd --out sample.pdf
```

Use a local transmuter module directly:

```bash
npm run dev:transmute -- sample.md --transmuter ./mkd-mkd/src/index.ts --theme ./theme.yaml --out out.json
```

## Notes

- `.json` output writes the transmuted `DocumentInput`.
- `.pdf` output renders through VMPrint directly.
- Relative image paths are resolved from the markdown file location.
