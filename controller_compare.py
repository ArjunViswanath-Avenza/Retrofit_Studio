#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
controller_compare.py
=====================
Deterministic comparison tool for Temenos Infinity / Kony Visualizer (Volt MX)
MVC controller files (form / presentation / business controllers).

It does the *mechanical* 70% of the customization-retrofit analysis — no LLM:
  1. Parses each controller (define({...})) with a real JS parser (esprima).
  2. Extracts every top-level method and field, and builds a TOKEN-LEVEL signature
     for each, so formatting/brace-style/line-wrapping differences are ignored.
  3. Emits an .xlsx workbook:
       - Method Matrix           (presence across versions)
       - Genuine Changes         (BASE_OLD vs CUSTOM, real changes only)
       - 3-Way                   (BASE_OLD | CUSTOM | BASE_NEW + deterministic bucket hint)
       - Retrofit Checklist      (one row per CUSTOM change; judgment columns left blank)
       - Widget Index Map        (txt/listbox widget usage per version - spot field remaps)
       - Legend
The JUDGMENT columns (intent, final bucket, action, risk) are intentionally left blank
for an LLM or human pass. That is the 30% a tool should NOT guess.

Usage
-----
  python controller_compare.py \
      --base-old  frmXController_R21.js \
      --custom    frmXController_KBZ.js \
      --base-new  frmXController_R26.js \
      --out       frmXController_Comparison.xlsx \
      --labels    R21 KBZ R26

--base-new is optional; omit it for a plain 2-way (BASE_OLD vs CUSTOM) comparison.

