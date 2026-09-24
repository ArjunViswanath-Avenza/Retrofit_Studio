# Retrofit Studio

Compare three versions of a Temenos Infinity / Kony Visualizer (Volt MX) MVC controller
— **old base**, **customized branch**, and **new base** — and produce a validated
customization-retrofit plan.

The problem it solves: a customer (e.g. KBZ) customized a controller on top of an old
vendor base (R21); the vendor then evolved that base to a new release (R26). You need to
carry the customizations onto the new base. This is a **three-way merge with the old base
as the common ancestor** — the tool separates *genuine* logic changes from formatting noise
and classifies each one by how to retrofit it.

```
        R21  (old base = common ancestor)
        /  \
   KBZ /    \ R26
 (custom)    (new base = upgrade target)
        \    /
      R26 + KBZ   ← the retrofit you produce
```

## Quick start (no install)

1. Open **`index.html`** (or `retrofit_studio.html`) in any browser — double-click it.
2. Upload the three `.js` controllers: **Base (old)**, **Custom**, **New base** (3rd optional).
   Labels auto-fill from the filename suffix (e.g. `…_R21.js` → `R21`).
3. Click **Analyze**.

Everything — JS parsing, token-level diff, retrofit-bucket classification, widget scan —
runs **entirely in your browser**. Nothing is uploaded anywhere; no server or internet needed.

### What you get (tabs)
- **Overview** — module signatures + the list of customizations to retrofit.
- **Genuine Changes** — every real Custom-vs-Base change; click one for a 3-way diff
  (toggle Custom↔Base, New↔Base, Custom↔New). Formatting/brace/wrapping differences are ignored.
- **3-Way + Buckets** — every member with a Custom delta and its retrofit bucket (1–5).
- **Retrofit Checklist** — one row per change; fill Action / Field-remap / Other-layers /
  Risk / Status / Notes and tick **Validated**. Auto-saves to your browser; export JSON/CSV.
- **Widget Remap** — widget tokens whose presence differs across versions (flags field-index
  remaps and form-layer work).

### Retrofit buckets (deterministic candidates — confirm with a human)
1. Custom changed / New untouched → clean re-apply (low risk)
2. Custom changed / New changed same area → reconcile (conflict)
3. New already provides/matches Custom → adopt New
4. Custom-only, no New equivalent → port as net-new
5. New-only, new to Custom → keep New; check vs Custom business rules

## Advanced / scriptable path (Python, for batch or CI)

`controller_compare.py` is the same analyzer as a CLI; it emits an Excel workbook and/or a
JSON model (the `compare_viewer.html` page can load that JSON). Use it to process many
controllers headlessly.

```bash
pip install esprima jsbeautifier openpyxl
python controller_compare.py \
  --base-old  X_R21.js --custom X_KBZ.js --base-new X_R26.js \
  --out X_Comparison.xlsx --json X_data.json --labels R21 KBZ R26
```

The browser studio and the Python tool are verified to produce **identical** results.

## Repo layout
| File | Purpose |
|------|---------|
| `index.html` | Default entry point → opens the studio |
| `retrofit_studio.html` | **The tool** — upload 3 files, analyze in-browser |
| `controller_compare.py` | Same analyzer as a Python CLI (batch/CI) |
| `compare_viewer.html` | Legacy viewer that loads Python-generated JSON |
| `frmCustomerProfileEntitlementsController_*.js` | Example controller set (R21/KBZ/R26) |

## What is deterministic vs judgment
The tool fills every factual column (what changed, presence across versions, bucket
candidate, widget remap). The checklist's Action / Field-remap / Other-layers / Risk columns
are left blank by design — that is the intent/judgment layer for an engineer (or an LLM pass).
