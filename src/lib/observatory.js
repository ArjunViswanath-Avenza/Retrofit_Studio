// Observatory: a whole project as a sky. A monolith's modules (or a micro-app project's micro apps) are galaxies, every
// form is a solar system, and the links between them are navigation (form → form), shared components and code calls
// that cross into another galaxy. Two phases: universe() builds the skeleton straight from the project index (fast),
// surveyForm() then reads one form's controller, components and the presentation / business code it reaches.
import { loadProject, buildIndex, getClass, analyzeFn, componentIndex, looseJson } from "./blueprint.js";

const PROPS = /(^|\/)projectProperties\.json$/;

// one folder: a monolith or a single micro app (one projectProperties.json at the top), or a micro-app project
// (a folder of micro apps, each its own Visualizer project)
export function readSky(fileList) {
  const all = [...fileList];
  const path = (f) => (f.webkitRelativePath || f.name).replace(/\\/g, "/");
  const dirs = [];
  for (const f of all) { const p = path(f); if (PROPS.test(p)) dirs.push(p.slice(0, p.length - "projectProperties.json".length)); }
  if (!dirs.length) return { kind: "none", name: all.length ? path(all[0]).split("/")[0] : "", projects: [], channels: {} };
  const depth = (d) => d.split("/").length;
  const min = Math.min(...dirs.map(depth));
  const top = dirs.filter((d) => depth(d) === min).filter((d) => !/__appextensions__/.test(d));
  const projects = top.map((dir) => {
    const list = all.filter((f) => path(f).startsWith(dir));
    return { name: dir.replace(/\/$/, "").split("/").pop(), dir, project: loadProject(list) };
  });
  const channels = {};
  for (const p of projects) for (const [ch, n] of Object.entries(p.project.channels)) channels[ch] = (channels[ch] || 0) + n;
  const composite = projects.length > 1;
  return { kind: composite ? "microapps" : "monolith", name: composite ? top[0].replace(/\/$/, "").split("/").slice(0, -1).pop() || "micro apps" : projects[0].name, projects, channels };
}

