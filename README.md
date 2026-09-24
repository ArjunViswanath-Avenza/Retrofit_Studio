# Retrofit Studio (React)

A single React app that **formats** and **compares** Temenos Infinity / Kony Visualizer
(Volt MX) MVC controllers — the whole workflow in one place, running entirely in the browser.

Upload 2–3 versions of a controller (**Base / Custom / New base**); each file is formatted to
one standard style, then compared method-by-method so only real code changes show.

## Run it

```bash
npm install
npm run dev        # dev server → http://localhost:5173
```

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
[acorn](https://github.com/acornjs/acorn) (parsing). No backend — everything runs client-side.

## Source layout
```
src/
  App.jsx                   UI: uploader + tabbed report
  App.css                   styles
  lib/analyzer.js           format + parse + diff + bucket classification
  components/DiffView.jsx    2-column and 3-column diff tables
  components/Checklist.jsx   retrofit checklist (localStorage + export)
```
