// COMP-are: user widgets (components) compared across R21 / KBZ / R26.
// A component is one folder under userwidgets/ (e.g. com.adminConsole.CSR.detailHeader):
//   userwidgetmodel.sm/*.json                 widget tree (same format as a form .sm)  -> structure diff (forms engine)
//   modules/require/<name>Controller.js       component controller                     -> member diff (3-way + buckets)
//   modules/require/<name>ControllerActions.js generated action sequences              -> member diff
//   uwProperties.json                         public contract: custom properties/events/APIs/groups -> entry diff
//   uwDependencies.json                       skins + media the component depends on  -> entry diff
//   modules/require/<other>.js                helper scripts (DAOs, extra controllers)  -> member diff
// Every aspect except structure is reduced to the {members} shape so buildModel/classify apply unchanged.
import { extract, extractComponent, buildModel } from "./analyzer.js";
import { summarizeForm } from "./forms.js";

// "<root>/userwidgets/<component>/<rel>" -> { key: component folder, rel }
export function compPath(relPath) {
  const p = "/" + (relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const i = p.toLowerCase().indexOf("/userwidgets/");
  if (i < 0) return null;
  const rest = p.slice(i + "/userwidgets/".length);
  const j = rest.indexOf("/");
  return j > 0 && j < rest.length - 1 ? { key: rest.slice(0, j), rel: rest.slice(j + 1) } : null;
}

export const compName = (key) => key.split(".").pop();
export const compNamespace = (key) => key.split(".").slice(0, -1).join(".");

// role of a file inside a component folder
export function roleOf(key, rel) {
  if (/^userwidgetmodel\.sm\/[^/]+\.json$/i.test(rel)) return "structure";
  if (rel === "uwProperties.json") return "contract";
  if (rel === "uwDependencies.json") return "deps";
  if (/^modules\/require\/[^/]+ControllerActions\.js$/i.test(rel)) return "actions";
  if (rel.toLowerCase() === `modules/require/${compName(key)}controller.js`.toLowerCase()) return "controller";
  if (/\.js$/i.test(rel)) return "script";
  return "other";
}

const OMIT = new Set(["kuid", "srcWgtKUID"]); // tool-generated identifiers — ignored for change detection
const stable = (v) => {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).filter((k) => !OMIT.has(k)).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v);
};
const entry = (kind, value) => {
  const f = JSON.stringify(value, null, 4);
  return { kind, raw: f, fmt: f, canon: stable(value) };
};
const SECTION = { properties: "property", events: "event", apis: "API", widgets: "widget" };

// uwProperties.json -> members ("property · objServiceName", "event · onRowClick", "group (properties) · General", ...)
export function parseContract(text) {
  const d = JSON.parse(text);
  const members = {};
  for (const k of ["classname", "namespace", "version"]) if (k in d) members[`meta · ${k}`] = entry("meta", d[k]);
  for (const [sec, subs] of Object.entries(d.definitions || {})) {
    for (const [sub, arr] of Object.entries(subs || {})) {
      if (!Array.isArray(arr)) continue;
      for (const e of arr) {
        if (sec === "groups") { members[`group (${sub}) · ${typeof e === "string" ? e : JSON.stringify(e)}`] = entry("group", e); continue; }
        const id = e && typeof e === "object" ? (e.propertyKey ?? e.name ?? e.id) : e;
        const label = (SECTION[sec] || sec) + (sub === "custom" || sub === "expose" ? "" : ` (${sub})`);
        members[`${label} · ${id}`] = entry(sec === "widgets" ? "exposed widget" : SECTION[sec] || sec, e);
      }
    }
  }
  for (const k of Object.keys(d)) if (!["classname", "namespace", "version", "definitions"].includes(k)) members[`meta · ${k}`] = entry("meta", d[k]);
  return { moduleName: d.classname || null, members };
}

// uwDependencies.json -> members ("skin · sknX", "media · img.png")
export function parseDeps(text) {
  const d = JSON.parse(text);
  const members = {};
  for (const [k, arr] of Object.entries(d)) {
    const kind = k === "skins" ? "skin" : k;
    if (Array.isArray(arr)) for (const v of arr) members[`${kind} · ${typeof v === "string" ? v : JSON.stringify(v)}`] = entry(kind, v);
    else members[`${k}`] = entry(k, arr);
  }
  return { moduleName: null, members };
}

// readable labels for generated actions: "/** onClick defined for btnSave **/ AS_Button_x: ..." -> "onClick defined for btnSave"
export function actionLabels(src) {
  const out = {};
  for (const m of (src || "").replace(/\r\n?/g, "\n").matchAll(/\/\*\*\s*(.+?)\s*\*\*\/\s*\n\s*(AS_\w+)\s*:/g)) out[m[2]] = m[1];
  return out;
}

const EMPTY = { moduleName: null, members: {} };
const norm = (s) => (s || "").replace(/\r\n?/g, "\n").replace(/^﻿/, "");

// one aspect across versions: files[i] = File | File[] | null ; parse(src, file) -> {members}
async function aspect(labels, files, parse) {
  if (!files.some((f) => f && (!Array.isArray(f) || f.length))) return null;
  const list = [];
  for (let i = 0; i < labels.length; i++) {
    const f = files[i];
    let src = "", parsed = EMPTY;
    if (Array.isArray(f)) {
      // several helper scripts merged into one member set, prefixed by file name
      const members = {};
      for (const [rel, file] of f) {
        const s = norm(await file.text());
        src += s + "\n";
        const p = parse(s);
        for (const [n, m] of Object.entries(p.members)) members[`${rel.split("/").pop()} › ${n}`] = m;
      }
      parsed = { moduleName: null, members };
    } else if (f) {
      src = norm(await f.text());
      parsed = parse(src);
    }
    list.push({ label: labels[i], name: "", src, parsed });
  }
  return buildModel(list);
}

