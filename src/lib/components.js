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
import { buildFormDiff } from "./forms.js";
import { yieldNow, pool, bgTurn } from "./jobs.js";

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
export async function aspect(labels, files, parse) {
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

export async function readWidgetJson(map) {
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
  const results = new Array(keys.length);
  let done = 0;
  onProgress({ done: 0, total: keys.length, running: true });
  await pool(keys.length, 8, async (k) => { // several at once: their file reads go out together
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
        const d = buildFormDiff(W[a], W[b]);
        r.structure[`${a}${b}`] = { ...d.totals, propWidgets: d.propWidgets, leaves: d.leaves, byCategory: d.byCategory };
        // per changed widget, the parameters that changed — lets the dashboard recount with some parameters excluded
        r.wkeys = r.wkeys || {};
        r.wkeys[`${a}${b}`] = [];
        for (const nd of d.nodes.values()) if (nd.props.length) r.wkeys[`${a}${b}`].push([...new Set(nd.props.map((x) => x.key))]);
        r.keyCat = r.keyCat || {};
        for (const nd of d.nodes.values()) for (const x of nd.props) r.keyCat[x.key] = x.category;
        r.rel = r.rel || {};
        r.rel[`${a}${b}`] = { moved: d.totals.moved, reordered: d.totals.reordered };
      }
      r.widgetCounts = Object.fromEntries(L.map((l, i) => [l, Object.keys(W[i]).length]));
    } catch (e) {
      r.errors.structure = String(e.message || e);
    }
    // headline numbers (customisation = KBZ vs R21)
    const g = (m) => (m ? m.genuine.length : 0);
    const s = r.structure["01"];
    r.changes = {
      structure: s ? s.added + s.removed + s.moved + s.propWidgets + (s.reordered || 0) : 0,
      controller: g(r.models.controller), actions: g(r.models.actions), contract: g(r.models.contract),
      deps: g(r.models.deps), scripts: g(r.models.scripts),
    };
    r.total = Object.values(r.changes).reduce((x, y) => x + y, 0);
    r.conflicts = 0;
    for (const m of Object.values(r.models)) if (m) for (const x of Object.values(m.members)) if (x.bucket === "2") r.conflicts++;
    r.status = !present[L[0]] && present[L[1]] ? "new" : present[L[0]] && !present[L[1]] ? "removed"
      : !present[L[0]] && !present[L[1]] ? "absent" : r.total ? "customised" : "unchanged";
    results[k] = r;
    if (++done % 4 === 0) { onProgress({ done, total: keys.length, running: true }); await yieldNow(); }
  });
  onProgress({ done: keys.length, total: keys.length, running: false });
  return results;
}


// ---------------------------------------------------------------- where each component is used
// A form, template or component places a component as a UserWidgetInstance whose "sourceUserWidget" is the kuid of
// the component's root widget (the child of its userwidgetmodel wrapper). Per version: Map(componentKey -> [{ kind:
// "form" | "template" | "component", where, app, via: instance widget id }]). signal: runs as a background job.
const SRC = /"sourceUserWidget"\s*:\s*"([^"]+)"/;
export async function componentUsage(picked, onProgress, signal) {
  const all = [];
  const total = picked.reduce((t, p) => t + (p && p.comps ? [...(p.forms || new Map()).values()].reduce((x, m) => x + m.size, 0) : 0), 0);
  let done = 0;
  for (const p of picked) {
    if (!p || !p.comps) { all.push(null); continue; }
    // kuid of every component's root widget
    const byKuid = new Map();
    const keys = [...p.comps.keys()];
    await pool(keys.length, 16, async (k) => {
      const parts = partsOf(keys[k], p.comps.get(keys[k]));
      if (!parts) return;
      const W = await readWidgetJson(parts.structure);
      for (const w of Object.values(W)) if (w && w.parent === "userwidgetmodel" && w.kuid) byKuid.set(w.kuid, keys[k]);
    });
    const use = new Map();
    const add = (kuid, e) => { const key = byKuid.get(kuid); if (!key) return; if (!use.has(key)) use.set(key, []); use.get(key).push(e); };
    const scan = async (items, make) => {
      for (let i = 0; i < items.length; i += 256) {
        const part = items.slice(i, i + 256);
        const texts = await Promise.all(part.map((x) => x.f.text()));
        texts.forEach((t, j) => { if (!t.includes("sourceUserWidget")) return; const m = t.match(SRC); if (m) add(m[1], make(part[j])); });
        if (signal) await bgTurn(signal); else await yieldNow();
      }
    };
    const formItems = [];
    for (const [fk, widgets] of p.forms || []) for (const [id, f] of widgets) formItems.push({ fk, id, f });
    for (let i = 0; i < formItems.length; i += 2048) {
      await scan(formItems.slice(i, i + 2048), (x) => ({ kind: "form", where: x.fk, app: p.formApp ? p.formApp.get(x.fk) || null : null, via: x.id }));
      done += Math.min(2048, formItems.length - i);
      onProgress({ done, total, running: true });
    }
    const tplItems = [];
    for (const [tk, widgets] of p.segs || []) for (const [id, f] of widgets) tplItems.push({ tk, id, f });
    await scan(tplItems, (x) => ({ kind: "template", where: x.tk, app: p.segMeta && p.segMeta.get(x.tk) ? p.segMeta.get(x.tk).app : null, via: x.id }));
    const compItems = [];
    for (const [ck, files] of p.comps) for (const [rel, f] of files) if (/^userwidgetmodel\.sm\/[^/]+\.json$/i.test(rel)) compItems.push({ ck, id: rel.slice(19, -5), f });
    await scan(compItems, (x) => ({ kind: "component", where: x.ck, app: p.compApp ? p.compApp.get(x.ck) || null : null, via: x.id }));
    all.push(use);
  }
  onProgress({ done: total, total, running: false });
  return all;
}

