# OpenSource Snapshot Baseline

:: An editorial-grade README output profile with a title deck and print-like figure plates.

This fixture validates the opensource theme output for README-style documentation pages.

![Pipeline](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl9kAAAAASUVORK5CYII= 'Pipeline frame')

> Figure 1. Deterministic flow from markdown source to engine layout boxes.

## Notes

- Blockquote directly under image should compile as figure caption.
- Image frame style should be visible in the emitted image box.

```ts
export const opensourceSignature = (pages: number): string => `oss-${pages}`;
```
