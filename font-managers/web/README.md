# @vmprint/web-fonts

Browser-first font manager for vmprint. It keeps the standard `FontManager` contract, but assumes font binaries come from URLs, data URIs, or a remote font catalog rather than the local filesystem.

## What It Solves

`WebFontManager` is for environments where the engine still needs real font bytes for deterministic measurement, but the fonts live behind HTTP rather than on disk:

- browser apps
- edge runtimes
- static HTML / SVG pipelines
- hosted demos and previewers

It supports:

- explicit `FontConfig[]` registries
- family alias resolution
- lazy font-byte loading via `fetch()`
- request deduplication for concurrent loads
- in-memory caching
- optional IndexedDB persistence in browsers
- async bootstrap from a remote JSON catalog

## Usage

```ts
import { createEngineRuntime } from '@vmprint/engine';
import { WebFontManager } from '@vmprint/web-fonts';

const fontManager = new WebFontManager({
  repositoryBaseUrl: 'https://cdn.example.com/fonts/',
  fonts: [
    {
      name: 'My Sans Regular',
      family: 'My Sans',
      weight: 400,
      style: 'normal',
      src: 'my-sans/MySans-Regular.ttf',
      enabled: true,
      fallback: false
    }
  ],
  cache: true
});

const runtime = createEngineRuntime({ fontManager });
```

## Remote Catalogs

The engine needs font metadata synchronously, so a remote catalog has to be loaded *before* the manager is handed to `createEngineRuntime()`. `WebFontManager.fromCatalogUrl()` handles that bootstrap step:

```ts
const fontManager = await WebFontManager.fromCatalogUrl(
  'https://cdn.example.com/fonts/catalog.json',
  { cache: true }
);
```

Catalog shape:

```json
{
  "repositoryBaseUrl": "https://cdn.example.com/fonts/",
  "aliases": {
    "arial": "Arimo",
    "times new roman": "Tinos"
  },
  "fonts": [
    {
      "name": "Arimo Regular",
      "family": "Arimo",
      "weight": 400,
      "style": "normal",
      "src": "Arimo/Arimo-Regular.ttf",
      "enabled": true,
      "fallback": false
    }
  ]
}
```

`repositoryBaseUrl` is optional. If omitted, `fromCatalogUrl()` derives it from the catalog URL and resolves relative `src` entries against that base.

## Error Model

`WebFontManager` distinguishes between two kinds of failure:

- registry/config problems: the requested family or variant is missing from the registry
- transport problems: the font was declared, but its URL failed, timed out, or returned an empty body

Transport failures surface as source-specific errors from `loadFontBuffer()`, preserving the current vmprint fail-fast behavior.

---

Licensed under the [Apache License 2.0](LICENSE).
