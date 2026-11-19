// Move to R26 for controllers (CtrlSync): KBZ's changes to one form / template controller, function by function, onto
// R26's controller file.
// R21 = base, KBZ = customisation, R26 = target. The members are the ones the comparison already uses
// (analyzer.js extractComponent: returned-object properties, prototype methods, factory / file-level functions and
// vars, the define() dependency list). Per member:
//   clean    KBZ changed it, R26 did not (or KBZ added it)          → KBZ's version moves (untick to keep R26)
//   merged   both changed it, edits on different lines             → line-by-line 3-way merge (diff3)
//   conflict both changed the same lines / R26 dropped a function KBZ changed / both added the same name
//            → keep R26, take KBZ, or edit the result by hand (starts from the merge with <<<<<<< markers)
//   removal  KBZ deleted it, R26 still has it                       → kept unless ticked
//   already  R26 already has KBZ's version                          → nothing to do
// The output is R26's file with only the chosen members' text replaced, added or removed: everything else keeps
// R26's exact bytes (line endings, BOM, comments). Moved KBZ code is KBZ's own text re-indented; a line merge or a
// hand edit is the formatted text the comparison shows.
import { parse } from "acorn";
import { extractComponent, buildModel } from "./analyzer.js";

const FUNC = new Set(["FunctionExpression", "ArrowFunctionExpression"]);
const DEPS = "define() dependencies";
const parseJs = (src) => parse(src, { ecmaVersion: "latest", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true });

