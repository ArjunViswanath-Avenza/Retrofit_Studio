// FormForge · forms retrofit across R21 / KBZ / R26: per form the widget tree (3 pairs, value-level Move-to-R26 rows
// against the R26 form compared), the form controller and its actions (Actions file, or studioactions JSON where the
// file is missing — R26 micro apps mostly ship without it), then triage and kind of customisation as in COMP-are.
// Nothing is kept per form but counts: the detail page reads the files again when it is opened.
import { extractComponent, buildModel } from "./analyzer.js";
import { buildFormDiff } from "./forms.js";
import { mergeRows, aboutOf, breakpointOf } from "./segmerge.js";
import { readWidgetJson, eventsOf, actionsVersion, studioActionsOf, actionLabels, triageOf, TRIAGE } from "./components.js";
import { pool, yieldNow, bgTurn } from "./jobs.js";

export const formName = (key) => key.split("/").pop().replace(/\.sm$/i, "");
// "desktop/AuthModule/frmLogin.sm" -> "AuthModule"; an R26-only key "desktop/AuthenticationMA·AuthUIModule/…" -> "AuthUIModule"
export const formModule = (key) => key.split("/").slice(1, -1).join("/").replace(/^[^·]*·/, "");
// the controller key CtrlSync uses for a form (an R26-only form's key gives the R26-only controller key)
export const ctrlKeyOfForm = (key) => { const s = key.split("/"); const n = s.pop().replace(/\.sm$/i, ""); return [...s, `${n}Controller`, `${n}Controller.js`].join("/"); };

// the micro app a version keeps a form (and its controller) in; "" for a monolith
const appOf = (p, key) => (p && p.formApp ? p.formApp.get(key) || "" : "");
const ctrlAppOf = (p, ck) => (p && p.ctrlApp ? p.ctrlApp.get(ck) || "" : "");
// the generated ControllerActions.js beside a controller file (same folder), from the version's file list
const byPath = new WeakMap();
const relOf = (f) => (f.webkitRelativePath || f.name || "").replace(/\\/g, "/");
function actionsBeside(p, ctrlFile, app) {
  if (!p || !ctrlFile) return null;
  const list = app && p.appFiles ? p.appFiles.get(app) : p.all;
  if (!list) return null;
  if (!byPath.has(list)) { const m = new Map(); for (const f of list) if (/ControllerActions\.js$/i.test(f.name || relOf(f))) m.set(relOf(f), f); byPath.set(list, m); }
  return byPath.get(list).get(relOf(ctrlFile).replace(/Controller\.js$/i, "ControllerActions.js")) || null;
}

// one form's files in one version: widget map, controller, actions file, studioactions index
export function formFiles(p, key) {
  if (!p) return null;
  const map = p.forms && p.forms.get(key);
  const ck = ctrlKeyOfForm(key);
  const ctrl = (p.controllers && p.controllers.get(ck)) || null;
  const app = appOf(p, key), capp = ctrlAppOf(p, ck) || app;
  return { map: map || null, ctrl, actions: actionsBeside(p, ctrl, capp), sa: studioActionsOf(p, app), app };
}

const EMPTY = { moduleName: null, members: {} };
const norm = (s) => (s || "").replace(/\r\n?/g, "\n").replace(/^﻿/, "");
// the controller and actions models of one form (W: each version's widgets, for the events naming actions)
export async function formCodeModels(picked, labels, key, W) {
  const n = labels.length;
  const files = picked.slice(0, n).map((p) => formFiles(p, key));
  const out = { controller: null, actions: null, errors: {} };
  try {
    if (files.some((f) => f && f.ctrl)) {
      const list = [];
      for (let i = 0; i < n; i++) { const src = files[i] && files[i].ctrl ? norm(await files[i].ctrl.text()) : ""; list.push({ label: labels[i], name: "", src, parsed: src ? extractComponent(src) : EMPTY }); }
      out.controller = buildModel(list);
    }
  } catch (e) { out.errors.controller = String(e.message || e); }
  try {
    const events = (W || []).map((w) => (w ? eventsOf(w) : new Map()));
    const vers = [];
    for (let i = 0; i < n; i++) vers.push(files[i] && files[i].map ? await actionsVersion(files[i].actions, events[i] || new Map(), files[i].sa) : null);
    if (vers.some(Boolean)) {
      const m = buildModel(labels.map((label, i) => ({ label, name: "", src: vers[i] ? vers[i].src : "", parsed: vers[i] ? vers[i].parsed : EMPTY })));
      const hints = {};
      for (const f of files) if (f && f.actions) Object.assign(hints, actionLabels(await f.actions.text()));
      for (const ev of events) for (const [id, h] of ev) if (!hints[id]) hints[id] = h;
      m.hints = hints;
      m.fromJson = Object.fromEntries(labels.map((l, i) => [l, vers[i] ? vers[i].fromJson : []]).filter(([, x]) => x.length));
      m.approx = [...new Set(vers.flatMap((v) => (v ? v.approx : [])))];
      m.noFile = labels.filter((l, i) => files[i] && files[i].map && !files[i].actions);
      out.actions = m;
    }
  } catch (e) { out.errors.actions = String(e.message || e); }
  return out;
}