// every line that names one widget of a component, in one version: the component's own scripts, then wherever it is
// used — the instance's settings / overrides (dataDiffs) and the form's controller, a parent component's scripts
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ctrlOfForm = (fk) => { const s = fk.split("/"); const name = s.pop().replace(/\.sm$/i, ""); return [...s, `${name}Controller`, `${name}Controller.js`].join("/"); };
export async function componentRefs(p, key, id, uses) {
  const files = p && p.comps && p.comps.get(key);
  if (!files) return [];
  const re = new RegExp(`(^|[^\\w$])${esc(id)}(?![\\w$])`);
  // the files to search, in the order they are listed (a busy component sits on many forms: read them together)
  const tasks = [];
  const scan = (file, group) => { if (file) tasks.push({ file, group }); };
  for (const [rel, f] of files) if (/\.js$/i.test(rel)) scan(f, { kind: "component", label: rel.split("/").pop(), sub: "the component's own code", path: key });
  const done = new Set();
  for (const e of uses || []) {
    if (e.kind === "form") {
      const name = e.where.split("/").pop().replace(/\.sm$/i, "");
      const inst = p.forms && p.forms.get(e.where) ? p.forms.get(e.where).get(e.via) : null;
      scan(inst, { kind: "form", label: name, sub: `instance ${e.via} · its settings and overrides`, app: e.app, path: e.where });
      if (done.has(`fc|${e.where}`)) continue;
      done.add(`fc|${e.where}`);
      scan(p.controllers && p.controllers.get(ctrlOfForm(e.where)), { kind: "form", label: name, sub: `${name}Controller.js`, app: e.app, path: e.where });
    } else if (e.kind === "component") {
      if (done.has(`c|${e.where}`)) continue;
      done.add(`c|${e.where}`);
      for (const [rel, f] of (p.comps && p.comps.get(e.where)) || []) if (/\.js$/i.test(rel) || rel === `userwidgetmodel.sm/${e.via}.json`) scan(f, { kind: "component", label: e.where.split(".").pop(), sub: rel, app: e.app, path: e.where });
    } else if (e.kind === "template") {
      const inst = p.segs && p.segs.get(e.where) ? p.segs.get(e.where).get(e.via) : null;
      scan(inst, { kind: "template", label: e.where.split("/").pop(), sub: `instance ${e.via} in the segment template`, app: e.app, path: e.where });
    }
  }
  const found = new Array(tasks.length);
  await pool(tasks.length, 24, async (i) => {
    const L = (await tasks[i].file.text()).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
    const hits = [];
    L.forEach((t, k) => { if (re.test(t)) hits.push({ line: k + 1, text: t.trim().slice(0, 240), from: Math.max(1, k - 2), ctx: L.slice(Math.max(0, k - 3), k + 4) }); });
    if (hits.length) found[i] = { ...tasks[i].group, hits: hits.slice(0, 40), more: Math.max(0, hits.length - 40) };
  });
  return found.filter(Boolean);
}
