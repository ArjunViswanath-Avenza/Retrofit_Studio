# Controller Retrofit Toolkit

Compare three versions of a Temenos/Kony MVC controller (old base, customized, new base)
and produce a validated retrofit plan.

## Easiest: `retrofit_studio.html`  (no Python, no setup)
Open **`retrofit_studio.html`** in any browser, **upload the three `.js` files** (Base/old,
Custom, New base), set the labels (auto-guessed from the filename suffix, e.g. `_R21`), and
click **Analyze**. Everything — JS parsing, token-level diff, bucket classification, widget
scan — runs **in the browser**; nothing is uploaded anywhere. Same output as the Python path:
Overview, Genuine Changes with 3-way diffs, 3-Way + Buckets, editable Retrofit Checklist
(auto-saved, export JSON/CSV), Widget Remap. Verified to match the Python analyzer exactly.

## Scriptable path (for batch / CI): `controller_compare.py` + `compare_viewer.html`
1. **`controller_compare.py`** — deterministic Python analyzer (no LLM). Parses each file
   with a real JS parser (esprima), diffs at the **token level** (formatting/braces/wrapping
   ignored), and emits an Excel workbook and/or a JSON model.
2. **`compare_viewer.html`** — offline HTML frontend that loads that JSON (Load JSON… button).

## Install (once)
```
pip install esprima jsbeautifier openpyxl
```

## Run the analyzer
```
python controller_compare.py \
  --base-old  frmXController_R21.js \
  --custom    frmXController_KBZ.js \
  --base-new  frmXController_R26.js \
  --out       frmXController_Comparison.xlsx \
  --json      frmXController_data.json \
  --labels    R21 KBZ R26
```
- `--base-new` is optional (omit for a 2-way old-vs-custom comparison).
- Provide `--out` (Excel), `--json` (for the viewer), or both.

## Open the viewer
Open `compare_viewer.html` in any browser, click **Load JSON…**, and pick the
`*_data.json` you generated (drag & drop also works). No server or internet needed.

Tabs:
- **Overview** — module signatures + the list of customizations to retrofit.
- **Genuine Changes** — every real CUSTOM-vs-OLD change; click one for a 3-way diff
  (toggle CUSTOM↔OLD, NEW↔OLD, CUSTOM↔NEW).
- **3-Way + Buckets** — every member with a CUSTOM delta and its deterministic retrofit
  bucket (1–5).
- **Retrofit Checklist** — one row per change; fill Action / Field-remap / Other-layers /
  Risk / Status / Notes and tick **Validated**. Saves to your browser; export JSON/CSV.
- **Widget Remap** — widget tokens whose presence differs across versions (flags
  field-index remaps and form-layer work).

## Retrofit buckets (candidates — confirm with a human)
1. CUSTOM changed / NEW untouched  → clean re-apply (low risk)
2. CUSTOM changed / NEW changed same area → reconcile (conflict)
3. NEW already provides/matches CUSTOM → adopt NEW
4. CUSTOM-only, no NEW equivalent → port as net-new
5. NEW-only, new to CUSTOM → keep NEW; check vs CUSTOM business rules

## What is deterministic vs judgment
The tool fills every factual column (what changed, presence, bucket candidate, widget
remap). The checklist's Action / Field-remap / Other-layers / Risk columns are left blank
by design — that is the intent/judgment layer for an engineer (or an LLM pass).
