# 🚀 VMPrint / Draft2Final 0.3.0: The Global JIT Typesetting Release

We are incredibly excited to announce version 0.3.0 of VMPrint and Draft2Final. This release transforms the tooling from a developer-centric layout engine into a highly polished, production-ready, globally aware application for writers and publishers.

Draft2Final is no longer just a wrapper—it is now a **zero-dependency, standalone CLI** that instantly provides publication-grade PDF compilation.

## 🌟 Highlights

### 🌍 Global "Just-In-Time" Typesetting
We built Draft2Final to give developers and writers absolute typographic control without bloat. The biggest challenge with global language support is file size: a full set of high-quality CJK fonts can exceed 60MB. 

In `0.3.0`, we solved this with the **JIT Downloader**:
* **Tiny Core:** The CLI is now distributed as a standalone 4.4MB binary, bundling only a lightweight "Latin Pack" of core fonts (Caladea, Cousine, Arimo) and PDF metrics for instant offline rendering.
* **Intelligent Pruning:** The layout engine deeply analyzes your Document AST before rendering. If it detects Chinese, Japanese, Hebrew, Arabic, Thai, or Indic scripts, it dynamically disables unused fallbacks and *only* fetches what your document requires.
* **Auto-Downloading:** The required scripts are securely downloaded from a high-speed CDN, displayed in the CLI via a buttery-smooth concurrent progress tracker, and permanently cached in your local `~/.vmprint/fonts/` folder.

You get world-class global typography, on-demand, without bloating your hard drive or the repository.

### ⚡ Zero-Dependency Standalone CLI
Installing Draft2Final is now faster and more reliable than ever. We've replaced the sprawling monorepo NPM dependencies with a single, highly-optimized `tsup` bundle. It just works.

### 🏗️ Instant Project Scaffolding
Starting a new book or screenplay? We added an initialization command to get you running immediately without memorizing YAML configs:
```bash
draft2final --init my-new-book
cd my-new-book
draft2final document.md --config config.yaml --theme theme.yaml
```

## 🛠️ Fixes and Polish
* **Smarter Fallbacks:** We fixed an issue where standard English punctuation (like the em-dash) would accidentally trigger the download of 10MB Chinese fonts.
* **Beautiful Terminal Output:** Enjoy precise timing reports and a flicker-free concurrent download UI.
* **Lean Open-Source Repo:** We extracted 50MB+ of binary fonts from the core repository into a dedicated `assets` branch, keeping `git clone` times lightning fast for new contributors.

## Install It Today

```bash
npm install -g @draft2final/cli
```

*Write in plaintext. Compile to perfection. Welcome to Draft2Final.*
