---
as: academic
links:
  mode: citation
references:
  heading: References
footnotes:
  heading: Footnotes
typography:
  smartQuotes: true
---

# Sample Paper

:: Demonstrating the academic transmuter tags

## Abstract

This sample includes citations, structured headings, theorem-like code blocks, tables, and notes [Prior Work](https://example.com/prior-work).[^abs]

## Introduction

Academic prose renders as regular paragraphs, while links are collected into a references section by default [Survey](https://example.com/survey).

### Contributions

1. It shows the core markdown tags.
2. It shows academic-specific code fence styles.

```theorem
If the sample uses the supported tags, the rendered output demonstrates the format clearly.
```

```lemma
Small claims can be styled separately from full theorems.
```

```proof
Proof-style blocks are useful for arguments, derivations, and methodological notes.
```

```example
Examples can be called out with their own display treatment.
```

> Standard block quotes are also supported for excerpted prose.

| Metric | Control | Variant |
| --- | ---: | ---: |
| Precision | 0.73 | 0.81 |
| Recall | 0.69 | 0.79 |

![Figure frame marker](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9sAAAAASUVORK5CYII=)

Figure 1 A self-contained image example.

## Terms

Corpus
: The set of documents used in the experiment.

Baseline
: The comparison system used for evaluation.

[^abs]: Footnotes remain available even when links are handled as citations.
