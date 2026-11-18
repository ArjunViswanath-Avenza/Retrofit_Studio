// Moving KBZ's segment-template changes onto R26, one change at a time (TemplateTwin · "Move to R26").
// R21 is the base, KBZ the customisation, one R26 copy the target. Every difference between R21 and KBZ becomes a row:
//   prop    a property (top-level widget JSON key) KBZ changed
//   add     a widget KBZ added
//   remove  a widget KBZ removed
//   parent  a widget KBZ moved under another parent
//   order   a container whose children KBZ put in another order
//   gone    a widget KBZ changed that R26 no longer has
// and each row is sorted by what R26 did with the same thing:
//   clean    R26 left it as in R21 -> moving it is safe (selected to begin with)
//   already  R26 has KBZ's value already -> nothing to do
//   conflict R26 changed it too, differently -> someone must choose (nothing is generated until every one is chosen)
//   removal  KBZ removed a widget R26 still has -> kept unless chosen (R26 code may use it)
// A choice is "kbz" (move KBZ's change) or "r26" (keep R26). applyMerge builds the merged widget set from R26 + the
// "kbz" choices; writeFiles turns it into the template folder (unchanged widget files byte-for-byte as in R26).
// Object-valued properties (responsiveData, accessibilityconfig, dataDiffs, …) are compared value by value: one row per
// changed leaf (row.path, e.g. responsiveData › b1 › width), so KBZ and R26 changing different breakpoints of the same
// property is not a conflict. A {type, value} pair stays one value.
// Design-time rows (Visualizer's own canvas state: context, breakpointInfo, prevDevice, …) and widget-id (kuid) rows
// start as "keep R26" (row.design), whatever their state — they are noise when moved, and a kuid change can break a
// component contract's srcWgtKUID links.
import { sameValue, commonOrder, isNoiseKey } from "./forms.js";

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const parentOf = (w) => (w && w.parent != null ? w.parent : null);
const isDunder = (k) => k.length > 4 && k.startsWith("__") && k.endsWith("__");

export const DESIGN_KEYS = new Set(["context", "breakpointInfo", "currentBreakpoint", "prevDevice", "prevPlatform", "device", "platform", "initdone", "addWidgetsdone", "allboxes", "areflexpropsreferenced", "isdatareferenced", "snapgridsize", "snaptogrid", "canvasWidth", "iscustomlayout", "currentLocale", "containerId", "DNDConfig", "_children_", "pf", "masterType", "shellCSS", "kuid", "_pxMenuIndex"]);
export const isDesignKey = (k) => DESIGN_KEYS.has(k);

// one row per changed leaf of an object-valued property; [{ path: [] }] = the property as a whole
const splittable = (v) => !!v && typeof v === "object" && !Array.isArray(v) && !("value" in v) && !("type" in v);
function leafRows(v0, v1, v2, path = [], depth = 0) {
  const vs = [v0, v1, v2].filter((v) => v !== undefined && v !== null);
  if (depth < 4 && vs.length && vs.every(splittable)) {
    const out = [];
    for (const s of new Set(vs.flatMap((v) => Object.keys(v)))) {
      if (isDunder(s)) continue; // IDE state travels with its container
      const a = v0 ? v0[s] : undefined, b = v1 ? v1[s] : undefined, c = v2 ? v2[s] : undefined;
      if (sameValue(a, b)) continue;
      out.push(...leafRows(a, b, c, [...path, s], depth + 1));
    }
    if (out.length) return out;
  }
  return [{ path, v0, v1, v2 }];
}
// the name a leaf row is about (responsiveData › b1 › skin -> "skin"; dataDiffs › lbl › text › Default -> "text")
export const leafName = (r) => { const p = (r.path || []).filter((s) => s !== "Default"); return p.length ? p[p.length - 1] : r.key; };
export const rowLabel = (r) => (r.path && r.path.length ? `${r.key} › ${r.path.join(" › ")}` : r.key);

