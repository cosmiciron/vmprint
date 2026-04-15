# Shared Engine Workflow

`vmprint` remains a fully usable standalone repository.

You do not need sibling repos such as `vmcanvas` or `vmprint-engine-shared`
in order to build, test, or develop VMPrint itself.

This document only matters for maintainers working in the broader multi-repo
shared-engine workflow.

## Standalone Use

If you cloned only `vmprint`, you can ignore the shared-engine workflow and
work in this repo normally.

Typical standalone work includes:

- CLI changes
- print/bootstrap/runtime behavior
- font-management behavior
- VMPrint-specific renderer behavior
- ordinary bug fixes and maintenance inside this repo

## Maintainer Workflow

When working across the full local workspace:

- `vmprint-engine-shared` is the source of truth for the shared neutral engine kernel
- `vmcanvas` is currently the primary active product repo
- `vmprint` pulls in shared-core changes when it should catch up

## What To Edit Where

- Print/bootstrap/renderer/font-management behavior: edit `vmprint`
- Shared layout/runtime/text/simulation kernel logic: edit `vmprint-engine-shared`
- Browser/product behavior: edit `vmcanvas`

## Important Rule

Do not treat `vmprint/engine/src` as the permanent origin for shared-kernel
changes unless you immediately promote them back into `vmprint-engine-shared`.

The preferred flow is:

1. change shared kernel code in `vmprint-engine-shared`
2. sync into `vmcanvas` and verify there
3. sync into `vmprint` when this repo should catch up

## Optional Sync Commands

Pull the current shared snapshot into this repo:

```bash
npm run sync:shared-engine
```

Check whether this repo matches the current shared snapshot:

```bash
npm run sync:shared-engine:check
```

These commands are only relevant if the sibling shared repo exists locally.
