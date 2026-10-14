// Monolith -> micro-app placement plan from the built-in R26 map (no R26 upload needed).
// For every module and form of ONE monolith channel it decides the destination micro app and module, under three
// user-selectable policies (shown live in the Visualize workspace, then agreed):
//   placement  "module"  keep each monolith module whole, in the micro app that holds most of its forms in R26
//              "form"    follow R26 form by form (a module R26 splits is split the same way)
//   naming     "kbz"     keep monolith module names       "r26"  use R26's module name where R26 has the form
//   unmatched  "new"     a module with no R26 counterpart becomes its own micro app
//              "nearest" it joins the existing micro app whose name is closest (falls back to a new one)
// Business-only modules (mvcextensions without forms — managers, utilities) go where R26 has a module of the same
// name, otherwise to the shared code app (CommonsMA).
import R26 from "../data/r26-map.json" with { type: "json" };

export const R26_MAP = R26;
export const SHARED = { commons: "CommonsMA", resources: "ResourcesMA" };
export const POLICY_DEFAULT = { placement: "module", naming: "kbz", unmatched: "new" };
const CHANNEL_DIRS = { web: ["desktop"], mobile: ["mobile", "tablet", "watch"] };

// ---------------------------------------------------------------- monolith inventory (from file paths only)
export function inventory(files, channel) {
  const dirs = CHANNEL_DIRS[channel];
  const forms = new Map(); // module/form -> {module, name, ch, ids:Set}
  const ctrl = new Set(); // module/form with a controller
  const mvc = new Map(); // module -> {business, presentation, files}
  for (const { rel } of files) {
    const s = rel.split("/");
    if (s[0] === "forms" && dirs.includes(s[1])) {
      const i = s.findIndex((x) => /\.sm$/i.test(x));
      if (i >= 2 && s.length === i + 2 && /\.json$/i.test(s[i + 1])) {
        const module = s.slice(2, i).join("/"), name = s[i].replace(/\.sm$/i, "");
        const k = `${s[1]}|${module}|${name}`;
        if (!forms.has(k)) forms.set(k, { module, name, ch: s[1], ids: new Set() });
        forms.get(k).ids.add(s[i + 1].replace(/\.json$/i, ""));
      }
    } else if (s[0] === "controllers" && dirs.includes(s[1]) && s.length >= 5 && /Controller\.js$/.test(s[s.length - 1]) && !/ControllerActions\.js$/.test(s[s.length - 1])) {
      ctrl.add(`${s[1]}|${s.slice(2, -2).join("/")}|${s[s.length - 2].replace(/Controller$/, "")}`); // controllers/<ch>/<Module>/frmXController/frmXController.js
    } else if (s[0] === "mvcextensions" && s.length >= 3 && /\.js$/.test(s[s.length - 1])) {
      if (!mvc.has(s[1])) mvc.set(s[1], { business: 0, presentation: 0, files: 0 });
      const m = mvc.get(s[1]);
      m.files++;
      if (/BusinessControllers?\//.test(rel)) m.business++;
      if (/PresentationControllers?\//.test(rel)) m.presentation++;
    }
  }
  return { forms: [...forms.values()], ctrl, mvc };
}

// ---------------------------------------------------------------- helpers
const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; const u = a.size + b.size - i; return u ? i / u : 0; };
const GENERIC = new Set(["manage", "management", "new", "module", "manager", "flow", "unified"]);
const tokens = (s) => s.replace(/MA$/, "").replace(/(UI)?Module(New)?$|Manager$|New$/g, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !GENERIC.has(t)).map((t) => t.replace(/s$/, ""));
const featureApps = Object.entries(R26.apps).filter(([, a]) => a.kind === "feature").map(([n]) => n);

// the R26 copy a monolith form corresponds to: unique name, or among copies the one sharing most widgets (stubs lose)
function r26Owner(form, channel) {
  const list = (R26.channels[channel === "web" ? "web" : "mobile"].forms[form.name] || []).map(([app, module, widgets, ids]) => ({ app, module, widgets, ids }));
  if (!list.length) return { list, owner: null };
  if (list.length === 1) return { list, owner: list[0] };
  const scored = list.map((c) => ({ ...c, score: c.ids ? jaccard(form.ids, new Set(c.ids)) : 0 })).sort((a, b) => b.score - a.score || b.widgets - a.widgets);
  const tie = scored.length > 1 && scored[0].score === scored[1].score && scored[0].widgets === scored[1].widgets;
  return { list, owner: scored[0], tie };
}

// closest existing micro app by name: compares the module's words with each micro app's name, its R26 form modules
// and its R26 business modules ("auth" matches "authentication"); ties go to the candidate holding more forms
const sameWord = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
const wordScore = (x, y) => { if (!x.length || !y.length) return 0; const hit = x.reduce((n, a) => n + (y.includes(a) ? 1 : y.some((b) => sameWord(a, b)) ? 0.75 : 0), 0); return hit / Math.max(x.length, y.length); };
export function nearestApp(module, channel) {
  const t = tokens(module);
  const mods = R26.channels[channel === "web" ? "web" : "mobile"].modules;
  let best = null, score = 0, weight = 0;
  for (const a of featureApps) {
    const names = [[a, 0], ...Object.entries(mods[a] || {}), ...R26.apps[a].mvc.map((m) => [m, 0])];
    for (const [n, forms] of names) {
      const sc = wordScore(t, tokens(n));
      if (sc > score || (sc === score && sc > 0 && forms > weight)) { score = sc; best = a; weight = forms; }
    }
  }
  return score >= 0.5 ? best : null;
}
const newAppName = (module) => `${module.replace(/(UI)?Module(New)?$/i, "").replace(/New$/, "").replace(/[^A-Za-z0-9]/g, "") || module}MA`;

// ---------------------------------------------------------------- plan
// overrides: { [module]: appName }  (applies to the whole module, any placement policy)
export function buildPlan(inv, channel, policy = POLICY_DEFAULT, overrides = {}) {
  const mobileOnly = channel === "mobile";
  const byModule = new Map();
  for (const f of inv.forms) {
    if (!byModule.has(f.module)) byModule.set(f.module, []);
    byModule.get(f.module).push(f);
  }
  const modules = [];
  for (const [module, list] of [...byModule].sort((a, b) => a[0].localeCompare(b[0]))) {
    const forms = list.sort((a, b) => a.name.localeCompare(b.name)).map((f) => {
      const noChannel = mobileOnly && f.ch !== "mobile";
      const r = noChannel ? { list: [], owner: null } : r26Owner(f, channel);
      return { name: f.name, ch: f.ch, widgets: f.ids.size, controller: inv.ctrl.has(`${f.ch}|${module}|${f.name}`), r26: r.list.map(({ app, module: m, widgets }) => ({ app, module: m, widgets })), owner: r.owner ? { app: r.owner.app, module: r.owner.module } : null, tie: !!r.tie, noChannel };
    });
    // identical R26 copies (e.g. frmCustomViews in ArrangementsMA and HomepageMA): take the one in the micro app
    // most of this module's other forms belong to
    const major = {};
    for (const f of forms) if (f.owner && !f.tie) major[f.owner.app] = (major[f.owner.app] || 0) + 1;
    for (const f of forms) if (f.tie) {
      const pick = f.r26.filter((c) => c.widgets === Math.max(...f.r26.map((x) => x.widgets))).sort((a, b) => (major[b.app] || 0) - (major[a.app] || 0))[0];
      if (pick) f.owner = { app: pick.app, module: pick.module };
    }
    // where R26 keeps this module's forms
    const apps = {}, r26mods = {};
    for (const f of forms) if (f.owner) { apps[f.owner.app] = (apps[f.owner.app] || 0) + 1; const k = `${f.owner.app}|${f.owner.module}`; r26mods[k] = (r26mods[k] || 0) + 1; }
    const byApp = Object.entries(apps).sort((a, b) => b[1] - a[1]);
    let home, reason, basis;
    if (overrides[module]) { home = overrides[module]; reason = "chosen by you"; basis = "override"; }
    else if (byApp.length) {
      home = byApp[0][0]; basis = byApp.length > 1 ? "split" : "r26";
      reason = byApp.length > 1 ? `R26 splits these forms over ${byApp.length} micro apps (${byApp.map(([a, n]) => `${a} ${n}`).join(", ")})` : `${byApp[0][1]} of ${forms.length} forms are in ${home} in R26`;
    } else {
      const sameName = Object.entries(R26.apps).find(([, a]) => a.mvc.includes(module));
      const near = policy.unmatched === "nearest" ? nearestApp(module, channel) : null;
      if (sameName) { home = sameName[0]; basis = "name"; reason = `R26 has a module named ${module} in ${home}`; }
      else if (near) { home = near; basis = "nearest"; reason = `no R26 form matches — joins the closest existing micro app, ${near}`; }
      else if (R26.apps[newAppName(module)]) { home = newAppName(module); basis = "name"; reason = `R26 has a micro app named ${home}`; }
      else { home = newAppName(module); basis = "new"; reason = "no R26 counterpart — becomes a new micro app"; }
    }
    // R26 module name for the home app (most of the module's forms there)
    const homeMod = Object.entries(r26mods).filter(([k]) => k.startsWith(home + "|")).sort((a, b) => b[1] - a[1])[0];
    const destModuleName = (r26Module) => (policy.naming === "r26" && r26Module ? r26Module : module);
    for (const f of forms) {
      const follow = policy.placement === "form" && f.owner && !overrides[module];
      f.dest = follow ? { app: f.owner.app, module: destModuleName(f.owner.module) } : { app: home, module: destModuleName(homeMod ? homeMod[0].split("|")[1] : null) };
      f.status = f.noChannel ? "channel" : !f.owner ? "kbz" : f.dest.app === f.owner.app ? "same" : "moved";
    }
    const m = inv.mvc.get(module);
    modules.push({ module, kind: "ui", forms, home, basis, reason, split: byApp.length > 1, r26Apps: byApp, mvc: m || null, renamedTo: homeMod ? homeMod[0].split("|")[1] : null });
  }
  // business-only modules (no forms in this channel)
  for (const [module, m] of [...inv.mvc].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (byModule.has(module)) continue;
    const sameName = Object.entries(R26.apps).filter(([, a]) => a.mvc.includes(module)).map(([n]) => n);
    let home, reason, basis;
    if (overrides[module]) { home = overrides[module]; reason = "chosen by you"; basis = "override"; }
    else if (sameName.length) { home = sameName.includes(SHARED.commons) ? SHARED.commons : sameName[0]; basis = "name"; reason = `R26 has ${module} in ${sameName.join(", ")}`; }
    else { home = SHARED.commons; basis = "shared"; reason = "business-only, no R26 counterpart — shared code"; }
    modules.push({ module, kind: "logic", forms: [], home, basis, reason, split: false, r26Apps: [], mvc: m, renamedTo: null });
  }

  // destination micro apps
  const appsOut = new Map();
  const app = (name) => {
    if (!appsOut.has(name)) {
      const k = R26.apps[name] ? R26.apps[name].kind : "new";
      appsOut.set(name, { name, kind: k === "feature" || k === "other" ? "r26" : k, retail: !!(R26.apps[name] && R26.apps[name].listedIn.includes("RESproject.manifest")), business: !!(R26.apps[name] && R26.apps[name].listedIn.includes("BCESproject.manifest")), modules: new Map(), forms: 0, logic: [] });
    }
    return appsOut.get(name);
  };
  for (const m of modules) {
    if (m.kind === "logic") { app(m.home).logic.push(m.module); continue; }
    for (const f of m.forms) {
      const a = app(f.dest.app);
      a.forms++;
      if (!a.modules.has(f.dest.module)) a.modules.set(f.dest.module, { name: f.dest.module, from: new Set(), forms: [] });
      const dm = a.modules.get(f.dest.module);
      dm.from.add(m.module);
      dm.forms.push({ ...f, from: m.module });
    }
    if (m.mvc) app(m.home).logic.push(m.module);
  }
  app(SHARED.commons); app(SHARED.resources);
  const appList = [...appsOut.values()].map((a) => ({ ...a, modules: [...a.modules.values()].map((x) => ({ ...x, from: [...x.from] })) }))
    .sort((a, b) => ({ r26: 0, new: 1, shared: 2, container: 3 })[a.kind] - ({ r26: 0, new: 1, shared: 2, container: 3 })[b.kind] || b.forms - a.forms || a.name.localeCompare(b.name));

  const allForms = modules.flatMap((m) => m.forms);
  const count = (s) => allForms.filter((f) => f.status === s).length;
  const stats = {
    forms: allForms.length, modules: modules.filter((m) => m.kind === "ui").length, logicModules: modules.filter((m) => m.kind === "logic").length,
    apps: appList.filter((a) => a.forms || a.logic.length).length, r26Apps: appList.filter((a) => a.kind === "r26" && a.forms).length,
    newApps: appList.filter((a) => a.kind === "new").length, same: count("same"), moved: count("moved"), kbzOnly: count("kbz"), noChannel: count("channel"),
    splitModules: modules.filter((m) => m.split).length, renamed: modules.filter((m) => m.forms.some((f) => f.dest.module !== m.module)).length,
  };
  return { channel, policy, overrides, modules, apps: appList, stats, release: R26.release, container: R26.container };
}

// CSV of every form's placement
export function planCsv(plan) {
  const rows = [["Monolith module", "Form", "Channel", "Micro app", "Module in micro app", "R26 has it in", "Status", "Reason (module)"]];
  const label = { same: "Same micro app as R26", moved: "Different micro app from R26", kbz: "Monolith only (not in R26)", channel: "No R26 form for this channel" };
  for (const m of plan.modules) {
    if (m.kind === "logic") { rows.push([m.module, "(business logic only)", "", m.home, m.module, "", "", m.reason]); continue; }
    for (const f of m.forms) rows.push([m.module, f.name, f.ch, f.dest.app, f.dest.module, f.r26.map((r) => `${r.app} / ${r.module}`).join("; "), label[f.status], m.reason]);
  }
  return rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

// split one monolith module the way R26 does: each form goes to the micro app R26 keeps it in; forms R26 does not
// have go to `primary`. Returns { "Module/frmX": app } for the forms that do not go to `primary`, and the detail.
export function r26Split(inv, channel, module, primary) {
  const targets = {}, detail = [];
  for (const f of inv.forms.filter((x) => x.module === module)) {
    const r = r26Owner(f, channel);
    const app = r.owner ? r.owner.app : primary;
    detail.push({ form: f.name, app, r26: r.owner ? `${r.owner.app} / ${r.owner.module}` : "not in R26" });
    if (app !== primary) targets[`${module}/${f.name}`] = app;
  }
  return { targets, detail };
}
