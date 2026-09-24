# Retrofit Studio

Compare three versions of a Temenos Infinity / Kony Visualizer (Volt MX) MVC controller
— **old base**, **customized branch**, and **new base** — and produce a validated
customization-retrofit plan.

The problem it solves: a customer (e.g. KBZ) customized a controller on top of an old
vendor base (R21); the vendor then evolved that base to a new release (R26). You need to
carry the customizations onto the new base. This is a **three-way merge with the old base
as the common ancestor** — the studio separates *genuine* logic changes from formatting
noise and classifies each one by how to retrofit it.

```
        R21  (old base = common ancestor)
        /  \
   KBZ /    \ R26
 (custom)    (new base = upgrade target)
        \    /
      R26 + KBZ   ← the retrofit you produce
```

## Workflow: format first, then compare

Run the input files through the **formatter** first, then upload the *formatted* copies to
the **studio**. Formatting every file identically up front is what makes the comparison
clean — otherwise cosmetic differences (brace style, indentation, line endings) show up as
fake changes.

### Step 1 — Format the inputs (Python)

```bash
pip install jsbeautifier
python format_js.py X_R21.js X_KBZ.js X_R26.js
```

Each file is re-formatted to one standard style and written to **`Formatted_JS_Outputs/`**.
Only whitespace / brace placement / indentation change — no tokens, strings, comments or
logic are touched. Rules applied:

1. **K&R braces** — `if (cond) {` … `} else {` … `}` (an opening `{` never sits alone on a
   line; `else` / `catch` / `finally` hug the closing `}`).
2. **`key: value`** spacing.
3. **No line wrapping** — a long `let x = …` stays on one line regardless of length.

Options: `--out <folder>` (default `Formatted_JS_Outputs`), `--indent <n>` (default 4),
`--suffix _formatted`. You can also pass a folder to format every `.js` inside it.

### Step 2 — Upload the formatted files to the studio

1. Open **`index.html`** (or `retrofit_studio.html`) in any browser — double-click it.
2. Upload the three **formatted** controllers from `Formatted_JS_Outputs/`:
   **Base (old)**, **Custom**, **New base** (the 3rd is optional). Labels auto-fill from the
   filename suffix (e.g. `…_R21.js` → `R21`).
3. Click **Analyze**.

Everything in the studio runs **entirely in your browser** — no server or internet needed.

### What the studio shows (tabs)
- **Overview** — module signatures + the list of customizations to retrofit.
- **Genuine Changes** — every real Custom-vs-Base change; click one for a side-by-side diff
  with a version-pair selector (**R21 vs KBZ**, **R21 vs R26**, **KBZ vs R26**) and a
  **3-column** view. Each column keeps its own line numbers; only real changes are highlighted.
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

## Repo layout
| File / folder | Purpose |
|---------------|---------|
| `format_js.py` | **Step 1** — standard JS formatter (run this on the inputs first) |
| `Formatted_JS_Outputs/` | where the formatter writes the formatted copies |
| `index.html` | default entry point → opens the studio |
| `retrofit_studio.html` | **Step 2** — the studio; upload the formatted files and analyze |
| `controller_compare.py` | same analyzer as a Python CLI (batch/CI) |
| `compare_viewer.html` | legacy viewer that loads Python-generated JSON |
| `frmCustomerProfileEntitlementsController_*.js` | example controller set (R21/KBZ/R26) |

## What is deterministic vs judgment
The studio fills every factual column (what changed, presence across versions, bucket
candidate, widget remap). The checklist's Action / Field-remap / Other-layers / Risk columns
are left blank by design — that is the intent/judgment layer for an engineer (or an LLM pass).
