// Core analysis: format (js-beautify) + parse (acorn) + diff + retrofit buckets.
import { parse } from "acorn";
import beautify from "js-beautify";

const jsB = beautify.js || beautify;

// Formatting rules: K&R braces, key: value, never wrap long lines.
// preserve_newlines:false re-flows to a CANONICAL line structure, so code that differs only
// in how the author broke lines (e.g. "}, {" vs "},\n{") formats identically — otherwise
// structurally-identical code produces false diffs. Long lines still never wrap (wrap_line_length:0).
const FMT = {
  indent_size: 4,
  brace_style: "collapse",
  wrap_line_length: 0,
  preserve_newlines: false,
  space_in_empty_paren: false,
  end_with_newline: false,
  eol: "\n",
};

export function fmt(code) {
  try {
    return (jsB(code || "", FMT) || "").replace(/\r\n?/g, "\n");
  } catch {
    return (code || "").replace(/\r\n?/g, "\n");
  }
}

// Strip // and /* */ comments (string/template aware) — used only for change detection,
// so comment-only edits don't count as genuine code changes. Display keeps comments.
const Q = { "'": 1, '"': 1, "`": 1 };
function stripComments(code) {
  let out = "", i = 0; const n = code.length;
  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c === "/" && d === "/") { while (i < n && code[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++; i += 2; continue; }
    if (Q[c]) { const q = c; out += c; i++; while (i < n) { out += code[i]; if (code[i] === "\\") { out += code[i + 1]; i += 2; continue; } if (code[i] === q) { i++; break; } i++; } continue; }
    out += c; i++;
  }
  return out;
}
const canonOf = (fmtBody) => stripComments(fmtBody).replace(/\s+/g, " ").trim();

const FUNC = new Set(["FunctionExpression", "ArrowFunctionExpression"]);

// Extract module name + top-level members of the define({...}) object using a real parser.
export function extract(src) {
  src = (src || "").replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  let ast;
  try {
    ast = parse(src, {
      ecmaVersion: "latest",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    });
  } catch (e) {
    throw new Error("Parse error: " + e.message);
  }
  let moduleName = null;
  const members = {};

  const handleObject = (obj) => {
    for (const p of obj.properties) {
      if (p.type !== "Property") continue;
      const key = p.key.name !== undefined ? p.key.name : p.key.value;
      if (key == null) continue;
      const val = p.value;
      const raw = src.slice(val.start, val.end);
      const f = fmt(raw);
      members[String(key)] = {
        kind: FUNC.has(val.type) ? "method" : "field",
        raw,
        fmt: f,
        canon: canonOf(f),
      };
    }
  };

  for (const node of ast.body) {
    if (node.type === "ExpressionStatement" && node.expression.type === "CallExpression") {
      const call = node.expression;
      if (call.callee && call.callee.name === "define") {
        for (const a of call.arguments) {
          if (a.type === "Literal" && typeof a.value === "string") moduleName = a.value;
          if (a.type === "ObjectExpression") handleObject(a);
        }
      }
    }
  }
  return { moduleName, members };
}

// ---- line diff (LCS) ----
export function lcsDiff(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push(["=", a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(["-", a[i]]); i++; }
    else { ops.push(["+", b[j]]); j++; }
  }
  while (i < n) { ops.push(["-", a[i]]); i++; }
  while (j < m) { ops.push(["+", b[j]]); j++; }
  return ops;
}

// two-column side-by-side rows (pair changed lines)
export function twoColRows(A, B) {
  const ops = lcsDiff(A, B); const rows = []; let del = [], add = [];
  const flush = () => {
    const m = Math.max(del.length, add.length);
    for (let i = 0; i < m; i++)
      rows.push({
        left: i < del.length ? { t: del[i], c: "del" } : { t: "", c: "gap" },
        right: i < add.length ? { t: add[i], c: "add" } : { t: "", c: "gap" },
      });
    del = []; add = [];
  };
  for (const [t, txt] of ops) {
    if (t === "=") { flush(); rows.push({ left: { t: txt, c: "same" }, right: { t: txt, c: "same" } }); }
    else if (t === "-") del.push(txt);
    else add.push(txt);
  }
  flush(); return rows;
}

