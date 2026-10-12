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
  const log = [];
  const unresolved = { getModule: 0, navigation: 0 };
  const needs = (target) => shared || target !== app;
  const edits = [];
  // getModule("X") / getModule('X')
  for (const m of text.matchAll(/getModule\(\s*(["'])([\w$.]+)\1\s*\)/g)) {
    const target = moduleApp.get(m[2]);
    if (!target) continue;
    if (!needs(target)) continue;
    const after = `getModule({"moduleName" : "${m[2]}", "appName" : "${target}"})`;
    edits.push({ at: m.index, len: m[0].length, after, rule: "getModule → other micro app" + (shared ? " (shared code)" : ""), before: m[0] });
  }
  for (const m of text.matchAll(/getModule\(\s*(?![\s"'{)])/g)) { void m; unresolved.getModule++; }
  // named define("Module/...") of form controllers
  for (const m of text.matchAll(/(^|\n)(\s*define\(\s*)(["'])([\w$]+)\/([^"']*)\3/g)) {
    if (!moduleApp.has(m[4])) continue;
    const at = m.index + m[1].length + m[2].length;
    edits.push({ at, len: m[0].length - m[1].length - m[2].length, after: `${m[3]}${app}/${m[4]}/${m[5]}${m[3]}`, rule: "define name → app-prefixed", before: `${m[3]}${m[4]}/${m[5]}${m[3]}` });
  }
  // require(["Module/frmX", "Module/frmXController"]) — R26 prefixes the micro app: "AboutUsMA/FeedbackModule/frmCustomerFeedback"
  for (const r of text.matchAll(/require\(\s*(\[[^\]]*\]|(["'])[^"']*\2)/g)) {
    const base = r.index + r[0].indexOf(r[1]);
    for (const m of r[1].matchAll(/(["'])([\w$]+)\/([\w$/]+)\1/g)) {
      const target = moduleApp.get(m[2]);
      if (!target || !needs(target)) continue;
      edits.push({ at: base + m.index, len: m[0].length, after: `${m[1]}${target}/${m[2]}/${m[3]}${m[1]}`, rule: "require path → app-prefixed (other micro app)" + (shared ? " (shared code)" : ""), before: m[0] });
    }
  }
  // navigation to a form given as a literal (any real form name, "frmX" or "Module/frmX")
  const navRx = /(\.navigateTo\(\s*|new\s+kony\.mvc\.Navigation\(\s*)(["'])((?:[\w$]+\/)?[\w$]+)\2/g;
  for (const m of text.matchAll(navRx)) {
    const lit = m[3];
    let apps;
    if (lit.includes("/")) { const mod = lit.split("/")[0]; apps = moduleApp.has(mod) && formIndex.has(lit.split("/").pop()) ? new Set([moduleApp.get(mod)]) : null; }
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

// ---------------------------------------------------------------- conversion
const JS_REWRITE = new Set(["formController", "templateController", "mvc", "widget", "folder:modules", "action", "appAction"]);

export async function convert(monoFiles, ma, plan, onProgress = () => {}) {
  const { container, commons, resources } = plan;
  const moduleApp = new Map(plan.rows.map((r) => [r.module, r.target.trim()]));
  const featureApps = [...new Set(plan.rows.map((r) => r.target.trim()))].filter((a) => a !== commons && a !== resources && a !== container).sort();
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
    if (u.startsWith("form:")) return [moduleApp.get(u.slice(5)) || container];
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
  for (const x of files) if (x.c.cat === "form") { const a = moduleApp.get(x.c.module) || container; if (!formIndex.has(x.c.form)) formIndex.set(x.c.form, new Set()); formIndex.get(x.c.form).add(a); }

  // --- destinations
  const out = []; // {path, f} | {path, text}
  const add = (app, rel, x) => out.push({ path: `${app}/${rel}`, f: x.f, src: x.rel, app, c: x.c });
  const placements = { widgets: {}, templates: {}, actions: { unreferenced: 0 } };
  const orphanCtrl = new Set(); // controllers outside any module that belong to no template
  for (const x of files) {
    const c = x.c;
    switch (c.cat) {
      case "form": case "formController": case "mvc": add(moduleApp.get(c.module) || container, x.rel, x); break;
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
  const js = out.filter((o) => o.f && /\.js$/i.test(o.path) && (JS_REWRITE.has(o.c.cat) || (o.c.cat === "folder" && o.c.top === "modules")));
  const unresolved = { getModule: 0, navigation: 0 };
  let navPatched = false, dataUseFiles = 0;
  for (let i = 0; i < js.length; i++) {
    const o = js[i];
    const raw = await o.f.text();
    if (!/getModule\(|define\(|navigateTo\(|kony\.mvc\.Navigation\(|require\(/.test(raw)) continue;
    let { text, log, unresolved: u, dataUses } = rewriteJs(raw, { app: o.app, shared: sharedApps.has(o.app), moduleApp, formIndex, path: o.path });
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

  // --- generated project files (R26 structure)
  const tplApp = (name) => ma.apps.get(name) || ma.apps.get(featureApps.find((a) => ma.apps.has(a))) || [...ma.apps.values()].find((a) => ma.manifests[a.name] && a.name !== container);
  const relIn = (app, f) => (f.webkitRelativePath || f.name).replace(/\\/g, "/").slice(app.root.length + 1);
  const tplFile = (app, rel) => app && app.files.find((f) => relIn(app, f) === rel);
  const monoRoot = (name) => files.find((x) => x.rel === name);
  const kbzProps = monoRoot("projectProperties.json") ? JSON.parse((await monoRoot("projectProperties.json").f.text()).replace(/^﻿/, "")) : {};
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
      if (r.startsWith("navigation/")) out.push({ path: `${p}/${r}`, f, app: p, generated: true });
      if (p !== container && ["splashscreenproperties.json", "nativeapi.json", ".gitignore", ".meta/lockMeta.json"].includes(r)) out.push({ path: `${p}/${r}`, f, app: p, generated: true });
      if (p === container && r === ".meta/lockMeta.json") out.push({ path: `${p}/${r}`, f, app: p, generated: true });
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
  for (const p of projects) {
    if (!deps[p].length) continue;
    const manifest = { dependencies: deps[p].map((d) => ({ name: d, ...(d === commons || d === resources ? { useResources: true } : {}), isHidden: false, excludeFromBuild: false })) };
    out.push({ path: `${p}/project.manifest`, text: JSON.stringify(manifest, null, 4), app: p, generated: true });
  }

  const summary = {
    channel: plan.channel, container, commons, resources, projects,
    files: out.length, rewrites: rewrites.length, warnings: warnings.length,
    rewriteRules: rewrites.reduce((m, r) => ((m[r.rule] = (m[r.rule] || 0) + 1), m), {}),
    unresolved, navigationManagerAdapted: navPatched, filesWithFormNamesAsData: dataUseFiles,
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
  out.push({ path: "conversion-summary.json", text: JSON.stringify({ summary, plan: plan.rows.map((r) => ({ module: r.module, target: r.target, suggested: r.suggested, reason: r.reason })), placements }, null, 2), generated: true });
  onProgress({ step: "done", done: 1, total: 1 });
  return { out, rewrites, warnings, summary, placements };
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
