// Where every action of a form lives: the widget (form widget, or component instance → inner widget), the file that
// wires the event (designer JSON or a code line), the handler and the controller file it sits in, whether a user can
// reach it (design visibility, shown by code), wiring that code replaces at run time, and the first calls it makes.
import { analyzeFn, getClass, looseJson, clsLabel } from "./blueprint.js";

const isActionsFile = (rel) => /ControllerActions\.js$/.test(rel || "");
const visOf = (o) => (o && "isvisible" in o ? o.isvisible !== false && o.isvisible !== "false" : o && "isVisible" in o ? o.isVisible !== false && o.isVisible !== "false" : null);
const dflt = (v) => (v && typeof v === "object" && "Default" in v ? v.Default : v);

// widget files of one form or component, by id, with the file each one came from
async function widgetFiles(idx, rels) {
  const W = new Map();
  for (const rel of rels) if (rel.endsWith(".json")) { const t = await idx.read(rel); const j = looseJson(t); if (j && j.id) W.set(j.id, { j, rel, text: t || "" }); }
  return W;
}
const compRels = (idx, ns) => [...idx.project.files.keys()].filter((r) => r.startsWith(`userwidgets/${ns}/userwidgetmodel.sm/`) && r.endsWith(".json"));

// "hidden in the design" for one widget id inside a widget map: itself or any parent; diffs = an instance's overrides
function hiddenIn(W, id, diffs) {
  let cur = W.get(id), guard = 0;
  while (cur && guard++ < 60) {
    const d = diffs && diffs[cur.j.id];
    const own = d && d.isRoot ? null : d ? visOf(d.o) : null;
    const v = own != null ? own : visOf(cur.j);
    if (v === false) return cur.j.id;
    cur = cur.j.parent ? W.get(cur.j.parent) : null;
  }
  return null;
}
function diffsOf(inst) {
  const out = {};
  for (const [id, d] of Object.entries((inst && inst.dataDiffs) || {})) {
    if (!d || typeof d !== "object") continue;
    const o = {};
    for (const [k, v] of Object.entries(d)) if (!k.startsWith("__")) o[k] = dflt(v);
    out[id] = { o, isRoot: !!(d.__info__ && d.__info__.isRoot) };
  }
  return out;
}

