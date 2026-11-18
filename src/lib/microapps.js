// Monolith -> micro app: align R26 micro-app artifacts onto the monolith's keys so the existing
// FormForge / CtrlSync / MVC Bridge / COMP-are engines can compare R21 + KBZ monoliths with R26 unchanged.
//
// R26 (verified on Apps_Trial/R26): one folder per Visualizer project; a project = a folder holding
// projectProperties.json. OnlineBanking is the container (project.manifest / RES / BCES list the micro apps),
// *MA folders are micro apps, CommonsMA / Resources*MA are shared. Each micro app has the same inner layout
// as a monolith (forms/<channel>/<Module>/frmX.sm, controllers/<channel>/..., mvcextensions/<Module>/...,
// userwidgets/<namespace>/...) but modules are renamed (CardManagementModule -> ManageCardsUIModule +
// CardsManager) and user-widget namespaces move to com.InfinityOLB.<MA>.<name> / com.InfinityMB.<MA>.<name>.
//
// Matching, per artifact:
//   forms        same channel + name and the root widget's kuid (see "forms" below); several candidates -> the one
//                whose widget-id set is most similar to the monolith form (ties: module affinity)
//   controllers  form controllers follow their form (the controller beside the R26 form it matched, even when that
//                form has another name); otherwise same channel + name; several -> most similar text
//   mvc          presentation / business controllers -> the R26 controller file with the most similar set of
//                member (method) names, preferring the UIModules the module's forms moved to
//   user widgets root widget kuid, else same class name (last namespace segment); several -> most similar widget-id set
// Tablet / watch monolith forms have no R26 counterpart (R26 micro apps carry desktop + mobile forms only).
import { pool } from "./jobs.js";

export const CHANNELS = {
  web: { label: "Web (Online Banking)", mono: ["desktop"], r26: ["desktop"], family: /\.InfinityOLB\./ },
  mobile: { label: "Mobile (Mobile Banking)", mono: ["mobile", "tablet", "watch"], r26: ["mobile"], family: /\.InfinityMB\./ },
};

// ---------------------------------------------------------------- scanning the R26 folder
// groups files by the project folder they belong to (deepest folder with projectProperties.json)
export function scanMicroApps(fileList, scanFolder) {
  const files = [...fileList];
  const rel = (f) => (f.webkitRelativePath || f.name).replace(/\\/g, "/");
  const roots = new Set();
  for (const f of files) {
    const p = rel(f);
    if (/(^|\/)projectProperties\.json$/.test(p)) roots.add(p.slice(0, p.lastIndexOf("/")));
  }
  const sorted = [...roots].sort((a, b) => b.length - a.length);
  const groups = new Map();
  let skipped = 0;
  for (const f of files) {
    const p = rel(f);
    const r = sorted.find((x) => p.startsWith(x + "/"));
    if (!r) { skipped++; continue; }
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(f);
  }
  const apps = new Map();
  const manifests = {};
  for (const [r, fs] of groups) {
    const name = r.split("/").pop();
    apps.set(name, { name, root: r, scan: scanFolder(fs), fileCount: fs.length, files: fs });
    for (const f of fs) {
      const p = rel(f).slice(r.length + 1);
      if (/^[^/]*project\.manifest$/.test(p)) (manifests[name] = manifests[name] || {})[p] = f;
    }
  }
  const tot = { forms: 0, controllers: 0, business: 0, presentation: 0, components: 0 };
  for (const a of apps.values()) for (const k in tot) tot[k] += a.scan.counts[k] || 0;
  return { apps, manifests, fileCount: files.length, skipped, counts: tot, microApps: apps.size };
}

// declared micro apps (container manifests) that are not in the picked folder
export async function missingMicroApps(ma) {
  const declared = new Set();
  for (const [app, mf] of Object.entries(ma.manifests)) {
    for (const f of Object.values(mf)) {
      try {
        const j = JSON.parse((await f.text()).replace(/^﻿/, ""));
        for (const d of j.dependencies || []) declared.add(d.name);
      } catch { /* unreadable manifest */ }
      void app;
    }
  }
  return [...declared].filter((n) => !ma.apps.has(n)).sort();
}

