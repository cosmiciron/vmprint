# Layout Snapshot Baseline

This fixture is intentionally stable and should only change when we accept a deliberate layout update.

Primary evidence includes **bold emphasis**, _italic rhythm_, and inline `code` spans with a source [reference](https://example.com/reference).

- [x] Freeze parser and semantic output.
- [ ] Confirm visual regression snapshots before release.

1. Build the document IR.
2. Paginate to renderer-ready pages.
3. Compare against committed layout snapshots.

> Deterministic layout is part of product behavior.
>
> Snapshot drift must be explicit and reviewed.

---

```ts
export const layoutSignature = (pageCount: number, boxCount: number): string => `${pageCount}:${boxCount}`;
```