const STRUCT_PAIRS = [[0, 1], [0, 2], [1, 2]];
// Analyse every form across the loaded versions. picked: the versions' scans (R26 aligned in the micro-app workspace);
// opts.keys: only these forms (a re-link); opts.report: Map(form key -> micro-app map row) (tablet / watch forms);
// opts.signal: run as a background job
export async function analyzeForms(picked, labels, onProgress = () => {}, opts = {}) {
  const n = picked[2] ? 3 : 2;
  const L = labels.slice(0, n);
  const maps = picked.slice(0, n).map((p) => (p && p.forms) || new Map());
  const keys = opts.keys || [...new Set(maps.flatMap((m) => [...m.keys()]))].sort((a, b) => formName(a).localeCompare(formName(b)) || a.localeCompare(b));
  const results = new Array(keys.length);
  let done = 0;
  onProgress({ done: 0, total: keys.length, running: true });
  await pool(keys.length, 4, async (k) => {
    const key = keys[k];
    const present = Object.fromEntries(L.map((l, i) => [l, maps[i].has(key)]));
    const row = opts.report && opts.report.get(key);
    const r = { key, name: formName(key), module: formModule(key), channel: key.split("/")[0], present, errors: {}, structure: {}, tablet: !!(row && row.status === "tablet") };
    let W = [];
    try { for (let i = 0; i < n; i++) W.push(maps[i].has(key) ? await readWidgetJson(maps[i].get(key)) : null); } catch (e) { r.errors.structure = String(e.message || e); W = L.map(() => null); }
    try {
      if (r.errors.structure) throw new Error(r.errors.structure);
      // the Move-to-R26 rows against the R26 form compared, counted per parameter; conflicts listed by what they are
      // about and their breakpoint (so saved conflict rules can be counted per form)
      if (n === 3 && W[0] && W[1] && W[2]) {
        const byKey = {}, conf = [];
        for (const x of mergeRows(W[0], W[1], W[2])) {
          const kk = x.kind === "prop" ? x.key : `(${x.kind})`;
          const s = x.design ? "design" : x.state;
          (byKey[kk] = byKey[kk] || {})[s] = (byKey[kk][s] || 0) + 1;
          if (s === "conflict") conf.push([aboutOf(x), breakpointOf(x), kk]);
        }
        r.merge = { byKey, conf };
      }
      for (const [a, b] of STRUCT_PAIRS) {
        if (b >= n || (!W[a] && !W[b])) continue;
        const d = buildFormDiff(W[a] || {}, W[b] || {});
        r.structure[`${a}${b}`] = { ...d.totals, propWidgets: d.propWidgets, leaves: d.leaves, byCategory: d.byCategory };
        r.wkeys = r.wkeys || {};
        r.wkeys[`${a}${b}`] = [];
        for (const nd of d.nodes.values()) if (nd.props.length) r.wkeys[`${a}${b}`].push([...new Set(nd.props.map((x) => x.key))]);
        r.keyCat = r.keyCat || {};
        for (const nd of d.nodes.values()) for (const x of nd.props) r.keyCat[x.key] = x.category;
        r.rel = r.rel || {};
        r.rel[`${a}${b}`] = { moved: d.totals.moved, reordered: d.totals.reordered };
      }
      r.widgetCounts = Object.fromEntries(L.map((l, i) => [l, W[i] ? Object.keys(W[i]).length : 0]));
    } catch (e) { r.errors.structure = String(e.message || e); }
    // controller + actions: counts only (the detail page builds the models again)
    const code = await formCodeModels(picked, L, key, W);
    Object.assign(r.errors, code.errors);
    const g = (m) => (m ? m.genuine.length : 0);
    const c2 = (m) => (m ? Object.values(m.members).filter((x) => x.bucket === "2").length : 0);
    r.code = { controller: !!code.controller, actions: !!code.actions, fromJson: code.actions ? code.actions.fromJson : {} };
    const s = r.structure["01"];
    r.changes = { structure: s ? s.added + s.removed + s.moved + s.propWidgets + (s.reordered || 0) : 0, controller: g(code.controller), actions: g(code.actions) };
    r.total = Object.values(r.changes).reduce((x, y) => x + y, 0);
    r.conflicts = c2(code.controller) + c2(code.actions);
    r.status = !present[L[0]] && present[L[1]] ? "new" : present[L[0]] && !present[L[1]] ? "removed"
      : !present[L[0]] && !present[L[1]] ? "absent" : r.total ? "customised" : "unchanged";
    results[k] = r;
    if (++done % 4 === 0) { onProgress({ done, total: keys.length, running: true }); if (opts.signal) await bgTurn(opts.signal); else await yieldNow(); }
  });
  onProgress({ done: keys.length, total: keys.length, running: false });
  return results;
}

