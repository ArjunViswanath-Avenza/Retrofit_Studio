// Builds the built-in R26 micro-app map (src/data/r26-map.json) from an R26 folder of Visualizer projects.
// Only names are kept — micro apps, their modules and forms, widget counts — no product code.
// usage: node scripts/build-r26-map.mjs <R26 folder> [release]     e.g. node scripts/build-r26-map.mjs Apps_Trial/R26 26.0.5
import fs from "node:fs";
import path from "node:path";

const [root, release = "unknown"] = process.argv.slice(2);
if (!root) { console.error("usage: node scripts/build-r26-map.mjs <R26 folder> [release]"); process.exit(1); }
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "src", "data", "r26-map.json");
const CH = { web: "desktop", mobile: "mobile" };
const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();
const json = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")); } catch { return null; } };

const projects = fs.readdirSync(root).filter((d) => isDir(path.join(root, d)) && fs.existsSync(path.join(root, d, "projectProperties.json"))).sort();

// which container manifests list each project
const manifests = {};
let container = null, most = -1;
for (const p of projects) {
  for (const f of fs.readdirSync(path.join(root, p)).filter((x) => /project\.manifest$/.test(x))) {
    const deps = (json(path.join(root, p, f)) || {}).dependencies || [];
    if (f === "project.manifest" && deps.length > most) { most = deps.length; container = p; }
    for (const d of deps) (manifests[d.name] ||= []).push(f);
  }
}

const apps = {};
for (const p of projects) {
  const kind = p === container ? "container" : /^(CommonsMA|Resources\w*MA)$/.test(p) ? "shared" : manifests[p] ? "feature" : "other";
  apps[p] = { kind, listedIn: [...new Set(manifests[p] || [])].sort(), mvc: [] };
  const mvc = path.join(root, p, "mvcextensions");
  if (isDir(mvc)) apps[p].mvc = fs.readdirSync(mvc).filter((m) => isDir(path.join(mvc, m))).sort();
}

const channels = {};
for (const [key, dir] of Object.entries(CH)) {
  const forms = {}; // name -> [[app, module, widgets]]
  const modules = {}; // app -> { module: formCount }
  for (const p of projects) {
    const base = path.join(root, p, "forms", dir);
    if (!isDir(base)) continue;
    const add = (module, sm) => {
      const name = sm.replace(/\.sm$/, "");
      const ids = fs.readdirSync(path.join(base, module, sm)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
      (forms[name] ||= []).push({ app: p, module, widgets: ids.length, ids });
      ((modules[p] ||= {})[module || "(no module)"] = (modules[p][module || "(no module)"] || 0) + 1);
    };
    for (const e of fs.readdirSync(base)) {
      if (e.endsWith(".sm")) add("", e);
      else if (isDir(path.join(base, e))) for (const f of fs.readdirSync(path.join(base, e))) if (f.endsWith(".sm")) add(e, f);
    }
  }
  // widget names are kept only where a form name exists in several projects (to tell the real one from stubs)
  const out = {};
  for (const [name, list] of Object.entries(forms)) out[name] = list.map((c) => (list.length > 1 ? [c.app, c.module, c.widgets, c.ids] : [c.app, c.module, c.widgets]));
  channels[key] = { forms: out, modules };
}

const map = { release, builtFrom: path.basename(path.resolve(root)), built: new Date().toISOString().slice(0, 10), container, apps, channels };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(map));
const n = (k) => Object.keys(channels[k].forms).length;
console.log(`r26-map.json: ${projects.length} projects (container ${container}), web ${n("web")} form names, mobile ${n("mobile")}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
