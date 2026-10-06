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
//   forms        same channel + same form name across all micro apps; several candidates -> the one whose
//                widget-id set is most similar to the monolith form (ties: module affinity)
//   controllers  form controllers follow their form's micro app; otherwise same channel + name; several ->
//                most similar text
//   mvc          presentation / business controllers -> the R26 controller file with the most similar set of
//                member (method) names, preferring the UIModules the module's forms moved to
//   user widgets same class name (last namespace segment); several -> most similar widget-id set
// Tablet / watch monolith forms have no R26 counterpart (R26 micro apps carry desktop + mobile forms only).

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
const lineSet = (t) => new Set(t.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l.length > 2));
const memberSet = (t) => new Set([...t.matchAll(/([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?function\b/g)].map((m) => m[1]));
const textCache = new WeakMap();
const textOf = async (f) => { if (!textCache.has(f)) textCache.set(f, f.text()); return textCache.get(f); };

// filter a monolith scan to the channels in scope (forms / controllers are channel-keyed; mvc & widgets are shared)
export function channelScan(scan, channels) {
  if (!scan) return null;
  const keep = (m) => new Map([...m].filter(([k]) => channels.includes(k.split("/")[0])));
  const forms = keep(scan.forms), controllers = keep(scan.controllers);
  return { ...scan, forms, controllers, counts: { ...scan.counts, forms: forms.size, controllers: controllers.size } };
}

const parseFormKey = (k) => { const s = k.split("/"); return { ch: s[0], module: s.slice(1, -1).join("/"), name: s[s.length - 1].replace(/\.sm$/i, "") }; };
const parseCtrlKey = (k) => { const s = k.split("/"); return { ch: s[0], module: s.length > 3 ? s.slice(1, -2).join("/") : "", name: s[s.length - 1].replace(/\.js$/i, "") }; };

// ---------------------------------------------------------------- alignment
// mono: [R21 scan, KBZ scan] (already channel-filtered); ma: scanMicroApps result; channel: "web" | "mobile"
export async function alignMicroApps(mono, ma, channel, onProgress = () => {}) {
  const C = CHANNELS[channel];
  const apps = [...ma.apps.values()];
  const report = { channel, forms: [], controllers: [], mvc: [], comps: [], affinity: {} };
  const out = { forms: new Map(), controllers: new Map(), mvc: new Map(), comps: new Map() };
  const ref = (cat, key) => (mono[0] && mono[0][cat].get(key)) || (mono[1] && mono[1][cat].get(key)) || null; // R21 first, else KBZ
  const inSide = (cat, key) => [!!(mono[0] && mono[0][cat].has(key)), !!(mono[1] && mono[1][cat].has(key))];
  const claimed = { forms: new Set(), controllers: new Set(), mvc: new Set(), comps: new Set() };
  const loc = (app, key) => `${app}/${key}`;

  // ---- forms
  onProgress({ step: "Matching forms", running: true });
  const r26Forms = new Map(); // ch|name -> [{app, key, module, map}]
  for (const a of apps) for (const [k, m] of a.scan.forms) {
    const p = parseFormKey(k);
    if (!C.r26.includes(p.ch)) continue;
    const id = `${p.ch}|${p.name}`;
    if (!r26Forms.has(id)) r26Forms.set(id, []);
    r26Forms.get(id).push({ app: a.name, key: k, module: p.module, map: m });
  }
  const monoFormKeys = [...new Set(mono.flatMap((s) => (s ? [...s.forms.keys()] : [])))].sort();
  const aff = {}; // monolith module -> { "MA:module": n } from unique matches
  for (const k of monoFormKeys) {
    const p = parseFormKey(k), c = r26Forms.get(`${p.ch}|${p.name}`) || [];
    if (c.length === 1) { const t = `${c[0].app}:${c[0].module}`; (aff[p.module] = aff[p.module] || {})[t] = (aff[p.module][t] || 0) + 1; }
  }
  report.affinity = aff;
  for (const k of monoFormKeys) {
    const p = parseFormKey(k);
    const row = { key: k, name: p.name, channel: p.ch, module: p.module, present: inSide("forms", k), status: "none", method: "", target: null, alts: [] };
    if (!C.r26.includes(p.ch)) { row.status = "tablet"; row.method = `${p.ch} form — the micro apps have no ${p.ch} forms`; report.forms.push(row); continue; }
    const cands = r26Forms.get(`${p.ch}|${p.name}`) || [];
    if (cands.length === 1) {
      const ov = jaccard(new Set(ref("forms", k).keys()), new Set(cands[0].map.keys()));
      Object.assign(row, { status: "mapped", method: `unique name · widget overlap ${Math.round(ov * 100)}%`, target: cands[0], overlap: ov });
    } else if (cands.length > 1) {
      const ids = new Set(ref("forms", k).keys());
      const scored = cands.map((c) => ({ ...c, score: jaccard(ids, new Set(c.map.keys())), aff: (aff[p.module] || {})[`${c.app}:${c.module}`] || 0 }))
        .sort((x, y) => y.score - x.score || y.aff - x.aff);
      const best = scored[0];
      const clear = scored.length < 2 || best.score - scored[1].score >= 0.05 || best.aff > scored[1].aff;
      Object.assign(row, { status: clear ? "mapped" : "ambiguous", method: `${cands.length} candidates — widget overlap ${Math.round(best.score * 100)}%${best.aff ? `, module affinity ${best.aff}` : ""}`, target: best, alts: scored.slice(1).map((c) => `${c.app}:${c.module} (${Math.round(c.score * 100)}%)`) });
      if (!clear) row.target = best; // still compared, flagged for review
    }
    if (row.target) { out.forms.set(k, row.target.map); claimed.forms.add(loc(row.target.app, row.target.key)); row.target = { app: row.target.app, module: row.target.module, key: row.target.key }; }
    else { // where KBZ-only / unmatched forms would most likely live (module affinity)
      const best = Object.entries(aff[p.module] || {}).sort((x, y) => y[1] - x[1])[0];
      if (best) row.suggest = best[0];
    }
    report.forms.push(row);
  }
  for (const a of apps) for (const [k, m] of a.scan.forms) {
    const p = parseFormKey(k);
    if (!C.r26.includes(p.ch) || claimed.forms.has(loc(a.name, k))) continue;
    out.forms.set(`${p.ch}/${a.name}·${p.module}/${p.name}.sm`, m);
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
    const follow = ft && cands.find((c) => c.app === ft.app && c.module === ft.module);
    if (follow) Object.assign(row, { status: "mapped", method: "follows its form", target: follow });
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
    if (row.target) { out.controllers.set(k, row.target.f); claimed.controllers.add(loc(row.target.app, row.target.key)); row.target = { app: row.target.app, module: row.target.module, key: row.target.key }; }
    report.controllers.push(row);
  }
  for (const a of apps) for (const [k, f] of a.scan.controllers) {
    const p = parseCtrlKey(k);
    if (!C.r26.includes(p.ch) || claimed.controllers.has(loc(a.name, k))) continue;
    out.controllers.set(`${p.ch}/${a.name}·${p.module || "templates"}/${p.name}/${p.name}.js`, f);
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
  const pct = (x) => `${Math.round(x * 100)}%`;
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
  onProgress({ step: "Matching user widgets", running: true });
  const r26Comps = new Map(); // class name -> [{app, key, files}]
  for (const a of apps) for (const [k, files] of a.scan.comps) {
    const n = k.split(".").pop();
    if (!r26Comps.has(n)) r26Comps.set(n, []);
    r26Comps.get(n).push({ app: a.name, key: k, files });
  }
  const widgetIds = (files) => new Set([...files.keys()].filter((r) => r.startsWith("userwidgetmodel.sm/")));
  const monoCompKeys = [...new Set(mono.flatMap((s) => (s ? [...s.comps.keys()] : [])))].sort();
  for (const k of monoCompKeys) {
    const n = k.split(".").pop();
    const row = { key: k, name: n, module: k.split(".").slice(0, -1).join("."), present: inSide("comps", k), status: "none", method: "", target: null, alts: [] };
    let cands = r26Comps.get(n) || [];
    const fam = cands.filter((c) => !/\.Infinity(OLB|MB)\./.test(c.key) || C.family.test(c.key));
    if (fam.length) cands = fam;
    if (cands.length === 1) Object.assign(row, { status: "mapped", method: "unique class name", target: cands[0] });
    else if (cands.length > 1) {
      const ids = widgetIds(ref("comps", k));
      const shared = (c) => (/^(Resources\w*|Commons)MA$/.test(c.app) ? 1 : 0);
      const scored = cands.map((c) => ({ ...c, score: jaccard(ids, widgetIds(c.files)) })).sort((x, y) => y.score - x.score || shared(y) - shared(x));
      const identical = scored[0].score >= 0.95 && scored[1].score >= 0.95;
      const clear = identical || scored[0].score - scored[1].score >= 0.05;
      Object.assign(row, { status: clear ? "mapped" : "ambiguous", method: `${cands.length} candidates — widget overlap ${Math.round(scored[0].score * 100)}%${identical ? " (same structure in several micro apps)" : ""}`, target: scored[0], alts: scored.slice(1).map((c) => `${c.key} (${Math.round(c.score * 100)}%)`) });
    }
    if (row.target) { out.comps.set(k, row.target.files); claimed.comps.add(loc(row.target.app, row.target.key)); row.target = { app: row.target.app, module: row.target.key, key: row.target.key }; }
    report.comps.push(row);
  }
  for (const a of apps) for (const [k, files] of a.scan.comps) {
    if (claimed.comps.has(loc(a.name, k))) continue;
    if (/\.Infinity(OLB|MB)\./.test(k) && !C.family.test(k)) continue; // other channel's widgets
    out.comps.set(k, files);
  }

  let business = 0, presentation = 0;
  for (const k of out.mvc.keys()) { if (/\/BusinessControllers\//.test(k)) business++; else presentation++; }
  const r26 = {
    ...out, fileCount: ma.fileCount, microApps: ma.apps.size,
    counts: { forms: out.forms.size, controllers: out.controllers.size, business, presentation, components: out.comps.size },
  };
  report.r26Only = {
    forms: [...out.forms.keys()].filter((k) => k.includes("·")).length,
    controllers: [...out.controllers.keys()].filter((k) => k.includes("·")).length,
    mvc: [...out.mvc.keys()].filter((k) => k.startsWith("[")).length,
    comps: [...out.comps.keys()].filter((k) => !monoCompKeys.includes(k)).length,
  };
  onProgress({ step: "done", running: false });
  return { r26, report };
}
