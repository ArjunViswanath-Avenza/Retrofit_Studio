# Retrofit Studio (React)

A React app for the Temenos Infinity / Kony Visualizer (Volt MX) R21 → R26 upgrade: it compares
the base, customised and new-release projects (forms, controllers, MVC extensions, user widgets,
segment templates, Fabric exports), explores one project (Visualize, Blueprint, Observatory) and
converts a monolith into micro apps.

## Run it

```bash
npm install
npm run dev        # dev server → http://localhost:5173
```

Run it with the dev server: it also hosts the local services — the **file service** (opens project
folders by path, reads them in batches and keeps them in memory; `RETROFIT_CACHE_MB` sets the
budget, default 1500), the jar decompiler and the Converter's writer. They answer only on localhost.

## Using it

1. **Projects** — load each folder once: base, customised and new-release Visualizer projects
   (a monolith, or the R26 micro-app folder), a spare project, and up to three Fabric exports.
   Paste a folder's path to open it through the file service (fast, and reopened after a reload),
   or choose it with the browser's folder picker.
2. **Compare · Explore · Convert** — every tool works from the loaded folders. Page addresses
   (`#/ma/segs?item=…`) work with Back / Forward and bookmarks; **Ctrl+K** searches every tool,
   page, form, controller, component and template; **⏱** shows how long each step took.

Production build:

```bash
npm run build      # outputs static files to dist/  (host anywhere, no server code)
npm run preview    # preview the built app
```

## What it does

1. **Format** — every file is run through **js-beautify** with fixed rules:
   K&R braces (`if () {` … `} else {`), `key: value` spacing, and **no line wrapping**
   (long lines stay on one line). Line endings are normalised, so CRLF vs LF never causes
   false diffs.
2. **Parse** — methods/fields of the `define({…})` object are extracted with **acorn**
   (a real JS parser — handles regex literals, template strings, etc.).
3. **Compare** — genuine changes are detected on comment-stripped code (comment-only edits
   don't count), and shown as clean side-by-side diffs.

### Tabs
- **Overview** — module signatures + the customisations to retrofit.
- **Genuine Changes** — per-method changes; pick a version pair (**Base vs Custom**,
  **Base vs New**, **Custom vs New**) or **All 3** (3-column view). Each column keeps its own
  line numbers; only real changes are highlighted (green = added, red = removed, amber = base
  line changed in a branch).
- **3-Way + Buckets** — every changed member and its retrofit bucket (1–5).
- **Retrofit Checklist** — one row per change; fill Action / Field-remap / Other-layers /
  Risk / Status / Notes and tick **Validated**. Auto-saves to your browser; export JSON/CSV.
- **Widget Remap** — widget tokens whose presence differs across versions (flags field-index
  remaps and form-layer work).

### Retrofit buckets (deterministic candidates — confirm with a human)
1. Custom changed / New untouched → clean re-apply
2. Custom changed / New changed same area → reconcile (conflict)
3. New already matches Custom → adopt New
4. Custom-only, no New equivalent → port as net-new
5. New-only, new to Custom → keep New; check vs Custom business rules

## Stack
React + Vite · [js-beautify](https://github.com/beautifier/js-beautify) (formatting) ·
[acorn](https://github.com/acornjs/acorn) (parsing). Comparisons run in the browser; the dev
server adds local services (`server/`).

## Source layout
```
src/
  App.jsx                   top bar, areas, page addresses; each tool loads when first opened
  app/                      the frame: projects store + Projects page, tool list and menus,
                            sidebar shell, search (Ctrl+K), timings panel, progressive lists
  tools/                    one module per tool (Compare ×3, Visualize, Blueprint, Observatory, Converter)
  components/               the tools' views (FormForge, TemplateTwin, COMP-are, LoomSync, …)
  lib/                      analysis (analyzer, forms, segments, microapps, fabric, …),
                            jobs.js (foreground / background queue), perf.js, localfs.js
server/
  files.js                  local file service: open by path, batched reads, in-memory cache
  decompiler.js             Vineflower jar decompiler
  writer.js                 Converter file writer
```