// set one leaf inside a widget property: missing containers are created (carrying KBZ's IDE-only __x__ entries);
// a removed value drops the containers it leaves empty that KBZ does not have either
function setLeaf(w, key, path, value, w1) {
  const chain = [key, ...path];
  const trail = [];
  let cur = w, src = w1;
  for (let i = 0; i < chain.length - 1; i++) {
    const s = chain[i];
    src = src && typeof src === "object" ? src[s] : undefined;
    if (!cur[s] || typeof cur[s] !== "object" || Array.isArray(cur[s])) {
      if (value === undefined) return;
      cur[s] = Object.fromEntries(Object.entries(src && typeof src === "object" ? src : {}).filter(([k]) => isDunder(k)).map(([k, v]) => [k, clone(v)]));
    }
    trail.push([cur, s, src]);
    cur = cur[s];
  }
  const last = chain[chain.length - 1];
  if (value !== undefined) { cur[last] = clone(value); return; }
  delete cur[last];
  for (let i = trail.length - 1; i >= 0; i--) {
    const [p, s, kbz] = trail[i];
    if (Object.keys(p[s]).some((k) => !isDunder(k)) || kbz !== undefined) break;
    delete p[s];
  }
}

// widget ids in tree order (parents before children), following KBZ, then R26-only and R21-only widgets
function treeOrder(...Ws) {
  const out = [], seen = new Set();
  const all = new Set(Ws.flatMap((W) => Object.keys(W)));
  const kids = new Map();
  for (const W of Ws) for (const [id, w] of Object.entries(W)) {
    const p = parentOf(w);
    if (!kids.has(p)) kids.set(p, []);
    if (!kids.get(p).includes(id)) kids.get(p).push(id);
  }
  const walk = (id) => { if (seen.has(id)) return; seen.add(id); out.push(id); for (const c of kids.get(id) || []) walk(c); };
  for (const id of all) { const p = Ws.map((W) => W[id]).find(Boolean); if (!all.has(parentOf(p))) walk(id); }
  for (const id of all) walk(id);
  return out;
}

function depthIn(W, id) { let d = 0, p = parentOf(W[id]); const seen = new Set(); while (p != null && W[p] && !seen.has(p)) { seen.add(p); d++; p = parentOf(W[p]); } return d; }

// every widget property key worth comparing
const propKeys = (...ws) => [...new Set(ws.flatMap((w) => (w ? Object.keys(w) : [])))].filter((k) => !isNoiseKey(k));

// changed(w0, w1): has KBZ changed anything on this widget (properties, parent, child order)?
function changedWidget(w0, w1) {
  if (propKeys(w0, w1).some((k) => !sameValue(w0[k], w1[k]))) return true;
  if (parentOf(w0) !== parentOf(w1)) return true;
  const [a, b] = commonOrder(w0.children, w1.children);
  return a.join("|") !== b.join("|");
}