// three-column rows aligned against base B
export function threeColRows(B, K, N) {
  const parseOps = (ops) => {
    const pre = [], base = []; let bi = 0, bucket = [];
    for (const [t, txt] of ops) {
      if (t === "=") { pre[bi] = bucket; bucket = []; base[bi] = { common: true }; bi++; }
      else if (t === "-") { pre[bi] = bucket; bucket = []; base[bi] = { common: false }; bi++; }
      else bucket.push(txt);
    }
    pre[bi] = bucket; return { pre, base };
  };
  const PK = parseOps(lcsDiff(B, K)), PN = parseOps(lcsDiff(B, N));
  const rows = [], nb = B.length;
  for (let i = 0; i <= nb; i++) {
    const kIns = PK.pre[i] || [], nIns = PN.pre[i] || [], m = Math.max(kIns.length, nIns.length);
    for (let j = 0; j < m; j++)
      rows.push({
        r21: { t: "", c: "gap" },
        kbz: j < kIns.length ? { t: kIns[j], c: "add" } : { t: "", c: "gap" },
        r26: j < nIns.length ? { t: nIns[j], c: "add" } : { t: "", c: "gap" },
      });
    if (i < nb) {
      const bt = B[i];
      const kc = PK.base[i] && PK.base[i].common, nc = PN.base[i] && PN.base[i].common;
      rows.push({
        r21: { t: bt, c: kc && nc ? "same" : "chg" },
        kbz: kc ? { t: bt, c: "same" } : { t: "", c: "del" },
        r26: nc ? { t: bt, c: "same" } : { t: "", c: "del" },
      });
    }
  }
  return rows;
}

// retrofit bucket classification (deterministic candidate)
export function classify(O, C, N, name) {
  const io = name in O.members, ic = name in C.members, iN = N && name in N.members;
  if (ic && !io && (!N || !iN)) return ["4", "CUSTOM-only — port as net-new"];
  if (N && iN && !io && !ic) return ["5", "NEW-only — keep BASE_NEW; check vs CUSTOM rules"];
  const custChanged = io && ic && O.members[name].canon !== C.members[name].canon;
  if (!custChanged) return ["", ""];
  if (N && !iN) return ["?", "CUSTOM changed but target MISSING in BASE_NEW — relocate"];
  if (!N) return ["", ""];
  const newChanged = O.members[name].canon !== N.members[name].canon;
  if (!newChanged) return ["1", "CUSTOM change on area BASE_NEW left untouched — clean re-apply"];
  if (N.members[name].canon === C.members[name].canon) return ["3", "BASE_NEW already matches CUSTOM"];
  return ["2", "Both CUSTOM and BASE_NEW changed same area — reconcile (conflict)"];
}

const WIDGET = /\b(txt[A-Z]\w+|lst[A-Z]\w+|listbox\w+|tbx\w+|flx[A-Z]\w+|btn[A-Z]\w+|lbl[A-Z]\w+|seg[A-Z]\w+|img[A-Z]\w+|rich\w+|font[Ii]con\w+)\b/g;
function widgetCounts(src) {
  const c = {}; const m = (src || "").match(WIDGET) || [];
  for (const w of m) c[w] = (c[w] || 0) + 1;
  return c;
}

