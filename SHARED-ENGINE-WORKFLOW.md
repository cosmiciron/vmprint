# Shared Engine Workflow

This repo now follows a `vmcanvas`-first development posture.

## Roles

- `vmprint-engine-shared` is the source of truth for the shared neutral engine kernel
- `vmcanvas` is the primary active product repo
- `vmprint` is updated when shared-core changes need to be pulled in here

## What To Edit Where

- Shared layout/runtime/text/simulation kernel logic: edit `vmprint-engine-shared`
- Browser/product behavior: edit `vmcanvas`
- Print/bootstrap/renderer/font-management behavior: edit `vmprint`

## Important Rule

Do not treat `vmprint/engine/src` as the place to originate shared-kernel
changes unless you immediately promote them back into `vmprint-engine-shared`.

The preferred flow is:

1. change shared kernel code in `vmprint-engine-shared`
2. sync into `vmcanvas` and verify there
3. sync into `vmprint` when this repo should catch up

## Sync Commands

Pull the current shared snapshot into this repo:

```bash
npm run sync:shared-engine
```

Check whether this repo matches the current shared snapshot:

```bash
npm run sync:shared-engine:check
```