Dependencies:  pip install esprima jsbeautifier openpyxl
"""

import argparse
import difflib
import json
import os
import re
import sys

import esprima
import jsbeautifier
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

FUNC_TYPES = ("FunctionExpression", "ArrowFunctionExpression")

# --------------------------------------------------------------------------- #
# Parsing / extraction
# --------------------------------------------------------------------------- #
def read(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def _beautify_opts():
    o = jsbeautifier.default_options()
    o.indent_size = 4
    o.brace_style = "collapse"
    o.space_in_empty_paren = True
    o.preserve_newlines = False   # drop blank-line noise so diffs show only real changes
    return o


def _canon(src_slice):
    """Token-level canonical signature: ignores whitespace, comments, braces layout."""
    try:
        toks = esprima.tokenize(src_slice, {"tolerant": True})
        return " ".join(t.value for t in toks)
    except Exception:
        # fallback: strip comments + collapse whitespace
        s = re.sub(r"/\*.*?\*/", " ", src_slice, flags=re.S)
        s = re.sub(r"//.*", " ", s)
        return re.sub(r"\s+", " ", s).strip()


def extract(src):
    """
    Returns dict:
      module_name : str | None       (define("name",{...}) -> "name"; anonymous -> None)
      members     : { name: {"kind": "method"|"field", "canon": str, "body": str} }
    """
    tree = esprima.parseScript(src, {"range": True, "tolerant": True})
    module_name = None
    members = {}
    for node in tree.body:
        if node.type != "ExpressionStatement":
            continue
        expr = node.expression
        if expr.type != "CallExpression" or getattr(expr.callee, "name", None) != "define":
            continue
        for arg in expr.arguments:
            if arg.type == "Literal" and isinstance(arg.value, str):
                module_name = arg.value
            if arg.type == "ObjectExpression":
                for prop in arg.properties:
                    key = prop.key
                    name = getattr(key, "name", None) or getattr(key, "value", None)
                    if name is None:
                        continue
                    val = prop.value
                    body = src[val.range[0]:val.range[1]]
                    kind = "method" if val.type in FUNC_TYPES else "field"
                    members[str(name)] = {"kind": kind, "canon": _canon(body), "body": body}
    return {"module_name": module_name, "members": members}


def diff_snippet(old_body, new_body, max_lines=14):
    """Short human-readable unified diff of two beautified bodies."""
    opts = _beautify_opts()
    a = jsbeautifier.beautify(old_body, opts).splitlines()
    b = jsbeautifier.beautify(new_body, opts).splitlines()
    out = []
    for line in difflib.unified_diff(a, b, lineterm="", n=1):
        if line.startswith(("+++", "---", "@@")):
            continue
        if line and line[0] in "+-":
            out.append(line)
        if len(out) >= max_lines:
            out.append("... (truncated)")
            break
    return "\n".join(out)


# --------------------------------------------------------------------------- #
# Widget-index extraction (spot field remaps deterministically)
# --------------------------------------------------------------------------- #
WIDGET_RE = re.compile(r"(txtSearchParam\d+|listboxSearchParam\d+|txtSearchCriteria\d+|"
                       r"lstNRCNumber|tbxNRCnumber|tbxusernameccid|txtCpnyName|lstPage|"
                       r"lblSelectLegalEntity|segStatusFilterDropdown|flxSearchbyUserId)")


def widget_counts(src):
    counts = {}
    for m in WIDGET_RE.findall(src):
        counts[m] = counts.get(m, 0) + 1
    return counts


# generic widget-token counter (any Kony-style widget id) for remap detection
GENERIC_WIDGET_RE = re.compile(
    r"\b(txt[A-Z]\w+|lst[A-Z]\w+|listbox\w+|tbx\w+|flx[A-Z]\w+|btn[A-Z]\w+|"
    r"lbl[A-Z]\w+|seg[A-Z]\w+|img[A-Z]\w+|rich\w+|fonticon\w+|fontIcon\w+)\b")


def widget_counts_generic(src):
    counts = {}
    for m in GENERIC_WIDGET_RE.findall(src):
        counts[m] = counts.get(m, 0) + 1
    return counts


# --------------------------------------------------------------------------- #
# JSON model (feeds the HTML frontend)
# --------------------------------------------------------------------------- #
def build_json(data, labels, paths):
    old, cust = data[0], data[1]
    new = data[2] if len(data) == 3 else None
    opts = _beautify_opts()

    def bty(body):
        try:
            return jsbeautifier.beautify(body, opts)
        except Exception:
            return body

    names, seen = [], set()
    for d in data:
        for name in d["members"]:
            if name not in seen:
                seen.add(name); names.append(name)

    members = {}
    genuine = []
    for name in names:
        present = {labels[i]: (name in data[i]["members"]) for i in range(len(data))}
        kind = next((d["members"][name]["kind"] for d in data if name in d["members"]), "")
        bodies = {}
        for i, d in enumerate(data):
            bodies[labels[i]] = bty(d["members"][name]["body"]) if name in d["members"] else None
        # 2-way change (old vs custom)
        io, ic = name in old["members"], name in cust["members"]
        change = None
        if io and ic:
            if old["members"][name]["canon"] != cust["members"][name]["canon"]:
                change = "Modified"
        elif ic:
            change = "Added"
        elif io:
            change = "Removed"
        bucket, note = ("", "")
        if new is not None:
            bucket, note = classify(old, cust, new, name)
        in_new = None
        if new is not None:
            if name in new["members"]:
                if io and old["members"][name]["canon"] == new["members"][name]["canon"]:
                    in_new = "same"
                elif ic and cust["members"][name]["canon"] == new["members"][name]["canon"]:
                    in_new = "matches_custom"
                else:
                    in_new = "differs"
            else:
                in_new = "absent"
        members[name] = {
            "kind": kind, "present": present, "bodies": bodies,
            "change": change, "bucket": bucket, "note": note, "in_new": in_new,
        }
        if change:
            genuine.append(name)

    # widget remap table (generic)
    wc = [widget_counts_generic(d["_src"]) for d in data]
    allw = sorted(set().union(*[set(c) for c in wc]))
    widgets = []
    for w in allw:
        counts = {labels[i]: wc[i].get(w, 0) for i in range(len(data))}
        vals = list(counts.values())
        # flag if present in some versions and absent in others, or count differs a lot
        present_flags = [v > 0 for v in vals]
        remap = (len(set(present_flags)) > 1)
        widgets.append({"token": w, "counts": counts, "remap": remap})

    return {
        "labels": labels,
        "paths": [os.path.basename(p) for p in paths],
        "counts": {labels[i]: len(data[i]["members"]) for i in range(len(data))},
        "module_names": {labels[i]: data[i]["module_name"] for i in range(len(data))},
        "genuine_changes": genuine,
        "members": members,
        "widgets": widgets,
        "has_new": new is not None,
    }


# --------------------------------------------------------------------------- #
# Excel styling helpers
# --------------------------------------------------------------------------- #
FONT = "Arial"
HDR = PatternFill("solid", fgColor="1F3864")
TITLE = PatternFill("solid", fgColor="2E5496")
SECT = PatternFill("solid", fgColor="8EAADB")
ADD = PatternFill("solid", fgColor="E2EFDA")
REM = PatternFill("solid", fgColor="FCE4E4")
MOD = PatternFill("solid", fgColor="FFF2CC")
NEW = PatternFill("solid", fgColor="DEEAF6")
PORT = PatternFill("solid", fgColor="FCE4D6")
GREY = PatternFill("solid", fgColor="EDEDED")
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
TL = Alignment(horizontal="left", vertical="top", wrap_text=True)
TC = Alignment(horizontal="center", vertical="top", wrap_text=True)
CC = Alignment(horizontal="center", vertical="center", wrap_text=True)


def _header(ws, headers, widths, row=1):
    for c, h in enumerate(headers, 1):
        cell = ws.cell(row, c, h)
        cell.font = Font(name=FONT, bold=True, color="FFFFFF")
        cell.fill = HDR
        cell.alignment = CC
        cell.border = BORDER
    for c, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.row_dimensions[row].height = 26
    ws.freeze_panes = ws.cell(row + 1, 1)


def _autoheight(ws, first_row, widths, text_cols):
    for rr in range(first_row, ws.max_row + 1):
        maxlines = 1
        for c in text_cols:
            v = str(ws.cell(rr, c).value or "")
            w = widths[c - 1]
            approx = sum(max(1, len(seg) // int(w * 1.05) + 1) for seg in v.split("\n"))
            maxlines = max(maxlines, approx)
        ws.row_dimensions[rr].height = max(15, min(180, maxlines * 12.5))


# --------------------------------------------------------------------------- #
# Sheet builders
# --------------------------------------------------------------------------- #
def sheet_matrix(wb, labels, data, names_ordered):
    three = len(labels) == 3
    ws = wb.create_sheet("Method Matrix")
    heads = ["Member", "Kind"] + labels + ["Note"]
    widths = [34, 10] + [8] * len(labels) + [40]
    _header(ws, heads, widths)
    r = 2
    for name in names_ordered:
        present = [name in d["members"] for d in data]
        kind = next((d["members"][name]["kind"] for d in data if name in d["members"]), "")
        note = ""
        if three:
            o, c, n = present
            if c and not o and not n:
                note = "CUSTOM-only"
            elif n and not o and not c:
                note = "NEW-only"
            elif o and not n:
                note = "dropped in NEW"
        cells = [name, kind] + ["Y" if p else "-" for p in present] + [note]
        for ci, v in enumerate(cells, 1):
            cell = ws.cell(r, ci, v)
            cell.font = Font(name=FONT, size=10, bold=(ci == 1))
            cell.alignment = TL if ci in (1, len(cells)) else CC
            cell.border = BORDER
            if 3 <= ci <= 2 + len(labels) and v == "Y":
                cell.fill = ADD
        r += 1
    _autoheight(ws, 2, widths, [1, len(heads)])


def sheet_genuine(wb, old, cust, lbl_old, lbl_cust):
    ws = wb.create_sheet("Genuine Changes")
    heads = ["#", "Member", "Kind", "Change", f"{lbl_old} present", f"{lbl_cust} present", "Token-level diff (beautified)"]
    widths = [5, 30, 9, 11, 12, 12, 70]
    _header(ws, heads, widths)
    om, cm = old["members"], cust["members"]
    rows = []
    for name in sorted(set(om) | set(cm)):
        in_o, in_c = name in om, name in cm
        if in_o and in_c:
            if om[name]["canon"] == cm[name]["canon"]:
                continue
            change = "Modified"
            snippet = diff_snippet(om[name]["body"], cm[name]["body"])
        elif in_c:
            change = "Added"; snippet = "(new in CUSTOM)"
        else:
            change = "Removed"; snippet = "(present in BASE_OLD, absent in CUSTOM)"
        kind = (cm.get(name) or om.get(name))["kind"]
        rows.append((name, kind, change, "Y" if in_o else "-", "Y" if in_c else "-", snippet))
    # module signature difference
    if old["module_name"] != cust["module_name"]:
        rows.insert(0, ("define() module id", "module", "Modified",
                        repr(old["module_name"]), repr(cust["module_name"]),
                        "anonymous vs named AMD module"))
    fill = {"Added": ADD, "Removed": REM, "Modified": MOD}
    for i, (name, kind, change, po, pc, snip) in enumerate(rows, 1):
        vals = [i, name, kind, change, po, pc, snip]
        for c, v in enumerate(vals, 1):
            cell = ws.cell(i + 1, c, v)
            cell.font = Font(name="Consolas" if c == 7 else FONT, size=9 if c == 7 else 10,
                             bold=(c == 4))
            cell.alignment = TC if c in (1, 5, 6) else (CC if c == 4 else TL)
            cell.border = BORDER
            if c == 4:
                cell.fill = fill.get(change, GREY)
    _autoheight(ws, 2, widths, [2, 7])
    return len(rows)


def classify(old, cust, new, name):
    """Deterministic retrofit-bucket CANDIDATE (LLM/human confirms)."""
    om, cm, nm = old["members"], cust["members"], new["members"]
    in_o, in_c, in_n = name in om, name in cm, name in nm
    if in_c and not in_o and not in_n:
        return "4", "CUSTOM-only — port as net-new"
    if in_n and not in_o and not in_c:
        return "5", "NEW-only — keep BASE_NEW; check vs CUSTOM rules"
    # method present in old & custom, custom differs from old
    cust_changed = in_o and in_c and om[name]["canon"] != cm[name]["canon"]
    if not cust_changed:
        return "", ""  # no CUSTOM delta here
    if not in_n:
        return "?", "CUSTOM changed but target MISSING in BASE_NEW — relocate"
    new_changed = om[name]["canon"] != nm[name]["canon"]
    if not new_changed:
        return "1", "CUSTOM change on area BASE_NEW left untouched — clean re-apply"
    if nm[name]["canon"] == cm[name]["canon"]:
        return "3", "BASE_NEW already matches CUSTOM"
    return "2", "Both CUSTOM and BASE_NEW changed same area — reconcile (conflict)"


def sheet_threeway(wb, data, labels, names_ordered):
    old, cust, new = data
    lo, lc, ln = labels
    ws = wb.create_sheet("3-Way")
    heads = ["#", "Member", lo, lc, ln, "Bucket hint", "Deterministic note (confirm w/ LLM/human)"]
    widths = [5, 30, 10, 10, 10, 9, 52]
    _header(ws, heads, widths)
    r = 2
    idx = 0
    for name in names_ordered:
        b, note = classify(old, cust, new, name)
        if not note:
            continue
        idx += 1
        def mark(d):
            return "Y" if name in d["members"] else "-"
        vals = [idx, name, mark(old), mark(cust), mark(new), b, note]
        for c, v in enumerate(vals, 1):
            cell = ws.cell(r, c, v)
            cell.font = Font(name=FONT, size=10, bold=(c == 2))
            cell.alignment = TC if c in (1, 3, 4, 5, 6) else TL
            cell.border = BORDER
            if c == 7:
                cell.fill = {"1": ADD, "2": PORT, "3": NEW, "4": ADD, "5": NEW}.get(b, GREY)
        r += 1
    _autoheight(ws, 2, widths, [2, 7])
    return idx


def sheet_checklist(wb, old, cust, new, labels):
    ln = labels[2] if len(labels) == 3 else "(none)"
    ws = wb.create_sheet("Retrofit Checklist")
    heads = ["#", "CUSTOM change (member)", "Change type",
             f"In {ln}?", "Bucket hint",
             "Action (LLM/human)", "Field/widget re-map? (LLM/human)",
             "Other layers impacted (LLM/human)", "Risk H/M/L", "Status"]
    widths = [5, 28, 11, 10, 9, 30, 22, 26, 9, 10]
    _header(ws, heads, widths)
    om, cm = old["members"], cust["members"]
    nm = new["members"] if new else {}
    r = 2
    idx = 0
    for name in sorted(set(om) | set(cm)):
        in_o, in_c = name in om, name in cm
        if in_o and in_c and om[name]["canon"] == cm[name]["canon"]:
            continue
        if in_o and in_c:
            ctype = "Modified"
        elif in_c:
            ctype = "Added"
        else:
            ctype = "Removed"
        if new:
            b, _ = classify(old, cust, new, name)
            if not b:  # custom==old (shouldn't reach here)
                b = ""
            in_new = "Y" if name in nm else "-"
            if in_o and in_c and name in nm:
                in_new = "same" if nm[name]["canon"] == om[name]["canon"] else "differs"
        else:
            b, in_new = "", "n/a"
        idx += 1
        vals = [idx, name, ctype, in_new, b, "", "", "", "", "TODO"]
        for c, v in enumerate(vals, 1):
            cell = ws.cell(r, c, v)
            cell.font = Font(name=FONT, size=10, bold=(c == 2))
            cell.alignment = TC if c in (1, 3, 4, 5, 9, 10) else TL
            cell.border = BORDER
            if c == 3:
                cell.fill = {"Added": ADD, "Removed": REM, "Modified": MOD}.get(ctype, GREY)
            if c in (6, 7, 8):
                cell.fill = PatternFill("solid", fgColor="FFFDE7")  # to-fill = pale yellow
        r += 1
    _autoheight(ws, 2, widths, [2, 6, 7, 8])
    return idx


def sheet_widgets(wb, data, labels):
    ws = wb.create_sheet("Widget Index Map")
    ws.cell(1, 1, "Widget-token usage per version — mismatched counts flag a field/index remap.")
    ws.cell(1, 1).font = Font(name=FONT, italic=True, size=10)
    heads = ["Widget token"] + labels
    widths = [34] + [12] * len(labels)
    _header(ws, heads, widths, row=2)
    counts = [widget_counts(d["_src"]) for d in data]
    allw = sorted(set().union(*[set(c) for c in counts]))
    r = 3
    for w in allw:
        vals = [w] + [counts[i].get(w, 0) for i in range(len(data))]
        distinct = len({counts[i].get(w, 0) > 0 for i in range(len(data))}) > 1
        for c, v in enumerate(vals, 1):
            cell = ws.cell(r, c, v)
            cell.font = Font(name=FONT, size=10, bold=(c == 1))
            cell.alignment = TL if c == 1 else CC
            cell.border = BORDER
            if c > 1 and v == 0 and distinct:
                cell.fill = REM
        r += 1


def sheet_legend(wb):
    ws = wb.create_sheet("Legend")
    rows = [
        ("Change type", ""),
        ("Added", "Member present in CUSTOM but not BASE_OLD."),
        ("Removed", "Member present in BASE_OLD but not CUSTOM."),
        ("Modified", "Member in both; token-level signature differs (real logic change)."),
        ("", ""),
        ("Retrofit bucket", ""),
        ("1", "CUSTOM changed / BASE_NEW untouched -> clean re-apply (low risk)."),
        ("2", "CUSTOM changed / BASE_NEW changed same area -> reconcile (conflict)."),
        ("3", "BASE_NEW already provides/matches CUSTOM -> adopt BASE_NEW."),
        ("4", "CUSTOM-only, no BASE_NEW equivalent -> port as net-new."),
        ("5", "BASE_NEW-only, new to CUSTOM -> keep BASE_NEW; check business rules."),
        ("?", "CUSTOM change whose target method is missing in BASE_NEW -> relocate."),
        ("", ""),
        ("Note", "Bucket hints are DETERMINISTIC CANDIDATES from token diffs. Confirm intent, "
                 "cross-layer impact, and final action with an LLM or human."),
    ]
    ws.column_dimensions["A"].width = 16
    ws.column_dimensions["B"].width = 90
    for i, (a, b) in enumerate(rows, 1):
        ca, cb = ws.cell(i, 1, a), ws.cell(i, 2, b)
        ca.font = Font(name=FONT, bold=True)
        cb.font = Font(name=FONT)
        ca.alignment = cb.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="Deterministic controller comparison / retrofit scaffold.")
    ap.add_argument("--base-old", required=True)
    ap.add_argument("--custom", required=True)
    ap.add_argument("--base-new", default=None)
    ap.add_argument("--out", required=False, help="Path to .xlsx output (optional).")
    ap.add_argument("--json", dest="json_out", default=None,
                    help="Path to .json output for the HTML frontend (optional).")
    ap.add_argument("--labels", nargs="*", default=None,
                    help="Display labels, e.g. --labels R21 KBZ R26")
    args = ap.parse_args()
    if not args.out and not args.json_out:
        sys.exit("ERROR: provide at least one of --out (.xlsx) or --json (.json).")

    paths = [args.base_old, args.custom] + ([args.base_new] if args.base_new else [])
    labels = args.labels or (["BASE_OLD", "CUSTOM"] + (["BASE_NEW"] if args.base_new else []))
    if len(labels) != len(paths):
        sys.exit("ERROR: number of --labels must match number of input files.")

    data = []
    for p in paths:
        src = read(p)
        ext = extract(src)
        ext["_src"] = src
        data.append(ext)

    old, cust = data[0], data[1]
    new = data[2] if args.base_new else None

    # ordered member list (old order, then custom extras, then new extras)
    names, seen = [], set()
    for d in data:
        for name in d["members"]:
            if name not in seen:
                seen.add(name); names.append(name)

    if args.out:
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        sheet_matrix(wb, labels, data, names)
        n_changes = sheet_genuine(wb, old, cust, labels[0], labels[1])
        if new:
            sheet_threeway(wb, data, labels, names)
            sheet_checklist(wb, old, cust, new, labels)
            sheet_widgets(wb, data, labels)
        sheet_legend(wb)
        wb.save(args.out)
        print(f"[OK] wrote {args.out}")

    if args.json_out:
        model = build_json(data, labels, paths)
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(model, f, ensure_ascii=False, indent=1)
        print(f"[OK] wrote {args.json_out}")

    print(f"     members: " + ", ".join(f"{labels[i]}={len(data[i]['members'])}" for i in range(len(data))))
    n_changes = sum(1 for n in names if n in cust["members"] and
                    (n not in old["members"] or old["members"][n]["canon"] != cust["members"][n]["canon"]))
    n_changes += sum(1 for n in old["members"] if n not in cust["members"])
    print(f"     genuine changes (BASE_OLD vs CUSTOM): {n_changes}")


if __name__ == "__main__":
    main()