/* ---------------------------------------------------------------- phase 1: the skeleton */
export async function universe(sky, ch) {
  const apps = [];
  for (const p of sky.projects) apps.push({ name: p.name, idx: await buildIndex(p.project, ch) });
  const galaxies = [], systems = [];
  const sysByName = new Map(); // form name -> [system]
  const add = (s) => { systems.push(s); if (!sysByName.has(s.name)) sysByName.set(s.name, []); sysByName.get(s.name).push(s); };
  if (sky.kind === "monolith") {
    const { idx } = apps[0];
    for (const M of [...idx.modules.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const g = { id: "g:" + M.name, name: M.name, kind: "module", app: apps[0].name, modules: [M.name], systems: [], pc: M.pcFiles.length, bc: M.bcFiles.length };
      galaxies.push(g);
    }
    for (const f of idx.forms.values()) {
      const g = galaxies.find((x) => x.name === f.module);
      if (!g) continue;
      const s = { id: `s:${g.name}/${f.name}`, name: f.name, key: f.key, module: f.module, galaxy: g.id, app: apps[0].name, files: f.files.length, idxApp: 0 };
      g.systems.push(s.id); add(s);
    }
  } else {
    apps.forEach((a, ai) => {
      const mods = [...a.idx.modules.values()].map((m) => m.name).sort();
      const g = { id: "g:" + a.name, name: a.name, kind: "microapp", app: a.name, modules: mods, systems: [], pc: [...a.idx.modules.values()].reduce((n, m) => n + m.pcFiles.length, 0), bc: [...a.idx.modules.values()].reduce((n, m) => n + m.bcFiles.length, 0) };
      galaxies.push(g);
      for (const f of a.idx.forms.values()) {
        const s = { id: `s:${a.name}/${f.key}`, name: f.name, key: f.key, module: f.module, galaxy: g.id, app: a.name, files: f.files.length, idxApp: ai };
        g.systems.push(s.id); add(s);
      }
    });
  }
  return { kind: sky.kind, name: sky.name, ch, apps, galaxies, systems, sysById: new Map(systems.map((s) => [s.id, s])), galById: new Map(galaxies.map((g) => [g.id, g])), sysByName, memo: new Map(), comps: null };
}

// the galaxy a module (and, in micro apps, an app) belongs to
export function galaxyOf(U, app, module) {
  if (U.kind === "monolith") return U.galById.get("g:" + module) || null;
  return U.galById.get("g:" + (app || "")) || null;
}
// a form name (and its app, when the code names one) to a solar system, preferring the caller's own galaxy and app
export function resolveForm(U, name, app, from) {
  const list = U.sysByName.get(name);
  if (!list || !list.length) return null;
  if (app) { const x = list.find((s) => s.app === app); if (x) return x; }
  return list.find((s) => s.galaxy === from.galaxy) || list.find((s) => s.app === from.app) || list[0];
}

// every component across the project by its kuid: { app, ns } — micro apps use components that live in another app
async function compIndex(U) {
  if (U.comps) return U.comps;
  const m = new Map();
  for (const a of U.apps) for (const [kuid, ns] of await componentIndex(a.idx)) if (!m.has(kuid)) m.set(kuid, { app: a.name, ns });
  U.comps = m;
  return m;
}

/* ---------------------------------------------------------------- phase 2: one form */
// what a presentation / business function leads to, following its own class and other modules a few levels deep
async function reach(U, appName, kind, module, fn, depth = 0) {
  const key = `${appName}|${kind}|${module}|${fn}`;
  if (U.memo.has(key)) return U.memo.get(key);
  const out = { navs: [], services: [], calls: [], missing: false };
  U.memo.set(key, out); // recursion guard: a cycle sees the (still filling) result
  const a = U.apps.find((x) => x.name === appName) || U.apps[0];
  let cls;
  try { cls = await getClass(a.idx, kind, module); } catch { out.missing = true; return out; }
  const visit = async (m, d) => {
    let steps;
    try { ({ steps } = analyzeFn(cls, a.idx, m, m.node)); } catch { return; }
    for (const s of steps) {
      if (s.type === "nav" && s.form) out.navs.push({ form: s.form, app: s.app || a.name });
      else if (s.type === "present" && s.form) out.navs.push({ form: s.form, app: a.name });
      else if (s.type === "service") out.services.push(`${s.svcKind === "model" ? "object" : s.svcKind}: ${s.obj}.${s.verb}`);
      else if (s.type === "self") { const m2 = cls.members.get(s.fn); if (m2 && d < 4 && !seen.has(m2.name)) { seen.add(m2.name); await visit(m2, d + 1); } }
      else if ((s.type === "pc" || s.type === "bc") && s.module) {
        const app = s.app || a.name;
        out.calls.push({ kind: s.type, module: s.module, app, fn: s.fn });
        if (depth < 3) { const r = await reach(U, app, s.type, s.module, s.fn, depth + 1); out.navs.push(...r.navs); out.services.push(...r.services); }
      }
    }
  };
  const m = cls.members.get(fn);
  const seen = new Set([fn]);
  if (!m) out.missing = true; else await visit(m, 0);
  out.services = [...new Set(out.services)];
  return out;
}

export async function surveyForm(U, s) {
  const a = U.apps[s.idxApp];
  const idx = a.idx, f = idx.forms.get(s.key);
  const comps = await compIndex(U);
  // components on the screen (instances), and how many widgets it has
  const used = new Map();
  for (const rel of f.files) {
    if (!rel.endsWith(".json")) continue;
    const t = await idx.read(rel);
    if (!t || !t.includes("UserWidgetInstance")) continue;
    const j = looseJson(t);
    if (j && j.wType === "UserWidgetInstance" && j.sourceUserWidget) {
      const c = comps.get(j.sourceUserWidget);
      const key = c ? `${c.app}:${c.ns}` : `?:${j.sourceUserWidget}`;
      if (!used.has(key)) used.set(key, { key, ns: c ? c.ns : null, app: c ? c.app : null, kuid: j.sourceUserWidget, instances: [] });
      used.get(key).instances.push(j.id);
    }
  }
  // the form controller: everything it calls, opens and wires
  const keys = idx.ctrlByForm.get(f.name) || [];
  const ck = keys.find((k) => k.startsWith(f.module + "/")) || keys[0];
  const res = { comps: [...used.values()], ctrl: null, actions: 0, calls: [], navs: [], services: [], ctrlCalls: [], reached: new Map() };
  if (ck) {
    const cls = await getClass(idx, "controller", ck);
    const actRel = cls.files.find((r) => /ControllerActions\.js$/.test(r));
    res.ctrl = { name: ck.split("/").pop(), files: cls.files, members: cls.members.size, lines: [...cls.src.values()].reduce((n, L) => n + L.length, 0) };
    const callKeys = new Set();
    for (const m of cls.members.values()) {
      if (m.rel === actRel && /^AS_/.test(m.name)) res.actions++;
      if (["preShow", "postShow", "onNavigate", "init", "onBreakpointChange"].includes(m.name)) res.actions++;
      let steps;
      try { ({ steps } = analyzeFn(cls, idx, m, m.node)); } catch { continue; }
      for (const st of steps) {
        if (st.type === "bind") res.actions++;
        else if (st.type === "nav" && st.form) res.navs.push({ form: st.form, app: st.app || a.name, via: `${m.name}()` });
        else if (st.type === "present" && st.form) res.navs.push({ form: st.form, app: a.name, via: `${m.name}()` });
        else if (st.type === "service") res.services.push(`${st.svcKind === "model" ? "object" : st.svcKind}: ${st.obj}.${st.verb}`);
        else if (st.type === "ctrl" && st.form && st.form !== f.name) res.ctrlCalls.push({ form: st.form, fn: st.fn, via: `${m.name}()` });
        else if ((st.type === "pc" || st.type === "bc") && st.module) {
          const k = `${st.type}|${st.app || a.name}|${st.module}|${st.fn}`;
          if (!callKeys.has(k)) { callKeys.add(k); res.calls.push({ kind: st.type, module: st.module, app: st.app || a.name, fn: st.fn, via: `${m.name}()` }); }
        }
      }
    }
    // what those presentation / business calls lead to: more navigation, services, and the business code behind them
    for (const c of res.calls) {
      const r = await reach(U, c.app, c.kind, c.module, c.fn);
      res.reached.set(`${c.kind}|${c.app}|${c.module}|${c.fn}`, r);
      for (const n of r.navs) res.navs.push({ ...n, via: `${c.module}.${c.fn}()` });
      res.services.push(...r.services);
    }
  }
  res.services = [...new Set(res.services)];
  return res;
}

/* ---------------------------------------------------------------- the links, from every surveyed form */
// kinds: nav (form → form), comp (forms sharing a component), call (a form's code reaching another galaxy, or another form's controller)
export function linksOf(U, surveys, { commonShare = 0.35 } = {}) {
  const nav = new Map(), call = new Map(), compUse = new Map();
  for (const s of U.systems) {
    const R = surveys.get(s.id);
    if (!R) continue;
    for (const n of R.navs) {
      const t = resolveForm(U, n.form, n.app, s);
      if (!t || t.id === s.id) continue;
      const k = s.id + ">" + t.id;
      if (!nav.has(k)) nav.set(k, { kind: "nav", from: s.id, to: t.id, via: new Set() });
      nav.get(k).via.add(n.via);
    }
    for (const c of R.ctrlCalls) {
      const t = resolveForm(U, c.form, null, s);
      if (!t || t.id === s.id) continue;
      const k = s.id + ">" + t.id;
      if (!call.has(k)) call.set(k, { kind: "call", from: s.id, to: t.id, toGalaxy: t.galaxy, fns: new Set() });
      call.get(k).fns.add(`${c.form}.${c.fn}()`);
    }
    for (const c of R.calls) {
      const g = galaxyOf(U, c.app, c.module);
      if (!g || g.id === s.galaxy) continue;
      const k = s.id + ">" + g.id;
      if (!call.has(k)) call.set(k, { kind: "call", from: s.id, to: null, toGalaxy: g.id, fns: new Set() });
      call.get(k).fns.add(`${c.module} ${c.kind === "pc" ? "presentation" : "business"}.${c.fn}()`);
    }
    for (const c of R.comps) { if (!compUse.has(c.key)) compUse.set(c.key, { key: c.key, ns: c.ns, app: c.app, systems: [] }); compUse.get(c.key).systems.push(s.id); }
  }
  const surveyed = surveys.size || 1;
  const components = [...compUse.values()].map((c) => ({ ...c, common: c.systems.length / surveyed >= commonShare && c.systems.length > 8 }));
  // galaxy to galaxy, summed by kind
  const gl = new Map();
  const bump = (a, b, kind, n = 1) => { if (!a || !b || a === b) return; const [x, y] = a < b ? [a, b] : [b, a]; const k = `${x}|${y}`; if (!gl.has(k)) gl.set(k, { a: x, b: y, nav: 0, call: 0, comp: 0 }); gl.get(k)[kind] += n; };
  for (const l of nav.values()) bump(U.sysById.get(l.from).galaxy, U.sysById.get(l.to).galaxy, "nav");
  for (const l of call.values()) bump(U.sysById.get(l.from).galaxy, l.toGalaxy, "call");
  for (const c of components) {
    if (c.common) continue;
    const gs = [...new Set(c.systems.map((id) => U.sysById.get(id).galaxy))];
    for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) bump(gs[i], gs[j], "comp");
  }
  return { nav: [...nav.values()], call: [...call.values()], components, galaxyLinks: [...gl.values()] };
}
