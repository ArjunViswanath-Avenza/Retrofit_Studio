// Monolith -> micro-app converter.
// Produces R26-shaped Visualizer projects (container + feature micro apps + CommonsMA + ResourcesMA) from ONE
// monolith project. Only the monolith's own files are used; R26 supplies nothing but project structure
// (project setting files, navigation scaffolding, which micro app a module belongs to by default).
//
// Decisions agreed with the user (2026-10-07):
//   plan        editable table: monolith module -> micro app (default from the micro-app map)
//   modules     keep monolith module names, keep each module whole (no UIModule / Manager split)
//   rewrites    automatic, every one reported: getModule(...) / named define(...) / navigation to forms
//   navigation  cross-app calls become {appName, friendlyName}; NavigationManager.navigateTo gets the
//               object-keyed back-stack handling R26 needed (option b) — marked in the code and the report
//   shared      themes / images / i18n / web -> ResourcesMA, modules/ -> CommonsMA
//   project     setting files follow the R26 projects' structure; monolith-only extras copied to the container
//   channel     one channel at a time; output written straight into a folder the user picks

import { channelScan, CHANNELS, alignMicroApps } from "./microapps.js";
import { R26_MAP, nearestApp } from "./mapplan.js";

// build output and VCS folders — never part of a project's source
export const SKIP_DIRS = [".git", "node_modules", "jssrc", "binaries", "build", "temp", "ssm_temp"];

// ---------------------------------------------------------------- picked folder -> [{rel, f}]
export function rawFiles(fileList) {
  const out = [];
  let skipped = 0;
  for (const f of fileList) {
    const p = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
    const rel = p.split("/").slice(1).join("/"); // drop the picked folder's own name
    if (!rel) continue;
    if (rel.split("/").slice(0, -1).some((s) => SKIP_DIRS.includes(s))) { skipped++; continue; }
    out.push({ rel, f });
  }
  return { files: out, skipped };
}

// what a monolith file is
function classify(rel) {
  const s = rel.split("/");
  const top = s[0];
  if (s.length === 1) return { cat: "root", name: top };
  if (top === "forms") {
    const i = s.findIndex((x) => /\.sm$/i.test(x));
    if (i >= 2) return { cat: "form", ch: s[1], module: s.slice(2, i).join("/"), form: s[i].replace(/\.sm$/i, "") };
  }
  if (top === "controllers" && s.length >= 4) {
    if (s.length >= 5) return { cat: "formController", ch: s[1], module: s.slice(2, -2).join("/") };
    return { cat: "templateController", ch: s[1], template: s[2].replace(/Controller$/, "") };
  }
  if (top === "templates" && s.length >= 4) {
    const i = s.findIndex((x) => /\.sm$/i.test(x));
    if (i > 0) return { cat: "template", ch: s[1], template: s[i].replace(/\.sm$/i, "") };
  }
  if (top === "mvcextensions" && s.length >= 3) return { cat: "mvc", module: s[1] };
  if (top === "userwidgets" && s.length >= 3) return { cat: "widget", ns: s[1] };
  if (top === "studioactions") {
    const m = s[s.length - 1].match(/^(AS_\w+)\.(js|json)$/);
    return m ? { cat: "action", id: m[1] } : { cat: "appAction" };
  }
  return { cat: "folder", top };
}

// ---------------------------------------------------------------- plan
export function modulesOf(files) {
  const mods = new Map();
  const get = (m) => { if (!mods.has(m)) mods.set(m, { module: m, forms: 0, controllers: 0, mvc: 0, formNames: [] }); return mods.get(m); };
  const seenForm = new Set();
  for (const { rel } of files) {
    const c = classify(rel);
    if (c.cat === "form" && !seenForm.has(`${c.ch}/${c.module}/${c.form}`)) { seenForm.add(`${c.ch}/${c.module}/${c.form}`); const x = get(c.module); x.forms++; x.formNames.push(c.form); }
    else if (c.cat === "formController" && /Controller\.js$/.test(rel) && !/ControllerActions\.js$/.test(rel)) get(c.module).controllers++;
    else if (c.cat === "mvc" && /\.js$/.test(rel)) get(c.module).mvc++;
  }
  return [...mods.values()].sort((a, b) => a.module.localeCompare(b.module));
}

// default micro app per monolith module, with the evidence behind it
export async function proposePlan(monoScan, monoFiles, ma, channel) {
  const C = CHANNELS[channel];
  const { report } = await alignMicroApps([channelScan(monoScan, C.mono), null], ma, channel);
  const r26Mod = new Map(); // module name -> R26 app holding a module of that name
  for (const a of ma.apps.values()) for (const k of a.scan.mvc.keys()) { const m = k.split("/")[0]; if (!r26Mod.has(m)) r26Mod.set(m, a.name); }
  const mvcHome = {};
  for (const r of report.mvc) if (r.target && /\/(BusinessController|PresentationController)\.js$/.test(r.key) && !mvcHome[r.module]) mvcHome[r.module] = r.target.app;
  const rows = modulesOf(monoFiles).map((m) => {
    const aff = Object.entries(report.affinity[m.module] || {}).sort((x, y) => y[1] - x[1]);
    const apps = {};
    for (const [k, n] of aff) { const a = k.split(":")[0]; apps[a] = (apps[a] || 0) + n; }
    const byApp = Object.entries(apps).sort((x, y) => y[1] - x[1]);
    let target, reason;
    if (byApp.length) {
      target = byApp[0][0];
      reason = byApp.length > 1
        ? `forms split across ${byApp.length} micro apps in R26 (${byApp.map(([a, n]) => `${a} ${n}`).join(", ")}) — kept whole in the one with most`
        : `${byApp[0][1]} of its forms are in ${target} in R26`;
    } else if (mvcHome[m.module]) { target = mvcHome[m.module]; reason = `its controller logic is in ${target} in R26`; }
    else if (r26Mod.has(m.module)) { target = r26Mod.get(m.module); reason = `a module of the same name is in ${target} in R26`; }
    else if (/Manager$/.test(m.module) && !m.forms) { target = "CommonsMA"; reason = "business-only manager with no R26 counterpart — shared"; }
    else { target = `${m.module.replace(/Module(New)?$/i, "").replace(/[^A-Za-z0-9]/g, "")}MA`; reason = "no R26 counterpart — new micro app"; }
    return { ...m, target, suggested: target, reason };
  });
  // container = the R26 project whose manifest lists the most micro apps
  let container = "OnlineBanking", most = -1;
  for (const [name, mf] of Object.entries(ma.manifests)) {
    const f = mf["project.manifest"];
    if (!f) continue;
    try { const n = (JSON.parse((await f.text()).replace(/^﻿/, "")).dependencies || []).length; if (n > most) { most = n; container = name; } } catch { /* ignore */ }
  }
  return { rows, container, commons: "CommonsMA", resources: "ResourcesMA", r26Apps: [...ma.apps.keys()].sort(), channel };
}

// ---------------------------------------------------------------- reference rewrites
const lineAt = (t, i) => t.slice(0, i).split("\n").length;

function patchNavigationManager(src) {
  // KBZ: NavigationManager.prototype.navigateTo = function(formname,ignoreExistence,params) { if(!ignoreExistence){ ... } ...
  const head = src.search(/NavigationManager\.prototype\.navigateTo\s*=\s*function\s*\(\s*formname\s*,\s*ignoreExistence\s*,\s*params\s*\)\s*\{/);
  if (head < 0) return null;
  const ifAt = src.indexOf("if(!ignoreExistence)", head);
  const altAt = src.search(/if\s*\(\s*!ignoreExistence\s*\)/);
  const start = ifAt >= 0 ? ifAt : altAt;
  if (start < 0 || start - head > 400) return null;
  const open = src.indexOf("{", start);
  let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) break; } }
  if (depth !== 0) return null;
  const replacement = `/* Retrofit Studio — micro-app navigation: forms in other micro apps are passed as {appName, friendlyName}.
       The back-stack is keyed by "appName/friendlyName" for those, by the form name otherwise (same handling as R26). */
    var navKey = function(f) { return (f && typeof f === "object") ? (f.appName ? (f.friendlyName ? f.appName + "/" + f.friendlyName : JSON.stringify(f)) : JSON.stringify(f)) : f; };
    if(!ignoreExistence){
      var formKey = navKey(formname);
      if(this.stack.map(navKey).indexOf(formKey)<0){
        this.stack.push(formname);
      }
      var stackLength = this.stack.length;
      var index = this.getFormIndex(formKey);
      if(index == null)
        this.setFormIndex(formKey,stackLength-1);
      else{
          for(var i=stackLength-1; i>index; i--){
            this.removeFormIndex(navKey(this.stack[i]));
            this.stack.pop();
          }
      }
    }`;
  return { text: src.slice(0, start) + replacement + src.slice(i + 1), before: src.slice(start, i + 1), line: lineAt(src, start) };
}