// ---------------------------------------------------------------- triage (as COMP-are, worded for forms)
export const FORM_TRIAGE = TRIAGE.map(([id, t, sub]) => [id, t, ({
  quick: "widget changes only, none conflicts with R26",
  code: "controller or actions changed too, nothing conflicts",
  retrofit: "controller or actions changed and something conflicts",
  nocopy: "KBZ changed it; no R26 form matched",
  new: "a form only KBZ has",
  removed: "KBZ dropped it",
  r26only: "new R26 form, not retrofit work",
})[id] || sub]).concat([["tablet", "Tablet / watch", "the micro apps carry no tablet or watch forms"]]);
export function formTriageOf(r, labels, excl, rules) {
  if (r.tablet) return "tablet";
  if (!rules || !rules.length || !r.merge) return triageOf(r, labels, excl);
  // conflicts every saved rule decides do not count
  return triageOf({ ...r, merge: { byKey: openByKey(r, rules) } }, labels, excl);
}
// a stored conflict ([about, breakpoint]) that a saved rule decides (same matching as ruleChoice)
const ruled = (about, bp, rules) => rules.some((x) => (x.by === "about" && x.k === about) || (x.by === "bp" && bp && x.k === bp));
// r.merge.byKey with the conflicts a saved rule decides taken out of "conflict"
function openByKey(r, rules) {
  const byKey = Object.fromEntries(Object.entries(r.merge.byKey).map(([k, v]) => [k, { ...v }]));
  for (const [about, bp, kk] of r.merge.conf || []) if (ruled(about, bp, rules)) byKey[kk].conflict--;
  return byKey;
}
// how many of a form's conflicts the saved rules decide
export const ruledCount = (r, rules) => (r.merge && rules && rules.length ? (r.merge.conf || []).filter(([about, bp]) => ruled(about, bp, rules)).length : 0);

// ---------------------------------------------------------------- the code that names one widget of a form
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export async function formRefs(p, key, id) {
  const f = formFiles(p, key);
  if (!f) return [];
  const re = new RegExp(`(^|[^\\w$])${esc(id)}(?![\\w$])`);
  const tasks = [];
  if (f.ctrl) tasks.push({ file: f.ctrl, group: { kind: "form", label: f.ctrl.name || "controller", sub: "the form's controller", app: f.app } });
  if (f.actions) tasks.push({ file: f.actions, group: { kind: "form", label: f.actions.name || "actions", sub: "the form's generated actions", app: f.app } });
  const out = [];
  for (const t of tasks) {
    const Ls = norm(await t.file.text()).split("\n");
    const hits = [];
    Ls.forEach((x, k) => { if (re.test(x)) hits.push({ line: k + 1, text: x.trim().slice(0, 240), from: Math.max(1, k - 2), ctx: Ls.slice(Math.max(0, k - 3), k + 4) }); });
    if (hits.length) out.push({ ...t.group, hits: hits.slice(0, 40), more: Math.max(0, hits.length - 40) });
  }
  return out;
}