// Build the full comparison model from parsed files.
export function buildModel(files) {
  const labels = files.map((f) => f.label);
  const O = files[0].parsed, C = files[1].parsed, N = files[2] ? files[2].parsed : null;
  const order = [], seen = new Set();
  for (const f of files)
    for (const k of Object.keys(f.parsed.members))
      if (!seen.has(k)) { seen.add(k); order.push(k); }

  const members = {}, genuine = [];
  for (const name of order) {
    const present = {}, bodies = {};
    for (const f of files) {
      present[f.label] = name in f.parsed.members;
      bodies[f.label] = name in f.parsed.members ? f.parsed.members[name].fmt : null;
    }
    const io = name in O.members, ic = name in C.members;
    let change = null;
    if (io && ic) { if (O.members[name].canon !== C.members[name].canon) change = "Modified"; }
    else if (ic) change = "Added";
    else if (io) change = "Removed";
    let bucket = "", note = "";
    if (N) [bucket, note] = classify(O, C, N, name);
    let inNew = null;
    if (N) {
      if (name in N.members) {
        inNew = io && O.members[name].canon === N.members[name].canon ? "same"
          : ic && C.members[name].canon === N.members[name].canon ? "matches_custom" : "differs";
      } else inNew = "absent";
    }
    const kind = files.find((f) => name in f.parsed.members).parsed.members[name].kind;
    const dups = {};
    for (const f of files) { const d = f.parsed.members[name]?.dups; if (d > 1) dups[f.label] = d; }
    members[name] = { kind, present, bodies, change, bucket, note, inNew, dups };
    if (change) genuine.push(name);
  }

  const wc = files.map((f) => widgetCounts(f.src));
  const allw = [...new Set(wc.flatMap((c) => Object.keys(c)))].sort();
  const widgets = allw.map((w) => {
    const counts = {}; files.forEach((f, i) => (counts[f.label] = wc[i][w] || 0));
    const flags = Object.values(counts).map((v) => v > 0);
    return { token: w, counts, remap: new Set(flags).size > 1 };
  });

  return {
    labels,
    names: files.map((f) => f.name),
    counts: Object.fromEntries(files.map((f) => [f.label, Object.keys(f.parsed.members).length])),
    moduleNames: Object.fromEntries(files.map((f) => [f.label, f.parsed.moduleName])),
    genuine,
    members,
    widgets,
    hasNew: !!N,
  };
}

// ---- Bulk grouping ----
// Group many uploaded files into per-controller sets keyed by version.
// Supports two conventions:
//   1. filename suffix:  frmXController_R21.js  (version = R21, base = frmXController)
//   2. version subfolder: R21/frmXController.js (relPath contains a version dir)
// `fileList`: [{ name, src, relPath? }]   `tokens`: e.g. ["R21","KBZ","R26"]
export function groupFiles(fileList, tokens) {
  const lc = tokens.map((t) => t.toLowerCase());
  const groups = new Map(); // base -> { base, byVersion: {token: {name, src}} }
  const unmatched = [];
  const ensure = (base) => {
    if (!groups.has(base)) groups.set(base, { base, byVersion: {} });
    return groups.get(base);
  };
  for (const f of fileList) {
    const nameLc = f.name.toLowerCase();
    let matched = false;
    // convention 1: _<token>.js suffix
    for (let i = 0; i < tokens.length; i++) {
      const suf = "_" + lc[i] + ".js";
      if (nameLc.endsWith(suf)) {
        ensure(f.name.slice(0, f.name.length - suf.length)).byVersion[tokens[i]] = f;
        matched = true; break;
      }
    }
    // convention 2: a version-named folder in the path
    if (!matched && f.relPath) {
      const parts = f.relPath.split(/[\/]/).map((p) => p.toLowerCase());
      const idx = lc.findIndex((t) => parts.includes(t));
      if (idx >= 0 && nameLc.endsWith(".js")) {
        ensure(f.name.replace(/\.js$/i, "")).byVersion[tokens[idx]] = f;
        matched = true;
      }
    }
    if (!matched) unmatched.push(f.name);
  }
  // stable sort by base name
  const list = [...groups.values()].sort((a, b) => a.base.localeCompare(b.base));
  return { groups: list, unmatched };
}

// ---- Project-folder helpers ----
// A main controller file (frmXController.js), not the generated *ControllerActions.js stub.
export function isMainController(name) {
  return /Controller\.js$/i.test(name) && !/ControllerActions\.js$/i.test(name);
}
// Matching key across projects: the path *under* controllers/ (so different project roots align).
export function controllerKey(relPath) {
  const p = (relPath || "").replace(/\\/g, "/");
  const i = p.toLowerCase().lastIndexOf("/controllers/");
  return i >= 0 ? p.slice(i + "/controllers/".length) : p.replace(/^.*\//, "");
}

// ---- MVC extensions (Business / Presentation controllers) ----
// These are AMD factories: define([], function(){ function X(){...} inheritsFrom(X, ...);
// X.prototype.m = function(){...}; ... return X; }). The *_Extn.js files instead use the
// define({ m: function(){...} }) object form. Both are reduced to the same member shape
// ({kind, raw, fmt, canon}) the form-controller engine uses, so buildModel/classify apply.
function walkAst(node, fn) {
  if (!node || typeof node.type !== "string") return;
  fn(node);
  for (const k in node) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => walkAst(c, fn));
    else if (v && typeof v.type === "string") walkAst(v, fn);
  }
}