// ---------------------------------------------------------------- helpers
const jaccard = (a, b) => {
  if (!a.size && !b.size) return 1;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
};
const pct = (x) => `${Math.round(x * 100)}%`;
const lineSet = (t) => new Set(t.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l.length > 2));
const memberSet = (t) => new Set([...t.matchAll(/([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?function\b/g)].map((m) => m[1]));
const textCache = new WeakMap();
const textOf = async (f) => { if (!textCache.has(f)) textCache.set(f, f.text()); return textCache.get(f); };

// filter a monolith scan to the channels in scope (forms / controllers are channel-keyed; mvc & widgets are shared)
export function channelScan(scan, channels) {
  if (!scan) return null;
  const keep = (m) => new Map([...m].filter(([k]) => channels.includes(k.split("/")[0])));
  const forms = keep(scan.forms), controllers = keep(scan.controllers);
  const segs = keep(scan.segs || new Map()), tplCtrl = keep(scan.tplCtrl || new Map());
  return { ...scan, forms, controllers, segs, tplCtrl, counts: { ...scan.counts, forms: forms.size, controllers: controllers.size, segments: segs.size } };
}

const parseFormKey = (k) => { const s = k.split("/"); return { ch: s[0], module: s.slice(1, -1).join("/"), name: s[s.length - 1].replace(/\.sm$/i, "") }; };
const parseCtrlKey = (k) => { const s = k.split("/"); return { ch: s[0], module: s.length > 3 ? s.slice(1, -2).join("/") : "", name: s[s.length - 1].replace(/\.js$/i, "") }; };

// ---------------------------------------------------------------- user widgets: identity
// the root widget of a component is the only child of its userwidgetmodel wrapper; its kuid is what a form's
// UserWidgetInstance names in "sourceUserWidget", and it survives R26's renames
export async function rootKuid(files) {
  if (!files) return null;
  const read = async (f) => { try { return JSON.parse((await textOf(f)).replace(/^﻿/, "")); } catch { return null; } };
  const wrap = files.get("userwidgetmodel.sm/userwidgetmodel.json");
  const w = wrap ? await read(wrap) : null;
  const id = w && Array.isArray(w.children) ? w.children[0] : null;
  const f = id ? files.get(`userwidgetmodel.sm/${id}.json`) : null;
  const root = f ? await read(f) : null;
  return (root && root.kuid) || null;
}
export const compWidgetIds = (files) => new Set(files ? [...files.keys()].filter((r) => r.startsWith("userwidgetmodel.sm/")) : []);
const sharedMA = (app) => /^(Resources\w*|Commons)MA$/.test(app);
// every R26 copy of the channel's family: { app, key, name, files, ids, kuid }
function compCatalog(apps, C) {
  const list = [];
  for (const a of apps) for (const [k, files] of a.scan.comps) {
    if (/\.Infinity(OLB|MB)\./.test(k) && !C.family.test(k)) continue; // the other channel's widgets
    list.push({ app: a.name, key: k, name: k.split(".").pop(), files, ids: compWidgetIds(files), kuid: null });
  }
  list.byLoc = new Map(list.map((c) => [`${c.app}/${c.key}`, c]));
  return list;
}
const copyRef = (c) => ({ app: c.app, key: c.key, name: c.name, score: c.score, kuid: c.kuid || null });
// best first: widget overlap, then a shared micro app (Resources / Commons), then name
const scoreCopies = (ids, list) => list.map((c) => ({ ...c, score: jaccard(ids, c.ids) }))
  .sort((x, y) => y.score - x.score || (sharedMA(y.app) ? 1 : 0) - (sharedMA(x.app) ? 1 : 0) || x.app.localeCompare(y.app)).map(copyRef);
const CONFIDENCE = { kuid: "proven", manual: "set by you", "manual-none": "set by you", name: "likely", "name-weak": "weak", suggested: "suggested", none: "none" };
const AUTO_FIELDS = ["status", "link", "method", "copies", "suggestions", "suggest"];
const autoOf = (row) => Object.fromEntries(AUTO_FIELDS.map((f) => [f, row[f]]));
// a manual link on top of the automatic match: {app, key} -> that copy (and the copies sharing its root kuid),
// "none" -> no R26 counterpart, null -> back to the automatic match
function applyLink(row, link, catalog) {
  Object.assign(row, row.auto);
  row.manual = null;
  if (link == null) return;
  if (link === "none") { Object.assign(row, { status: "none", link: "manual-none", method: "set by you: no R26 counterpart", copies: [] }); row.manual = "none"; return; }
  const c = catalog.byLoc.get(`${link.app}/${link.key}`);
  if (!c) { row.linkMissing = link; return; } // the linked copy is not in this R26 folder any more: automatic match kept
  const siblings = c.kuid ? catalog.filter((x) => x !== c && x.kuid === c.kuid) : [];
  const mine = scoreCopies(row.monoIds || new Set(), [c, ...siblings]);
  const first = mine.findIndex((x) => x.app === c.app && x.key === c.key);
  const copies = [mine[first], ...mine.filter((_, i) => i !== first)];
  Object.assign(row, { status: "mapped", link: "manual", method: `set by you${c.name !== row.name ? ` · named ${c.name} in R26` : ""}${copies.length > 1 ? ` · ${copies.length} copies share its root kuid` : ""}`, copies });
  row.manual = { app: c.app, key: c.key };
}
function finishCompRow(row) {
  const best = row.copies[0];
  row.target = best ? { app: best.app, module: best.key, key: best.key } : null;
  row.alts = row.copies.slice(1).map((c) => `${c.key} (${Math.round((c.score || 0) * 100)}%)`);
  row.confidence = CONFIDENCE[row.link] || "none";
}
// the aligned R26 maps for one component row
function publishComp(out, row) {
  const best = row.copies[0];
  const c = best && out.compCatalog.byLoc.get(`${best.app}/${best.key}`);
  if (c) { out.comps.set(row.key, c.files); out.compApp.set(row.key, c.app); } else { out.comps.delete(row.key); out.compApp.delete(row.key); }
  for (const [q, k] of [...out.compAlias]) if (k === row.key) out.compAlias.delete(q);
  for (const x of row.copies) if (x.kuid) out.compAlias.set(x.kuid, row.key);
  if (row.kuid && c) out.compAlias.set(row.kuid, row.key);
}
// a manual link set after the map was built: a new aligned result (the R26 maps and the report row replaced)
export function relinkComponent(aligned, key, link) {
  const r26 = aligned.picked[2];
  const next = { ...r26, comps: new Map(r26.comps), compApp: new Map(r26.compApp), compAlias: new Map(r26.compAlias) };
  const comps = aligned.report.comps.map((r) => {
    if (r.key !== key) return r;
    const row = { ...r, linkMissing: undefined };
    applyLink(row, link, r26.compCatalog);
    finishCompRow(row);
    publishComp(next, row);
    return row;
  });
  return { ...aligned, picked: [aligned.picked[0], aligned.picked[1], next], report: { ...aligned.report, comps } };
}

// ---------------------------------------------------------------- forms: identity
// a form's root widget is the file named after the form (the Form itself, no parent); its kuid survives copies and
// R26's re-makes (frmLogin -> frmLoginOlb)
export async function formRootKuid(map, name) {
  const f = map && map.get(name);
  if (!f) return null;
  try { const j = JSON.parse((await textOf(f)).replace(/^﻿/, "")); return j.kuid || null; } catch { return null; }
}
// every R26 form of the channel: { app, key, ch, module, name, map, ids, kuid }
function formCatalog(apps, C) {
  const list = [];
  for (const a of apps) for (const [k, m] of a.scan.forms) {
    const p = parseFormKey(k);
    if (!C.r26.includes(p.ch)) continue;
    list.push({ app: a.name, key: k, ch: p.ch, module: p.module, name: p.name, map: m, ids: new Set(m.keys()), kuid: null });
  }
  list.byLoc = new Map(list.map((c) => [`${c.app}/${c.key}`, c]));
  return list;
}
// the key an R26 form no monolith form claims is listed under
const r26OnlyFormKey = (c) => `${c.ch}/${c.app}·${c.module}/${c.name}.sm`;
const formCopies = (scored) => scored.map((x) => ({ app: x.c.app, key: x.c.key, module: x.c.module, name: x.c.name, score: x.score, kuid: x.c.kuid || null }));
const FORM_AUTO = ["status", "link", "method", "copies", "suggestions"];
const autoOfForm = (row) => Object.fromEntries(FORM_AUTO.map((f) => [f, row[f]]));
// a manual form link on top of the automatic match: {app, key} -> that form, "none" -> no R26 counterpart, null -> automatic
function applyFormLink(row, link, catalog) {
  Object.assign(row, row.auto);
  row.manual = null;
  row.linkMissing = undefined;
  if (link == null) return;
  if (link === "none") { Object.assign(row, { status: "none", link: "manual-none", method: "set by you: no R26 counterpart", copies: [] }); row.manual = "none"; return; }
  const c = catalog.byLoc.get(`${link.app}/${link.key}`);
  if (!c) { row.linkMissing = link; return; } // the linked form is not in this R26 folder any more: automatic match kept
  const mine = { app: c.app, key: c.key, module: c.module, name: c.name, score: jaccard(row.monoIds || new Set(), c.ids), kuid: c.kuid || null };
  Object.assign(row, { status: "mapped", link: "manual", method: `set by you${c.name !== row.name ? ` · named ${c.name} in R26` : ""} · widget overlap ${pct(mine.score)}`, copies: [mine, ...(row.copies || []).filter((x) => !(x.app === c.app && x.key === c.key))] });
  row.manual = { app: c.app, key: c.key };
}
function finishFormRow(row, aff) {
  const best = row.copies && row.copies[0];
  row.target = best && row.status !== "none" ? { app: best.app, module: best.module, key: best.key } : null;
  row.overlap = best ? best.score : undefined;
  row.alts = (row.copies || []).slice(1).map((c) => `${c.app}:${c.module}${c.name !== row.name ? `/${c.name}` : ""} (${pct(c.score || 0)})`);
  row.confidence = FORM_CONFIDENCE[row.link] || "none";
  row.suggest = undefined;
  if (!row.target) { // where KBZ-only / unmatched forms would most likely live (module affinity)
    const best2 = Object.entries((aff && aff[row.module]) || {}).sort((x, y) => y[1] - x[1])[0];
    if (best2) row.suggest = best2[0];
  }
}
const FORM_CONFIDENCE = { ...CONFIDENCE, check: "check" };
// the R26 controller a form controller follows: the one beside the form it matched (named after that form)
function followCtrl(ctrlIndex, ch, target) {
  if (!target) return null;
  const tName = target.key.split("/").pop().replace(/\.sm$/i, "");
  return (ctrlIndex.get(`${ch}|${tName}Controller`) || []).find((c) => c.app === target.app && c.module === target.module) || null;
}
const ctrlKeyOfForm = (formKey) => { const s = formKey.split("/"); const n = s.pop().replace(/\.sm$/i, ""); return [...s, `${n}Controller`, `${n}Controller.js`].join("/"); };
const r26OnlyCtrlKey = (c) => { const p = parseCtrlKey(c.key); return `${p.ch}/${c.app}·${p.module || "templates"}/${p.name}/${p.name}.js`; };

// a manual form link set after the map was built: a new aligned result (R26 forms, the form's controller and their report
// rows replaced; the R26 form / controller let go is listed as R26-only again)
export function relinkForm(aligned, key, link) {
  const r26 = aligned.picked[2];
  const next = { ...r26, forms: new Map(r26.forms), formApp: new Map(r26.formApp), controllers: new Map(r26.controllers), ctrlApp: new Map(r26.ctrlApp) };
  const cat = r26.formCatalog;
  let ctrlRow = null;
  const forms = aligned.report.forms.map((r) => {
    if (r.key !== key) return r;
    const row = { ...r };
    const before = r.target ? cat.byLoc.get(`${r.target.app}/${r.target.key}`) : null;
    applyFormLink(row, link, cat);
    finishFormRow(row, aligned.report.affinity);
    const after = row.target ? cat.byLoc.get(`${row.target.app}/${row.target.key}`) : null;
    if (before !== after) {
      if (before) { next.forms.set(r26OnlyFormKey(before), before.map); next.formApp.set(r26OnlyFormKey(before), before.app); }
      if (after) { next.forms.delete(r26OnlyFormKey(after)); next.formApp.delete(r26OnlyFormKey(after)); next.forms.set(key, after.map); next.formApp.set(key, after.app); } else { next.forms.delete(key); next.formApp.delete(key); }
    }
    ctrlRow = row;
    return row;
  });
  // the form's controller follows it
  let controllers = aligned.report.controllers;
  const ck = ctrlKeyOfForm(key);
  const idx = r26.ctrlIndex;
  if (ctrlRow && idx) {
    controllers = controllers.map((r) => {
      if (r.key !== ck) return r;
      const fc = followCtrl(idx, ctrlRow.channel, ctrlRow.target);
      if (!fc) return r; // no controller beside the new form: the controller keeps its own match
      const row = { ...r, status: "mapped", method: `follows its form${fc.key.split("/").pop() !== r.name + ".js" ? ` · ${fc.key.split("/").pop().replace(/\.js$/, "")}` : ""}`, target: { app: fc.app, module: fc.module, key: fc.key }, alts: [] };
      const was = r.target ? (idx.get(`${ctrlRow.channel}|${r.target.key.split("/").pop().replace(/\.js$/, "")}`) || []).find((c) => c.app === r.target.app && c.key === r.target.key) : null;
      if (was && was !== fc) { next.controllers.set(r26OnlyCtrlKey(was), was.f); next.ctrlApp.set(r26OnlyCtrlKey(was), was.app); }
      next.controllers.delete(r26OnlyCtrlKey(fc)); next.ctrlApp.delete(r26OnlyCtrlKey(fc));
      next.controllers.set(ck, fc.f); next.ctrlApp.set(ck, fc.app);
      return row;
    });
  }
  return { ...aligned, picked: [aligned.picked[0], aligned.picked[1], next], report: { ...aligned.report, forms, controllers } };
}

// ---------------------------------------------------------------- alignment
// mono: [R21 scan, KBZ scan] (already channel-filtered); ma: scanMicroApps result; channel: "web" | "mobile"
// links: manual user-widget links, { monolith key: {app, key} | "none" }; formLinks: the same for forms
export async function alignMicroApps(mono, ma, channel, onProgress = () => {}, links = null, formLinks = null) {
  const C = CHANNELS[channel];
  const apps = [...ma.apps.values()];
  const report = { channel, forms: [], controllers: [], mvc: [], comps: [], segs: [], affinity: {} };
  // segMeta: where each aligned template really lives (micro app, its own name, that app's template controllers);
  // formApp / ctrlApp / compApp: the micro app behind each aligned key
  const out = { forms: new Map(), controllers: new Map(), mvc: new Map(), comps: new Map(), segs: new Map(), segMeta: new Map(), formApp: new Map(), ctrlApp: new Map(), compApp: new Map() };
  const ref = (cat, key) => (mono[0] && mono[0][cat].get(key)) || (mono[1] && mono[1][cat].get(key)) || null; // R21 first, else KBZ
  const inSide = (cat, key) => [!!(mono[0] && mono[0][cat].has(key)), !!(mono[1] && mono[1][cat].has(key))];
  const claimed = { forms: new Set(), controllers: new Set(), mvc: new Set(), comps: new Set() };
  const loc = (app, key) => `${app}/${key}`;

  // ---- forms
  // Rules (measured on KBZ R21 → R26 web: every form's root widget has a kuid, R21 and KBZ share it on 369 of 370; no form
  // was renamed, but R26 re-made frmLogin / frmLogout as new shells and kept the old ones as frmLoginOlb / frmLogoutOlb with
  // the old kuid, and some copies keep the kuid of the form they were copied from — frmApprovalViewDetails has
  // frmACHDashboard's):
  //   name + kuid agree   -> proven
  //   only a kuid match   -> proven (renamed in R26)
  //   they disagree       -> the one sharing more widget ids, flagged "check"; the other listed beside it
  //   only the name       -> likely (>= 30% of the widget ids shared) or weak; several -> most similar widget-id set
  //   neither             -> forms sharing >= 60% of the widget ids, as suggestions only (nothing compared until linked)
  // A manual link (formLinks[key] = {app, key} | "none") replaces the automatic result; row.auto keeps the automatic one.
  onProgress({ step: "Matching forms", running: true });
  const fcat = formCatalog(apps, C);
  await pool(fcat.length, 16, async (i) => { fcat[i].kuid = await formRootKuid(fcat[i].map, fcat[i].name); });
  const r26Forms = new Map(), r26FormKuid = new Map(); // ch|name -> [copy] ; kuid -> [copy]
  for (const c of fcat) {
    const id = `${c.ch}|${c.name}`;
    if (!r26Forms.has(id)) r26Forms.set(id, []);
    r26Forms.get(id).push(c);
    if (c.kuid) { if (!r26FormKuid.has(c.kuid)) r26FormKuid.set(c.kuid, []); r26FormKuid.get(c.kuid).push(c); }
  }
  const monoFormKeys = [...new Set(mono.flatMap((s) => (s ? [...s.forms.keys()] : [])))].sort();
  const aff = {}; // monolith module -> { "MA:module": n } from unique matches
  for (const k of monoFormKeys) {
    const p = parseFormKey(k), c = r26Forms.get(`${p.ch}|${p.name}`) || [];
    if (c.length === 1) { const t = `${c[0].app}:${c[0].module}`; (aff[p.module] = aff[p.module] || {})[t] = (aff[p.module][t] || 0) + 1; }
  }
  report.affinity = aff;
  out.formCatalog = fcat;
  for (const k of monoFormKeys) {
    const p = parseFormKey(k);
    const row = { key: k, name: p.name, channel: p.ch, module: p.module, present: inSide("forms", k), status: "none", method: "", target: null, alts: [], copies: [] };
    if (!C.r26.includes(p.ch)) { row.status = "tablet"; row.method = `${p.ch} form — the micro apps have no ${p.ch} forms`; report.forms.push(row); continue; }
    const m0 = ref("forms", k);
    const ids = new Set(m0.keys());
    row.monoIds = ids;
    row.widgets = ids.size;
    row.kuid = (mono[1] && (await formRootKuid(mono[1].forms.get(k), p.name))) || (mono[0] && (await formRootKuid(mono[0].forms.get(k), p.name))) || null;
    const score = (list) => list.map((c) => ({ c, score: jaccard(ids, c.ids), aff: (aff[p.module] || {})[`${c.app}:${c.module}`] || 0 }))
      .sort((x, y) => y.score - x.score || y.aff - x.aff || x.c.app.localeCompare(y.c.app));
    const viaName = score(r26Forms.get(`${p.ch}|${p.name}`) || []);
    const viaKuid = row.kuid ? score(r26FormKuid.get(row.kuid) || []) : [];
    const both = (list) => { const seen = new Set(); return list.filter((x) => { const l = loc(x.c.app, x.c.key); if (seen.has(l)) return false; seen.add(l); return true; }); };
    const nameWithKuid = viaName.filter((x) => row.kuid && x.c.kuid === row.kuid);
    if (nameWithKuid.length) {
      const best = nameWithKuid[0];
      Object.assign(row, { status: "mapped", link: "kuid", method: `same name and root widget kuid${viaName.length > 1 ? ` · ${viaName.length} forms with this name` : ""} · widget overlap ${pct(best.score)}`, copies: formCopies(both([best, ...viaName, ...viaKuid])) });
    } else if (viaKuid.length && viaName.length) {
      const k0 = viaKuid[0], n0 = viaName[0];
      const pickK = k0.score > n0.score;
      const best = pickK ? k0 : n0, other = pickK ? n0 : k0;
      Object.assign(row, { status: "mapped", link: "check", method: `name and root widget kuid point to different R26 forms — ${best.c.name} (${pickK ? "same kuid" : "same name"}, ${pct(best.score)} of the widgets) chosen over ${other.c.name} in ${other.c.app} (${pickK ? "same name" : "same kuid"}, ${pct(other.score)})`, copies: formCopies(both([best, other, ...viaName, ...viaKuid])) });
    } else if (viaKuid.length) {
      const best = viaKuid[0];
      Object.assign(row, { status: "mapped", link: "kuid", method: `root widget kuid${best.c.name !== p.name ? ` · named ${best.c.name} in R26` : ""}${viaKuid.length > 1 ? ` · ${viaKuid.length} forms with this kuid` : ""} · widget overlap ${pct(best.score)}`, copies: formCopies(viaKuid) });
    } else if (viaName.length) {
      const best = viaName[0];
      const clear = viaName.length < 2 || best.score - viaName[1].score >= 0.05 || best.aff > viaName[1].aff;
      Object.assign(row, { status: clear ? "mapped" : "ambiguous", link: best.score >= 0.3 ? "name" : "name-weak", method: viaName.length === 1 ? `unique name, no kuid match · widget overlap ${pct(best.score)}` : `${viaName.length} candidates — widget overlap ${pct(best.score)}${best.aff ? `, module affinity ${best.aff}` : ""}`, copies: formCopies(viaName) });
    } else {
      const sc = ids.size >= 5 ? score(fcat.filter((c) => c.ids.size >= 5)).filter((x) => x.score >= 0.6).slice(0, 3) : [];
      Object.assign(row, { link: sc.length ? "suggested" : "none", suggestions: formCopies(sc), method: sc.length ? `no name or kuid match · ${sc[0].c.name} in ${sc[0].c.app} shares ${pct(sc[0].score)} of the widgets — link it if it is the same form` : "no form with its name, its root kuid or ≥ 60% of its widgets in any micro app" });
    }
    row.auto = autoOfForm(row);
    if (formLinks && formLinks[k] !== undefined) applyFormLink(row, formLinks[k], fcat);
    finishFormRow(row, aff);
    if (row.target) {
      const c = fcat.byLoc.get(loc(row.target.app, row.target.key));
      out.forms.set(k, c.map); out.formApp.set(k, c.app); claimed.forms.add(loc(c.app, c.key));
    }
    report.forms.push(row);
  }
  for (const c of fcat) {
    if (claimed.forms.has(loc(c.app, c.key))) continue;
    out.forms.set(r26OnlyFormKey(c), c.map);
    out.formApp.set(r26OnlyFormKey(c), c.app);
  }

  // ---- controllers
  onProgress({ step: "Matching controllers", running: true });
  const r26Ctrl = new Map(); // ch|name -> [{app, key, module, f}]
  for (const a of apps) for (const [k, f] of a.scan.controllers) {
    const p = parseCtrlKey(k);
    if (!C.r26.includes(p.ch)) continue;
    const id = `${p.ch}|${p.name}`;
    if (!r26Ctrl.has(id)) r26Ctrl.set(id, []);
    r26Ctrl.get(id).push({ app: a.name, key: k, module: p.module, f });
  }
  const formTarget = new Map(report.forms.filter((r) => r.target).map((r) => [`${r.channel}|${r.module}|${r.name}`, r.target]));
  const monoCtrlKeys = [...new Set(mono.flatMap((s) => (s ? [...s.controllers.keys()] : [])))].sort();
  for (const k of monoCtrlKeys) {
    const p = parseCtrlKey(k);
    const row = { key: k, name: p.name, channel: p.ch, module: p.module, present: inSide("controllers", k), status: "none", method: "", target: null, alts: [] };
    if (!C.r26.includes(p.ch)) { row.status = "tablet"; row.method = `${p.ch} controller — the micro apps have no ${p.ch} forms`; report.controllers.push(row); continue; }
    const cands = r26Ctrl.get(`${p.ch}|${p.name}`) || [];
    const ft = p.module && formTarget.get(`${p.ch}|${p.module}|${p.name.replace(/Controller$/, "")}`);
    const follow = followCtrl(r26Ctrl, p.ch, ft); // the controller beside the R26 form it matched (frmLogin -> frmLoginOlbController)
    if (follow) Object.assign(row, { status: "mapped", method: `follows its form${follow.key.split("/").pop() !== p.name + ".js" ? ` · ${follow.key.split("/").pop().replace(/\.js$/, "")}` : ""}`, target: follow });
    else if (cands.length === 1) Object.assign(row, { status: "mapped", method: "unique name", target: cands[0] });
    else if (cands.length > 1) {
      const lines = lineSet(await textOf(ref("controllers", k)));
      const scored = [];
      for (const c of cands) scored.push({ ...c, score: jaccard(lines, lineSet(await textOf(c.f))) });
      scored.sort((x, y) => y.score - x.score);
      const identical = scored[0].score >= 0.95 && scored[1].score >= 0.95;
      const clear = identical || scored[0].score - scored[1].score >= 0.05;
      Object.assign(row, { status: clear ? "mapped" : "ambiguous", method: `${cands.length} candidates — text overlap ${Math.round(scored[0].score * 100)}%${identical ? " (identical copies)" : ""}`, target: scored[0], alts: scored.slice(1).map((c) => `${c.app}:${c.module || "(template)"} (${Math.round(c.score * 100)}%)`) });
    }
    if (row.target) { out.controllers.set(k, row.target.f); out.ctrlApp.set(k, row.target.app); claimed.controllers.add(loc(row.target.app, row.target.key)); row.target = { app: row.target.app, module: row.target.module, key: row.target.key }; }
    report.controllers.push(row);
  }
  out.ctrlIndex = r26Ctrl; // kept for re-links (a form's controller follows it)
  for (const a of apps) for (const [k, f] of a.scan.controllers) {
    const p = parseCtrlKey(k);
    if (!C.r26.includes(p.ch) || claimed.controllers.has(loc(a.name, k))) continue;
    out.controllers.set(`${p.ch}/${a.name}·${p.module || "templates"}/${p.name}/${p.name}.js`, f);
    out.ctrlApp.set(`${p.ch}/${a.name}·${p.module || "templates"}/${p.name}/${p.name}.js`, a.name);
  }

  // ---- mvc (presentation + business controllers)
  // Rules, first that applies wins:
  //   1 same module name + same file exists in R26 (43 of 91 web modules keep their name, e.g. ACHManager)
  //   2 presentation controller: the UIModule(s) the module's forms moved to (same file name)
  //   3 member-name overlap >= 30% (only when both sides have >= 3 members — empty stubs match everything)
  //   4 extension / extra files: same file name inside the module the main controller was mapped to
  onProgress({ step: "Matching presentation & business controllers", running: true });
  const okVariant = (k) => (channel === "web" ? !/_(Mobile|Tablet)\.js$/i.test(k) : !/_Tablet\.js$/i.test(k));
  const MAIN = /^(PresentationController|BusinessController)\.js$/;
  const r26Mvc = [];
  for (const a of apps) for (const [k, f] of a.scan.mvc) {
    if (!okVariant(k)) continue;
    const s2 = k.split("/");
    r26Mvc.push({ app: a.name, key: k, module: s2[0], kind: /\/BusinessControllers\//.test(k) ? "B" : "P", file: s2[s2.length - 1], f });
  }
  const members = new Map();
  for (const c of r26Mvc) members.set(c, memberSet(await textOf(c.f)));
  const monoMvcKeys = [...new Set(mono.flatMap((s) => (s ? [...s.mvc.keys()] : [])))].sort((x, y) => {
    const mx = MAIN.test(x.split("/").pop()), my = MAIN.test(y.split("/").pop());
    return mx === my ? x.localeCompare(y) : mx ? -1 : 1; // main controllers first, extensions follow them
  });
  const mvcModuleTarget = {}; // monolith "module|kind" -> {app, module} its main controller mapped to
  for (const k of monoMvcKeys) {
    const s2 = k.split("/"), mod = s2[0], file = s2[s2.length - 1];
    const kind = /\/BusinessControllers\//.test(k) ? "B" : "P";
    const row = { key: k, name: k, module: mod, kind, present: inSide("mvc", k), status: "none", method: "", target: null, alts: [] };
    const mine = memberSet(await textOf(ref("mvc", k)));
    const pool = r26Mvc.filter((c) => c.kind === kind);
    const overlap = (c) => jaccard(mine, members.get(c));
    const homes = Object.keys(aff[mod] || {}); // "MA:UIModule" the module's forms moved to
    const pickBest = (cands, method) => {
      const sc = cands.map((c) => ({ c, score: overlap(c) })).sort((x, y) => y.score - x.score);
      const tie = sc.length > 1 && Math.abs(sc[0].score - sc[1].score) < 0.05;
      const identical = tie && sc[0].score >= 0.95;
      Object.assign(row, {
        status: !tie || identical ? "mapped" : "ambiguous",
        method: `${method}${sc.length > 1 ? ` · ${sc.length} candidates` : ""} · member overlap ${pct(sc[0].score)}${identical ? " (same members in each)" : ""}`,
        target: sc[0].c, alts: sc.slice(1, 4).map((x) => `${x.c.app}:${x.c.module} (${pct(x.score)})`),
      });
    };
    const same = pool.filter((c) => c.module === mod && c.file === file);
    const homeFiles = kind === "P" ? pool.filter((c) => homes.includes(`${c.app}:${c.module}`) && c.file === file) : [];
    const parent = mvcModuleTarget[`${mod}|${kind}`];
    if (same.length) pickBest(same, "same module name");
    else if (homeFiles.length) pickBest(homeFiles, "module's forms moved here");
    else if (!MAIN.test(file) && parent) {
      const sib = pool.filter((c) => c.app === parent.app && c.module === parent.module && c.file === file);
      if (sib.length) pickBest(sib, "same file in the module its main controller moved to");
      else row.method = `no ${file} in ${parent.app}:${parent.module}`;
    } else if (mine.size >= 3) {
      const sc = pool.filter((c) => members.get(c).size >= 3).map((c) => ({ c, score: overlap(c) })).sort((x, y) => y.score - x.score);
      if (sc.length && sc[0].score >= 0.3) pickBest(sc.filter((x) => sc[0].score - x.score < 0.05).map((x) => x.c), "member overlap");
      else if (sc.length) row.method = `best member overlap only ${pct(sc[0].score)} (${sc[0].c.app}:${sc[0].c.module})`;
    } else Object.assign(row, { status: "stub", method: `empty stub (${mine.size} member${mine.size === 1 ? "" : "s"}) — micro apps split modules: UIModules carry no business controller, Managers no presentation controller` });
    if (row.target) {
      if (MAIN.test(file)) mvcModuleTarget[`${mod}|${kind}`] = { app: row.target.app, module: row.target.module };
      out.mvc.set(k, row.target.f); claimed.mvc.add(loc(row.target.app, row.target.key));
      row.target = { app: row.target.app, module: row.target.module, key: row.target.key };
    }
    report.mvc.push(row);
  }
  for (const c of r26Mvc) if (!claimed.mvc.has(loc(c.app, c.key))) out.mvc.set(`[${c.app}] ${c.key}`, c.f);

  // ---- user widgets
  // Rules, first that applies wins (measured on KBZ R21 → R26: the root widget's kuid survives renames and is never
  // shared by two monolith components; 207 of 211 web kuid matches also share at least half their widgets):
  //   kuid       an R26 copy whose root widget has the monolith component's root kuid      -> proven
  //   name       same class name (several copies -> most similar widget-id set)           -> likely, weak below 30%
  //   suggested  no kuid / name match: the copies sharing >= 60% of the widget ids, shown as a suggestion only (generic
  //              small components match wrongly) — nothing is compared until someone links one
  // A manual link (links[key] = {app, key} | "none") replaces the automatic result; row.auto keeps the automatic one.
  // Every copy of a match is listed on its row (and claimed, so it is not listed again as an R26-only component).
  onProgress({ step: "Matching user widgets", running: true });
  const catalog = compCatalog(apps, C);
  await pool(catalog.length, 16, async (i) => { catalog[i].kuid = await rootKuid(catalog[i].files); });
  const monoCompKeys = [...new Set(mono.flatMap((s) => (s ? [...s.comps.keys()] : [])))].sort();
  const monoKuid = new Map();
  await pool(monoCompKeys.length, 16, async (i) => {
    const k = monoCompKeys[i];
    const q = (mono[1] && (await rootKuid(mono[1].comps.get(k)))) || (mono[0] && (await rootKuid(mono[0].comps.get(k))));
    if (q) monoKuid.set(k, q);
  });
  const byName = new Map(), byKuid = new Map();
  for (const c of catalog) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
    if (c.kuid) { if (!byKuid.has(c.kuid)) byKuid.set(c.kuid, []); byKuid.get(c.kuid).push(c); }
  }
  out.compCatalog = catalog;
  out.compAlias = new Map(); // root kuid of every listed copy -> the monolith key it stands for (where it is used)
  for (const k of monoCompKeys) {
    const n = k.split(".").pop();
    const ids = compWidgetIds(ref("comps", k));
    const row = { key: k, name: n, module: k.split(".").slice(0, -1).join("."), present: inSide("comps", k), kuid: monoKuid.get(k) || null, widgets: ids.size, monoIds: ids, status: "none", method: "", target: null, alts: [], copies: [] };
    const scored = (list) => scoreCopies(ids, list);
    const viaKuid = row.kuid ? byKuid.get(row.kuid) || [] : [];
    const viaName = byName.get(n) || [];
    if (viaKuid.length) {
      const sc = scored(viaKuid);
      const renamed = sc[0].name !== n;
      Object.assign(row, { status: "mapped", link: "kuid", method: `root widget kuid${renamed ? ` · renamed to ${sc[0].name}` : ""}${sc.length > 1 ? ` · ${sc.length} copies` : ""} · widget overlap ${pct(sc[0].score)}`, copies: sc });
    } else if (viaName.length) {
      const sc = scored(viaName);
      const identical = sc.length > 1 && sc[0].score >= 0.95 && sc[1].score >= 0.95;
      const clear = sc.length === 1 || identical || sc[0].score - sc[1].score >= 0.05;
      Object.assign(row, { status: clear ? "mapped" : "ambiguous", link: sc[0].score >= 0.3 ? "name" : "name-weak", method: `same class name, no kuid match${sc.length > 1 ? ` · ${sc.length} copies` : ""} · widget overlap ${pct(sc[0].score)}${identical ? " (same structure in several micro apps)" : ""}`, copies: sc });
    } else {
      const sc = ids.size ? scored(catalog.filter((c) => c.ids.size)).filter((c) => c.score >= 0.6).slice(0, 3) : [];
      Object.assign(row, { link: sc.length ? "suggested" : "none", suggestions: sc.map(copyRef), method: sc.length ? `no kuid or name match · ${sc[0].name} in ${sc[0].app} shares ${pct(sc[0].score)} of the widgets — link it if it is the same component` : `no copy with its root kuid, its class name or ≥ 60% of its widgets in any micro app` });
      if (sc.length) row.suggest = `${sc[0].app}:${sc[0].key}`;
    }
    row.auto = autoOf(row);
    if (links && links[k] !== undefined) applyLink(row, links[k], catalog);
    finishCompRow(row);
    publishComp(out, row);
    for (const c of row.copies) claimed.comps.add(loc(c.app, c.key));
    report.comps.push(row);
  }
  for (const c of catalog) {
    if (claimed.comps.has(loc(c.app, c.key))) continue;
    out.comps.set(c.key, c.files);
    out.compApp.set(c.key, c.app);
  }

  // ---- segment templates
  // templates/<ch>/segments/<name>.sm; R26 keeps copies of one template in several micro apps (SampleRowTemplate is in
  // nearly all of them). Same name -> the copy with the most similar widget-id set, the other copies listed beside it;
  // no same name -> a template whose root flex has the monolith template's root flex name (renamed; its controller
  // is named after the root flex, so it stays the same). R26 templates with no monolith counterpart are grouped by
  // name the same way (one row, every copy listed).
  onProgress({ step: "Matching segment templates", running: true });
  const metaOf = async (map, name) => {
    const f = map && map.get(name);
    if (!f) return {};
    try { const j = JSON.parse((await textOf(f)).replace(/^﻿/, "")); return { root: (j.children || [])[0] || null, kuid: j.kuid || null }; } catch { return {}; }
  };
  const r26Segs = new Map(); // ch|name -> [{app, key, name, ch, map, tplCtrl}]
  const r26SegList = [];
  for (const a of apps) for (const [k, m] of a.scan.segs || []) {
    const [ch, name] = k.split("/");
    if (!C.r26.includes(ch)) continue;
    const c = { app: a.name, key: k, name, ch, map: m, tplCtrl: a.scan.tplCtrl };
    r26SegList.push(c);
    if (!r26Segs.has(`${ch}|${name}`)) r26Segs.set(`${ch}|${name}`, []);
    r26Segs.get(`${ch}|${name}`).push(c);
  }
  let rootIdx = null; // ch|rootFlex -> [copy], read only when a name finds no match
  const byRoot = async (ch, root) => {
    if (!rootIdx) { rootIdx = new Map(); for (const c of r26SegList) { c.root = (await metaOf(c.map, c.name)).root; const id = `${c.ch}|${c.root}`; if (!rootIdx.has(id)) rootIdx.set(id, []); rootIdx.get(id).push(c); } }
    return rootIdx.get(`${ch}|${root}`) || [];
  };
  const sharedApp = (c) => (/^(Resources\w*|Commons)MA$/.test(c.app) ? 1 : 0);
  const segClaim = new Set(); // ch|name of R26 template names already shown on a monolith row
  const place = (row, k, scored, how) => {
    const best = scored[0];
    const identical = scored.length > 1 && best.score >= 0.95 && scored[1].score >= 0.95;
    const clear = scored.length === 1 || identical || best.score - scored[1].score >= 0.05;
    Object.assign(row, {
      status: row.status === "r26only" ? "r26only" : clear ? "mapped" : "ambiguous",
      method: `${how}${scored.length > 1 ? ` · ${scored.length} copies` : ""}${best.score != null ? ` · widget overlap ${pct(best.score)}` : ""}${identical ? " (same structure in several micro apps)" : ""}`,
      target: { app: best.app, name: best.name, key: best.key },
      alts: scored.slice(1).map((c) => ({ app: c.app, name: c.name, score: c.score })),
    });
    out.segs.set(k, best.map);
    out.segMeta.set(k, { app: best.app, name: best.name, ch: best.ch, tplCtrl: best.tplCtrl });
    for (const c of scored) segClaim.add(`${c.ch}|${c.name}`);
  };
  const monoSegKeys = [...new Set(mono.flatMap((s) => (s && s.segs ? [...s.segs.keys()] : [])))].sort();
  for (const k of monoSegKeys) {
    const [ch, name] = k.split("/");
    const row = { key: k, name, channel: ch, present: inSide("segs", k), status: "none", method: "", target: null, alts: [] };
    if (!C.r26.includes(ch)) { row.status = "tablet"; row.method = `${ch} template — the micro apps have no ${ch} templates`; report.segs.push(row); continue; }
    const ids = new Set(ref("segs", k).keys());
    const score = (list) => list.map((c) => ({ ...c, score: jaccard(ids, new Set(c.map.keys())) })).sort((x, y) => y.score - x.score || sharedApp(y) - sharedApp(x) || x.app.localeCompare(y.app));
    let cands = r26Segs.get(`${ch}|${name}`) || [];
    if (cands.length) place(row, k, score(cands), cands.length === 1 ? "unique name" : "same name");
    else {
      const { root } = await metaOf(ref("segs", k), name);
      const viaRoot = root ? await byRoot(ch, root) : [];
      if (viaRoot.length) { row.renamed = true; place(row, k, score(viaRoot), `renamed to ${viaRoot[0].name} — same root flex ${root}`); }
      else row.method = root ? `no template named ${name} or with root flex ${root} in any micro app` : `no template named ${name} in any micro app`;
    }
    report.segs.push(row);
  }
  // R26-only templates: one row per name, the copy in a shared app (or the first) stands for the others
  for (const [id, cands] of r26Segs) {
    if (segClaim.has(id)) continue;
    const [ch, name] = id.split("|");
    const rep = [...cands].sort((x, y) => sharedApp(y) - sharedApp(x) || x.app.localeCompare(y.app))[0];
    const ids = new Set(rep.map.keys());
    const scored = [rep, ...cands.filter((c) => c !== rep).map((c) => ({ ...c, score: jaccard(ids, new Set(c.map.keys())) })).sort((x, y) => y.score - x.score)];
    const k = `${ch}/${name}`;
    const row = { key: k, name, channel: ch, present: [false, false], status: "r26only", method: "", target: null, alts: [] };
    place(row, k, scored.map((c, i) => (i === 0 ? { ...c, score: null } : c)), cands.length === 1 ? `only in ${rep.app}` : "only in the micro apps");
    report.segs.push(row);
  }

  let business = 0, presentation = 0;
  for (const k of out.mvc.keys()) { if (/\/BusinessControllers\//.test(k)) business++; else presentation++; }
  const r26 = {
    ...out, fileCount: ma.fileCount, microApps: ma.apps.size,
    appFiles: new Map([...ma.apps.values()].map((a) => [a.name, a.files])), // each micro app's files, for drawing its templates
    counts: { forms: out.forms.size, controllers: out.controllers.size, business, presentation, components: out.comps.size, segments: out.segs.size },
  };
  report.r26Only = {
    forms: [...out.forms.keys()].filter((k) => k.includes("·")).length,
    controllers: [...out.controllers.keys()].filter((k) => k.includes("·")).length,
    mvc: [...out.mvc.keys()].filter((k) => k.startsWith("[")).length,
    comps: [...out.comps.keys()].filter((k) => !monoCompKeys.includes(k)).length,
    segs: report.segs.filter((r) => r.status === "r26only").length,
  };
  onProgress({ step: "done", running: false });
  return { r26, report };
}
