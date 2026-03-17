# Spatial IR Fixtures

`generate-spatial-ir-fixtures.ts` converts the AST regression fixtures in this directory into sibling `.spatial-ir.json` files here.

The generated files are intentionally provisional:

- They preserve current fixture semantics as explicitly as possible.
- They include a few temporary fields where the draft Spatial IR spec is still underspecified for current engine behavior.
- They are meant to be reviewed alongside the source AST fixtures and existing layout snapshots.

Run from the repo root:

```bash
npx tsx engine/tests/fixtures/regression/generate-spatial-ir-fixtures.ts
```