export function mergeRows(W0, W1, W2) {
  const rows = [];
  const add = (r) => rows.push({ ...r, rid: `${r.kind}:${r.wid}${r.key ? ":" + r.key : ""}${r.path && r.path.length ? "." + r.path.join(".") : ""}` });
  for (const id of treeOrder(W1, W2, W0)) {
    const w0 = W0[id], w1 = W1[id], w2 = W2[id];
    const wType = (w1 || w2 || w0).wType || "";
    if (!w0 && w1) {
      // KBZ added it
      if (!w2) add({ kind: "add", wid: id, wType, state: "clean", parent: parentOf(w1) });
      else {
        const same = propKeys(w1, w2).every((k) => sameValue(w1[k], w2[k])) && parentOf(w1) === parentOf(w2);
        add({ kind: "add", wid: id, wType, state: same ? "already" : "conflict", parent: parentOf(w1), note: same ? "R26 has the same widget" : "R26 also has a widget with this id — different" });
      }
      continue;
    }
    if (w0 && !w1) {
      if (w2) add({ kind: "remove", wid: id, wType, state: "removal", note: sameWidget(w0, w2) ? "" : "R26 changed this widget since R21" });
      continue;
    }
    if (!w0 || !w1) continue;
    if (!w2) {
      if (changedWidget(w0, w1)) add({ kind: "gone", wid: id, wType, state: "conflict", parent: parentOf(w1), note: "KBZ changed this widget; R26 no longer has it" });
      continue;
    }
    for (const k of propKeys(w0, w1, w2)) {
      if (sameValue(w0[k], w1[k])) continue;
      for (const l of leafRows(w0[k], w1[k], w2[k])) {
        add({ kind: "prop", wid: id, wType, key: k, path: l.path, base: l.v0, kbz: l.v1, r26: l.v2, state: stateOf(l.v0, l.v1, l.v2), design: isDesignKey(k) });
      }
    }
    if (parentOf(w0) !== parentOf(w1)) {
      const p0 = parentOf(w0), p1 = parentOf(w1), p2 = parentOf(w2);
      add({ kind: "parent", wid: id, wType, base: p0, kbz: p1, r26: p2, state: p2 === p0 ? "clean" : p2 === p1 ? "already" : "conflict" });
    }
    // child order: only children every version has
    const in3 = (c) => w0.children && w1.children && w2.children && w0.children.includes(c) && w1.children.includes(c) && w2.children.includes(c);
    const o0 = (w0.children || []).filter(in3), o1 = (w1.children || []).filter(in3), o2 = (w2.children || []).filter(in3);
    if (o0.join("|") !== o1.join("|")) {
      add({ kind: "order", wid: id, wType, base: o0, kbz: o1, r26: o2, state: o2.join("|") === o0.join("|") ? "clean" : o2.join("|") === o1.join("|") ? "already" : "conflict" });
    }
  }
  return rows;
}
const sameWidget = (a, b) => !changedWidget(a, b);
const stateOf = (v0, v1, v2) => (sameValue(v2, v0) ? "clean" : sameValue(v2, v1) ? "already" : "conflict");

// what a conflict is about, to decide many at once: a property, or one value of it (responsiveData › skin); other kinds
// by kind ("(add)", "(parent)" …). The breakpoint a responsiveData value belongs to (b1 … b4), else null.
export const aboutOf = (r) => (r.kind !== "prop" ? `(${r.kind})` : r.path && r.path.length ? `${r.key} › ${leafName(r)}` : r.key);
export const breakpointOf = (r) => (r.kind === "prop" && r.key === "responsiveData" && r.path && /^b\d+$/.test(r.path[0]) ? r.path[0] : null);
// conflict rules kept for every form: [{ by: "about" | "bp", k, choice: "kbz" | "r26" }]; a later rule wins over an earlier one
export function ruleChoice(r, rules) {
  let c = null;
  for (const x of rules || []) if ((x.by === "about" && aboutOf(r) === x.k) || (x.by === "bp" && breakpointOf(r) === x.k)) c = x.choice;
  return c;
}

// the choice a row starts with
export const defaultChoice = (r) => (r.design ? "r26" : r.state === "clean" ? "kbz" : r.state === "removal" ? "r26" : r.state === "already" ? "r26" : null);

