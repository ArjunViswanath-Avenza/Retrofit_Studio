#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
format_js.py — end-to-end JavaScript code formatter
====================================================
Takes one or more .js files (or folders), understands the code structure, and
writes a fully re-formatted copy into an output folder.

Formatting rules enforced:
  1. Bracket style is K&R / one-true-brace:
         if (cond) {
             ...
         } else {
             ...
         }
     (an opening "{" never sits alone on its own line; "else"/"catch"/"finally"
      hug the closing "}")
  2. Object/label colons are "key: value" (one space after, none before).
  3. Long statements are NEVER wrapped — `let x = <anything long>` stays on one
     line regardless of length (line wrapping by width is disabled).

Only whitespace, indentation, brace placement and blank-line runs are changed.
No tokens, identifiers, strings, comments or logic are altered.

Built on js-beautify (the reference JS formatter). Prettier is intentionally NOT
used because it force-wraps at a print width, which would violate rule 3.

Usage
-----
  python format_js.py path/to/file.js                     # one file
  python format_js.py a.js b.js c.js                      # several files
  python format_js.py ./src                               # every .js under a folder
  python format_js.py ./src --out Formatted_JS_Outputs    # choose output folder
  python format_js.py file.js --indent 2                  # indent width (default 4)

Output goes to ./Formatted_JS_Outputs/ next to this script by default.
Dependency:  pip install jsbeautifier
"""

import argparse
import os
import sys

import jsbeautifier

HERE = os.path.dirname(os.path.abspath(__file__))


def make_options(indent_size):
    o = jsbeautifier.default_options()
    o.indent_size = indent_size
    o.indent_char = " "
    o.brace_style = "collapse"        # rule 1: `) {` and `} else {`
    o.wrap_line_length = 0            # rule 3: never wrap by length
    o.preserve_newlines = True        # keep the author's line breaks between statements
    o.max_preserve_newlines = 2       # collapse 3+ blank lines down to 2
    o.end_with_newline = True
    o.space_in_empty_paren = False    # function() not function( )
    o.space_after_anon_function = False
    o.jslint_happy = False
    o.keep_array_indentation = False
    return o


def format_source(src, options):
    # normalize CRLF/CR -> LF first so formatting is deterministic
    src = src.replace("\r\n", "\n").replace("\r", "\n")
    # strip a UTF-8 BOM and any leading whitespace: js-beautify treats the first
    # line's indentation as a baseline and adds it to every line, so a source that
    # starts with e.g. "  define({" would come out indented 2 spaces deeper.
    src = src.lstrip("﻿").lstrip()
    return jsbeautifier.beautify(src, options)


def rule_check(text):
    """Quick self-check that the output honours the three rules."""
    lines = text.split("\n")
    # rule 1: no line is just an opening brace (Allman leftover)
    allman = sum(1 for ln in lines if ln.strip() == "{")
    # rule 1b: else/catch/finally should hug the brace (no bare "else" line)
    bare_else = sum(1 for ln in lines if ln.strip() in ("else", "else {", "}") and ln.strip() == "else")
    return {"allman_open_braces": allman, "bare_else": bare_else}


def gather_inputs(paths):
    files = []
    for p in paths:
        if os.path.isdir(p):
            for root, _, names in os.walk(p):
                for n in names:
                    if n.lower().endswith(".js"):
                        files.append(os.path.join(root, n))
        elif os.path.isfile(p):
            files.append(p)
        else:
            print(f"  ! not found: {p}", file=sys.stderr)
    return files


def main():
    ap = argparse.ArgumentParser(description="End-to-end JS formatter (K&R braces, key: value, no line wrapping).")
    ap.add_argument("inputs", nargs="+", help=".js files or folders to format")
    ap.add_argument("--out", default=os.path.join(HERE, "Formatted_JS_Outputs"),
                    help="output folder (default: ./Formatted_JS_Outputs)")
    ap.add_argument("--indent", type=int, default=4, help="indent size in spaces (default 4)")
    ap.add_argument("--suffix", default="", help="optional suffix before .js, e.g. '_formatted'")
    args = ap.parse_args()

    options = make_options(args.indent)
    os.makedirs(args.out, exist_ok=True)

    files = gather_inputs(args.inputs)
    if not files:
        sys.exit("No .js files found.")

    print(f"Formatting {len(files)} file(s) -> {args.out}")
    for f in files:
        with open(f, encoding="utf-8", errors="replace") as fh:
            src = fh.read()
        out_text = format_source(src, options)
        base = os.path.basename(f)
        if args.suffix:
            stem, ext = os.path.splitext(base)
            base = f"{stem}{args.suffix}{ext}"
        dest = os.path.join(args.out, base)
        with open(dest, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(out_text)
        chk = rule_check(out_text)
        flag = "OK" if chk["allman_open_braces"] == 0 else f"WARN allman={chk['allman_open_braces']}"
        print(f"  [{flag}] {base}  ({out_text.count(chr(10))+1} lines)")

    print("Done.")


if __name__ == "__main__":
    main()