/* ------------------------------------------------------------------ line-level 3-way merge */
// base -> other: other's index of every base line kept (LCS), undefined where the line went
function matchLines(base, other) {
  const n = base.length, m = other.length;
  // common head / tail first: most bodies differ in a few lines, so the LCS table stays small
  let h = 0; while (h < n && h < m && base[h] === other[h]) h++;
  let t = 0; while (t < n - h && t < m - h && base[n - 1 - t] === other[m - 1 - t]) t++;
  const map = new Array(n);
  for (let i = 0; i < h; i++) map[i] = i;
  for (let i = 0; i < t; i++) map[n - 1 - i] = m - 1 - i;
  const a = base.slice(h, n - t), b = other.slice(h, m - t);
  const A = a.length, B = b.length;
  if (A && B) {
    const dp = Array.from({ length: A + 1 }, () => new Int32Array(B + 1));
    for (let i = A - 1; i >= 0; i--) for (let j = B - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < A && j < B) {
      if (a[i] === b[j]) { map[h + i] = h + j; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
    }
  }
  return map;
}
const same = (x, y) => x.length === y.length && x.every((l, i) => l === y[i]);

// diff3 over lines: { lines (merged; conflict blocks carry markers), conflicts (count), clean (bool) }
export function diff3(baseText, kbzText, r26Text, labels = ["R21", "KBZ", "R26"]) {
  const B = (baseText || "").split("\n"), K = (kbzText || "").split("\n"), R = (r26Text || "").split("\n");
  if (baseText == null) B.length = 0;
  const mk = matchLines(B, K), mr = matchLines(B, R);
  const out = [];
  let conflicts = 0, i = 0, j = 0, k = 0;
  const nb = B.length;
  for (;;) {
    while (i < nb && mk[i] === j && mr[i] === k) { out.push(B[i]); i++; j++; k++; }
    if (i >= nb && j >= K.length && k >= R.length) break;
    let e = i;
    while (e < nb && (mk[e] === undefined || mr[e] === undefined)) e++;
    const je = e < nb ? mk[e] : K.length, ke = e < nb ? mr[e] : R.length;
    const b = B.slice(i, e), kk = K.slice(j, je), rr = R.slice(k, ke);
    if (same(kk, b)) out.push(...rr);
    else if (same(rr, b) || same(kk, rr)) out.push(...kk);
    else {
      conflicts++;
      out.push(`<<<<<<< ${labels[1]}`, ...kk, `||||||| ${labels[0]}`, ...b, "=======", ...rr, `>>>>>>> ${labels[2]}`);
    }
    i = e; j = je; k = ke;
  }
  return { lines: out, text: out.join("\n"), conflicts, clean: conflicts === 0 };
}
export const hasMarkers = (t) => /^(<<<<<<<|=======|>>>>>>>)( |$)/m.test(t || "");

/* ------------------------------------------------------------------ what moves, per member */
const sig = (x) => { let h = 0; const s = [x.bodies.R21, x.bodies.KBZ, x.bodies.R26].map((v) => v ?? "∅").join("\u0001"); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h.toString(36); };

// rows of one controller's model (buildModel with R21, KBZ, R26): what each changed member needs
export function ctrlRows(model) {
  const [O, C, N] = model.labels;
  const rows = [];
  for (const name of model.genuine) {
    const x = model.members[name];
    const b = x.bodies[O], k = x.bodies[C], r = x.bodies[N];
    const row = { name, kind: x.kind, change: x.change, bucket: x.bucket, base: b, kbz: k, r26: r, sig: null, state: "", note: "", merge: null, add: r == null, deps: name === DEPS };
    row.sig = sig({ bodies: { R21: b, KBZ: k, R26: r } });
    if (x.change === "Removed") {
      if (r == null) continue; // gone from R26 too
      Object.assign(row, { state: "removal", note: `${C} deleted it; ${N} still has it` });
    } else if (r != null && x.inNew === "matches_custom") {
      row.state = "already";
    } else if (r == null) {
      Object.assign(row, x.change === "Added" ? { state: "clean", note: `added by ${C}` } : { state: "conflict", note: `${C} changed it, but ${N} no longer has it — add ${C}'s version or leave it out` });
    } else if (x.change === "Added") {
      Object.assign(row, { state: "conflict", note: `added by both ${C} and ${N}, differently` });
      if (!row.deps) row.merge = diff3(null, k, r, model.labels);
    } else if (x.inNew === "same") {
      row.state = "clean";
    } else { // both changed it
      if (row.deps) Object.assign(row, { state: "conflict", note: "both changed the dependency list" });
      else {
        row.merge = diff3(b, k, r, model.labels);
        Object.assign(row, row.merge.clean ? { state: "merged", note: "line-by-line merge: their edits touch different lines" } : { state: "conflict", note: `${row.merge.conflicts} block${row.merge.conflicts === 1 ? "" : "s"} where both changed the same lines` });
      }
    }
    rows.push(row);
  }
  return rows;
}
// what happens to a row when nothing was chosen: clean → KBZ, merged → merge, removal → keep, conflict → open
export const defaultCtrlChoice = (row) => (row.state === "clean" ? "kbz" : row.state === "merged" ? "merge" : row.state === "removal" ? "r26" : row.state === "already" ? "r26" : null);
// the saved decisions (per member: { choice, edit, sig }) that still fit these rows; stale ones (the code changed) drop
export function choicesFor(rows, saved) {
  const ch = {}, ed = {};
  for (const row of rows) {
    const s = saved && saved[row.name];
    if (s && s.sig === row.sig) { ch[row.name] = s.choice; if (s.edit != null) ed[row.name] = s.edit; } else ch[row.name] = defaultCtrlChoice(row);
  }
  return { choices: ch, edits: ed };
}
// the text a member ends up with (formatted body), or null when it is left out
export function chosenBody(row, choice, edit) {
  if (choice === "kbz") return row.kbz;
  if (choice === "merge") return row.merge ? row.merge.text : row.kbz;
  if (choice === "edit") return edit ?? (row.merge ? row.merge.text : row.kbz);
  return row.r26; // keep R26 (for an add: left out)
}
export const undecidedOf = (rows, choices, edits) => rows.filter((r) => r.state === "conflict" && (!choices[r.name] || (choices[r.name] === "edit" && hasMarkers(chosenBody(r, "edit", edits[r.name])))));
export function ctrlCounts(rows, choices = {}, edits = {}) {
  const n = { clean: 0, merged: 0, conflict: 0, removal: 0, already: 0, undecided: 0, moving: 0 };
  for (const r of rows) {
    n[r.state]++;
    const c = choices[r.name];
    if (c && c !== "r26") n.moving++;
  }
  n.undecided = undecidedOf(rows, choices, edits).length;
  return n;
}

/* ------------------------------------------------------------------ where each member sits in a file */
// mirrors extractComponent: name -> { type: prop | stmt | decl | deps, cont, full: [s, e], val: [s, e], ... } (later wins)
export function locateMembers(src) {
  const ast = parseJs(src);
  const at = new Map(), seq = [];
  const conts = new Map(); // id -> { kind: "object" | "block", start, end, node }
  const put = (name, loc) => { loc.dups = at.has(name) ? at.get(name).dups + 1 : 1; loc.name = name; at.set(name, loc); seq.push(name); };
  const keyOf = (p) => (p.key.name !== undefined ? p.key.name : p.key.value);
  const obj = (o) => {
    const id = "obj@" + o.start;
    conts.set(id, { kind: "object", start: o.start, end: o.end, props: o.properties });
    o.properties.forEach((p, idx) => {
      if (p.type !== "Property") return;
      const key = keyOf(p);
      if (key == null) return;
      put(String(key), { type: "prop", cont: id, idx, full: [p.start, p.end], val: [p.value.start, p.value.end] });
    });
  };
  const decl = (node, d, cont) => ({ type: "decl", cont, idx: node.declarations.indexOf(d), full: [d.start, d.end], val: [d.start, d.end], stmt: [node.start, node.end], count: node.declarations.length, decls: node.declarations.map((x) => [x.start, x.end]) });
  conts.set("file", { kind: "block", start: 0, end: src.length, body: ast.body });
  for (const node of ast.body) {
    if (node.type === "FunctionDeclaration" && node.id) { put(`ƒ ${node.id.name}`, { type: "stmt", cont: "file", full: [node.start, node.end], val: [node.start, node.end] }); continue; }
    if (node.type === "VariableDeclaration") { for (const d of node.declarations) if (d.id.type === "Identifier") put(`var ${d.id.name}`, decl(node, d, "file")); continue; }
    if (node.type !== "ExpressionStatement" || node.expression.type !== "CallExpression") continue;
    const call = node.expression;
    if (!call.callee || call.callee.name !== "define") continue;
    const deps = call.arguments.find((a) => a.type === "ArrayExpression");
    const factory = call.arguments.find((a) => FUNC.has(a.type));
    conts.set("define", { kind: "block", start: node.start, end: node.end });
    for (const a of call.arguments) if (a.type === "ObjectExpression") obj(a);
    if (deps || (factory && factory.params.length)) {
      const ps = factory && factory.params.length ? [factory.params[0].start, factory.params[factory.params.length - 1].end] : null;
      put(DEPS, { type: "deps", cont: "define", full: [node.start, node.start], val: [node.start, node.start], deps: deps ? [deps.start, deps.end] : null, params: ps, factory: factory ? factory.start : null });
    }
    if (!factory || factory.body.type !== "BlockStatement") continue;
    const body = factory.body.body;
    conts.set("factory", { kind: "block", start: factory.body.start, end: factory.body.end, body });
    const ret = body.find((s) => s.type === "ReturnStatement" && s.argument);
    const retName = ret && ret.argument.type === "Identifier" ? ret.argument.name : null;
    for (const st of body) {
      if (st.type === "ReturnStatement" && st.argument && st.argument.type === "ObjectExpression") obj(st.argument);
      else if (st.type === "FunctionDeclaration" && st.id) put(`ƒ ${st.id.name}`, { type: "stmt", cont: "factory", full: [st.start, st.end], val: [st.start, st.end] });
      else if (st.type === "VariableDeclaration") {
        for (const d of st.declarations) {
          if (d.id.type !== "Identifier") continue;
          if (d.id.name === retName && d.init && d.init.type === "ObjectExpression") obj(d.init);
          else put(`var ${d.id.name}`, decl(st, d, "factory"));
        }
      } else if (st.type === "ExpressionStatement" && st.expression.type === "AssignmentExpression" && st.expression.left.type === "MemberExpression") {
        const L = st.expression.left, Rr = st.expression.right;
        const proto = L.object.type === "MemberExpression" && !L.object.computed && L.object.property.name === "prototype";
        const onRet = retName && L.object.type === "Identifier" && L.object.name === retName;
        if (proto || onRet) {
          const name = L.property.name ?? L.property.value;
          if (name == null) continue;
          put(String(name), { type: "stmt", cont: "factory", full: [st.start, st.end], val: [Rr.start, Rr.end] });
        }
      }
    }
    if (ret) conts.get("factory").ret = ret.start;
  }
  return { at, seq, conts };
}

/* ------------------------------------------------------------------ write the merged file */
const lineStart = (src, pos) => src.lastIndexOf("\n", pos - 1) + 1;
const indentAt = (src, pos) => /^[ \t]*/.exec(src.slice(lineStart(src, pos), pos))[0];
const nl = (t) => t.replace(/\r\n?/g, "\n");
// text written at `to`: lines after the first lose `from` (where they start with it) and gain `to`
const reindent = (text, from, to) => nl(text).split("\n").map((l, i) => (i === 0 ? l : !l.trim() ? "" : to + (from && l.startsWith(from) ? l.slice(from.length) : l))).join("\n");
// the dependency pseudo-member's text: define([deps], function(params) {});
function depsParts(text) {
  const m = /^define\((\[[\s\S]*\]),\s*function\(([\s\S]*)\)\s*\{\s*\}\);?\s*$/.exec((text || "").trim());
  return m ? { deps: m[1], params: m[2] } : null;
}
const sameKind = (a, b) => (a.type === "prop") === (b.type === "prop") && (a.type === "prop" || a.cont === b.cont);

// where a member goes when no neighbour of it is in R26: after the last property of R26's main object / before the
// factory's return / before define() (file level)
// (gone: members being removed — nothing is placed next to them)
function endOf(src, L, lk, gone) {
  if (lk.type === "prop") {
    const per = new Map();
    for (const l of L.at.values()) if (l.type === "prop") { if (!per.has(l.cont)) per.set(l.cont, []); per.get(l.cont).push(l); }
    let best = null;
    for (const list of per.values()) if (!best || list.length > best.length) best = list;
    if (!best) {
      const o = [...L.conts.values()].find((c) => c.kind === "object");
      if (!o) return null;
      const outer = indentAt(src, o.start);
      return { at: o.start + 1, mode: "empty", indent: outer + "    ", outer };
    }
    const kept = best.filter((l) => !gone.has(l.name)).sort((a, b) => a.full[1] - b.full[1]);
    if (kept.length) { const last = kept[kept.length - 1]; return { at: last.full[1], mode: "append", indent: indentAt(src, last.full[0]) }; }
    const first = [...best].sort((a, b) => a.full[0] - b.full[0])[0]; // every property removed: in front of the first
    return { at: first.full[0], mode: "before-prop", indent: indentAt(src, first.full[0]) };
  }
  if (lk.cont === "file") { const d = L.conts.get("define"); return d ? { at: d.start, mode: "before", indent: indentAt(src, d.start) } : { at: src.length, mode: "append-stmt", indent: "" }; }
  const f = L.conts.get("factory");
  if (!f) return null;
  if (f.ret != null) return { at: f.ret, mode: "before", indent: indentAt(src, f.ret) };
  return { at: f.end - 1, mode: "append-stmt", indent: indentAt(src, f.end - 1) + "    " };
}
// a whole statement, with its own line when it stands alone on it
function stmtRemoval(src, [s, e]) {
  const whole = !src.slice(lineStart(src, s), s).trim();
  const rest = /^[ \t]*\r?\n/.exec(src.slice(e));
  return { at: whole ? lineStart(src, s) : s, end: whole && rest ? e + rest[0].length : e, text: "" };
}
// the ranges removed members take out. Properties of one object (and declarators of one `var a, b, c;`) are removed
// as runs of neighbours so their commas never overlap: a run followed by a kept item takes its own commas; a run
// at the end takes the comma before it
function removals(src, L, locs) {
  const ops = [], groups = new Map();
  for (const l of locs) {
    if (l.type === "prop" || (l.type === "decl" && l.count > 1)) {
      const g = l.type === "prop" ? "p" + l.cont : "d" + l.stmt[0];
      if (!groups.has(g)) groups.set(g, { l, idx: new Set() });
      groups.get(g).idx.add(l.idx);
    } else ops.push(stmtRemoval(src, l.type === "decl" ? l.stmt : l.full));
  }
  for (const { l, idx } of groups.values()) {
    const items = l.type === "prop" ? L.conts.get(l.cont).props.map((p) => [p.start, p.end]) : l.decls;
    if (l.type === "decl" && idx.size === items.length) { ops.push(stmtRemoval(src, l.stmt)); continue; }
    const n = items.length, sorted = [...idx].sort((a, b) => a - b);
    for (let k = 0; k < sorted.length;) {
      const i = sorted[k];
      let j = i;
      k++;
      while (k < sorted.length && sorted[k] === j + 1) { j++; k++; }
      if (j < n - 1) {
        const s = items[i][0], ls = lineStart(src, s), own = !src.slice(ls, s).trim();
        const m = /^\s*,[ \t]*(\r?\n)?/.exec(src.slice(items[j][1]));
        if (m) ops.push({ at: own && m[1] ? ls : s, end: items[j][1] + m[0].length, text: "" });
        else ops.push({ at: s, end: items[j + 1][0], text: "" });
      } else if (i > 0) ops.push({ at: items[i - 1][1], end: items[j][1], text: "" });
      else { const m = /^\s*,/.exec(src.slice(items[j][1])); ops.push({ at: items[0][0], end: items[j][1] + (m ? m[0].length : 0), text: "" }); } // all of them, with a trailing comma
    }
  }
  return ops;
}

// the merged controller: R26's text with the chosen members replaced / added / removed. kbzSrc = KBZ's file text.
// Returns { text, problems: [{ name, text, warn? }], changed }
export function applyCtrlMerge(r26Src, kbzSrc, rows, choices, edits = {}) {
  const problems = [];
  const acts = rows.filter((r) => r.state !== "already" && choices[r.name] && choices[r.name] !== "r26");
  if (!acts.length) return { text: r26Src, problems, changed: 0 };
  const EOL = /\r\n/.test(r26Src) ? "\r\n" : "\n";
  const eol = (t) => t.replace(/\n/g, EOL);
  let L26, LK;
  try { L26 = locateMembers(r26Src); } catch (e) { return { text: r26Src, problems: [{ name: "", text: `R26's file does not parse: ${e.message}` }], changed: 0 }; }
  try { LK = locateMembers(kbzSrc); } catch (e) { return { text: r26Src, problems: [{ name: "", text: `KBZ's file does not parse: ${e.message}` }], changed: 0 }; }
  const ops = []; // { at, end, text }
  const kbzIndent = (lk) => indentAt(kbzSrc, lk.full[0]);
  // a member's value as written at indent `to`: KBZ's own text, or the formatted merge / hand edit
  const valueText = (row, choice, to) => {
    const lk = LK.at.get(row.name);
    if (choice === "kbz" && lk) return reindent(kbzSrc.slice(lk.val[0], lk.val[1]), kbzIndent(lk), to);
    return reindent(chosenBody(row, choice, edits[row.name]) || "", "", to);
  };
  const adds = new Map(); // anchor -> { anchor, list }
  // members removed (ticked removals): taken out together, and never used as the place to add something
  const gone = new Set(), goneLocs = [];
  for (const row of acts) {
    if (row.state !== "removal" || row.deps) continue;
    const l = L26.at.get(row.name);
    if (!l) continue;
    if (l.dups > 1) { problems.push({ name: row.name, text: `defined ${l.dups}× in R26 — remove it by hand` }); continue; }
    gone.add(row.name); goneLocs.push(l);
  }
  ops.push(...removals(r26Src, L26, goneLocs));

  for (const row of acts) {
    const choice = choices[row.name];
    const l = L26.at.get(row.name);
    if (row.deps) {
      const want = depsParts(chosenBody(row, choice, edits[row.name]));
      if (!want) { problems.push({ name: row.name, text: "the dependency list could not be read — change it by hand" }); continue; }
      if (!l) { problems.push({ name: row.name, text: `R26's file has no define() dependency list (it is written as define({ … })) — add ${want.deps} by hand, or untick this to keep R26's` }); continue; }
      if (!l.deps) { problems.push({ name: row.name, text: "R26's define() has no dependency array — add it by hand" }); continue; }
      ops.push({ at: l.deps[0], end: l.deps[1], text: eol(nl(want.deps)) });
      if (l.params) ops.push({ at: l.params[0], end: l.params[1], text: want.params });
      else if (want.params && l.factory != null) { const p = r26Src.indexOf("(", l.factory); if (p >= 0) ops.push({ at: p + 1, end: p + 1, text: want.params }); }
      continue;
    }
    if (row.state === "removal") continue; // done above
    if (l) { // in R26: replace its value where it stands (a merge / edit that comes out as R26's code leaves R26's text)
      if (choice !== "kbz" && chosenBody(row, choice, edits[row.name]) === row.r26) continue;
      if (l.dups > 1) problems.push({ name: row.name, warn: true, text: `defined ${l.dups}× in R26 — the last definition (the one that runs) was replaced` });
      ops.push({ at: l.val[0], end: l.val[1], text: eol(valueText(row, choice, indentAt(r26Src, l.full[0]))) });
      continue;
    }
    // not in R26: next to the member it follows in KBZ (or the one it precedes), else at the end of its container
    const lk = LK.at.get(row.name);
    if (!lk) { problems.push({ name: row.name, text: "not found in KBZ's file" }); continue; }
    const kseq = [...new Set(LK.seq)].filter((n) => LK.at.get(n).type !== "deps" && sameKind(LK.at.get(n), lk));
    const pos = kseq.indexOf(row.name);
    let anchor = null;
    const usable = (n) => { const a = L26.at.get(n); return a && !gone.has(n) && a.type !== "deps" && sameKind(a, lk) ? a : null; };
    for (let i = pos - 1; i >= 0 && !anchor; i--) { const a = usable(kseq[i]); if (a) anchor = { after: a }; }
    for (let i = pos + 1; i < kseq.length && !anchor; i++) { const a = usable(kseq[i]); if (a) anchor = { before: a }; }
    if (!anchor) { const e = endOf(r26Src, L26, lk, gone); if (e) anchor = { end: e }; }
    if (!anchor) { problems.push({ name: row.name, text: "no place for it in R26's file — add it by hand" }); continue; }
    const key = anchor.after ? "a" + anchor.after.full[0] : anchor.before ? "b" + anchor.before.full[0] : "e" + anchor.end.at;
    if (!adds.has(key)) adds.set(key, { anchor, list: [] });
    adds.get(key).list.push({ row, lk, choice });
  }

  // additions, in KBZ's order per place
  for (const { anchor, list } of adds.values()) {
    const ref = anchor.after || anchor.before;
    const ind = ref ? indentAt(r26Src, ref.type === "decl" ? ref.stmt[0] : ref.full[0]) : anchor.end.indent;
    const isProp = list[0].lk.type === "prop";
    const texts = list.map(({ row, lk, choice }) => {
      const from = kbzIndent(lk);
      // the whole member (key: value / statement) with its value as chosen
      const t = reindent(kbzSrc.slice(lk.full[0], lk.val[0]), from, ind) + valueText(row, choice, ind) + reindent(kbzSrc.slice(lk.val[1], lk.full[1]), from, ind);
      return eol(lk.type === "decl" ? `var ${t};` : t);
    });
    const E = EOL;
    if (anchor.after) {
      const a = anchor.after, at = a.type === "decl" ? a.stmt[1] : a.full[1];
      ops.push({ at, end: at, text: texts.map((t) => (isProp ? "," : "") + E + ind + t).join("") });
    } else if (anchor.before) {
      const b = anchor.before, at = b.type === "decl" ? b.stmt[0] : b.full[0];
      ops.push({ at, end: at, text: texts.map((t) => t + (isProp ? "," : "") + E + ind).join("") });
    } else {
      const e = anchor.end;
      const text = e.mode === "append" ? texts.map((t) => "," + E + ind + t).join("")
        : e.mode === "empty" ? texts.map((t, i) => (i ? "," : "") + E + ind + t).join("") + E + e.outer
          : e.mode === "before-prop" ? texts.join("," + E + ind)
            : e.mode === "before" ? texts.map((t) => t + E + ind).join("")
              : texts.map((t) => E + ind + t).join("");
      ops.push({ at: e.at, end: e.at, text });
    }
  }

  // apply from the end so earlier positions hold; at one position the wider change goes first (an insertion lands
  // in front of the text it replaced)
  ops.sort((x, y) => y.at - x.at || (y.end - y.at) - (x.end - x.at));
  for (let i = 1; i < ops.length; i++) if (ops[i].end > ops[i - 1].at) problems.push({ name: "", text: "two changes overlap in the file — check the result" });
  let text = r26Src;
  for (const o of ops) text = text.slice(0, o.at) + o.text + text.slice(o.end);
  try { parseJs(text); } catch (e) { problems.push({ name: "", text: `the merged file does not parse: ${e.message}` }); }
  return { text, problems, changed: acts.length };
}

/* ------------------------------------------------------------------ checks on the result */
const IDENT = /[A-Za-z_$][\w$]*/g;
// what to look at before writing: the result parses, its members are what was chosen, moved code names widgets the R26
// form has and calls this.<fn>() that exist. kbzWidgets / r26Widgets: widget ids of the form in KBZ / R26 (null for a
// template controller); framework: method names every controller inherits
export function ctrlChecks(rows, choices, edits, result, { kbzWidgets, r26Widgets, framework } = {}) {
  const out = [...result.problems.map((p) => ({ name: p.name, level: p.warn ? "warn" : "error", text: p.text }))];
  let members = null;
  try { members = extractComponent(result.text).members; } catch { /* reported as a parse problem */ }
  if (!members) return out;
  for (const row of rows) {
    const c = choices[row.name];
    if (!c || c === "r26" || row.state === "already" || row.deps) continue;
    if (row.state === "removal") { if (members[row.name]) out.push({ name: row.name, level: "error", text: "still in the result" }); continue; }
    const body = chosenBody(row, c, edits[row.name]);
    if (!members[row.name]) { out.push({ name: row.name, level: "error", text: "missing from the result" }); continue; }
    if (hasMarkers(body)) out.push({ name: row.name, level: "error", text: "still has <<<<<<< conflict markers" });
    const ids = new Set(body.match(IDENT) || []);
    if (kbzWidgets && r26Widgets) {
      const miss = [...ids].filter((w) => kbzWidgets.has(w) && !r26Widgets.has(w));
      if (miss.length) out.push({ name: row.name, level: "warn", kind: "widget", ids: miss, text: `uses ${miss.join(", ")} — on ${"KBZ"}'s form but not ${"R26"}'s (move ${miss.length === 1 ? "it" : "them"} with FormForge)` });
    }
    const calls = [...new Set([...body.matchAll(/\bthis\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))];
    const missing = calls.filter((n) => !members[n] && !(framework && framework.has(n)));
    if (missing.length) out.push({ name: row.name, level: "warn", kind: "call", text: `calls this.${missing.join("(), this.")}() — not in the merged controller` });
  }
  return out;
}
export const FRAMEWORK = new Set(["destroy", "getCurrentForm", "getCurrentFormFriendlyName", "getPreviousForm", "getPreviousFormFriendlyName", "pauseNavigation", "resumeNavigation", "show",
  "attachToModule", "didUpdateUI", "raiseEvent", "shouldUpdateUI", "updateUI", "willUpdateUI", "executeOnParent", "presenter", "view", "loadModule"]);

/* ------------------------------------------------------------------ the whole controller, end to end */
// read R21 / KBZ / R26, build the rows and (with choices) the merged text — used by the window and bulk generation
export async function ctrlPlan(files, labels = ["R21", "KBZ", "R26"]) {
  const srcs = await Promise.all(files.map((f) => (f ? f.text() : null)));
  const parsed = srcs.map((s) => (s == null ? null : extractComponent(s)));
  const model = buildModel(parsed.map((p, i) => ({ label: labels[i], name: "", src: srcs[i], parsed: p })));
  return { srcs, model, rows: ctrlRows(model) };
}
// widget ids a member names, among a form's widget ids
export const widgetsIn = (text, ids) => (ids ? [...new Set((text || "").match(IDENT) || [])].filter((w) => ids.has(w)) : []);
// controller key (ch/module/frmXController/frmXController.js) -> its form key (ch/module/frmX.sm); templates have no module
export function formKeyOfCtrl(key) {
  const s = key.split("/");
  if (s.length < 4) return null;
  const n = s[s.length - 1].replace(/Controller\.js$/i, "");
  return [...s.slice(0, -2), `${n}.sm`].join("/");
}
// where the R26 controller is written, relative to the output folder: <MA>/controllers/<ch>/…/<name>Controller.js
export function ctrlOutPath(file, app) {
  const rel = (file && (file.webkitRelativePath || file.name) || "").replace(/\\/g, "/");
  const m = /(?:^|\/)controllers\//i.exec(rel);
  if (!m) return null;
  const tail = rel.slice(m.index + (m[0].startsWith("/") ? 1 : 0));
  return (app ? app + "/" : "") + tail;
}

/* ------------------------------------------------------------------ triage (CtrlSync list) */
export const CTRL_TRIAGE = [
  ["nothing", "Nothing to do", "KBZ did not change it"],
  ["quick", "Ready", "KBZ's changes move cleanly or merge line by line — nothing to decide"],
  ["decide", "Conflicts to decide", "KBZ and R26 changed the same lines, or R26 dropped a function KBZ changed"],
  ["nocopy", "Changed, no R26 controller", "KBZ changed it; no R26 controller matched"],
  ["new", "New in KBZ", "a controller only KBZ has"],
  ["removed", "Removed in KBZ", "KBZ dropped it"],
  ["r26only", "Only in R26", "new R26 controller, not retrofit work"],
  ["tablet", "Tablet / watch", "the micro apps carry no tablet or watch forms"],
  ["error", "Can't read", "one of the versions does not parse"],
];
// r: one CtrlSync result (analyzeSets); rows: ctrlRows(r.model) or null; saved: this controller's decisions
export function ctrlTriageOf(r, rows, saved, labels, reportRow) {
  const [O, C, N] = labels;
  if (reportRow && reportRow.status === "tablet") return "tablet";
  if (r.error) return "error";
  const has = (l) => (r.present || []).includes(l);
  if (r.incomplete) return has(C) && !has(O) ? "new" : has(O) && !has(C) ? "removed" : "r26only";
  if (!r.model || !r.model.genuine.length) return "nothing";
  if (!r.model.hasNew || !has(N)) return "nocopy";
  if (!rows || !rows.length) return "nothing";
  const { choices, edits } = choicesFor(rows, saved);
  return undecidedOf(rows, choices, edits).length ? "decide" : "quick";
}