// merged widget set: R26 plus every row chosen "kbz". parentFor: rid -> parent id chosen for an added widget whose KBZ
// parent is not in the result. Only what a chosen row changes is changed — R26's own quirks (a child listed under
// another letter case, a stale entry) stay as they are. Returns { W, problems: [{rid, text}], removedWith, touched }
export function applyMerge(W1, W2, rows, choices, parentFor = {}) {
  const W = {};
  for (const [id, w] of Object.entries(W2)) W[id] = clone(w);
  const problems = [], removedWith = {}, touched = new Set();
  const take = (r) => choices[r.rid] === "kbz";
  const leave = new Map(); // container -> ids that leave its children list
  const arrive = new Map(); // container -> ids that join it
  const note = (m, p, id) => { if (p == null) return; if (!m.has(p)) m.set(p, new Set()); m.get(p).add(id); };
  // 1. removals (with everything under the widget in R26)
  for (const r of rows) if (r.kind === "remove" && take(r) && W[r.wid]) {
    const gone = [];
    const drop = (id) => { gone.push(id); note(leave, parentOf(W[id]), id); delete W[id]; for (const [c, w] of Object.entries(W)) if (parentOf(w) === id) drop(c); };
    drop(r.wid);
    removedWith[r.rid] = gone.slice(1);
  }
  // 2. added / restored widgets, parents first
  const adds = rows.filter((r) => (r.kind === "add" || r.kind === "gone") && take(r)).sort((a, b) => depthIn(W1, a.wid) - depthIn(W1, b.wid));
  for (const r of adds) {
    const w = clone(W1[r.wid]);
    if (Array.isArray(w.children)) w.children = [];
    const p = parentFor[r.rid] || parentOf(W1[r.wid]);
    if (p != null && !W[p]) { problems.push({ rid: r.rid, text: `its parent ${p} is not in the result — choose a parent` }); continue; }
    if (W2[r.wid]) note(leave, parentOf(W2[r.wid]), r.wid); // replacing R26's widget of the same id
    w.parent = p;
    W[r.wid] = w;
    note(arrive, p, r.wid);
    touched.add(r.wid);
  }
  // 3. properties
  for (const r of rows) if (r.kind === "prop" && take(r) && W[r.wid]) {
    if (r.path && r.path.length) setLeaf(W[r.wid], r.key, r.path, r.kbz, W1[r.wid]);
    else if (r.kbz === undefined) delete W[r.wid][r.key]; else W[r.wid][r.key] = clone(r.kbz);
    touched.add(r.wid);
  }
  // 4. new parents
  for (const r of rows) if (r.kind === "parent" && take(r) && W[r.wid]) {
    if (!W[r.kbz]) { problems.push({ rid: r.rid, text: `new parent ${r.kbz} is not in the result` }); continue; }
    note(leave, parentOf(W[r.wid]), r.wid);
    note(arrive, r.kbz, r.wid);
    W[r.wid].parent = r.kbz;
    touched.add(r.wid);
  }
  // 5. children lists of the containers these changes touch: R26's list, minus who left, plus who arrived (placed
  //    after the sibling it follows in KBZ), then KBZ's order where an order row is chosen
  const orderRows = new Map(rows.filter((r) => r.kind === "order" && take(r)).map((r) => [r.wid, r]));
  for (const id of new Set([...leave.keys(), ...arrive.keys(), ...orderRows.keys()])) {
    const w = W[id];
    if (!w) continue;
    const out = leave.get(id) || new Set(), inn = arrive.get(id) || new Set();
    let list = (Array.isArray(w.children) ? w.children : []).filter((c) => !out.has(c) || inn.has(c));
    const kbzList = (W1[id] && W1[id].children) || [];
    for (const c of inn) {
      if (list.includes(c)) continue;
      const k = kbzList.indexOf(c);
      const before = k > 0 ? kbzList.slice(0, k).reverse().find((x) => list.includes(x)) : null;
      list.splice(before ? list.indexOf(before) + 1 : k === 0 ? 0 : list.length, 0, c);
    }
    const o = orderRows.get(id);
    if (o) {
      const slots = list.map((c, i) => (o.kbz.includes(c) ? i : -1)).filter((i) => i >= 0);
      const kbzOrder = o.kbz.filter((c) => list.includes(c));
      slots.forEach((slot, k) => { list[slot] = kbzOrder[k]; });
    }
    const before = W2[id] && Array.isArray(W2[id].children) ? W2[id].children : null;
    if (!before || before.join("|") !== list.join("|")) { w.children = list; touched.add(id); }
  }
  return { W, problems, removedWith, touched };
}