// every place the code can make a widget visible: path -> [{ fn, rel, line, value, sure }]. A line scan rather than the
// parser, so code inside inline callbacks counts too; commented-out lines do not.
const SHOW = /(?:\bview|getCurrentForm\(\))\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.(?:isVisible\s*=(?!=)\s*([^;]+)|setVisibility\s*\(\s*([^)]*)\))/g;
function showsIn(cls, prefix, into) {
  const owner = (rel, line) => { let best = null; for (const m of cls.members.values()) if (m.rel === rel && m.line <= line && line <= m.end && (!best || m.end - m.line < best.end - best.line)) best = m; return best ? best.name : "(file level)"; };
  for (const [rel, L] of cls.src) {
    let block = false;
    L.forEach((raw, i) => {
      let t = raw;
      if (block) { const e = t.indexOf("*/"); if (e < 0) return; t = t.slice(e + 2); block = false; }
      t = t.replace(/\/\*.*?\*\//g, "");
      const o = t.indexOf("/*"); if (o >= 0) { block = true; t = t.slice(0, o); }
      const c = t.indexOf("//"); if (c >= 0 && !/["'`][^"'`]*\/\//.test(t.slice(0, c + 2))) t = t.slice(0, c);
      for (const m of t.matchAll(SHOW)) {
        const value = (m[2] != null ? m[2] : m[3] || "").trim();
        if (/^(false|!1)$/.test(value)) continue;
        const path = prefix ? `${prefix}.${m[1]}` : m[1];
        if (!into.has(path)) into.set(path, []);
        into.get(path).push({ fn: owner(rel, i + 1), rel, line: i + 1, value, sure: /^(true|!0)$/.test(value) });
      }
    });
  }
}

// the first calls a handler makes beyond its own class: presentation, business, other forms, services, navigation
// inside a component, this.X() that the component does not define raises its event X: the form may handle it as <inst>.X
function nextHops(cls, idx, member, fnNode, outer, inst, entries) {
  const out = [], seen = new Set();
  let screen = 0, missing = [], steps0 = null;
  const visit = (m, node, scope, d, via) => {
    const key = m.name + "@" + node.loc.start.line;
    if (seen.has(key) || d > 5 || out.length >= 5) return;
    seen.add(key);
    let steps;
    try { ({ steps } = analyzeFn(cls, idx, m, node, scope)); } catch { return; }
    if (d === 0) steps0 = steps.filter((s) => s.type !== "i18n");
    for (const s of steps) {
      if (out.length >= 5) break;
      const v = via.length ? ` (via ${via.join(" → ")})` : "";
      switch (s.type) {
        case "pc": out.push({ kind: "pc", text: `${s.module} · presentation ${s.fn}()`, line: s.line, via: v }); break;
        case "bc": out.push({ kind: "bc", text: `${s.module} · business ${s.fn}()`, line: s.line, via: v }); break;
        case "ctrl": out.push({ kind: "ctrl", text: `${s.form}.${s.fn}()`, line: s.line, via: v }); break;
        case "service": out.push({ kind: "service", text: `service ${s.obj}.${s.verb}`, line: s.line, via: v }); break;
        case "nav": out.push({ kind: "nav", text: `opens ${s.form || "a form chosen at run time"}`, line: s.line, via: v }); break;
        case "widget": screen++; break;
        case "self": { const m2 = cls.members.get(s.fn); if (m2) visit(m2, m2.node, undefined, d + 1, [...via, s.fn + "()"]); break; }
        case "local": if (s.fn && s.fn.loc) visit(m, s.fn, undefined, d + 1, [...via, s.name + "()"]); break;
        case "unresolved": {
          if (!/^this\.\w+\(\)$/.test(s.what)) break;
          const ev = s.what.slice(5, -2);
          if (cls.kind === "component" && inst) {
            const h = (entries || []).find((x) => x.widget === inst && x.event === ev && x.member);
            // the component may store the callback itself (setX(cb) { this.X = cb; }) — given at run time, not an event
            const stored = !h && [...cls.src.values()].some((L) => L.some((l) => new RegExp(`\\bthis\\.${ev}\\s*=[^=]`).test(l)));
            if (!out.some((x) => x.event === ev)) out.push(h ? { kind: "event", event: ev, text: `raises ${ev} → form runs ${h.fnNode ? h.handlerLabel || "an inline handler" : h.member.name + "()"}`, line: s.line, via: v }
              : stored ? { kind: "event", event: ev, text: `runs the ${ev} callback the component was given at run time`, line: s.line, via: v }
              : { kind: "event", event: ev, unhandled: true, text: `raises ${ev} — this form does not handle it`, line: s.line, via: v });
          } else if (!missing.some((x) => x.what === s.what)) missing.push({ what: s.what, line: s.line, via: v, rel: m.rel });
          break;
        }
        default: break;
      }
    }
  };
  visit(member, fnNode || member.node, outer, 0, []);
  const hops = out.filter((h, i) => out.findIndex((x) => x.text === h.text) === i);
  return { hops, screen, missing, empty: steps0 != null && steps0.length === 0 };
}

const WHERE = (cls, rel) => {
  const comp = cls.kind === "component";
  return `${comp ? "Component" : "Form"} controller${isActionsFile(rel) ? " actions" : ""}`;
};

export async function locateForm(idx, formKey, A) {
  const f = idx.forms.get(formKey);
  const FW = await widgetFiles(idx, f.files);
  const formFile = [...FW.values()].find((x) => x.j.wType === "Form") || [...FW.values()].find((x) => !x.j.parent);
  const comp = new Map(); // instance id -> { ns, W, diffs, cls } — ns/cls null when the component lives in another app
  for (const x of FW.values()) {
    if (x.j.wType !== "UserWidgetInstance") continue;
    const ns = (A.instances && A.instances.get(x.j.id)) || null;
    comp.set(x.j.id, { ns, kuid: x.j.sourceUserWidget, W: ns ? await widgetFiles(idx, compRels(idx, ns)) : new Map(), diffs: diffsOf(x.j), rel: x.rel, cls: ns ? await getClass(idx, "component", ns) : null });
  }
  // code that shows widgets: the form controller for every path, each component controller for its own widgets
  const shows = new Map();
  if (A.cls) showsIn(A.cls, null, shows);
  for (const [inst, c] of comp) if (c.cls) showsIn(c.cls, inst, shows);

  // where a widget path stands: visible / hidden in design (and by which element) / shown later by code
  const reach = (path) => {
    const segs = path.split(".");
    const inst = comp.has(segs[0]) ? segs[0] : null;
    let hiddenAt = null;
    if (inst) {
      const c = comp.get(inst);
      const h0 = hiddenIn(FW, inst, null);
      const rootDiff = Object.values(c.diffs).find((x) => x.isRoot);
      if (h0) hiddenAt = h0;
      else if (rootDiff && visOf(rootDiff.o) === false) hiddenAt = inst;
      else if (segs.length > 1) {
        // inner widgets: the component's own design (when we have it) and the instance's overrides along the inner path
        const h1 = c.W.size ? hiddenIn(c.W, segs[segs.length - 1], c.diffs) : null;
        const h2 = segs.slice(1).find((id) => c.diffs[id] && !c.diffs[id].isRoot && visOf(c.diffs[id].o) === false);
        if (h1) hiddenAt = `${inst}.${h1}`; else if (h2) hiddenAt = `${inst}.${h2}`;
      }
    } else {
      const id = segs[segs.length - 1];
      if (FW.has(id)) hiddenAt = hiddenIn(FW, id, null);
      else return { state: "unknown" };
    }
    if (!hiddenAt) return { state: "visible" };
    const by = shows.get(hiddenAt) || (hiddenAt.includes(".") ? null : [...shows.entries()].filter(([p]) => p.split(".").pop() === hiddenAt).flatMap(([, v]) => v));
    return by && by.length ? { state: "shown", hiddenAt, by } : { state: "hidden", hiddenAt };
  };

  // which designer files wire an action sequence
  const asFiles = (name, W) => [...W.values()].filter((x) => x.text.includes(`"${name}"`)).map((x) => x.rel);

  const acts = [];
  for (const e of A.entries) {
    const group = e.group === "lifecycle" ? "events" : (e.viewPrefix || (e.widget && comp.has(e.widget.split(".")[0]))) ? "comp:" + (e.viewPrefix || e.widget.split(".")[0]) : "form";
    const inst = group.startsWith("comp:") ? group.slice(5) : null;
    const path = e.widget || f.name;
    const inner = inst && path.startsWith(inst + ".") ? path.slice(inst.length + 1) : inst ? "" : null;
    // wiring
    const wired = [];
    if (e.id.startsWith("as:")) {
      const files = asFiles(e.member.name, FW);
      if (files.length) for (const rel of files) wired.push({ how: "designer", rel, text: rel.split("/").slice(-2).join("/") });
      else wired.push({ how: "none" });
    } else if (e.id.startsWith("cas:")) {
      for (const rel of asFiles(e.member.name, comp.get(inst).W)) wired.push({ how: "designer", rel, text: `${(comp.get(inst).ns || "").split(".").pop()} component · ${rel.split("/").pop()}` });
    } else if (e.id.startsWith("code:") || e.id.startsWith("ccode:")) {
      const owner = e.cls.members.get(e.setIn);
      const line = Number(e.id.split(":")[e.id.startsWith("code:") ? 2 : 3]);
      wired.push({ how: "code", rel: owner && owner.rel, line, from: owner ? owner.line : line, to: owner ? owner.end : line + 30, text: `${e.setIn}() line ${line}`, conds: e.conds });
    } else if (e.id === "lc:onNavigate") wired.push({ how: "framework", text: "called by the MVC framework every time the form is navigated to" });
    // handler
    let handler = null;
    if (e.member) {
      const node = e.fnNode || e.member.node;
      handler = { name: e.fnNode ? e.handlerLabel || "inline function" : e.member.name, rel: e.member.rel, line: node.loc.start.line, end: node.loc.end.line, where: WHERE(e.cls, e.member.rel), owner: clsLabel(e.cls), inline: !!e.fnNode };
    }
    const nh = e.member ? nextHops(e.cls, idx, e.member, e.fnNode, e.outerScope, inst, A.entries) : { hops: [], screen: 0, missing: [], empty: false };
    acts.push({ id: e.id, entry: e, group, inst, path, inner, event: e.event, wired, handler, ...nh, reach: group === "events" ? { state: "form" } : reach(path), status: [] });
  }

  // run-time replacements: the same widget event wired by the designer and set again in code, or set in several places
  const byKey = new Map();
  for (const a of acts) { if (a.group === "events") continue; const k = a.path + "|" + a.event; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(a); }
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const des = list.filter((a) => a.wired.some((w) => w.how === "designer")), code = list.filter((a) => a.wired.some((w) => w.how === "code"));
    for (const a of des) if (code.length) a.status.push({ tone: "warn", text: `Replaced at run time: code sets this event again in ${code.map((c) => c.wired[0].text).join(", ")}${code.some((c) => c.entry.conds && c.entry.conds.length) ? " (only under a condition)" : ""}` });
    for (const a of code) {
      if (des.length) a.status.push({ tone: "info", text: "Replaces the event the designer wired (the code runs later, so this one wins)" });
      if (code.length > 1) a.status.push({ tone: "info", text: `Set in ${code.length} places in code — the last one to run wins` });
    }
  }
  for (const a of acts) {
    const e = a.entry;
    if (!e.member) {
      // what the right-hand side of "widget.onX = …" is, when it is not a function of this class
      const h = (e.unresolved || "").replace(/^handler /, "").replace(/ is not a function of this (controller|component)$/, "").trim();
      const pc = h.match(/presentationController\.(\w+)/), self = h.match(/^(?:this|self|scopeObj|scope|that|me)\.(\w+)$/);
      if (/^(null|undefined|""|'')$/.test(h)) { a.cleared = true; a.status.push({ tone: "info", text: "Clears the event (sets it to nothing) — no handler runs" }); }
      else if (pc) { a.handler = { name: `${pc[1]}()`, where: "Presentation controller", owner: h.split(".presentationController")[0], text: h }; a.hops.unshift({ kind: "pc", text: `presentation ${pc[1]}()`, via: "" }); a.status.push({ tone: "info", text: "The handler is a presentation controller function itself — no form code runs first" }); }
      else if (self && idx.protoFns && idx.protoFns.has(self[1])) { const pf = idx.protoFns.get(self[1]); a.handler = { name: self[1], where: "Shared on every controller", owner: pf.owner, ...(idx.project.files.has(pf.rel) ? { rel: pf.rel, line: pf.line, end: pf.line + 30 } : { text: `${pf.owner}.prototype · ${pf.rel}` }) }; }
      else if (self) a.status.push({ tone: "bad", text: `Handler ${h} is not defined in ${clsLabel(e.cls)} — nothing runs` });
      else if (/\)\s*$/.test(h)) a.status.push({ tone: "info", text: `The handler is built at run time by ${h} — open the code to follow it` });
      else a.status.push({ tone: "info", text: `The handler comes from ${h || "a value"} at run time — open the code to follow it` });
    }
    if (a.wired[0] && a.wired[0].how === "none") a.status.push({ tone: "bad", text: "Not wired to any widget in the form files — this action sequence never runs" });
    // a missing function behind a widget nobody can reach is leftover code, not a live failure
    const dead = a.reach.state === "hidden";
    for (const m of a.missing) a.status.push({ tone: dead ? "warn" : "bad", text: `Calls ${m.what}${m.via}, which is not defined in ${a.handler ? a.handler.owner : "this class"} — ${dead ? "leftover code: it would fail, but the widget is hidden" : "it would fail if it ran"}` });
    for (const x of a.hops) if (x.unhandled) a.status.push({ tone: "info", text: `The component raises ${x.event}, but this form wires no handler to ${a.inst}.${x.event} — nothing happens on the form` });
    if (a.empty) a.status.push({ tone: "warn", text: "Empty handler — it does nothing" });
    if (a.reach.state === "hidden") a.status.push({ tone: "warn", text: `Hidden in the design (${a.reach.hiddenAt === a.path ? "the widget itself" : a.reach.hiddenAt}) and nothing in this form's controller shows it — users cannot reach it` });
    if (a.reach.state === "shown") a.status.push({ tone: "info", text: `Hidden at first (${a.reach.hiddenAt}); shown by code in ${[...new Set(a.reach.by.map((b) => b.fn + "()"))].slice(0, 3).join(", ")}${a.reach.by.some((b) => !b.sure) ? " (depending on a condition)" : ""}` });
    if (e.conds && e.conds.length) a.status.push({ tone: "info", text: `Wired only ${e.conds[e.conds.length - 1]}` });
    a.problem = a.status.some((s) => s.tone === "bad") ? "bad" : a.status.some((s) => s.tone === "warn") ? "warn" : null;
  }

  const groups = [];
  const ev = acts.filter((a) => a.group === "events");
  if (ev.length) groups.push({ id: "events", kind: "events", title: "Form events", acts: ev });
  const fw = acts.filter((a) => a.group === "form");
  if (fw.length) groups.push({ id: "form", kind: "form", title: "Form widgets", acts: fw });
  for (const [inst, c] of comp) {
    const list = acts.filter((a) => a.group === "comp:" + inst);
    if (!list.length) continue;
    groups.push({ id: "comp:" + inst, kind: "component", title: inst, ns: c.ns, kuid: c.kuid, rel: c.rel, files: c.cls ? c.cls.files : [], reach: reach(inst), acts: list });
  }
  return {
    form: { name: f.name, module: f.module, key: formKey, rel: formFile && formFile.rel, folder: formFile ? formFile.rel.split("/").slice(0, -1).join("/") : null, ctrl: A.cls ? A.cls.files : [] },
    groups, acts,
    counts: { acts: acts.length, comps: groups.filter((g) => g.kind === "component").length, bad: acts.filter((a) => a.problem === "bad").length, warn: acts.filter((a) => a.problem === "warn").length },
  };
}