async function readWidgetJson(map) {
  const W = {};
  if (!map) return W;
  const entries = [...map];
  const texts = await Promise.all(entries.map(([, f]) => f.text()));
  entries.forEach(([id], k) => { try { W[id] = JSON.parse(texts[k]); } catch { /* unreadable widget file */ } });
  return W;
}

// split one component folder's files (Map rel -> File) by role
export function partsOf(key, files) {
  const p = { structure: new Map(), controller: null, actions: null, contract: null, deps: null, scripts: [], other: [] };
  if (!files) return null;
  for (const [rel, f] of files) {
    const r = roleOf(key, rel);
    if (r === "structure") p.structure.set(rel.slice("userwidgetmodel.sm/".length).replace(/\.json$/i, ""), f);
    else if (r === "script") p.scripts.push([rel, f]);
    else if (r === "other") p.other.push([rel, f]);
    else p[r] = f;
  }
  // no <name>Controller.js: fall back to the only *Controller.js helper, if exactly one exists
  if (!p.controller) {
    const c = p.scripts.filter(([rel]) => /Controller\.js$/i.test(rel));
    if (c.length === 1) { p.controller = c[0][1]; p.scripts = p.scripts.filter((s) => s !== c[0]); }
  }
  p.scripts.sort((a, b) => a[0].localeCompare(b[0]));
  return p;
}

export const ASPECTS = [
  ["controller", "Controller"],
  ["actions", "Actions"],
  ["contract", "Contract (uwProperties)"],
  ["deps", "Dependencies"],
  ["scripts", "Helper scripts"],
];
const STRUCT_PAIRS = [[0, 1], [0, 2], [1, 2]];

// Analyse every component across the loaded versions. maps[i]: Map(componentKey -> Map(rel -> File)) or null.
export async function analyzeComponents(maps, labels, onProgress) {
  const n = maps[2] ? 3 : 2;
  const L = labels.slice(0, n);
  const keys = [...new Set(maps.slice(0, n).flatMap((m) => (m ? [...m.keys()] : [])))].sort((a, b) => compName(a).localeCompare(compName(b)) || a.localeCompare(b));
  const results = [];
  onProgress({ done: 0, total: keys.length, running: true });
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const parts = maps.slice(0, n).map((m) => partsOf(key, m && m.get(key)));
    const present = Object.fromEntries(L.map((l, i) => [l, !!parts[i]]));
    const r = { key, name: compName(key), namespace: compNamespace(key), present, models: {}, errors: {}, structure: {} };
    const run = async (name, files, parse) => {
      try { r.models[name] = await aspect(L, files, parse); } catch (e) { r.models[name] = null; r.errors[name] = String(e.message || e); }
    };
    await run("controller", parts.map((p) => p && p.controller), extractComponent);
    await run("actions", parts.map((p) => p && p.actions), extract);
    if (r.models.actions) {
      const hints = {};
      for (const p of parts) if (p && p.actions) Object.assign(hints, actionLabels(await p.actions.text()));
      r.models.actions.hints = hints;
    }
    await run("contract", parts.map((p) => p && p.contract), parseContract);
    await run("deps", parts.map((p) => p && p.deps), parseDeps);
    await run("scripts", parts.map((p) => (p ? p.scripts : null)), extractComponent);
    try {
      const W = [];
      for (const p of parts) W.push(p ? await readWidgetJson(p.structure) : {});
      for (const [a, b] of STRUCT_PAIRS) {
        if (b >= n || (!parts[a] && !parts[b])) continue;
        r.structure[`${a}${b}`] = summarizeForm(W[a], W[b]);
      }
      r.widgetCounts = Object.fromEntries(L.map((l, i) => [l, Object.keys(W[i]).length]));
    } catch (e) {
      r.errors.structure = String(e.message || e);
    }
    // headline numbers (customisation = KBZ vs R21)
    const g = (m) => (m ? m.genuine.length : 0);
    const s = r.structure["01"];
    r.changes = {
      structure: s ? s.added + s.removed + s.moved + s.propWidgets : 0,
      controller: g(r.models.controller), actions: g(r.models.actions), contract: g(r.models.contract),
      deps: g(r.models.deps), scripts: g(r.models.scripts),
    };
    r.total = Object.values(r.changes).reduce((x, y) => x + y, 0);
    r.conflicts = 0;
    for (const m of Object.values(r.models)) if (m) for (const x of Object.values(m.members)) if (x.bucket === "2") r.conflicts++;
    r.status = !present[L[0]] && present[L[1]] ? "new" : present[L[0]] && !present[L[1]] ? "removed"
      : !present[L[0]] && !present[L[1]] ? "absent" : r.total ? "customised" : "unchanged";
    results.push(r);
    if (k % 4 === 0) { onProgress({ done: k + 1, total: keys.length, running: true }); await new Promise((res) => setTimeout(res)); }
  }
  onProgress({ done: keys.length, total: keys.length, running: false });
  return results;
}

