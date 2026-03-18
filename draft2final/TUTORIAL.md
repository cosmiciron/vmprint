# draft2final Tutorial

This short tutorial is the practical companion to `draft2final/README.md`.

## 1. Create a Starter File

```bash
draft2final --new story.md --as manuscript
```

## 2. Render a PDF

```bash
draft2final story.md --as manuscript
```

## 3. Prepare an Existing Markdown File

```bash
draft2final --prepare story.md --as manuscript
```

## 4. Switch Forms

```bash
draft2final script.md --as screenplay
draft2final paper.md --as academic
draft2final poems.md --as literature
```

## 5. Emit AST Instead of PDF

```bash
draft2final story.md --as manuscript --out story.json
```

For the full CLI surface and options, see [README.md](README.md).