// rewrite one JS file for the micro app it is written into
function rewriteJs(text, ctx) {
  const { app, shared, moduleApp, formIndex, path } = ctx;
  const moduleApps = ctx.moduleApps || new Map();
  const appOfForm = ctx.appOfForm || ((m) => moduleApp.get(m));
  const local = (module) => !shared && moduleApps.has(module) && moduleApps.get(module).has(app); // split module with a copy here
  const L = ctx.layout; // R26 layout: monolith module -> parts (micro app + module name)
  const log = [];
  const unresolved = { getModule: 0, navigation: 0 };
  const needs = (target) => shared || target !== app;
  const edits = [];
  // getModule("X") / getModule('X')
  for (const m of text.matchAll(/getModule\(\s*(["'])([\w$.]+)\1\s*\)/g)) {
    if (L && L.has(m[2])) {
      const t = L.resolve(m[2], app, shared, ctx.self);
      if (!shared && t.app === app) { if (t.name !== m[2]) edits.push({ at: m.index, len: m[0].length, after: `getModule("${t.name}")`, rule: "getModule → R26 module name", before: m[0] }); }
      else edits.push({ at: m.index, len: m[0].length, after: `getModule({"moduleName" : "${t.name}", "appName" : "${t.app}"})`, rule: "getModule → other micro app" + (shared ? " (shared code)" : ""), before: m[0] });
      continue;
    }
    const target = moduleApp.get(m[2]);
    if (!target) continue;
    if (!needs(target) || local(m[2])) continue;
    const after = `getModule({"moduleName" : "${m[2]}", "appName" : "${target}"})`;
    edits.push({ at: m.index, len: m[0].length, after, rule: "getModule → other micro app" + (shared ? " (shared code)" : ""), before: m[0] });
  }
  for (const m of text.matchAll(/getModule\(\s*(?![\s"'{)])/g)) { void m; unresolved.getModule++; }
  // named define("Module/...") of form controllers
  for (const m of text.matchAll(/(^|\n)(\s*define\(\s*)(["'])([\w$]+)\/([^"']*)\3/g)) {
    if (!moduleApp.has(m[4]) && !(L && L.has(m[4]))) continue;
    const at = m.index + m[1].length + m[2].length;
    const nm = L && L.has(m[4]) ? L.resolve(m[4], app, false, ctx.self).name : m[4];
    edits.push({ at, len: m[0].length - m[1].length - m[2].length, after: `${m[3]}${app}/${nm}/${m[5]}${m[3]}`, rule: "define name → app-prefixed", before: `${m[3]}${m[4]}/${m[5]}${m[3]}` });
  }
  // require(["Module/frmX", "Module/frmXController"]) — R26 prefixes the micro app: "AboutUsMA/FeedbackModule/frmCustomerFeedback"
  for (const r of text.matchAll(/require\(\s*(\[[^\]]*\]|(["'])[^"']*\2)/g)) {
    const base = r.index + r[0].indexOf(r[1]);
    for (const m of r[1].matchAll(/(["'])([\w$]+)\/([\w$/]+)\1/g)) {
      if (L && L.has(m[2])) {
        const frm = m[3].split("/").pop().replace(/Controller(Actions)?$/, "");
        const t = L.formPart(m[2], frm) || L.resolve(m[2], app, shared, ctx.self);
        const after = !shared && t.app === app ? `${m[1]}${t.name}/${m[3]}${m[1]}` : `${m[1]}${t.app}/${t.name}/${m[3]}${m[1]}`;
        if (after !== m[0]) edits.push({ at: base + m.index, len: m[0].length, after, rule: t.app === app && !shared ? "require path → R26 module name" : "require path → app-prefixed (other micro app)" + (shared ? " (shared code)" : ""), before: m[0] });
        continue;
      }
      const target = moduleApp.has(m[2]) ? appOfForm(m[2], m[3].split("/").pop().replace(/Controller(Actions)?$/, "")) : null;
      if (!target || !needs(target)) continue;
      edits.push({ at: base + m.index, len: m[0].length, after: `${m[1]}${target}/${m[2]}/${m[3]}${m[1]}`, rule: "require path → app-prefixed (other micro app)" + (shared ? " (shared code)" : ""), before: m[0] });
    }
  }
  // navigation to a form given as a literal (any real form name, "frmX" or "Module/frmX")
  const navRx = /(\.navigateTo\(\s*|new\s+kony\.mvc\.Navigation\(\s*)(["'])((?:[\w$]+\/)?[\w$]+)\2/g;
  for (const m of text.matchAll(navRx)) {
    const lit = m[3];
    if (L && lit.includes("/") && L.has(lit.split("/")[0])) {
      const [mod, frm] = [lit.split("/")[0], lit.split("/").pop()];
      const t = L.formPart(mod, frm);
      if (!t) continue;
      const at = m.index + m[1].length;
      if (!shared && t.app === app) { if (t.name !== mod) edits.push({ at, len: m[0].length - m[1].length, after: `${m[2]}${t.name}/${frm}${m[2]}`, rule: "navigation → R26 module name", before: `${m[2]}${lit}${m[2]}` }); }
      else edits.push({ at, len: m[0].length - m[1].length, after: `{"appName" : "${t.app}", "friendlyName" : "${frm}"}`, rule: "navigation → other micro app" + (shared ? " (shared code)" : ""), before: `${m[2]}${lit}${m[2]}` });
      continue;
    }
    let apps;
    if (lit.includes("/")) { const mod = lit.split("/")[0], frm = lit.split("/").pop(); apps = moduleApp.has(mod) && formIndex.has(frm) ? new Set([appOfForm(mod, frm)]) : null; }
    else apps = formIndex.get(lit) || null;
    if (!apps) continue;
    if (apps.size > 1 && !shared && apps.has(app)) continue; // the caller's own micro app has a form of that name — a plain name resolves there
    if (apps.size > 1) { log.push({ path, line: lineAt(text, m.index), rule: "navigation left unchanged — form name exists in several micro apps", before: m[0], after: `(${[...apps].join(", ")})`, warn: true }); continue; }
    const target = [...apps][0];
    if (!needs(target)) continue;
    const at = m.index + m[1].length;
    edits.push({ at, len: m[0].length - m[1].length, after: `{"appName" : "${target}", "friendlyName" : "${lit}"}`, rule: "navigation → other micro app" + (shared ? " (shared code)" : ""), before: `${m[2]}${lit}${m[2]}` });
  }
  for (const m of text.matchAll(/(\.navigateTo\(|new\s+kony\.mvc\.Navigation\()\s*(?![\s"'{)])/g)) { void m; unresolved.navigation++; }
  // remaining "Module/…" strings of a module that has moved: controller ids (define dependency lists,
  // controllerActions = [...]) follow the app-prefixed define names; form paths kept as data take the module's new
  // name, as R26 writes them ("form": "AuthUIModule/frmLogin", even from another micro app)
  if (L) {
    const taken = (i) => edits.some((e) => i >= e.at && i < e.at + e.len);
    for (const m of text.matchAll(/(["'])([\w$]+)\/((?:user)?frm[\w$]*)\1/g)) {
      if (!L.has(m[2]) || taken(m.index)) continue;
      const id = m[3], frm = id.replace(/^user/, "").replace(/Controller(Actions)?$/, "");
      const t = L.formPart(m[2], frm) || L.resolve(m[2], app, shared, ctx.self);
      const ctrl = /Controller(Actions)?$/.test(id) || id.startsWith("user");
      const after = ctrl ? `${m[1]}${t.app}/${t.name}/${id}${m[1]}` : `${m[1]}${t.name}/${id}${m[1]}`;
      if (after !== m[0]) edits.push({ at: m.index, len: m[0].length, after, rule: ctrl ? "controller id → app-prefixed R26 module" : "form path (data) → R26 module name", before: m[0] });
    }
  }
  // form names of other micro apps used as data (frmName = "frmX"; navigateTo(frmName)) — cannot be rewritten
  // safely; reported per file. Comparisons with the current form's id (=== "frmX", case "frmX":) are left out.
  const dataUses = [];
  const inEdit = (i) => edits.some((e) => i >= e.at && i < e.at + e.len);
  for (const m of text.matchAll(/(["'])([\w$]+)\1/g)) {
    const apps = formIndex.get(m[2]);
    if (!apps || inEdit(m.index)) continue;
    const before = text.slice(Math.max(0, m.index - 14), m.index), after = text.slice(m.index + m[0].length, m.index + m[0].length + 6);
    if (/(===?|!==?|\bcase)\s*$/.test(before) || /^\s*(===?|!==?)/.test(after)) continue;
    const others = [...apps].filter((a) => shared || a !== app);
    if (others.length === apps.size) dataUses.push({ line: lineAt(text, m.index), name: m[2], app: others.join("/") });
  }
  if (!edits.length) return { text, log, unresolved, dataUses };
  edits.sort((a, b) => a.at - b.at);
  let out = "", pos = 0;
  for (const e of edits) {
    if (e.at < pos) continue; // overlapping — keep the first
    out += text.slice(pos, e.at) + e.after;
    log.push({ path, line: lineAt(text, e.at), rule: e.rule, before: e.before, after: e.after });
    pos = e.at + e.len;
  }
  out += text.slice(pos);
  return { text: out, log, unresolved, dataUses };
}

// ---------------------------------------------------------------- composite app (as R26 builds it)
// R26 links a container and its micro apps through project.manifest files (container: every micro app; feature
// apps: ResourcesMA + CommonsMA; CommonsMA: ResourcesMA) plus RES / BCES variants of the container manifest for
// the retail and business builds. At run time the composite app starts with _kony.mvc.initCompositeApp(true) in
// preappinit — in the container and in every feature app (so each can also run on its own).
export const COMPOSITE_INIT = "_kony.mvc.initCompositeApp(true);";

// put COMPOSITE_INIT first in an app-event function: kind "json" (action definition — the source Visualizer
// regenerates the JS from), "js" (a function AS_x(eventobject) { … } file or the appEvents.js define({...}))
export function addCompositeInit(text, id, kind) {
  if (text.includes("initCompositeApp")) return null;
  if (kind === "json") {
    const i = text.indexOf(`"${id}"`);
    const k = i < 0 ? -1 : text.indexOf('"codeSnippet"', i);
    if (k < 0) return null;
    const q = text.indexOf('"', text.indexOf(":", k) + 1);
    return text.slice(0, q + 1) + COMPOSITE_INIT + "\\n" + text.slice(q + 1);
  }
  const m = new RegExp(`function\\s+${id}\\s*\\([^)]*\\)\\s*\\{[^\\n]*\\n`).exec(text);
  if (!m) return null;
  const at = m.index + m[0].length;
  const indent = (text.slice(at).match(/^[ \t]*/) || [""])[0] || "    ";
  return `${text.slice(0, at)}${indent}${COMPOSITE_INIT}\n${text.slice(at)}`;
}

// rewrite cross-app references inside the code snippets of an action definition (.json)
function rewriteActionJson(raw, ctx) {
  let j;
  try { j = JSON.parse(raw.replace(/^\uFEFF/, "")); } catch { return null; }
  const log = [], dataUses = [];
  const unresolved = { getModule: 0, navigation: 0 };
  let changed = false;
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (k === "codeSnippet" && typeof v === "string" && /getModule\(|navigateTo\(|kony\.mvc\.Navigation\(|require\(/.test(v)) {
        const r = rewriteJs(v, ctx);
        if (r.text !== v) { o[k] = r.text; changed = true; }
        log.push(...r.log); dataUses.push(...r.dataUses); unresolved.getModule += r.unresolved.getModule; unresolved.navigation += r.unresolved.navigation;
      } else if (v && typeof v === "object") walk(v);
    }
  };
  walk(j);
  return { text: changed ? JSON.stringify(j, null, 4) : raw, log, dataUses, unresolved };
}

const NAV_MODEL = '{ \n    "Application": {},\n    "Forms" : {},\n    "UIModules" : {}\n}\n';
const NAV_CONTROLLER = "define({\n    //Add your navigation controller code here.\n});\n";

// R26's retail / business container manifests list a subset of the micro apps; micro apps R26 does not have go in both
function variantMembers(file, apps) {
  return apps.filter((a) => !R26_MAP.apps[a] || R26_MAP.apps[a].listedIn.includes(file));
}

// in-memory (or on-disk, via read) check that every project is wired the way R26 wires it
export async function checkComposite(projects, roles, read) {
  const { container, commons, resources } = roles;
  const rows = [];
  for (const p of projects) {
    const checks = [];
    const ok = (name, pass, detail = "") => checks.push({ name, ok: !!pass, detail });
    const mf = await read(`${p}/project.manifest`);
    let deps = [];
    try { deps = mf ? (JSON.parse(mf).dependencies || []).map((d) => d.name) : []; } catch { /* unreadable */ }
    if (p === resources) ok("no project.manifest (as in R26)", !mf);
    else {
      ok("project.manifest", mf, mf ? `${deps.length} dependencies` : "missing");
      const want = p === container ? projects.filter((x) => x !== container) : p === commons ? [resources] : [resources, commons];
      const miss = want.filter((x) => !deps.includes(x));
      ok(p === container ? "lists every micro app" : p === commons ? "depends on ResourcesMA" : "depends on CommonsMA + ResourcesMA", !miss.length, miss.length ? `missing ${miss.join(", ")}` : "");
    }
    if (p === container) {
      for (const v of ["RESproject.manifest", "BCESproject.manifest"]) ok(v, await read(`${p}/${v}`));
    }
    const props = await read(`${p}/projectProperties.json`);
    ok("projectProperties.json", props);
    if (props) {
      let pj = {};
      try { pj = JSON.parse(props.replace(/^\uFEFF/, "")); } catch { /* unreadable */ }
      const evs = [];
      for (const d of roles.channelDirs) for (const [k, id] of Object.entries((pj.ide_appEvents || {})[d] || {})) if (typeof id === "string" && /^AS_AppEvents_\w+$/.test(id)) evs.push([d, k, id]);
      if (p === commons || p === resources) ok("no app events (as in R26)", !evs.length, evs.length ? `${evs.length} found` : "");
      else {
        const missing = [];
        let init = false;
        for (const [d, k, id] of evs) {
          const found = await read(`${p}/studioactions/${d}/${id}.json`);
          if (!found) missing.push(`${d}.${k}=${id}`);
          else if (k === "preappinit" && found.includes("initCompositeApp")) init = true;
        }
        ok("app events present", evs.length && !missing.length, missing.length ? `missing ${missing.join(", ")}` : evs.length ? `${evs.length} events` : "none");
        ok("preappinit starts the composite app", init, evs.some((e) => e[1] === "preappinit") ? "" : "no preappinit");
      }
    }
    ok("navigation framework files", await read(`${p}/navigation/${roles.channelDirs[0]}/navigationModel.json`));
    rows.push({ project: p, role: p === container ? "container" : p === commons || p === resources ? "shared" : "feature", checks, ok: checks.every((c) => c.ok) });
  }
  return rows;
}

// ---------------------------------------------------------------- R26 layout (form by form, R26 module names)
// Decisions agreed with the user (2026-10-14):
//   forms       each monolith form goes to the micro app + module R26 keeps it in (R26's module name)
//   KBZ-only    forms R26 does not have go with their siblings (the module's main part); a module with no form in
//               R26 keeps its own name inside the closest existing micro app (a new one only if nothing is close)
//   split       a module R26 spreads over several modules gets its business / presentation code in every part
//   two-in-one  when two monolith modules land in the same R26 module, the bigger takes the R26 name and the
//               smaller keeps its own name next to it
//   business    business controllers stay inside the (renamed) module — no *Manager restructuring
// A "part" = { module (monolith), app, name (module name in the micro app), forms: [names] }.
export async function r26Layout(monoFiles, ma, channel) {
  const C = CHANNELS[channel];
  const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; const u = a.size + b.size - i; return u ? i / u : 0; };
  // micro apps that are part of the R26 composite app (listed and not hidden in the container manifest)
  const listed = new Set(), hidden = new Set();
  for (const mf of Object.values(ma.manifests)) for (const f of Object.values(mf)) {
    try { for (const d of JSON.parse((await f.text()).replace(/^\uFEFF/, "")).dependencies || []) { listed.add(d.name); if (d.isHidden || d.excludeFromBuild) hidden.add(d.name); } } catch { /* unreadable */ }
  }
  const usable = (a) => listed.has(a) && !hidden.has(a) && !/^Resources\w*MA$/.test(a);
  // R26 forms of this channel: name -> [{app, module, ids}]
  const r26 = new Map();
  for (const a of ma.apps.values()) {
    if (!usable(a.name)) continue;
    for (const [k, w] of a.scan.forms) {
      const s = k.split("/"), ch = s[0];
      if (!C.r26.includes(ch)) continue;
      const name = s[s.length - 1].replace(/\.sm$/i, ""), module = s.slice(1, -1).join("/");
      if (!r26.has(name)) r26.set(name, []);
      r26.get(name).push({ app: a.name, module, ids: new Set(w.keys()) });
    }
  }
  // monolith forms of this channel with their widget ids
  const forms = new Map(); // "M/frm" -> {module, name, ids}
  for (const { rel } of monoFiles) {
    const s = rel.split("/");
    if (s[0] !== "forms" || !C.mono.includes(s[1])) continue;
    const i = s.findIndex((x) => /\.sm$/i.test(x));
    if (i < 3 || s.length !== i + 2) continue;
    const module = s.slice(2, i).join("/"), name = s[i].replace(/\.sm$/i, ""), k = `${module}/${name}`;
    if (!forms.has(k)) forms.set(k, { module, name, ids: new Set() });
    forms.get(k).ids.add(s[i + 1].replace(/\.json$/i, ""));
  }
  // owner of each monolith form in R26 (unique name, else the copy sharing most widgets)
  const owner = new Map(), ties = [];
  for (const [k, f] of forms) {
    const c = r26.get(f.name);
    if (!c) continue;
    const sc = c.map((x) => ({ ...x, score: jac(f.ids, x.ids) })).sort((a, b) => b.score - a.score || b.ids.size - a.ids.size);
    owner.set(k, sc[0]);
    if (sc.length > 1 && sc[0].score === sc[1].score && sc[0].ids.size === sc[1].ids.size) ties.push(k);
  }
  // identical copies: prefer the micro app most of the module's other forms go to
  const byModule = new Map();
  for (const [k, f] of forms) { if (!byModule.has(f.module)) byModule.set(f.module, []); byModule.get(f.module).push(k); }
  for (const k of ties) {
    const m = forms.get(k).module, votes = {};
    for (const o of byModule.get(m)) if (owner.has(o) && !ties.includes(o)) votes[owner.get(o).app] = (votes[owner.get(o).app] || 0) + 1;
    const c = r26.get(forms.get(k).name).filter((x) => x.ids.size === owner.get(k).ids.size).sort((a, b) => (votes[b.app] || 0) - (votes[a.app] || 0));
    owner.set(k, c[0]);
  }
  // parts
  const parts = new Map(); // "app|name" -> part
  const part = (module, app, name, r26mod) => {
    const key = `${module}|${app}|${name}`;
    if (!parts.has(key)) parts.set(key, { module, app, name, r26: r26mod, forms: [], matched: 0 });
    return parts.get(key);
  };
  const formPart = new Map(), primary = new Map(), notes = [];
  for (const [m, keys] of byModule) {
    const matched = keys.filter((k) => owner.has(k));
    for (const k of matched) { const o = owner.get(k); const pt = part(m, o.app, o.module, true); pt.matched++; formPart.set(k, pt); }
    // main part: the one holding most of the module's forms; KBZ-only forms join it
    const count = {};
    for (const k of matched) { const pk = `${owner.get(k).app}|${owner.get(k).module}`; count[pk] = (count[pk] || 0) + 1; }
    const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    let main;
    if (best) { const [app, name] = best[0].split("|"); main = part(m, app, name, true); }
    else {
      const near = nearestApp(m, channel);
      const app = near && ma.apps.has(near) && usable(near) ? near : `${m.replace(/(UI)?Module(New)?$/i, "").replace(/New$/, "").replace(/[^A-Za-z0-9]/g, "") || m}MA`;
      main = part(m, app, m, false);
      notes.push({ module: m, message: near && app === near ? `no form of ${m} is in R26 — kept as ${m} in the closest micro app, ${app}` : `no form of ${m} is in R26 and no micro app is close — new micro app ${app}` });
    }
    primary.set(m, main);
    for (const k of keys) if (!formPart.has(k)) formPart.set(k, main);
  }
  for (const [k, p] of formPart) p.forms.push(forms.get(k).name);
  // two monolith modules in one R26 module: the bigger keeps the R26 name, the smaller its own
  const byTarget = new Map();
  for (const p of parts.values()) { const t = `${p.app}|${p.name}`; if (!byTarget.has(t)) byTarget.set(t, []); byTarget.get(t).push(p); }
  for (const list of byTarget.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.matched - a.matched || b.forms.length - a.forms.length); // the module R26 actually keeps there wins
    for (const p of list.slice(1)) { notes.push({ module: p.module, message: `${p.module}'s ${p.forms.join(", ")} would share ${p.app}/${p.name} with ${list[0].module} — kept as module ${p.module} next to it` }); p.name = p.module; p.r26 = false; }
  }
  return {
    channel,
    parts: [...parts.values()].filter((p) => p.forms.length),
    formPart: Object.fromEntries([...formPart].map(([k, p]) => [k, `${p.app}|${p.name}`])),
    primary: Object.fromEntries([...primary].map(([m, p]) => [m, `${p.app}|${p.name}`])),
    notes, ties: ties.length,
  };
}

// lookups over a layout (as produced by r26Layout)
function layoutIndex(layout) {
  if (!layout) return null;
  const byKey = new Map(layout.parts.map((p) => [`${p.app}|${p.name}`, p]));
  const byModule = new Map();
  for (const p of layout.parts) { if (!byModule.has(p.module)) byModule.set(p.module, []); byModule.get(p.module).push(p); }
  for (const l of byModule.values()) l.sort((a, b) => b.forms.length - a.forms.length);
  return {
    has: (m) => byModule.has(m),
    parts: (m) => byModule.get(m) || [],
    primary: (m) => byKey.get(layout.primary[m]) || (byModule.get(m) || [])[0],
    formPart: (m, f) => byKey.get(layout.formPart[`${m}/${f}`]) || null,
    // the part a monolith module resolves to from code in `app` (inside folder `self` of module `selfKbz`)
    resolve(m, app, shared, self) {
      const all = byModule.get(m) || [];
      if (!shared) {
        if (self && self.kbz === m) { const own = all.find((p) => p.app === app && p.name === self.name); if (own) return own; }
        const here = all.find((p) => p.app === app);
        if (here) return here;
      }
      return this.primary(m);
    },
  };
}

// ---------------------------------------------------------------- conversion
const JS_REWRITE = new Set(["formController", "templateController", "mvc", "widget", "folder:modules", "action", "appAction"]);

export async function convert(monoFiles, ma, plan, onProgress = () => {}) {
  const { container, commons, resources } = plan;
  const moduleApp = new Map(plan.rows.map((r) => [r.module, r.target.trim()]));
  const formTargets = plan.formTargets || {}; // "Module/frmX" -> micro app, for modules split across micro apps
  const appOfForm = (module, form) => (L && L.formPart(module, form) ? L.formPart(module, form).app : null) || formTargets[`${module}/${form}`] || moduleApp.get(module); // L: see below
  const moduleApps = new Map(); // module -> every micro app holding some of it (primary first)
  for (const [m, a] of moduleApp) moduleApps.set(m, new Set([a]));
  for (const [k, a] of Object.entries(formTargets)) { const m = k.split("/")[0]; if (!moduleApps.has(m)) moduleApps.set(m, new Set()); moduleApps.get(m).add(a); }
  const L = layoutIndex(plan.layout);
  if (L) for (const p of plan.layout.parts) { // the layout decides where module code and forms go
    moduleApp.set(p.module, L.primary(p.module).app);
    if (!moduleApps.has(p.module)) moduleApps.set(p.module, new Set());
    moduleApps.set(p.module, new Set(L.parts(p.module).map((x) => x.app)));
  }
  const featureApps = [...new Set([...plan.rows.filter((r) => !L || !L.has(r.module)).map((r) => r.target.trim()), ...Object.values(plan.formTargets || {}), ...(plan.layout ? plan.layout.parts.map((p) => p.app) : [])])].filter((a) => a !== commons && a !== resources && a !== container).sort();
  const sharedApps = new Set([commons, resources, container]);
  const files = monoFiles.map((x) => ({ ...x, c: classify(x.rel) }));
  const warnings = [];
  const rewrites = [];

  // --- usage index: which units reference which user widgets / templates / actions
  // Templates are referenced by the kuid of their root (rowTemplateId / sectionHeaderTemplateId …) and, from
  // controller code, by the id of their top widget (rowTemplate = "flxRow…"); template controllers are named after
  // that top widget. User widgets are referenced by the kuid of their root widget file (sourceUserWidget).
  onProgress({ step: "Reading forms, widgets and templates", done: 0, total: 0 });
  const unitOf = (c) => (c.cat === "form" ? `form:${c.module}` : c.cat === "widget" ? `widget:${c.ns}` : c.cat === "template" ? `template:${c.template}` : null);
  const templateNames = new Set(files.filter((x) => x.c.cat === "template").map((x) => x.c.template));
  const templateKuid = new Map(); // root kuid -> template
  const templateByTop = new Map(); // top widget id (and folder name) -> template
  const widgetRootKuid = new Map(); // kuid -> ns
  const roots = files.filter((x) => (x.c.cat === "template" && x.rel.endsWith(`/${x.c.template}.sm/${x.c.template}.json`))
    || (x.c.cat === "widget" && x.rel === `userwidgets/${x.c.ns}/userwidgetmodel.sm/${x.c.ns.split(".").pop()}.json`));
  for (let i = 0; i < roots.length; i += 250) {
    const chunk = roots.slice(i, i + 250);
    const texts = await Promise.all(chunk.map((x) => x.f.text()));
    chunk.forEach((x, k) => {
      let d;
      try { d = JSON.parse(texts[k].replace(/^\ufeff/, "")); } catch { return; }
      if (x.c.cat === "widget") { if (d.kuid) widgetRootKuid.set(d.kuid, x.c.ns); return; }
      if (d.kuid) templateKuid.set(d.kuid, x.c.template);
      templateByTop.set(x.c.template, x.c.template);
      for (const ch of d.children || []) if (!templateByTop.has(ch)) templateByTop.set(ch, x.c.template);
    });
  }
  const refs = new Map(); // unit -> {kuids:Set, templates:Set, actions:Set}
  const unitRefs = (u) => { if (!refs.has(u)) refs.set(u, { kuids: new Set(), templates: new Set(), actions: new Set() }); return refs.get(u); };
  // JSON of forms / widgets / templates, and the JS of modules and widgets (templates assigned in code)
  const jsUnit = (c) => (c.cat === "formController" || c.cat === "mvc" ? `form:${c.module}` : c.cat === "widget" ? `widget:${c.ns}` : null);
  const scan = files.filter((x) => (unitOf(x.c) && /\.json$/i.test(x.rel)) || (jsUnit(x.c) && /\.js$/i.test(x.rel)));
  for (let i = 0; i < scan.length; i += 250) {
    const chunk = scan.slice(i, i + 250);
    const texts = await Promise.all(chunk.map((x) => x.f.text()));
    chunk.forEach((x, k) => {
      const t = texts[k];
      const isJs = /\.js$/i.test(x.rel);
      const u = isJs ? jsUnit(x.c) : unitOf(x.c);
      const r = unitRefs(u);
      if (!isJs) {
        for (const m of t.matchAll(/"sourceUserWidget"\s*:\s*"(\w+)"/g)) r.kuids.add(m[1]);
        for (const m of t.matchAll(/"(AS_\w+)"/g)) r.actions.add(m[1]);
        for (const m of t.matchAll(/"(\w{20,40})"/g)) { const tp = templateKuid.get(m[1]); if (tp) r.templates.add(tp); }
      }
      for (const m of t.matchAll(/["']([\w$]+)["']/g)) { const tp = templateByTop.get(m[1]); if (tp && (isJs || x.c.cat !== "template" || tp !== x.c.template)) r.templates.add(tp); }
    });
    onProgress({ step: "Reading forms, widgets and templates", done: Math.min(i + 250, scan.length), total: scan.length });
    await new Promise((r) => setTimeout(r));
  }
  for (const x of files) { const u = unitOf(x.c); if (u && (x.c.cat === "widget" || x.c.cat === "template")) unitRefs(u); }

  // --- placement (fixed point): a user widget lives in the one feature app using it, else ResourcesMA;
  //     templates are copied into every app whose forms / widgets / templates use them
  const widgetNs = [...new Set(files.filter((x) => x.c.cat === "widget").map((x) => x.c.ns))];
  const place = new Map(widgetNs.map((n) => [n, resources]));
  const tplApps = new Map([...templateNames].map((t) => [t, new Set()]));
  const appsOfUnit = (u) => {
    if (u.startsWith("form:")) return moduleApps.has(u.slice(5)) ? [...moduleApps.get(u.slice(5))] : [container];
    if (u.startsWith("widget:")) return [place.get(u.slice(7))];
    if (u.startsWith("template:")) return [...(tplApps.get(u.slice(9)) || [])];
    return [];
  };
  for (let iter = 0; iter < 12; iter++) {
    const wUsers = new Map(widgetNs.map((n) => [n, new Set()]));
    const tUsers = new Map([...templateNames].map((t) => [t, new Set()]));
    for (const [u, r] of refs) {
      const apps = appsOfUnit(u);
      for (const k of r.kuids) { const ns = widgetRootKuid.get(k); if (ns && `widget:${ns}` !== u) apps.forEach((a) => wUsers.get(ns).add(a)); }
      for (const t of r.templates) if (`template:${t}` !== u) apps.forEach((a) => tUsers.get(t).add(a));
    }
    let changed = false;
    for (const n of widgetNs) {
      const us = [...wUsers.get(n)];
      const p = us.length === 1 && !sharedApps.has(us[0]) ? us[0] : resources;
      if (p !== place.get(n)) { place.set(n, p); changed = true; }
    }
    for (const t of templateNames) {
      const us = tUsers.get(t);
      if (!us.size) us.add(resources);
      const prev = tplApps.get(t);
      if (prev.size !== us.size || [...us].some((a) => !prev.has(a))) { tplApps.set(t, us); changed = true; }
    }
    if (!changed) break;
  }
  const actApps = new Map();
  for (const [u, r] of refs) for (const a of r.actions) { if (!actApps.has(a)) actApps.set(a, new Set()); appsOfUnit(u).forEach((x) => actApps.get(a).add(x)); }

  // --- form name -> apps (for navigation rewrites)
  const formIndex = new Map();
  for (const x of files) if (x.c.cat === "form") { const a = appOfForm(x.c.module, x.c.form) || container; if (!formIndex.has(x.c.form)) formIndex.set(x.c.form, new Set()); formIndex.get(x.c.form).add(a); }

  // --- destinations
  const out = []; // {path, f} | {path, text}
  const add = (app, rel, x, extra) => out.push({ path: `${app}/${rel}`, f: x.f, src: x.rel, app, c: x.c, ...extra });
  // R26 layout: folder renamed to the part's module name (forms/<ch>/<M>/…, controllers/<ch>/<M>/…, mvcextensions/<M>/…)
  const renamed = (rel, m, name) => (name === m ? rel : rel.replace(new RegExp(`^(forms/[^/]+/|controllers/[^/]+/|mvcextensions/)${m.replace(/[$.]/g, "\\$&")}/`), `$1${name}/`));
  const placements = { widgets: {}, templates: {}, actions: { unreferenced: 0 } };
  const orphanCtrl = new Set(); // controllers outside any module that belong to no template
  for (const x of files) {
    const c = x.c;
    switch (c.cat) {
      case "form": case "formController": {
        const frm = c.cat === "form" ? c.form : x.rel.split("/").slice(-2)[0].replace(/Controller$/, "");
        const pt = L && L.formPart(c.module, frm);
        if (pt) add(pt.app, renamed(x.rel, c.module, pt.name), x, { self: { kbz: c.module, name: pt.name } });
        else add(appOfForm(c.module, frm) || container, x.rel, x);
        break;
      }
      case "mvc":
        if (L && L.has(c.module)) for (const pt of L.parts(c.module)) add(pt.app, renamed(x.rel, c.module, pt.name), x, { self: { kbz: c.module, name: pt.name }, part: pt });
        else for (const a of moduleApps.get(c.module) || [container]) add(a, x.rel, x); // a split module's code goes with each part
        break;
      case "widget": add(place.get(c.ns), x.rel, x); break;
      case "template": for (const a of tplApps.get(c.template) || [resources]) add(a, x.rel, x); break;
      case "templateController": {
        const tp = templateByTop.get(c.template);
        if (tp) for (const a of tplApps.get(tp) || [resources]) add(a, x.rel, x);
        else { add(container, x.rel, x); orphanCtrl.add(x.rel.split("/").slice(0, 3).join("/")); }
        break;
      }
      case "action": { const as = actApps.get(c.id); if (as && as.size) as.forEach((a) => add(a, x.rel, x)); else { add(container, x.rel, x); placements.actions.unreferenced++; } break; }
      case "appAction": add(container, x.rel, x); break;
      case "folder":
        if (c.top === "modules") add(commons, x.rel, x);
        else if (["themes", "resources", "web"].includes(c.top)) add(resources, x.rel, x);
        else if (c.top === "models") { add(container, x.rel, x); featureApps.forEach((a) => add(a, x.rel, x)); }
        else if (c.top === ".webmeta") placements.skippedWebmeta = (placements.skippedWebmeta || 0) + 1;
        else add(container, x.rel, x); // nativebindings, testresources, .meta and every monolith-only extra folder
        break;
      case "root":
        if (/^(mobileFabricServiceConfigMap|objectServicesConfigMap|mobileFabricRulesServiceConfigMap)\.json$/.test(c.name)) { add(container, x.rel, x); featureApps.forEach((a) => add(a, x.rel, x)); }
        else if (c.name === "i18n.json") { add(resources, x.rel, x); add(container, x.rel, x); }
        else if (["projectProperties.json", "HeadlessBuild.properties", ".storyboard"].includes(c.name)) { /* generated below */ }
        else add(container, x.rel, x); // nativeapi.json, splashscreenproperties.json, .gitignore and monolith-only extras
        break;
      default: add(container, x.rel, x);
    }
  }
  for (const n of widgetNs) placements.widgets[n] = place.get(n);
  for (const t of templateNames) placements.templates[t] = [...tplApps.get(t)];
  for (const o of orphanCtrl) warnings.push({ path: `${container}/${o}`, message: "controller outside any module with no matching form or template — copied to the container unchanged; probably left over" });

  // --- reference rewrites in JS
  onProgress({ step: "Rewriting references", done: 0, total: 0 });
  const js = out.filter((o) => o.f && ((/\.js$/i.test(o.path) && (JS_REWRITE.has(o.c.cat) || (o.c.cat === "folder" && o.c.top === "modules")))
    || (/\.json$/i.test(o.path) && o.c.cat === "action")));
  const unresolved = { getModule: 0, navigation: 0 };
  let navPatched = false, dataUseFiles = 0;
  for (let i = 0; i < js.length; i++) {
    const o = js[i];
    const raw = await o.f.text();
    if (!/getModule\(|define\(|navigateTo\(|kony\.mvc\.Navigation\(|require\(/.test(raw)) continue;
    const ctx = { app: o.app, shared: sharedApps.has(o.app), moduleApp, moduleApps, appOfForm, formIndex, path: o.path, layout: L, self: o.self };
    const res = /\.json$/i.test(o.path) ? rewriteActionJson(raw, ctx) : rewriteJs(raw, ctx);
    if (!res) continue;
    let { text } = res;
    const { log, unresolved: u, dataUses } = res;
    unresolved.getModule += u.getModule; unresolved.navigation += u.navigation;
    if (dataUses.length) {
      dataUseFiles++;
      warnings.push({ path: o.path, line: dataUses[0].line, kind: "data", message: `${dataUses.length} form name(s) of other micro apps used as data — e.g. ${dataUses.slice(0, 3).map((d) => `line ${d.line} "${d.name}" (${d.app})`).join(", ")}. If one is navigated to, it needs {appName, friendlyName}.` });
    }
    if (/mvcextensions\/NavigationManager\/BusinessControllers\/BusinessController\.js$/.test(o.src)) {
      const p = patchNavigationManager(text);
      if (p) { text = p.text; navPatched = true; log.push({ path: o.path, line: p.line, rule: "NavigationManager.navigateTo — object-keyed back-stack (option b)", before: p.before.split("\n")[0] + " …", after: "if(!ignoreExistence){ … keyed by appName/friendlyName … }" }); }
      else warnings.push({ path: o.path, message: "NavigationManager.navigateTo has an unexpected shape — not adapted; cross-app back navigation may misbehave" });
    }
    for (const l of log) { if (l.warn) warnings.push({ path: l.path, line: l.line, message: `${l.rule}: ${l.before} ${l.after}` }); else rewrites.push(l); }
    if (text !== raw) { o.text = text; delete o.f; }
    if (i % 200 === 0) { onProgress({ step: "Rewriting references", done: i, total: js.length }); await new Promise((r) => setTimeout(r)); }
  }
  if (!navPatched && files.some((x) => /mvcextensions\/NavigationManager\//.test(x.rel))) warnings.push({ message: "NavigationManager was not adapted — check the report" });

  // --- R26 layout: ModuleConfig.json files. Every "Module/frmX" path (Controller, FormName, extensions — at any
  //     depth, e.g. KBZ's "EUROPE" variant block) is renamed to the module the form now lives in, as R26 writes them
  //     ("AuthUIModule/frmLogin"); a module's own forms are listed only in the part that holds them, forms it
  //     registered from other modules stay registered in its main part (as in the monolith)
  let configs = 0, crossKept = 0;
  if (L) {
    const formPath = (v) => {
      if (typeof v !== "string") return v;
      const m = v.match(/^([\w$]+)\/((?:user)?frm[\w$]*)$/);
      if (!m || !L.has(m[1])) return v;
      const pt = L.formPart(m[1], m[2].replace(/^user/, "").replace(/Controller(Actions)?$/, "")) || L.primary(m[1]);
      return `${pt.name}/${m[2]}`;
    };
    const ownPath = (v, m, name) => (typeof v === "string" && v.startsWith(`${m}/`) && !/^[\w$]+\/(user)?frm/.test(v) ? `${name}/${v.slice(m.length + 1)}` : v);
    const deep = (o, f) => (Array.isArray(o) ? o.map((x) => deep(x, f)) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deep(v, f)])) : f(o));
    // filter every "Forms": { <channel>: { frm: entry } } block for one part
    const filterForms = (o, pt) => {
      if (Array.isArray(o)) return o.map((x) => filterForms(x, pt));
      if (!o || typeof o !== "object") return o;
      const next = {};
      for (const [k, v] of Object.entries(o)) {
        if (k === "Forms" && v && typeof v === "object" && pt) {
          const fsOut = {};
          for (const [ch, list] of Object.entries(v)) {
            for (const [frm, e] of Object.entries(list || {})) {
              const fm = e && typeof e.FormName === "string" ? e.FormName.split("/")[0] : pt.module;
              const own = fm === pt.module;
              const keep = own ? pt.forms.includes(frm) : L.primary(pt.module) === pt;
              if (!keep) continue;
              if (!own) crossKept++;
              (fsOut[ch] ||= {})[frm] = e;
            }
          }
          next[k] = fsOut;
        } else next[k] = filterForms(v, pt);
      }
      return next;
    };
    for (const o of out) {
      if (!/^[^/]+\/mvcextensions\/[^/]+\/Config\/ModuleConfig\.json$/.test(o.path)) continue;
      const raw = o.text != null ? o.text : await o.f.text();
      let j;
      try { j = JSON.parse(raw.replace(/^\uFEFF/, "")); } catch { continue; }
      const pt = o.part || null;
      if (pt) j = filterForms(j, pt);
      j = deep(j, (v) => formPath(pt ? ownPath(v, pt.module, pt.name) : v));
      if (pt && "ModuleName" in j) j.ModuleName = pt.name;
      const text = JSON.stringify(j, null, 4);
      if (text !== raw) { o.text = text; delete o.f; configs++; }
    }
  }


  // --- composite runtime (R26): preappinit starts with _kony.mvc.initCompositeApp(true); every feature app carries
  //     the app events its projectProperties.json points to
  let kbzProps = {};
  const propsFile = files.find((x) => x.rel === "projectProperties.json");
  if (propsFile) {
    try { kbzProps = JSON.parse((await propsFile.f.text()).replace(/^\uFEFF/, "")); }
    catch (e) { warnings.push({ path: "projectProperties.json", message: `the monolith's projectProperties.json could not be read (${e.message}) \u2014 its settings and app events are not carried over` }); }
  }
  // app events are projectProperties.ide_appEvents.<channel dir>.<event> = action id (studioactions/<dir>/<id>.json)
  const evDirs = CHANNELS[plan.channel].mono;
  const appEvents = kbzProps.ide_appEvents || {};
  const eventIds = new Set(evDirs.flatMap((d) => Object.values(appEvents[d] || {}).filter((v) => typeof v === "string" && /^AS_AppEvents_\w+$/.test(v))));
  const preInits = new Map(evDirs.map((d) => [d, (appEvents[d] || {}).preappinit]).filter(([, v]) => v));
  const evOut = out.filter((o) => o.app === container && /^studioactions\/[^/]+\/(AS_AppEvents_\w+\.(js|json)|appEvents\.js)$/.test(o.src || "")
    && evDirs.includes(o.src.split("/")[1]) && (/appEvents\.js$/.test(o.src) || eventIds.has(o.src.split("/").pop().replace(/\.(js|json)$/, ""))));
  let initAdded = 0;
  for (const o of evOut) {
    const pre = preInits.get(o.src.split("/")[1]);
    if (!pre) continue;
    const raw = o.text != null ? o.text : await o.f.text();
    let text = raw;
    if (o.src.endsWith(`${pre}.json`)) text = addCompositeInit(raw, pre, "json") || raw;
    else if (o.src.endsWith(`${pre}.js`) || o.src.endsWith("appEvents.js")) text = addCompositeInit(raw, pre, "js") || raw;
    if (text !== raw) { o.text = text; delete o.f; initAdded++; rewrites.push({ path: o.path, line: "", rule: "composite app start (R26)", before: "preappinit", after: COMPOSITE_INIT }); }
  }
  for (const [d, pre] of preInits) if (!evOut.some((o) => o.src.endsWith(`${d}/${pre}.json`) && o.text && o.text.includes("initCompositeApp"))) warnings.push({ message: `preappinit (${d}: ${pre}) not found in studioactions — add ${COMPOSITE_INIT} to it by hand` });
  for (const a of featureApps) for (const o of evOut) out.push({ path: `${a}/${o.src}`, ...(o.text != null ? { text: o.text } : { f: o.f }), src: o.src, app: a, c: o.c, generated: true });
  if (!preInits.size) warnings.push({ message: "the monolith has no preappinit event — the composite app will not call initCompositeApp; add one to the container" });

  // --- generated project files (R26 structure)
  const tplApp = (name) => ma.apps.get(name) || ma.apps.get(featureApps.find((a) => ma.apps.has(a))) || [...ma.apps.values()].find((a) => ma.manifests[a.name] && a.name !== container);
  const relIn = (app, f) => (f.webkitRelativePath || f.name).replace(/\\/g, "/").slice(app.root.length + 1);
  const tplFile = (app, rel) => app && app.files.find((f) => relIn(app, f) === rel);
  const monoRoot = (name) => files.find((x) => x.rel === name);
  const containerTpl = ma.apps.get(container) || tplApp(container);
  const appId = kbzProps.appidkey || "OnlineBanking";
  // Settings policy: the monolith's value wins for every setting it has (so no reference-project secrets, cloud ids
  // or bundle ids are carried over); the reference supplies only Visualizer-version metadata, settings the monolith
  // does not have, and — for micro apps — their own identity (name / package), renamed to the micro app.
  const TOOLING = new Set(["konyVizVersion", "currentgaversion", "createdgaversion", "createdVizVersion", "project_version", "lastmodifiedtime"]);
  const IDENTITY = new Set(["appnamekey", "apppackagekey", "andwearapppackagekey", "appidkey"]);
  const parseProps = (t) => { const m = new Map(); for (const line of t.split(/\r?\n/)) { const x = line.match(/^\s*([^#=\s][^=]*?)\s*=(.*)$/); if (x) m.set(x[1], x[2]); } return m; };
  const kbzHead = monoRoot("HeadlessBuild.properties") ? parseProps(await monoRoot("HeadlessBuild.properties").f.text()) : new Map();
  const projects = [container, ...featureApps, commons, resources];
  // start-up form (a form kuid): R26 keeps it in the container and in the one project holding that form; every other
  // micro app has its own start-up form or none — a key pointing at a form outside the project is cleared
  const STARTUP = ["startupformkey", "desktopstartupformkey", "tabletstartupformkey"];
  const wantedKuid = new Set(STARTUP.map((k) => kbzProps[k]).filter(Boolean));
  const startupApp = new Map();
  if (wantedKuid.size) for (const x of files) if (x.c.cat === "form" && x.rel.endsWith(`/${x.c.form}.sm/${x.c.form}.json`)) {
    const m = (await x.f.text()).match(/"kuid"\s*:\s*"(\w+)"/);
    if (m && wantedKuid.has(m[1])) startupApp.set(m[1], appOfForm(x.c.module, x.c.form) || container);
  }
  const channelKey = plan.channel === "web" ? "desktopstartupformkey" : "startupformkey";
  if (kbzProps[channelKey] && !startupApp.has(kbzProps[channelKey])) warnings.push({ message: `start-up form ${channelKey} (${kbzProps[channelKey]}) is not one of this channel's forms — set the container's start-up form in Visualizer` });
  const deps = {};
  for (const p of projects) {
    const tpl = p === container ? containerTpl : tplApp(p);
    const tplName = tpl ? tpl.name : p;
    // projectProperties.json: R26 structure; container also takes every KBZ setting it has
    const pf = tplFile(tpl, "projectProperties.json");
    if (pf) {
      let props = JSON.parse((await pf.text()).replace(/^﻿/, ""));
      props = JSON.parse(JSON.stringify(props).split(`"${tplName}"`).join(`"${p}"`).split(`.${tplName}"`).join(`.${p}"`));
      for (const [k, v] of Object.entries(kbzProps)) {
        if (TOOLING.has(k)) continue;
        if (p !== container && (IDENTITY.has(k) || !(k in props))) continue; // micro apps keep their own identity and structure
        props[k] = v;
      }
      if (p !== container) { props.appnamekey = p; if (props.appidkey && props.appidkey !== p) props.appidkey = appId; }
      if (p !== container) for (const k of STARTUP) if (props[k]) props[k] = startupApp.get(props[k]) === p ? props[k] : "";
      if (p === commons || p === resources) delete props.ide_appEvents;
      else if (kbzProps.ide_appEvents) props.ide_appEvents = kbzProps.ide_appEvents;
      out.push({ path: `${p}/projectProperties.json`, text: JSON.stringify(props, null, 4), app: p, generated: true });
    } else warnings.push({ message: `No R26 template project for ${p} — projectProperties.json not generated` });
    const hb = tplFile(tpl, "HeadlessBuild.properties");
    if (hb) {
      const own = new Set(["project.name", ...(p === container ? [] : ["appid", "android.packagename"])]);
      const text = (await hb.text()).split(/(\r?\n)/).map((line) => {
        const x = line.match(/^(\s*)([^#=\s][^=]*?)(\s*=)(.*)$/);
        if (!x) return line;
        if (x[2] === "project.name") return `${x[1]}${x[2]}${x[3]}${p}`;
        if (own.has(x[2])) return line.split(tplName).join(p);
        return kbzHead.has(x[2]) ? `${x[1]}${x[2]}${x[3]}${kbzHead.get(x[2])}` : line;
      }).join("");
      out.push({ path: `${p}/HeadlessBuild.properties`, text, app: p, generated: true });
    }
    if (tpl) for (const f of tpl.files) {
      const r = relIn(tpl, f);
      if (p !== container && ["splashscreenproperties.json", "nativeapi.json", ".gitignore", ".meta/lockMeta.json"].includes(r)) out.push({ path: `${p}/${r}`, f, app: p, generated: true });
      if (p === container && r === ".meta/lockMeta.json") out.push({ path: `${p}/${r}`, f, app: p, generated: true });
    }
    // navigation framework (R26): empty model + controller per channel — R26's own navigation rules are not copied
    for (const ch of ["desktop", "mobile", "tablet"]) {
      out.push({ path: `${p}/navigation/${ch}/navigationModel.json`, text: NAV_MODEL, app: p, generated: true });
      out.push({ path: `${p}/navigation/${ch}/navigationController.js`, text: NAV_CONTROLLER, app: p, generated: true });
    }
    // default skins (Visualizer defaults) in every project except ResourcesMA, which gets all of them
    if (p !== resources && tpl) {
      const defaults = new Set(tpl.files.map((f) => relIn(tpl, f)).filter((r) => /^themes\/[^/]+\/[^/]+\.json$/.test(r)).map((r) => r.split("/").pop()));
      for (const x of files) if (x.c.cat === "folder" && x.c.top === "themes") {
        const s = x.rel.split("/");
        if ((s.length === 3 && defaults.has(s[2])) || (s.length >= 4 && s[2] === "constants")) out.push({ path: `${p}/${x.rel}`, f: x.f, src: x.rel, app: p });
      }
    }
    deps[p] = p === container ? projects.filter((x) => x !== container) : p === commons ? [resources] : p === resources ? [] : [commons, resources];
  }
  const entry = (d) => ({ name: d, ...(d === commons || d === resources ? { useResources: true } : {}), isHidden: false, excludeFromBuild: false });
  for (const p of projects) {
    if (!deps[p].length) continue;
    out.push({ path: `${p}/project.manifest`, text: JSON.stringify({ dependencies: deps[p].map(entry) }, null, 4), app: p, generated: true });
  }
  const variants = {};
  for (const v of ["RESproject.manifest", "BCESproject.manifest"]) {
    const members = [...variantMembers(v, featureApps), commons, resources];
    variants[v] = members;
    out.push({ path: `${container}/${v}`, text: JSON.stringify({ dependencies: members.map(entry) }, null, 4), app: container, generated: true });
  }
  const notInR26 = featureApps.filter((a) => !R26_MAP.apps[a]);
  if (notInR26.length) warnings.push({ message: `${notInR26.length} micro apps R26 does not have are listed in both RESproject.manifest (retail) and BCESproject.manifest (business): ${notInR26.join(", ")} — remove them from the one they do not belong to` });

  // composite check on what is about to be written
  const byPath = new Map(out.map((o) => [o.path, o]));
  const channelDirs = CHANNELS[plan.channel].mono;
  const readOut = async (path) => { const o = byPath.get(path); return o ? (o.text != null ? o.text : await o.f.text()) : null; };
  const composite = await checkComposite(projects, { container, commons, resources, channelDirs }, readOut);

  const summary = {
    channel: plan.channel, container, commons, resources, projects,
    files: out.length, rewrites: rewrites.length, warnings: warnings.length,
    rewriteRules: rewrites.reduce((m, r) => ((m[r.rule] = (m[r.rule] || 0) + 1), m), {}),
    unresolved, navigationManagerAdapted: navPatched, filesWithFormNamesAsData: dataUseFiles,
    splitModules: Object.fromEntries([...moduleApps].filter(([, a]) => a.size > 1).map(([m, a]) => [m, [...a]])),
    layout: plan.layout ? { mode: "R26 (form by form, R26 module names)", parts: plan.layout.parts.length, moduleConfigs: configs, crossRegisteredFormsKept: crossKept, renamedModules: plan.layout.parts.filter((p) => p.name !== p.module).length, notes: plan.layout.notes } : null,
    composite: { initCompositeApp: initAdded > 0, appEventsCopiedTo: featureApps.length, retail: variants["RESproject.manifest"], business: variants["BCESproject.manifest"], allLinked: composite.every((r) => r.ok) },
    widgetsShared: Object.values(placements.widgets).filter((a) => a === resources).length,
    widgetsInFeatureApps: Object.values(placements.widgets).filter((a) => a !== resources).length,
    templatesCopied: Object.values(placements.templates).reduce((n, a) => n + a.length, 0),
    templatesOnlyShared: Object.values(placements.templates).filter((a) => a.length === 1 && a[0] === resources).length,
    orphanControllers: orphanCtrl.size,
    unreferencedActions: placements.actions.unreferenced,
    skippedDirs: SKIP_DIRS, notGenerated: [".storyboard", ".webmeta (Visualizer rebuilds these)"],
  };
  const csv = [["file", "line", "rule", "before", "after"], ...rewrites.map((r) => [r.path, r.line, r.rule, r.before, r.after]), ...warnings.map((w) => [w.path || "", w.line || "", "WARNING", w.message, ""])]
    .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  out.push({ path: "conversion-report.csv", text: csv, generated: true });
  out.push({ path: "conversion-summary.json", text: JSON.stringify({ summary, plan: plan.rows.map((r) => ({ module: r.module, target: r.target, suggested: r.suggested, reason: r.reason })), formTargets, layout: plan.layout || null, placements, composite }, null, 2), generated: true });
  onProgress({ step: "done", done: 1, total: 1 });
  return { out, rewrites, warnings, summary, placements, composite, roles: { container, commons, resources, channelDirs }, projects };
}

// ---------------------------------------------------------------- writing into a picked folder (File System Access API)
export async function writeOut(dir, out, onProgress = () => {}) {
  const dirs = new Map([["", dir]]);
  const dirOf = async (path) => {
    const parts = path.split("/").slice(0, -1);
    let cur = "", h = dir;
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!dirs.has(cur)) dirs.set(cur, await h.getDirectoryHandle(p, { create: true }));
      h = dirs.get(cur);
    }
    return h;
  };
  let done = 0, failed = [];
  const queue = [...out];
  const worker = async () => {
    for (;;) {
      const o = queue.shift();
      if (!o) return;
      try {
        const h = await dirOf(o.path);
        const fh = await h.getFileHandle(o.path.split("/").pop(), { create: true });
        const w = await fh.createWritable();
        await w.write(o.f ? o.f : o.text);
        await w.close();
      } catch (e) { failed.push({ path: o.path, error: String(e.message || e) }); }
      done++;
      if (done % 50 === 0) onProgress({ done, total: out.length });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  onProgress({ done, total: out.length });
  return { written: done - failed.length, failed };
}