// what the selected changes bring in that R26 may not have: skins, images, i18n keys; plus widget kuids used twice
// i18nKeys: every key of every R26 i18n.json (all micro apps, all languages) — the running composite app uses them all
export function dependencyIssues(rows, choices, merged, kbzAssets, r26Assets, i18nKeys) {
  const out = [];
  const seen = new Set();
  const check = (r, key, v) => {
    if (typeof v !== "string" || !v) return;
    const k = key.replace(/^_+|_+$/g, "").toLowerCase();
    let issue = null;
    if (/skin/.test(k)) {
      if (!r26Assets.skinsByKuid.has(v) && !r26Assets.skinsByName.has(v)) {
        const ks = kbzAssets && (kbzAssets.skinsByKuid.get(v) || (kbzAssets.skinsByName.has(v) ? { _name: v } : null));
        const name = ks && ks._name;
        issue = { type: "skin", value: v, text: `skin ${name ? `“${name}” ` : ""}(${v}) is not in R26${name && r26Assets.skinsByName.has(name) ? ` — R26 has a skin named “${name}” with another id` : ""}` };
      }
    } else if (k === "src" || k === "imagewhenfailed" || k === "imagewhileloading") {
      if (/\.(png|jpe?g|gif|svg|webp)$/i.test(v) && !r26Assets.images.has(v.split("/").pop().toLowerCase())) issue = { type: "image", value: v, text: `image ${v} is not in R26` };
    } else if (/i18n$/.test(k)) {
      if (i18nKeys ? !i18nKeys.has(v) : !(v in r26Assets.i18n)) issue = { type: "i18n", value: v, text: `i18n key ${v} is not in R26` };
    }
    if (issue && !seen.has(r.rid + "|" + issue.value)) { seen.add(r.rid + "|" + issue.value); out.push({ rid: r.rid, wid: r.wid, ...issue }); }
  };
  for (const r of rows) {
    if (choices[r.rid] !== "kbz") continue;
    if (r.kind === "prop") { const key = leafName(r); if (Array.isArray(r.kbz)) r.kbz.forEach((x) => check(r, key, x)); else check(r, key, r.kbz); }
    if ((r.kind === "add" || r.kind === "gone") && merged.W[r.wid]) for (const [key, v] of Object.entries(merged.W[r.wid])) { if (Array.isArray(v)) v.forEach((x) => check(r, key, x)); else check(r, key, v); }
  }
  // the same kuid on two widgets of the result
  const byKuid = new Map();
  for (const [id, w] of Object.entries(merged.W)) if (w && w.kuid) { if (!byKuid.has(w.kuid)) byKuid.set(w.kuid, []); byKuid.get(w.kuid).push(id); }
  for (const [kuid, ids] of byKuid) if (ids.length > 1) out.push({ rid: null, wid: ids[0], type: "kuid", value: kuid, text: `widgets ${ids.join(", ")} share the id (kuid) ${kuid}` });
  return out;
}

// ---------------------------------------------------------------- the template folder
// how R26 writes widget files: indent, line ending, BOM, final newline (taken from one of the copy's own files)
export function fileStyle(sample) {
  const t = sample || "";
  const eol = t.includes("\r\n") ? "\r\n" : "\n";
  const m = t.match(/\n([ \t]+)"/);
  return { eol, indent: m ? m[1] : "    ", bom: t.charCodeAt(0) === 0xfeff, endNewline: /\n$/.test(t) };
}
export function writeJson(obj, style) {
  let s = JSON.stringify(obj, null, style.indent);
  if (style.eol !== "\n") s = s.replace(/\n/g, style.eol);
  return (style.bom ? "﻿" : "") + s + (style.endNewline ? style.eol : "");
}

// files of the merged template: { "<id>.json": text } — a widget nobody changed keeps R26's file text exactly; every
// other widget (changed, or new from KBZ) is written in R26's style, so the folder never mixes line endings
export function templateFiles(merged, W2, raw2, style) {
  const out = {};
  for (const [id, w] of Object.entries(merged.W)) {
    const name = `${id}.json`;
    out[name] = raw2[id] != null && !merged.touched.has(id) && JSON.stringify(w) === JSON.stringify(W2[id]) ? raw2[id] : writeJson(w, style);
  }
  return out;
}