export function extractModule(src) {
  src = (src || "").replace(/\r\n?/g, "\n").replace(/^\ufeff/, "");
  let ast;
  try {
    ast = parse(src, { ecmaVersion: "latest", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
  } catch (e) {
    throw new Error("Parse error: " + e.message);
  }
  let moduleName = null;
  const members = {};
  const put = (name, kind, raw) => {
    const f = fmt(raw);
    const prev = members[name];
    // a name defined twice: at runtime the LATER definition wins — keep it, and count the duplicates
    members[name] = { kind, raw, fmt: f, canon: canonOf(f), dups: prev ? (prev.dups || 1) + 1 : 1 };
  };

  // 1) X.prototype.m = <value>   (anywhere in the file)
  walkAst(ast, (n) => {
    if (n.type !== "AssignmentExpression" || n.left.type !== "MemberExpression") return;
    const L = n.left;
    if (L.object.type === "MemberExpression" && !L.object.computed && L.object.property.name === "prototype") {
      const name = L.property.name ?? L.property.value;
      if (name == null) return;
      if (!moduleName && L.object.object.type === "Identifier") moduleName = L.object.object.name;
      put(String(name), FUNC.has(n.right.type) ? "method" : "field", src.slice(n.right.start, n.right.end));
    }
  });

  // 2) define(...) — object form (members) or factory form (private functions / module vars)
  for (const node of ast.body) {
    if (node.type !== "ExpressionStatement" || node.expression.type !== "CallExpression") continue;
    const call = node.expression;
    if (!call.callee || call.callee.name !== "define") continue;
    for (const a of call.arguments) {
      if (a.type === "ObjectExpression") {
        for (const p of a.properties) {
          if (p.type !== "Property") continue;
          const key = p.key.name !== undefined ? p.key.name : p.key.value;
          if (key == null) continue;
          put(String(key), FUNC.has(p.value.type) ? "method" : "field", src.slice(p.value.start, p.value.end));
        }
      } else if (FUNC.has(a.type) && a.body && a.body.type === "BlockStatement") {
        for (const st of a.body.body) {
          if (st.type === "FunctionDeclaration" && st.id) {
            put(`ƒ ${st.id.name}`, "method", src.slice(st.start, st.end)); // constructor + private helpers
          } else if (st.type === "VariableDeclaration") {
            for (const d of st.declarations) if (d.id.type === "Identifier") put(`var ${d.id.name}`, "field", src.slice(d.start, d.end));
          }
        }
      }
    }
  }
  return { moduleName, members };
}

// ---- User-widget (component) controllers ----
// Mostly AMD factories that RETURN the controller object: define([deps], function(deps){ return { m: fn, ... }; }).
// Also seen: `var controller = {...}; return controller;`, prototype classes (`X.prototype.m = ...`), and define({...}).
// Members: returned-object properties (by key), prototype methods (by method name), factory-level helpers
// (`ƒ name` / `var name`), plus one pseudo-member for the define() dependency list so added requires show up.
export function extractComponent(src) {
  src = (src || "").replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  let ast;
  try {
    ast = parse(src, { ecmaVersion: "latest", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
  } catch (e) {
    throw new Error("Parse error: " + e.message);
  }
  let moduleName = null;
  const members = {};
  const put = (name, kind, raw) => {
    const f = fmt(raw);
    const prev = members[name];
    members[name] = { kind, raw, fmt: f, canon: canonOf(f), dups: prev ? (prev.dups || 1) + 1 : 1 };
  };
  const keyOf = (p) => (p.key.name !== undefined ? p.key.name : p.key.value);
  const putObject = (obj) => {
    for (const p of obj.properties) {
      if (p.type !== "Property") continue;
      const key = keyOf(p);
      if (key == null) continue;
      put(String(key), FUNC.has(p.value.type) ? "method" : "field", src.slice(p.value.start, p.value.end));
    }
  };

  for (const node of ast.body) {
    // file-level declarations outside define() (online / mobile banking controllers keep state there)
    if (node.type === "FunctionDeclaration" && node.id) { put(`ƒ ${node.id.name}`, "method", src.slice(node.start, node.end)); continue; }
    if (node.type === "VariableDeclaration") {
      for (const d of node.declarations) if (d.id.type === "Identifier") put(`var ${d.id.name}`, "field", src.slice(d.start, d.end));
      continue;
    }
    if (node.type !== "ExpressionStatement" || node.expression.type !== "CallExpression") continue;
    const call = node.expression;
    if (!call.callee || call.callee.name !== "define") continue;
    const deps = call.arguments.find((a) => a.type === "ArrayExpression");
    const factory = call.arguments.find((a) => FUNC.has(a.type));
    for (const a of call.arguments) {
      if (a.type === "Literal" && typeof a.value === "string") moduleName = a.value;
      if (a.type === "ObjectExpression") putObject(a);
    }
    if (deps || (factory && factory.params.length)) {
      const params = factory ? factory.params.map((p) => src.slice(p.start, p.end)).join(", ") : "";
      put("define() dependencies", "imports", `define(${deps ? src.slice(deps.start, deps.end) : "[]"}, function(${params}) {});`);
    }
    if (!factory || factory.body.type !== "BlockStatement") continue;
    const body = factory.body.body;
    // what the factory returns: an object literal, or the name of a variable holding one
    const ret = body.find((s) => s.type === "ReturnStatement" && s.argument);
    const retName = ret && ret.argument.type === "Identifier" ? ret.argument.name : null;
    for (const st of body) {
      if (st.type === "ReturnStatement" && st.argument && st.argument.type === "ObjectExpression") putObject(st.argument);
      else if (st.type === "FunctionDeclaration" && st.id) put(`ƒ ${st.id.name}`, "method", src.slice(st.start, st.end));
      else if (st.type === "VariableDeclaration") {
        for (const d of st.declarations) {
          if (d.id.type !== "Identifier") continue;
          if (d.id.name === retName && d.init && d.init.type === "ObjectExpression") putObject(d.init);
          else put(`var ${d.id.name}`, "field", src.slice(d.start, d.end));
        }
      } else if (st.type === "ExpressionStatement" && st.expression.type === "AssignmentExpression" && st.expression.left.type === "MemberExpression") {
        const L = st.expression.left, R = st.expression.right;
        const proto = L.object.type === "MemberExpression" && !L.object.computed && L.object.property.name === "prototype";
        const onRet = retName && L.object.type === "Identifier" && L.object.name === retName;
        if (proto || onRet) {
          const name = L.property.name ?? L.property.value;
          if (name == null) continue;
          if (proto && !moduleName && L.object.object.type === "Identifier") moduleName = L.object.object.name;
          put(String(name), FUNC.has(R.type) ? "method" : "field", src.slice(R.start, R.end));
        }
      }
    }
  }
  return { moduleName, members };
}

// A Business/Presentation controller file (not other scripts that may sit in mvcextensions).
export function isMvcController(relPath) {
  return /\/(Business|Presentation)Controllers\/[^/]+\.js$/i.test("/" + relPath.replace(/\\/g, "/"));
}
export function mvcKey(relPath) {
  const p = "/" + (relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const i = p.toLowerCase().lastIndexOf("/mvcextensions/");
  return i >= 0 ? p.slice(i + "/mvcextensions/".length) : p.slice(1);
}
export function mvcKind(key) {
  if (/_Extn\.js$/i.test(key)) return "Extension";
  return /\/BusinessControllers\//i.test("/" + key) ? "Business" : "Presentation";
}
